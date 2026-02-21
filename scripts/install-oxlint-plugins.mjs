#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import os from "node:os";
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
 * If any relative-path plugin files are listed in `rawSet`, add `@oxlint/plugins`
 * to `installSet` since local oxlint JS plugins require it.
 *
 * @param {Set<string>} rawSet All values collected from jsPlugins (including relative paths)
 * @param {Set<string>} installSet Set to add detected npm packages to
 */
function collectFromLocalPlugins(rawSet, installSet) {
  for (const s of rawSet) {
    if (typeof s !== 'string') continue;
    if (!s.startsWith('./') && !s.startsWith('../')) continue;
    installSet.add('@oxlint/plugins');
    return;
  }
}

/**
 * Install only valid plugin packages, we don't want/need to install packages
 * from relative paths and we don't want any non-plugin packages to be
 * installed if we can avoid it.
 *
 * @param {string[]} plugins The contents of the `jsPlugins` field in the oxlint json config.
 * @returns {string[]} Filtered list of plugin package names, NOTE that the values returned from this
 *   function are not guaranteed to be safe! Further validation should be done and care needs to be taken.
 */
function filterInstallable(plugins) {
  // dedupe and normalize
  const unique = Array.from(new Set(plugins.map((s) => (typeof s === "string" ? s.trim() : s))));

  return unique.filter((s) => {
    // skip non-strings
    if (typeof s !== "string") {
      return false;
    }

    // skip anything with spaces, probably a bad value
    if (s.includes(" ")) {
      return false;
    }

    // skip plugins that are relative file paths
    if (s.startsWith("./") || s.startsWith("../") || s.startsWith("/")) {
      return false;
    }

    // Allow strings starting with the `eslint-plugin-` prefix
    if (/^eslint-plugin-([\w_-]+)$/.test(s)) {
      return true;
    }

    // disallow anything that isn't in the shape of `@foo-bar/eslint-plugin` or `@foo-bar/eslint-plugin-baz`.
    // Only dashes, underscores, and letters/numbers allowed in the names.
    if (/^@[\w_-]+\/eslint-plugin(-[\w_-]+)?$/.test(s)) {
      return true;
    }

    // Allow @oxlint/plugins (used as a peer dependency by local oxlint JS plugins)
    if (s === '@oxlint/plugins') {
      return true;
    }

    return false;
  });
}

/**
 * Regex to filter values that are invalid package names.
 * Should only allow strings like the following:
 * - eslint-plugin-name
 * - @foo/eslint-plugin
 * - @foo-bar/eslint-plugin
 * - @foo-bar/eslint-plugin-name
 * - @foo-bar/eslint-plugin-name_with_underscores
 * - @oxlint/plugins
 */
const PACKAGE_REGEX = /^(?:eslint-plugin-[A-Za-z0-9_-]+|@[A-Za-z0-9_-]+\/eslint-plugin(?:-[A-Za-z0-9_-]+)?|@oxlint\/plugins)$/;

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
  if (fs.existsSync(dest)) {
    console.log('`oxlint` already present in', dest);
    return true;
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

/**
 * Install npm packages, we do this locally from the config file's directory.
 * @param {string[]} pkgs npm packages that will need to be installed for jsPlugins to work.
 * @throws Will throw an error if installation fails or package names are invalid.
 */
function installPackages(pkgs) {
  if (!pkgs || pkgs.length === 0) {
    return;
  }

  // Validate that all package names are in the expected format.
  // Throw an error if there are any invalid or unsafe package names and list them
  // so it's easier to debug failures from CI logs.
  const invalidPkgs = pkgs.filter(p => !PACKAGE_REGEX.test(p));
  if (invalidPkgs.length > 0) {
    throw new Error('Refusing to install invalid or unsafe package names: ' + invalidPkgs.join(', '));
  }

  // Determine installation directory from config file location
  // TODO: Need to handle the case where there is a config file nested in a subdirectory.
  const installDir = process.cwd();
  
  console.log("Installing packages in", installDir, ":", pkgs.join(", "));

  // Using spawnSync with args array here to try to avoid shell interpretation.
  // Use stdio: 'pipe' so we can inspect the output and detect specific errors
  // and still emit the logs to the console.
  const args = ['install', '--ignore-scripts', ...pkgs];
  let res = spawnSync('npm', args, {
    stdio: 'pipe', 
    shell: false,
    cwd: installDir // Install in the config file's directory
  });

  // Emit logged output so CI shows the output even when we capture it
  if (res.stdout && res.stdout.length > 0) {
    process.stdout.write(res.stdout);
  }
  if (res.stderr && res.stderr.length > 0) {
    process.stderr.write(res.stderr);
  }

  if (res.error) {
    // If we got an error that indicates "workspace:" protocol is unsupported, fall back
    // to installing in a temporary directory and copying node_modules into the repo.
    if (res.error.code === 'EUNSUPPORTEDPROTOCOL' || (res.error.message && /workspace:/.test(res.error.message))) {
      console.warn('npm reported unsupported workspace protocol, retrying install in temporary directory...');
    } else {
      throw res.error;
    }
  }

  // If npm failed (non-zero) and stderr mentions "workspace:" or "EUNSUPPORTEDPROTOCOL", fallback
  const stderrStr = res.stderr ? res.stderr.toString() : '';
  const stdoutStr = res.stdout ? res.stdout.toString() : '';
  if (res.status !== 0 && (/Unsupported URL Type "workspace"/i.test(stderrStr) || /workspace:/.test(stderrStr) || /EUNSUPPORTEDPROTOCOL/.test(stderrStr) || /workspace:/.test(stdoutStr))) {
    // Fallback: install into a temporary directory without the repository package.json interfering,
    // then copy the installed packages into the repo's node_modules.
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'install-oxlint-'));
    console.log('Fallback: installing packages in temporary directory', tmpDir);

    // Collect peer dependencies for the requested plugins so the fallback install
    // includes them (many plugins declare peers that are required at runtime).
    function collectPeerDepsSync(requestedPkgs) {
      const peerSet = new Set();
      for (const p of requestedPkgs) {
        try {
          const r = spawnSync('npm', ['view', p, 'peerDependencies', '--json'], {
            stdio: ['ignore', 'pipe', 'inherit'],
            shell: false
          });
          if (r.status !== 0 || !r.stdout) {
            continue;
          }
          const out = r.stdout.toString().trim();
          if (!out || out === 'null') continue;
          const obj = JSON.parse(out);
          if (obj && typeof obj === 'object') {
            for (const k of Object.keys(obj)) {
              // ignore peer deps that are workspace: specifiers or look unsafe
              if (typeof k === 'string' && k.length > 0) {
                peerSet.add(k);
              }
            }
          }
        } catch (err) {
          // non-fatal, warn and continue
          console.warn('Could not fetch peerDependencies for', p, ':', err && err.message);
        }
      }
      return Array.from(peerSet);
    }

    const peerDeps = collectPeerDepsSync(pkgs);
    const installList = Array.from(new Set([...pkgs, ...peerDeps]));
    if (peerDeps.length > 0) {
      console.log('Including peerDependencies in fallback install:', peerDeps.join(', '));
    }

    const tmpRes = spawnSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', ...installList], {
      stdio: 'inherit',
      shell: false,
      cwd: tmpDir
    });

    if (tmpRes.error) {
      throw tmpRes.error;
    }
    if (tmpRes.status !== 0) {
      throw new Error(`Fallback npm install failed with code ${tmpRes.status}`);
    }

    // Copy all installed packages (including transitive dependencies) from tmpDir/node_modules
    // to installDir/node_modules so plugins can find their deps (like @typescript-eslint/utils).
    const tmpNodeModules = path.join(tmpDir, 'node_modules');
    const destNodeModules = path.join(installDir, 'node_modules');
    fs.mkdirSync(destNodeModules, { recursive: true });

    if (fs.existsSync(tmpNodeModules)) {
      console.log('Copying installed node_modules from', tmpNodeModules, '=>', destNodeModules);
      // Merge the temporary node_modules into the destination. Do not force overwrite existing files so
      // we avoid clobbering repository-installed packages; copying is recursive.
      fs.cpSync(tmpNodeModules, destNodeModules, { recursive: true, force: false });
    } else {
      console.warn('Temporary install did not produce a node_modules directory:', tmpNodeModules);
    }

    // Cleanup temporary dir
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_err) {
      // non-fatal
    }

    console.log('Fallback install succeeded and packages copied into', destNodeModules);
    return;
  }

  if (res.status !== 0) {
    throw new Error(`npm install failed with code ${res.status}`);
  }
}

function main() {
  const cmd = process.env.MATRIX_COMMAND || "";
  const set = new Set();

  collectFromCommand(cmd, set);
  collectDefaultIfEmpty(set);

  // Scan local (relative-path) plugin files for @oxlint/plugins imports
  collectFromLocalPlugins(set, set);

  const pkgs = filterInstallable(Array.from(set));
  if (pkgs.length > 0) {
    console.log("Attempting to install packages:", pkgs.join(", "));
    try {
      installPackages(pkgs);
    } catch (e) {
      console.error("Failed to install plugins:", e.message);
      process.exit(1);
    }
  } else {
    console.log("No plugin packages to install.");
  }

  // Always attempt to copy built oxlint into node_modules so local plugins can import it
  try {
    if (copyBuiltOxlintIntoNodeModules(process.cwd())) {
      console.log('Installed built `oxlint` into', path.join(process.cwd(), 'node_modules', 'oxlint'));
    } else {
      console.log('No built `oxlint` artifact found to install.');
    }
  } catch (err) {
    console.warn('Could not install built oxlint:', err && err.message);
  }
}

main();
