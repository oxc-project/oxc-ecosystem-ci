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
 *
 * NOTE: Allow digits as well (previously digits were rejected which could
 * incorrectly refuse valid plugin package names).
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
  // And `--ignore-scripts` to avoid running any install scripts from untrusted packages,
  // but the CI job has very limited permissions anyway, so the damage that could be done
  // here should be minimal, and it'd require a lot of work to actually exploit this in
  // any way.
  const args = ['install', '--ignore-scripts', ...pkgs];
  const res = spawnSync('npm', args, {
    stdio: 'inherit', 
    shell: false,
    cwd: installDir // Install in the config file's directory
  });

  if (res.error) {
    throw res.error;
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
