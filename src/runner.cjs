// runner.cjs — the gog subprocess runner, kept dependency-free (no typebox/ESM)
// so it is unit-testable in a clean checkout. index.js requires this.
const { spawn } = require("node:child_process");

// Default wall-clock budget for a single gog subprocess. A hung gog (network
// stall, keyring prompt, wedged OAuth) must not hold the tool call open forever;
// on expiry we SIGTERM, then SIGKILL after a short grace, and resolve with the
// conventional timeout exit code 124 so callers see `success: false`.
const GOG_TIMEOUT_MS = Number(process.env.OPENCLAW_GOOGLE_CLI_TIMEOUT_MS) || 120000;
const GOG_KILL_GRACE_MS = Number(process.env.OPENCLAW_GOOGLE_CLI_KILL_GRACE_MS) || 5000;
// Hard cap on accumulated stdout+stderr to prevent a large gog response from
// OOM-ing the gateway. When either stream exceeds this limit we SIGTERM the
// child immediately and resolve with an output-size-exceeded error.
const MAX_OUTPUT_BYTES = Number(process.env.OPENCLAW_GOOGLE_CLI_MAX_OUTPUT_BYTES) || 8 * 1024 * 1024; // 8 MB

function resolveGogPath(pluginConfig = {}, env = process.env) {
  for (const candidate of [pluginConfig?.gogPath, env?.OPENCLAW_GOOGLE_CLI_GOG_PATH]) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  // Let spawn/execvp resolve the binary through the gateway's production PATH.
  // This stays portable across Apple Silicon Homebrew (/opt/homebrew), Intel
  // Homebrew (/usr/local), and Linux images without guessing a host prefix.
  return "gog";
}

function runGog(gogPath, argv, env, timeoutMs = GOG_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const child = spawn(gogPath, argv, {
      shell: false,
      env,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let killTimer = null;

    // Resolve the tool-call promise. Deliberately does NOT touch killTimer: on a
    // timeout we resolve with 124 immediately but let the SIGTERM→SIGKILL
    // escalation keep running, so a child that ignores SIGTERM is still
    // force-killed instead of leaking as an orphan. The kill timer is cleared
    // only when the child actually exits (close/error handlers below).
    const settle = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const onChildGone = () => {
      if (killTimer) {
        clearTimeout(killTimer);
        killTimer = null;
      }
    };

    const timer = setTimeout(() => {
      stderr += `\n[openclaw-google-cli-tools] gog timed out after ${timeoutMs}ms; terminating.`;
      try { child.kill("SIGTERM"); } catch { /* already gone */ }
      // Escalate to SIGKILL if SIGTERM is ignored; survives settle(), cleared on exit.
      killTimer = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* already gone */ } }, GOG_KILL_GRACE_MS);
      settle({ code: 124, stdout, stderr });
    }, timeoutMs);

    const killForSize = (stream) => {
      stderr += `\n[openclaw-google-cli-tools] gog output exceeded ${MAX_OUTPUT_BYTES} bytes on ${stream}; terminating.`;
      try { child.kill("SIGTERM"); } catch { /* already gone */ }
      killTimer = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* already gone */ } }, GOG_KILL_GRACE_MS);
      settle({ code: 1, stdout, stderr, outputSizeExceeded: true });
    };

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
      if (stdout.length > MAX_OUTPUT_BYTES) killForSize("stdout");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
      if (stderr.length > MAX_OUTPUT_BYTES) killForSize("stderr");
    });
    child.on("error", (error) => { onChildGone(); settle({ code: 127, stdout, stderr: error.message }); });
    child.on("close", (code) => { onChildGone(); settle({ code: code ?? 1, stdout, stderr }); });
  });
}

module.exports = { runGog, resolveGogPath, GOG_TIMEOUT_MS, GOG_KILL_GRACE_MS };
