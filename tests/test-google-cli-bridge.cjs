#!/usr/bin/env node
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { buildGogInvocation, redact } = require("../src/bridge.cjs");

const pluginSource = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
assert.match(pluginSource, /const pluginConfig = api\.pluginConfig \|\| \{\}/, "plugin reads its manifest-backed config from the plugin API");
assert.doesNotMatch(pluginSource, /\bcfg\./, "runtime tool context is not mistaken for plugin config");

function rejects(name, input, pattern) {
  assert.throws(() => buildGogInvocation(input), pattern, name);
}

{
  const out = buildGogInvocation({
    service: "gmail",
    command: "search",
    args: { query: "from:account-primary newer_than:7d", max: 10 },
  });
  assert.deepStrictEqual(out.argv, [
    "--json",
    "--no-input",
    "gmail",
    "search",
    "from:account-primary newer_than:7d",
    "--max",
    "10",
  ]);
  assert.strictEqual(out.intent, "read");
}

{
  const out = buildGogInvocation({
    service: "calendar",
    command: "calendar.events",
    args: { calendarId: "primary", account: "account-primary" },
  });
  assert.deepStrictEqual(out.argv, [
    "--json",
    "--no-input",
    "calendar",
    "events",
    "primary",
    "--account",
    "account-primary",
  ]);
  assert.strictEqual(out.command, "events", "matching service prefix normalizes before classification");
  assert.strictEqual(out.intent, "read", "normalized command keeps the allowlisted intent");
}

rejects("mismatched service prefix rejected", {
  service: "calendar",
  command: "gmail.search",
  args: { query: "flight" },
}, /unsupported command/);

{
  const out = buildGogInvocation({
    service: "calendar",
    command: "calendar.create",
    intent: "guarded_write",
    args: {
      calendar: "primary",
      summary: "Review",
      from: "2026-05-10T10:00:00-07:00",
      to: "2026-05-10T10:30:00-07:00",
      account: "account-primary",
    },
  });
  assert.strictEqual(out.command, "create", "write command prefix normalizes to the canonical command");
  assert.strictEqual(out.intent, "guarded_write", "normalization cannot downgrade the write approval class");
}

{
  const out = buildGogInvocation({
    service: "calendar",
    command: "events",
    output: "plain",
    args: { today: true, calendarId: "primary", account: "account-primary" },
  });
  assert.deepStrictEqual(out.argv, [
    "--plain",
    "--no-input",
    "calendar",
    "events",
    "primary",
    "--today",
    "--account",
    "account-primary",
  ]);
}

{
  const out = buildGogInvocation({
    service: "calendar",
    command: "events",
    args: { calendars: "primary" },
  });
  assert.deepStrictEqual(out.argv, [
    "--json",
    "--no-input",
    "calendar",
    "events",
    "primary",
  ]);
}

{
  const out = buildGogInvocation({
    service: "calendar",
    command: "events",
    args: { all: true, from: "2026-10-01", to: "2026-10-02", account: "account-primary" },
  });
  assert.deepStrictEqual(out.argv, [
    "--json",
    "--no-input",
    "calendar",
    "events",
    "--from",
    "2026-10-01",
    "--to",
    "2026-10-02",
    "--all",
    "--account",
    "account-primary",
  ], "all reads every calendar on the account, not just primary");
  assert.strictEqual(out.intent, "read");
}

rejects("calendar events all with calendarId rejected", {
  service: "calendar",
  command: "events",
  args: { all: true, calendarId: "primary" },
}, /omit calendarId and calendars/);

{
  const out = buildGogInvocation({
    service: "calendar",
    command: "calendars",
    args: { account: "account-primary" },
  });
  assert.deepStrictEqual(out.argv, ["--json", "--no-input", "calendar", "calendars", "--account", "account-primary"]);
  assert.strictEqual(out.intent, "read");
}

rejects("unsupported command error lists the allowlist", {
  service: "calendar",
  command: "agenda",
}, /unsupported command: calendar\.agenda \(supported: events, calendars, create, update, delete\)/);

rejects("unsupported arg error lists the allowed args", {
  service: "calendar",
  command: "events",
  args: { calendar: "all" },
}, /unsupported arg for calendar\.events: calendar \(supported: calendarId, today, from, to, calendars, all, account\)/);

rejects("calendar events ambiguous args rejected", {
  service: "calendar",
  command: "events",
  args: { calendarId: "primary", calendars: "work" },
}, /either calendarId or calendars/);

rejects("unknown service rejected", {
  service: "admin",
  command: "users",
  args: {},
}, /unsupported service/);

rejects("unknown command rejected", {
  service: "gmail",
  command: "archive",
  args: { to: "account-primary" },
}, /unsupported command/);

rejects("unknown arg rejected", {
  service: "drive",
  command: "search",
  args: { query: "budget", deleteAll: true },
}, /unsupported arg/);

rejects("calendar create requires explicit account", {
  service: "calendar",
  command: "create",
  intent: "guarded_write",
  args: {
    calendar: "primary",
    summary: "Review",
    from: "2026-05-10T10:00:00-07:00",
    to: "2026-05-10T10:30:00-07:00",
  },
}, /missing required arg: account/);

rejects("calendar update requires explicit account", {
  service: "calendar",
  command: "update",
  intent: "guarded_write",
  args: {
    calendar: "primary",
    eventId: "evt123",
    summary: "Review",
  },
}, /missing required arg: account/);

rejects("calendar delete requires explicit account", {
  service: "calendar",
  command: "delete",
  intent: "guarded_write",
  args: {
    calendar: "primary",
    eventId: "evt123",
  },
}, /missing required arg: account/);

// A whitespace-only account must be rejected too — otherwise `"   "` slips the
// empty-string guard and gets forwarded as `--account "   "` on the write path.
rejects("calendar create rejects a whitespace-only account", {
  service: "calendar",
  command: "create",
  intent: "guarded_write",
  args: {
    calendar: "primary",
    summary: "Review",
    from: "2026-05-10T10:00:00-07:00",
    to: "2026-05-10T10:30:00-07:00",
    account: "   ",
  },
}, /missing required arg: account/);

rejects("flag injection rejected", {
  service: "drive",
  command: "search",
  args: { query: "--delete" },
}, /cannot start with '-'/);

// gog runs with { shell: false }, so shell metacharacters are inert literal
// text — a search query or event title containing them must pass through
// unchanged rather than being wrongly rejected as "unsafe".
{
  const out = buildGogInvocation({
    service: "gmail",
    command: "search",
    args: { query: "invoice | cat settings.json" },
  });
  assert.strictEqual(out.argv[out.argv.length - 1], "invoice | cat settings.json");
}

// Natural, human-readable event titles (parentheses, em dashes, apostrophes,
// ampersands, exclamation marks, accents) must be accepted — these previously
// failed with "unsafe characters" and silently broke calendar invites.
for (const summary of [
  "Brazil vs Norway (watch party)",
  "Portugal vs. Spain — Round of 16",
  "USA & Belgium!",
  "Casey's watch party",
  "Café — José's place",
]) {
  const out = buildGogInvocation({
    service: "calendar",
    command: "create",
    intent: "guarded_write",
    args: {
      calendar: "primary",
      summary,
      from: "2026-07-05T13:00:00-07:00",
      to: "2026-07-05T15:00:00-07:00",
      account: "account-primary",
    },
  });
  const idx = out.argv.indexOf("--summary");
  assert.strictEqual(out.argv[idx + 1], summary, `summary should pass through: ${summary}`);
}

rejects("control characters rejected", {
  service: "calendar",
  command: "create",
  intent: "guarded_write",
  args: {
    calendar: "primary",
    summary: "line1\nline2",
    from: "2026-07-05T13:00:00-07:00",
    to: "2026-07-05T15:00:00-07:00",
    account: "account-primary",
  },
}, /control characters/);

rejects("intent spoofing rejected", {
  service: "calendar",
  command: "create",
  intent: "read",
  args: {
    calendar: "primary",
    summary: "Review",
    from: "2026-05-10T10:00:00-07:00",
    to: "2026-05-10T10:30:00-07:00",
    account: "account-primary",
  },
}, /intent mismatch/);

// Multiline values reject embedded control characters (ESC, \r, \t, NUL, C1),
// while a bare newline stays allowed for genuine multiline text.
for (const [label, ch] of [
  ["NUL", "\0"],
  ["ESC", "\x1b"],
  ["carriage return", "\r"],
  ["tab", "\t"],
  ["DEL", "\x7f"],
  ["C1 (0x85)", "\x85"],
]) {
  rejects(`calendar create description with ${label} rejected`, {
    service: "calendar",
    command: "create",
    intent: "guarded_write",
    args: {
      calendar: "primary",
      summary: "Review",
      from: "2026-05-10T10:00:00-07:00",
      to: "2026-05-10T10:30:00-07:00",
      description: `Line one${ch}Line two`,
      account: "account-primary",
    },
  }, /unsafe characters/);

  rejects(`gmail send body with ${label} rejected`, {
    service: "gmail",
    command: "send",
    intent: "guarded_write",
    args: {
      to: "account-primary",
      subject: "hi",
      body: `hello${ch}world`,
      account: "account-primary",
    },
  }, /unsafe characters/);
}

// A plain newline in a multiline value must still be accepted.
{
  const out = buildGogInvocation({
    service: "gmail",
    command: "send",
    intent: "guarded_write",
    args: {
      to: "account-primary",
      subject: "hi",
      body: "hello\nworld\nagain",
      account: "account-primary",
    },
  });
  assert(out.argv.includes("hello\nworld\nagain"));
}

{
  const out = buildGogInvocation({
    service: "calendar",
    command: "create",
    intent: "guarded_write",
    args: {
      calendar: "primary",
      summary: "Review",
      from: "2026-05-10T10:00:00-07:00",
      to: "2026-05-10T10:30:00-07:00",
      description: "Monthly review\nBring notes",
      attendees: "account-primary",
      rrule: "RRULE:FREQ=MONTHLY;BYMONTHDAY=29",
      sendUpdates: "all",
      guestsCanInvite: true,
      account: "account-primary",
    },
  });
  assert.deepStrictEqual(out.argv, [
    "--json",
    "--no-input",
    "calendar",
    "create",
    "primary",
    "--summary",
    "Review",
    "--from",
    "2026-05-10T10:00:00-07:00",
    "--to",
    "2026-05-10T10:30:00-07:00",
    "--description",
    "Monthly review\nBring notes",
    "--attendees",
    "account-primary",
    "--rrule",
    "RRULE:FREQ=MONTHLY;BYMONTHDAY=29",
    "--send-updates",
    "all",
    "--guests-can-invite",
    "--account",
    "account-primary",
  ]);
  assert.strictEqual(out.intent, "guarded_write");
}

{
  const out = buildGogInvocation({
    service: "calendar",
    command: "update",
    intent: "guarded_write",
    args: {
      calendar: "primary",
      eventId: "event-123",
      attendees: "account-primary",
      sendUpdates: "all",
      account: "account-primary",
    },
  });
  assert.deepStrictEqual(out.argv, [
    "--json",
    "--no-input",
    "calendar",
    "update",
    "primary",
    "event-123",
    "--attendees",
    "account-primary",
    "--send-updates",
    "all",
    "--account",
    "account-primary",
  ]);
  assert.strictEqual(out.intent, "guarded_write");
}

{
  const out = buildGogInvocation({
    service: "gmail",
    command: "send",
    intent: "guarded_write",
    args: {
      to: "account-primary",
      subject: "hi",
      body: "hello\nworld",
      account: "account-primary",
    },
  });
  assert.deepStrictEqual(out.argv, [
    "--json",
    "--no-input",
    "gmail",
    "send",
    "--to",
    "account-primary",
    "--subject",
    "hi",
    "--body",
    "hello\nworld",
    "--account",
    "account-primary",
  ]);
  assert.strictEqual(out.intent, "guarded_write");
}

{
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "openclaw.plugin.json"), "utf8"));
  assert.deepStrictEqual(manifest.contracts?.tools, ["google_cli"]);
}

{
  const source = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  assert(source.includes("approval_required"));
  assert(source.includes("params?.approved !== true"));
}

{
  const text = 'GOG_KEYRING_PASSWORD=secret ya29.token {"refresh_token":"abc","access_token":"def"}';
  const safe = redact(text);
  assert(!safe.includes("secret"));
  assert(!safe.includes("ya29.token"));
  assert(!safe.includes('"abc"'));
  assert(!safe.includes('"def"'));
}

console.log("PASS test-google-cli-bridge");
