#!/usr/bin/env node

const exec = require("child_process").exec;
const matrix = require("../oxfmt-matrix.json");

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
  for (const item of matrix) {
    cloneRepo(item);
  }
}

module.exports = { cloneRepo }