#!/usr/bin/env node

const assert = require("node:assert");
const { execSync } = require("node:child_process");
const { existsSync, writeFileSync } = require("node:fs");
const { resolve, join } = require("node:path");

const matrix = require("../oxfmt-matrix.json");

let binary = process.argv[2];

if (!binary) {
  console.error("USAGE: ./test-oxfmt.js PATH_TO_OXFMT_BINARY");
  process.exit(0);
}
binary = resolve(binary); // normalize relative paths

assert(existsSync("repos"), "No repositories found, did you forget to run clone.js?");

const args = process.argv.slice(3);

for (const item of matrix) {
  const repoPath = join("repos", item.path);

  // Write .oxfmtrc.json config if options are provided
  if (item.options) {
    const configPath = join(repoPath, ".oxfmtrc.json");
    writeFileSync(configPath, JSON.stringify(item.options, null, 2));
    console.log(`Created config at ${configPath}`);
  }

  const oxfmt = item.command.replace(/^oxfmt/, binary);
  const command = `cd ${repoPath} && ${oxfmt} ${args.join(' ')}`;
  console.log(command);
  execSync(command, { stdio: "inherit" });
}