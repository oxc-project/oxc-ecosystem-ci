#!/usr/bin/env node

const assert = require("node:assert");
const { execSync, execFileSync } = require('node:child_process');
const { existsSync, writeFileSync } = require("node:fs");
const { resolve, join } = require("node:path");

// Parse command-line arguments
const allArgs = process.argv.slice(2);
let matrixFile = undefined;
let tool = undefined; // default to undefined
let binary = null;
let extraArgs = [];

// Parse flags and arguments
for (let i = 0; i < allArgs.length; i++) {
  const arg = allArgs[i];
  if (arg === "--oxfmt") {
    tool = "oxfmt";
  } else if (arg === "--oxlint") {
    tool = "oxlint";
  } else if (!binary) {
    binary = arg;
  } else {
    extraArgs.push(arg);
  }
}

if (!tool) {
  // error if no tool specified
  console.error("Error: You must specify either --oxlint or --oxfmt");
  process.exit(0);
}

matrixFile = `../${tool}-matrix.json`;
const matrix = require(matrixFile);

if (!binary) {
  console.error(
    "USAGE: ./test.js [--oxlint|--oxfmt] PATH_TO_BINARY [EXTRA_ARGS...]",
  );
  console.error("  --oxlint: Use oxlint-matrix.json");
  console.error("  --oxfmt:  Use oxfmt-matrix.json");
  process.exit(0);
}
binary = resolve(binary); // normalize relative paths

assert(
  existsSync("repos"),
  "No repositories found, did you forget to run clone.js?",
);

console.log(`Using matrix file: ${matrixFile}`);
console.log(`Binary: ${binary}`);

for (const item of matrix) {
  const repoPath = join("repos", item.path);

  // Write .oxfmtrc.json config if options are provided (for oxfmt)
  if (item.options) {
    const configPath = join(repoPath, ".oxfmtrc.json");
    writeFileSync(configPath, JSON.stringify(item.options, null, 2));
    console.log(`Created config at ${configPath}`);
  }

  // Replace binary name in command
  const commandWithBinary = item.command.replace(
    /^(oxfmt|oxlint|\.\/oxlint)/,
    binary,
  );
  const command = `cd ${repoPath} && ${commandWithBinary} ${extraArgs.join(" ")}`;
  if (tool === "oxlint") {
    // Install any oxlint jsPlugins required by this repo before running the oxlint command
    try {
      // Run the script inside the repo checkout so relative config paths resolve correctly.
      // This is cursed but whatever.
      console.log('Preparing oxlint jsPlugins in', repoPath);
      execFileSync('node', ['../../scripts/install-oxlint-plugins.mjs'], {
        cwd: repoPath,
        stdio: 'inherit',
        env: Object.assign({}, process.env, { MATRIX_COMMAND: commandWithBinary }),
      });
    } catch (e) {
      console.error('Error preparing oxlint jsPlugins:', e);
    }
  }
  console.log(command);
  execSync(command, { stdio: "inherit" });
}
