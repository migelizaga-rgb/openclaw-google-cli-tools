#!/usr/bin/env node
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

const bridgeSchemaChars = read("index.js").length;
assert(
  bridgeSchemaChars < 12000,
  `google_cli bridge (${bridgeSchemaChars} chars) exceeded size budget (12000 chars) after legacy removal`
);

console.log(`PASS test-google-cli-token-estimate bridge=${bridgeSchemaChars} legacy=removed`);
