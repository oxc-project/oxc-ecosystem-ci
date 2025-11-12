#!/usr/bin/env node

const assert = require("node:assert");
const exec = require("node:child_process").exec;
const { existsSync } = require("node:fs");

// Parse command-line arguments
const args = process.argv.slice(2);
let matrixFile = "../oxlint-matrix.json"; // default to oxlint

if (args.includes("--oxfmt")) {
  matrixFile = "../oxfmt-matrix.json";
} else if (args.includes("--oxlint")) {
  matrixFile = "../oxlint-matrix.json";
}

const matrix = require(matrixFile);

assert(
  existsSync("repos"),
  "No repositories found, did you forget to run clone.js?",
);

console.log(`Using matrix file: ${matrixFile}`);

for (const item of matrix) {
  const command = `cd repos/${item.path} && git pull`;

  console.log(`Running ${command}`);
  exec(command, function (err) {
    if (err) {
      console.error(err);
      return;
    }
    console.log(`Updated ${item.repository}`);
  });
}
