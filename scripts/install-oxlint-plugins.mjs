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
 */
const PACKAGE_REGEX = /^(?:eslint-plugin-[A-Za-z0-9_-]+|@[A-Za-z0-9_-]+\/eslint-plugin(?:-[A-Za-z0-9_-]+)?)$/;

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

    const tmpRes = spawnSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', ...pkgs], {
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
    } catch (err) {
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

  const pkgs = filterInstallable(Array.from(set));
  if (pkgs.length === 0) {
    console.log("No plugin packages to install.");
    return;
  }

  console.log("Attempting to install packages:", pkgs.join(", "));
  try {
    installPackages(pkgs);
  } catch (e) {
    console.error("Failed to install plugins:", e.message);
    process.exit(1);
  }
}

main();
