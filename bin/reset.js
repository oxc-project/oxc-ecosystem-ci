#!/usr/bin/env node
/**
 * @file reset.js
 * @summary Forcibly reset all repositories to the latest commit on their
 * default branch. All local changes will be lost.
 */

const { cloneRepo } = require("./clone");
const fs = require("fs");
const cp = require("child_process");

// Parse command-line arguments
const args = process.argv.slice(2);
let matrixFile = "../oxlint-matrix.json"; // default to oxlint

if (args.includes("--oxfmt")) {
  matrixFile = "../oxfmt-matrix.json";
} else if (args.includes("--oxlint")) {
  matrixFile = "../oxlint-matrix.json";
}

const matrix = require(matrixFile);

/**
 * @param {import("./clone").MatrixItem} item
 */
function syncAndResetRepo(item) {
  const cmd = [
    `cd repos/${item.path}`,
    `git reset --hard`,
    `git checkout ${item.ref}`,
    `git pull`,
  ].join(" && ");

  console.log(`Running ${cmd}`);
  cp.execSync(cmd, { stdio: "inherit" });
}

function reset() {
  // await fs.promises.mkdir("repos", { recursive: true });
  fs.mkdirSync("repos", { recursive: true });

  console.log(`Using matrix file: ${matrixFile}`);

  let failed = false;
  for (const item of matrix) {
    if (!fs.existsSync(`repos/${item.path}`)) {
      cloneRepo(item);
    } else {
      try {
        syncAndResetRepo(item);
      } catch (e) {
        console.error(e);
        failed = true;
      }
    }
  }

  if (failed) {
    process.exit(1);
  }
}

if (require.main === module) {
  reset();
}
