import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { buildGogInvocation, redact } = require("./src/bridge.cjs");
const { runGog, resolveGogPath, GOG_TIMEOUT_MS } = require("./src/runner.cjs");

const GoogleCliSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    service: { type: "string", enum: ["gmail", "calendar", "drive"], description: "Google service to use." },
    command: {
      type: "string",
      description: "Allowlisted command name. Gmail: search, get, drafts.create, send. Calendar: events, calendars, create, update, delete. Drive: search, get, ls.",
    },
    args: { type: "object", additionalProperties: true, description: "Structured arguments. Unknown command arguments are rejected." },
    output: { type: "string", enum: ["json", "plain"], description: "Output format. Defaults to json." },
    intent: { type: "string", enum: ["read", "draft", "guarded_write"], description: "Optional intent self-check; actual intent comes from the command registry." },
    approved: {
      type: "boolean",
      description: "Set true only after a human explicitly approves this write. OpenClaw's approval layer should enforce approval independently.",
    },
  },
  required: ["service", "command"],
};

function jsonText(payload) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    details: payload,
  };
}

export default {
  register(api) {
    const pluginConfig = api.pluginConfig || {};
    api.registerTool(() => ({
      name: "google_cli",
      label: "Google CLI",
      description:
        "Compact, allowlisted bridge to gogcli for Gmail, Calendar, and Drive. " +
        "Rejects unknown commands and derives write/read intent from a static registry.",
      parameters: GoogleCliSchema,
      async execute(_toolCallId, params) {
        let invocation;
        try {
          invocation = buildGogInvocation(params || {});
        } catch (error) {
          return jsonText({
            success: false,
            error: error instanceof Error ? error.message : String(error),
            code: "validation_failed",
          });
        }

        // Defense-in-depth: the advisor before_tool_call guard is the primary
        // enforcement gate; this check is a secondary in-process safeguard.
        if (invocation.intent === "guarded_write" && params?.approved !== true) {
          return jsonText({
            success: false,
            error: "guarded_write commands require approved=true",
            code: "approval_required",
            command: `${invocation.service}.${invocation.command}`,
          });
        }

        const gogPath = resolveGogPath(pluginConfig, process.env);
        const env = {
          ...process.env,
          GOG_KEYRING_BACKEND: process.env.GOG_KEYRING_BACKEND || "file",
        };
        const result = await runGog(gogPath, invocation.argv, env, GOG_TIMEOUT_MS);
        const payload = {
          success: result.code === 0,
          code: result.code,
          command: `${invocation.service}.${invocation.command}`,
          intent: invocation.intent,
          stdout: redact(result.stdout),
          stderr: redact(result.stderr),
        };
        return jsonText(payload);
      },
    }));
  },
};
