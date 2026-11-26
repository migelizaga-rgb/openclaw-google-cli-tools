#!/usr/bin/env node
// Regression guard for the google-plugin gog subprocess timeout. A hung gog must
// not hold the tool call open forever: on timeout we resolve with exit code 124
// and a timeout note, while fast commands still return their real exit code. We
// also verify the SIGTERM→SIGKILL escalation actually force-kills a child that
// ignores SIGTERM (the orphan-leak regression).
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

// Small kill grace so the SIGKILL-escalation case runs fast. Must be set before
// requiring the runner (the constant is read at module load).
process.env.OPENCLAW_GOOGLE_CLI_KILL_GRACE_MS = "300";
const { runGog, resolveGogPath } = require("../src/runner.cjs");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // 1. A command that outlives the timeout is terminated and resolves promptly.
  const start = Date.now();
  const timedOut = await runGog("/bin/sleep", ["10"], process.env, 300);
  const elapsed = Date.now() - start;
  assert.strictEqual(timedOut.code, 124, "timed-out gog resolves with code 124");
  assert.ok(/timed out/i.test(timedOut.stderr), "stderr notes the timeout");
  assert.ok(elapsed < 4000, `resolves promptly after timeout (took ${elapsed}ms)`);

  // 2. A fast command completes normally with its real exit code + output.
  const ok = await runGog("/bin/sh", ["-c", "printf hi"], process.env, 5000);
  assert.strictEqual(ok.code, 0, "fast command returns real exit code 0");
  assert.strictEqual(ok.stdout, "hi", "stdout captured for fast command");

  // 3. A spawn error (missing binary) resolves with 127, not a hang.
  const missing = await runGog("/nonexistent/gog-binary", [], process.env, 5000);
  assert.strictEqual(missing.code, 127, "missing binary resolves with code 127");

  // 4. The portable default must use the real shell:false runner PATH lookup,
  // while explicit plugin config and environment overrides keep precedence.
  assert.strictEqual(resolveGogPath({ gogPath: "/configured/gog" }, { OPENCLAW_GOOGLE_CLI_GOG_PATH: "/env/gog" }), "/configured/gog");
  assert.strictEqual(resolveGogPath({ gogPath: "  " }, { OPENCLAW_GOOGLE_CLI_GOG_PATH: "/env/gog" }), "/env/gog");
  assert.strictEqual(resolveGogPath({}, {}), "gog");
  const fakeBinDir = fs.mkdtempSync(path.join(os.tmpdir(), "google-cli-path-"));
  const fakeGog = path.join(fakeBinDir, "gog");
  fs.writeFileSync(fakeGog, '#!/bin/sh\nprintf "%s" "$*"\n', { mode: 0o755 });
  const pathResolved = await runGog(resolveGogPath({}, {}), ["calendar", "events"], { PATH: fakeBinDir }, 5000);
  assert.strictEqual(pathResolved.code, 0, "bare gog resolves through the supplied PATH");
  assert.strictEqual(pathResolved.stdout, "calendar events", "PATH-resolved gog receives the intended argv");
  fs.rmSync(fakeBinDir, { recursive: true, force: true });

  // 5. A child that IGNORES SIGTERM must still be SIGKILLed (no orphan leak).
  // The child records its pid, traps+ignores TERM, then sleeps. The trap keeps
  // sh from exec-optimizing into sleep, so SIGTERM is genuinely ignored. After
  // runGog resolves 124, the kill timer must escalate to SIGKILL and end it.
  const pidfile = path.join(os.tmpdir(), `gog-kill-${process.pid}-${Date.now()}.pid`);
  const script = `echo $$ > '${pidfile}'; trap "" TERM; sleep 5`;
  // CI runners can be slow enough that a 200ms budget kills the shell before it
  // records its pid, which turns this into scheduler roulette instead of a
  // SIGKILL-escalation test. Keep it short, but long enough for process start.
  const killed = await runGog("/bin/sh", ["-c", script], process.env, 1000);
  assert.strictEqual(killed.code, 124, "SIGTERM-ignoring child still resolves 124");

  let pid = null;
  for (let i = 0; i < 20 && !pid; i++) {
    try { pid = parseInt(fs.readFileSync(pidfile, "utf8").trim(), 10); } catch { await sleep(25); }
  }
  assert.ok(pid > 0, "child recorded its pid");

  let gone = false;
  for (let i = 0; i < 80; i++) {
    try { process.kill(pid, 0); } catch { gone = true; break; }
    await sleep(50);
  }
  assert.ok(gone, "SIGTERM-ignoring child was force-killed via SIGKILL escalation");
  try { fs.unlinkSync(pidfile); } catch { /* best effort */ }

  console.log("google-cli timeout: OK (5 cases)");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
