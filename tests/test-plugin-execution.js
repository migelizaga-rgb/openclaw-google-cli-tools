#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "google-cli-plugin-test-"));
const stub = path.join(tempDir, "gog");
const log = path.join(tempDir, "calls.jsonl");
fs.writeFileSync(stub, `#!/usr/bin/env node
import fs from "node:fs";
fs.appendFileSync(process.env.GOG_STUB_LOG, JSON.stringify(process.argv.slice(2)) + "\\n");
process.stdout.write(JSON.stringify({ argv: process.argv.slice(2) }));
`);
fs.chmodSync(stub, 0o755);
const previousLog = process.env.GOG_STUB_LOG;
process.env.GOG_STUB_LOG = log;

try {
  const plugin = (await import(pathToFileURL(path.join(path.dirname(new URL(import.meta.url).pathname), "..", "index.js")))).default;
  let registeredTool;
  plugin.register({
    pluginConfig: { gogPath: stub },
    registerTool(factory) { registeredTool = factory(); },
  });

  const read = await registeredTool.execute("read-1", {
    service: "gmail",
    command: "search",
    args: { query: "is:unread", account: "work" },
  });
  const readPayload = JSON.parse(read.content[0].text);
  assert.equal(readPayload.success, true);
  assert.equal(readPayload.intent, "read");
  assert.match(readPayload.stdout, /gmail.*search.*is:unread/);
  const callsAfterRead = fs.readFileSync(log, "utf8").trim().split("\n").length;
  assert.equal(callsAfterRead, 1);

  const denied = await registeredTool.execute("write-1", {
    service: "calendar",
    command: "delete",
    args: { calendar: "primary", eventId: "event-1", account: "work" },
  });
  assert.equal(JSON.parse(denied.content[0].text).code, "approval_required");
  assert.equal(fs.readFileSync(log, "utf8").trim().split("\n").length, 1, "denied write never reaches gog");

  const approved = await registeredTool.execute("write-2", {
    service: "calendar",
    command: "delete",
    approved: true,
    args: { calendar: "primary", eventId: "event-1", account: "work" },
  });
  assert.equal(JSON.parse(approved.content[0].text).success, true);
  assert.equal(fs.readFileSync(log, "utf8").trim().split("\n").length, 2, "approved write reaches the stub");
  console.log("PASS test-plugin-execution");
} finally {
  if (previousLog === undefined) delete process.env.GOG_STUB_LOG;
  else process.env.GOG_STUB_LOG = previousLog;
  fs.rmSync(tempDir, { recursive: true, force: true });
}
