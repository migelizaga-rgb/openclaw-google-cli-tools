// gog is spawned with { shell: false } (see runner.cjs), so argv elements are
// passed straight to execvp without any shell involved. Shell metacharacters
// (| ; & $ ` ( ) ! etc.) therefore carry no special meaning and are safe as
// literal argument text — an overly strict allowlist here only breaks ordinary
// human-readable values (event titles like "Brazil vs Norway (watch party)",
// "USA & Belgium!", em-dashes, apostrophes, accented names) and silently fails
// calendar invites, Gmail sends, and searches. The two guards that DO matter:
//   1. a value must not start with '-', or gog would parse it as a flag;
//   2. a single-line value must not contain control characters, which could
//      corrupt the argv stream or terminal output.
// Both are enforced below. Multiline values (descriptions) are handled by
// assertSafeMultiline, which permits newlines.
const CONTROL_CHAR_RE = /[\u0000-\u001F\u007F-\u009F]/;
// Multiline values allow LF only. Other C0 controls, DEL, and C1 controls can
// corrupt gog parsing or terminal output and must be rejected.
const MULTILINE_CONTROL_RE = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/;
const generatedSecretRedactionPatterns = require("./generated-secret-redaction-patterns.cjs");

const COMMANDS = Object.freeze({
  gmail: Object.freeze({
    search: {
      argv: ["gmail", "search"],
      intent: "read",
      args: {
        query: { flag: null, required: true },
        max: { flag: "--max", type: "number", min: 1, max: 50 },
        account: { flag: "--account" },
      },
    },
    get: {
      argv: ["gmail", "get"],
      intent: "read",
      args: {
        messageId: { flag: null, required: true },
        account: { flag: "--account" },
        sanitizeContent: { flag: "--sanitize-content", type: "boolean" },
      },
    },
    "drafts.create": {
      argv: ["gmail", "drafts", "create"],
      intent: "draft",
      args: {
        to: { flag: "--to", required: true },
        subject: { flag: "--subject", required: true },
        text: { flag: "--text", required: true },
        account: { flag: "--account" },
      },
    },
    send: {
      argv: ["gmail", "send"],
      intent: "guarded_write",
      args: {
        to: { flag: "--to", required: true },
        cc: { flag: "--cc" },
        bcc: { flag: "--bcc" },
        subject: { flag: "--subject", required: true },
        body: { flag: "--body", required: true, multiline: true },
        account: { flag: "--account" },
      },
    },
  }),
  calendar: Object.freeze({
    events: {
      argv: ["calendar", "events"],
      intent: "read",
      args: {
        calendarId: { flag: null },
        today: { flag: "--today", type: "boolean" },
        from: { flag: "--from" },
        to: { flag: "--to" },
        calendars: { flag: "--calendars" },
        // Every calendar on the account (Work, Health, Home, shared, ...).
        // Without it gog reads only the account's primary calendar.
        all: { flag: "--all", type: "boolean" },
        account: { flag: "--account" },
      },
    },
    calendars: {
      argv: ["calendar", "calendars"],
      intent: "read",
      args: {
        account: { flag: "--account" },
      },
    },
    create: {
      argv: ["calendar", "create"],
      intent: "guarded_write",
      args: {
        calendar: { flag: null },
        summary: { flag: "--summary", required: true },
        from: { flag: "--from", required: true },
        to: { flag: "--to", required: true },
        description: { flag: "--description", multiline: true },
        location: { flag: "--location" },
        attendees: { flag: "--attendees" },
        rrule: { flag: "--rrule" },
        reminder: { flag: "--reminder" },
        sendUpdates: { flag: "--send-updates" },
        guestsCanInvite: { flag: "--guests-can-invite", type: "boolean" },
        guestsCanModify: { flag: "--guests-can-modify", type: "boolean" },
        guestsCanSeeOthers: { flag: "--guests-can-see-others", type: "boolean" },
        account: { flag: "--account", required: true },
      },
    },
    update: {
      argv: ["calendar", "update"],
      intent: "guarded_write",
      args: {
        calendar: { flag: null, required: true },
        eventId: { flag: null, required: true },
        summary: { flag: "--summary" },
        from: { flag: "--from" },
        to: { flag: "--to" },
        attendees: { flag: "--attendees" },
        sendUpdates: { flag: "--send-updates" },
        account: { flag: "--account", required: true },
      },
    },
    delete: {
      argv: ["calendar", "delete"],
      intent: "guarded_write",
      args: {
        calendar: { flag: null, required: true },
        eventId: { flag: null, required: true },
        sendUpdates: { flag: "--send-updates" },
        account: { flag: "--account", required: true },
      },
    },
  }),
  drive: Object.freeze({
    search: {
      argv: ["drive", "search"],
      intent: "read",
      args: {
        query: { flag: null, required: true },
        max: { flag: "--max", type: "number", min: 1, max: 100 },
        account: { flag: "--account" },
      },
    },
    get: {
      argv: ["drive", "get"],
      intent: "read",
      args: {
        fileId: { flag: null, required: true },
        fields: { flag: "--fields" },
        account: { flag: "--account" },
      },
    },
    ls: {
      argv: ["drive", "ls"],
      intent: "read",
      args: {
        parent: { flag: "--parent" },
        max: { flag: "--max", type: "number", min: 1, max: 100 },
        account: { flag: "--account" },
      },
    },
  }),
});

function fail(message) {
  const err = new Error(message);
  err.code = "GOOGLE_CLI_VALIDATION";
  throw err;
}

function assertSafeString(value, key) {
  if (typeof value !== "string") fail(`${key} must be a string`);
  if (value.length === 0) fail(`${key} cannot be empty`);
  if (value.length > 4096) fail(`${key} is too long`);
  if (value.startsWith("-")) fail(`${key} cannot start with '-'`);
  if (CONTROL_CHAR_RE.test(value)) fail(`${key} contains control characters`);
}

function assertSafeMultiline(value, key) {
  if (typeof value !== "string") fail(`${key} must be a string`);
  if (value.length === 0) fail(`${key} cannot be empty`);
  if (value.length > 20000) fail(`${key} is too long`);
  if (MULTILINE_CONTROL_RE.test(value)) fail(`${key} contains unsafe characters`);
}

function normalizeArgs(args) {
  if (args === undefined || args === null) return {};
  if (typeof args !== "object" || Array.isArray(args)) fail("args must be an object");
  return args;
}

function lookupCommand(service, command) {
  if (!Object.prototype.hasOwnProperty.call(COMMANDS, service)) {
    fail(`unsupported service: ${service}`);
  }
  const svc = COMMANDS[service];
  if (!Object.prototype.hasOwnProperty.call(svc, command)) {
    fail(`unsupported command: ${service}.${command} (supported: ${Object.keys(svc).join(", ")})`);
  }
  return svc[command];
}

function appendArg(argv, key, spec, value) {
  if (value === undefined || value === null || value === "") return;
  if (spec.type === "boolean") {
    if (typeof value !== "boolean") fail(`${key} must be boolean`);
    if (value && spec.flag) argv.push(spec.flag);
    return;
  }
  if (spec.type === "number") {
    if (typeof value !== "number" || !Number.isInteger(value)) fail(`${key} must be an integer`);
    if (spec.min !== undefined && value < spec.min) fail(`${key} is below minimum`);
    if (spec.max !== undefined && value > spec.max) fail(`${key} is above maximum`);
    if (spec.flag) argv.push(spec.flag);
    argv.push(String(value));
    return;
  }
  if (spec.multiline) assertSafeMultiline(value, key);
  else assertSafeString(value, key);
  if (spec.flag) argv.push(spec.flag);
  argv.push(value);
}

function buildGogInvocation(input) {
  const service = String(input?.service || "");
  const requestedCommand = String(input?.command || "");
  const servicePrefix = `${service}.`;
  // Tool descriptions and compatibility callers may use fully-qualified paths
  // such as calendar.events even though service is already a separate field.
  // Accept that exact redundant prefix, then use one canonical command for
  // lookup, intent classification, and argv construction.
  const command = requestedCommand.startsWith(servicePrefix)
    ? requestedCommand.slice(servicePrefix.length)
    : requestedCommand;
  const output = input?.output === "plain" ? "plain" : "json";
  const args = normalizeArgs(input?.args);
  const def = lookupCommand(service, command);
  const allowedArgs = def.args || {};
  const argv = [output === "json" ? "--json" : "--plain", "--no-input", ...def.argv];

  if (service === "calendar" && command === "events") {
    const calendarId = args.calendarId;
    const calendars = args.calendars;
    if (calendarId && calendars) fail("calendar.events: provide either calendarId or calendars, not both");
    if (args.all === true && (calendarId || calendars)) {
      fail("calendar.events: all reads every calendar; omit calendarId and calendars");
    }
    if (calendarId) {
      assertSafeString(calendarId, "calendarId");
      argv.push(calendarId);
      delete args.calendarId;
    } else if (calendars === "primary") {
      argv.push("primary");
      delete args.calendars;
    }
  }

  for (const key of Object.keys(args)) {
    if (!Object.prototype.hasOwnProperty.call(allowedArgs, key)) {
      fail(`unsupported arg for ${service}.${command}: ${key} (supported: ${Object.keys(allowedArgs).join(", ")})`);
    }
  }
  for (const [key, spec] of Object.entries(allowedArgs)) {
    if (spec.required && (args[key] === undefined || args[key] === null || String(args[key]).trim() === "")) {
      // Reject whitespace-only values too: a blank " " would otherwise pass the
      // empty-string check and be forwarded as `--account "   "` on the
      // calendar-write auth path. `String(...)` is safe here because undefined
      // and null are already short-circuited above.
      fail(`missing required arg: ${key}`);
    }
    appendArg(argv, key, spec, args[key]);
  }

  const requestedIntent = input?.intent;
  if (requestedIntent && requestedIntent !== def.intent) {
    fail(`intent mismatch: command is ${def.intent}`);
  }
  if (def.intent === "blocked") fail(`blocked command: ${service}.${command}`);
  return { argv, intent: def.intent, service, command, output };
}

function redact(text) {
  let output = String(text || "");
  for (const entry of generatedSecretRedactionPatterns) {
    output = output.replace(new RegExp(entry.source, entry.flags), (...args) => {
      if (entry.id === "google-oauth-token") return "[REDACTED_ACCESS_TOKEN]";
      if (entry.id === "gog-keyring-password") return "GOG_KEYRING_PASSWORD=[REDACTED]";
      if (entry.id === "oauth-json-field") {
        const [slashes, key] = args.slice(1, -2);
        return `${slashes}"${key}${slashes}":${slashes}"[REDACTED]${slashes}"`;
      }
      return "[REDACTED]";
    });
  }
  return output;
}

module.exports = {
  COMMANDS,
  buildGogInvocation,
  redact,
};
