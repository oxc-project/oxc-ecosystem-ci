#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { strip } from "json-strip-comments";

const DEFAULT_CONFIG_FILES = [".oxlintrc.json"];

/**
 * Read a config file and collect jsPlugins into the set.
 *
 * Example config structure:
 * ```json
 * {
 *   "jsPlugins": [
 *     "eslint-plugin-example",
 *     { "specifier": "eslint-plugin-another", "name": "eslint-plugin-another" }
 *   ]
 * }
 * ```
 *
 * @param {string} configPath
 * @param {Set<string>} set
 */
function readConfigAndCollect(configPath, set) {
  if (!fs.existsSync(configPath)) {
    return;
  }

  try {
    let raw = fs.readFileSync(configPath, "utf8");
    raw = strip(raw);
    const obj = JSON.parse(raw);
    const arr = Array.isArray(obj.jsPlugins) ? obj.jsPlugins : [];
    for (const it of arr) {
      if (!it) continue;
      if (typeof it === "string") set.add(it.trim());
      else if (typeof it === "object" && it !== null) {
        if (typeof it.specifier === "string") set.add(it.specifier.trim());
        else if (typeof it.name === "string") set.add(it.name.trim());
      }
    }
  } catch (e) {
    console.warn("Could not parse", configPath, ":", e.message);
  }
}

// Sometimes this is `echo "skip"`, make sure not to error on that.
function collectFromCommand(cmd, set) {
  if (!cmd) { return; }
  // skip if command includes "skip"
  if (/\bskip\b/.test(cmd)) { return; }
  // match -c <arg> and --config <arg>, allow quoted paths
  const patterns = [
    /((?:^|\s)-c)\s+(['"])?([^\s'"]+)\2/g,
    /((?:^|\s)--config)\s+(['"])?([^\s'"]+)\2/g,
  ];

  for (const re of patterns) {
    let m;
    while ((m = re.exec(cmd)) !== null) {
      const rawPath = m[3];
      if (!rawPath) { continue; }
      const p = path.resolve(process.cwd(), rawPath);
      readConfigAndCollect(p, set);
    }
  }
}

function collectDefaultIfEmpty(set) {
  if (set.size > 0) { return; }
  for (const f of DEFAULT_CONFIG_FILES) {
    const p = path.join(process.cwd(), f);
    if (fs.existsSync(p)) {
      readConfigAndCollect(p, set);
      return;
    }
  }
}

/**
 * Detect which package manager to use based on lock files in the directory.
 * @param {string} dir
 * @returns {'pnpm' | 'yarn' | 'bun' | 'npm'}
 */
function detectPackageManager(dir) {
  if (fs.existsSync(path.join(dir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(dir, 'yarn.lock'))) return 'yarn';
  if (fs.existsSync(path.join(dir, 'bun.lock')) || fs.existsSync(path.join(dir, 'bun.lockb'))) return 'bun';
  if (fs.existsSync(path.join(dir, 'package-lock.json'))) return 'npm';
  return 'npm';
}

/**
 * Remove `oxlint` from package.json dependencies so the repo's install
 * doesn't conflict with our manually-built version.
 *
 * @param {string} dir
 * @returns {boolean} Whether package.json was modified
 */
function removeOxlintFromPackageJson(dir) {
  const pkgPath = path.join(dir, 'package.json');
  if (!fs.existsSync(pkgPath)) return false;

  try {
    const raw = fs.readFileSync(pkgPath, 'utf8');
    const pkg = JSON.parse(raw);
    let modified = false;

    for (const depType of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      if (pkg[depType] && pkg[depType]['oxlint']) {
        console.log(`Removing oxlint from ${depType} in ${pkgPath}`);
        delete pkg[depType]['oxlint'];
        modified = true;
      }
    }

    if (modified) {
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    }

    return modified;
  } catch (e) {
    console.warn('Could not process package.json:', e.message);
    return false;
  }
}

/**
 * Run the repo's package manager install.
 *
 * @param {string} dir
 * @param {boolean} pkgJsonModified Whether package.json was modified (affects lockfile flags)
 */
function runInstall(dir, pkgJsonModified) {
  const pm = detectPackageManager(dir);
  console.log(`Detected package manager: ${pm}`);

  const args = ['install'];

  // If we modified package.json (removed oxlint), tell the package manager
  // not to error on lockfile mismatch.
  if (pkgJsonModified) {
    if (pm === 'pnpm') args.push('--no-frozen-lockfile');
    if (pm === 'yarn') args.push('--no-immutable');
  }

  console.log(`Running: ${pm} ${args.join(' ')} in ${dir}`);

  const res = spawnSync(pm, args, {
    stdio: 'inherit',
    cwd: dir,
    shell: false,
  });

  if (res.error) {
    throw res.error;
  }
  if (res.status !== 0) {
    throw new Error(`${pm} install failed with exit code ${res.status}`);
  }

  console.log('Install completed successfully.');
}

// Attempt to find a built oxlint package and copy it into the target repo's node_modules as `oxlint`.
function findBuiltOxlintSource() {
  const tryPaths = [];
  // Common locations used in CI artifacts/workflows relative to the repository being tested
  // e.g. ../oxlint-package/npm/oxlint and ../oxlint-package/apps/oxlint/dist
  let up = process.cwd();
  for (let i = 0; i < 4; i++) {
    tryPaths.push(path.join(up, 'oxlint-package'));
    tryPaths.push(path.join(up, 'oxlint-install'));
    up = path.dirname(up);
  }

  for (const base of tryPaths) {
    const npmPkg = path.join(base, 'npm', 'oxlint', 'package.json');
    const distDir = path.join(base, 'apps', 'oxlint', 'dist');
    if (fs.existsSync(npmPkg) && fs.existsSync(distDir)) {
      return { type: 'artifact', base, npmPkg, distDir };
    }
    // also allow copying from an oxlint-install layout
    const altPkg = path.join(base, 'package.json');
    const altDist = path.join(base, 'dist');
    if (fs.existsSync(altPkg) && fs.existsSync(altDist)) {
      return { type: 'install', base, npmPkg: altPkg, distDir: altDist };
    }
  }

  // As a last resort, see if oxlint is installed globally and copy from there
  try {
    const r = spawnSync('npm', ['root', '-g'], { shell: false, stdio: ['ignore', 'pipe', 'inherit'] });
    if (r && r.stdout) {
      const globalRoot = r.stdout.toString().trim();
      const globalPkg = path.join(globalRoot, 'oxlint');
      const globalPkgJson = path.join(globalPkg, 'package.json');
      const globalDist = path.join(globalPkg, 'dist');
      if (fs.existsSync(globalPkgJson) && fs.existsSync(globalDist)) {
        return { type: 'global', base: globalPkg, npmPkg: globalPkgJson, distDir: globalDist };
      }
    }
  } catch (_err) {
    // ignore
  }

  return null;
}

function copyBuiltOxlintIntoNodeModules(installDir) {
  const dest = path.join(installDir, 'node_modules', 'oxlint');

  // Remove existing oxlint in node_modules so we always use our built version.
  if (fs.existsSync(dest)) {
    console.log('Removing existing oxlint from', dest);
    fs.rmSync(dest, { recursive: true, force: true });
  }

  const src = findBuiltOxlintSource();
  if (!src) {
    return false;
  }

  try {
    fs.mkdirSync(dest, { recursive: true });
    // copy package.json
    const pkgJsonSrc = src.npmPkg;
    if (fs.existsSync(pkgJsonSrc)) {
      fs.copyFileSync(pkgJsonSrc, path.join(dest, 'package.json'));
    }
    // copy dist
    if (fs.existsSync(src.distDir)) {
      fs.cpSync(src.distDir, path.join(dest, 'dist'), { recursive: true, force: true });
    }

    // If there is a bin dir (from npm package bundle), copy it too
    const binSrc = path.join(src.base, 'bin');
    if (fs.existsSync(binSrc)) {
      fs.cpSync(binSrc, path.join(dest, 'bin'), { recursive: true, force: true });
    }

    console.log('Copied built oxlint from', src.base, '=>', dest);
    return true;
  } catch (err) {
    console.warn('Failed to copy built oxlint:', err && err.message);
    return false;
  }
}

function main() {
  const cmd = process.env.MATRIX_COMMAND || "";
  const set = new Set();

  collectFromCommand(cmd, set);
  collectDefaultIfEmpty(set);

  if (set.size === 0) {
    console.log("No JS plugins found, skipping install.");
    return;
  }

  console.log("JS plugins detected:", Array.from(set).join(", "));

  const dir = process.cwd();

  // Remove oxlint from package.json so the install doesn't conflict
  // with our manually-built version.
  const pkgJsonModified = removeOxlintFromPackageJson(dir);

  // Run the repo's package manager install to get all dependencies,
  // including any JS plugin packages.
  try {
    runInstall(dir, pkgJsonModified);
  } catch (e) {
    console.error("Install failed:", e.message);
    process.exit(1);
  }

  // Always attempt to copy built oxlint into node_modules so local plugins can import it.
  // This overwrites whatever version was installed by the package manager.
  try {
    if (copyBuiltOxlintIntoNodeModules(dir)) {
      console.log('Installed built `oxlint` into', path.join(dir, 'node_modules', 'oxlint'));
    } else {
      console.log('No built `oxlint` artifact found to install.');
    }
  } catch (err) {
    console.warn('Could not install built oxlint:', err && err.message);
  }
}

main();
