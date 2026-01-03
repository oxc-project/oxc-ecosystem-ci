#!/usr/bin/env node

const exec = require("child_process").exec;

// Parse command-line arguments
const args = process.argv.slice(2);
let matrixFile = undefined;
let tool = undefined;

if (args.includes("--oxfmt")) {
  tool = "oxfmt";
} else if (args.includes("--oxlint")) {
  tool = "oxlint";
} else {
  console.error("Error: You must specify either --oxlint or --oxfmt");
  process.exit(1);
}

matrixFile = `../${tool}-matrix.json`;

const matrix = require(matrixFile);

/**
 * @typedef {Object} MatrixItem
 * @property {string} repository
 * @property {string} path
 * @property {string} ref
 * @property {string} command
 * @property {Object} [options]
 */

/**
 * @param {MatrixItem} item
 */
function cloneRepo(item) {
  const command = `git clone --depth=1 --filter=blob:none --no-tags -b ${item.ref} git@github.com:${item.repository}.git repos/${item.path}`;

  console.log(`Running ${command}`);
  exec(command, function (err) {
    if (err) {
      console.error(err);
      return;
    }
    console.log(`Cloned ${item.repository}`);
  });
}

if (require.main === module) {
  console.log(`Using matrix file: ${matrixFile}`);
  for (const item of matrix) {
    cloneRepo(item);
  }
}

module.exports = { cloneRepo };
