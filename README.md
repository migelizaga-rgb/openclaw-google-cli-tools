# OpenClaw Google CLI Tools

[![CI](https://github.com/migelizaga-rgb/openclaw-google-cli-tools/actions/workflows/ci.yml/badge.svg)](https://github.com/migelizaga-rgb/openclaw-google-cli-tools/actions/workflows/ci.yml)

A compact OpenClaw plugin that exposes an allowlisted tool surface over [gog](https://github.com/steipete/gogcli), the Google CLI known as gogcli. It lets an OpenClaw agent search and read Gmail, Calendar, and Drive data, and offers explicit draft and write commands.

## Features

- One structured `google_cli` tool for Gmail, Calendar, and Drive.
- A static command and argument allowlist; unsupported operations and unknown arguments are rejected.
- Read and write intent is derived from the command registry.
- Subprocess execution uses `shell: false`, bounded runtime and output, and credential redaction in returned output.
- Account names, calendar IDs, Drive folder IDs, and message or file IDs are supplied per call. The plugin has no personal account or resource defaults.

## Security model

The tool accepts read commands, draft creation, and guarded writes. Its `approved` argument is a secondary check only. Configure OpenClaw's approval layer to intercept and require human approval for guarded writes before execution; do not rely on the argument alone as an authorization boundary. Keep this plugin's writes behind that approval layer.

The plugin invokes the local `gog` executable directly without a shell. It does not obtain credentials itself: gog uses the authentication already configured for its CLI profile. Treat output and logs as sensitive even though common credential formats are redacted.

## Prerequisites

- Node.js 22 or newer.
- OpenClaw with plugin support.
- `gog` installed and authenticated with the Google services you want to use. See the [gogcli documentation](https://github.com/steipete/gogcli).

## Install

Install this directory as an OpenClaw plugin using your normal plugin installation method. No runtime npm dependencies are required. OpenClaw is a peer dependency supplied by the host.

By default, the plugin resolves `gog` from the OpenClaw process's `PATH`. To choose a specific binary, set plugin configuration:

```json
{
  "plugins": {
    "entries": {
      "google-cli": {
        "enabled": true,
        "config": {
          "gogPath": "/usr/local/bin/gog"
        }
      }
    }
  }
}
```

Alternatively, set `OPENCLAW_GOOGLE_CLI_GOG_PATH`. Optional execution limits can be set with `OPENCLAW_GOOGLE_CLI_TIMEOUT_MS`, `OPENCLAW_GOOGLE_CLI_KILL_GRACE_MS`, and `OPENCLAW_GOOGLE_CLI_MAX_OUTPUT_BYTES`.

## Tool and commands

Pass `service`, `command`, and structured `args` to `google_cli`. Output defaults to JSON; `output: "plain"` selects gog's plain format.

| Service | Commands | Access |
| --- | --- | --- |
| Gmail | `search`, `get` | Read |
| Gmail | `drafts.create` | Draft write |
| Gmail | `send` | Guarded write |
| Calendar | `events`, `calendars` | Read |
| Calendar | `create`, `update`, `delete` | Guarded write |
| Drive | `search`, `get`, `ls` | Read |

Only the listed operations are exposed. Account selection uses the `account` argument where supported. Calendar events may use `calendarId`, `calendars`, or `all`; Drive listing may use a `parent` folder ID. These values are call arguments and are never hard-coded into the plugin.

## Usage example

Example tool input for a read-only Gmail search:

```json
{
  "service": "gmail",
  "command": "search",
  "args": {
    "query": "is:unread newer_than:7d",
    "max": 10,
    "account": "work"
  }
}
```

A guarded write such as `calendar.create`, `calendar.update`, `calendar.delete`, or `gmail.send` requires explicit `approved: true` after the OpenClaw approval layer has approved it. `gmail.drafts.create` creates a draft and does not send it.

## Testing

Tests use Node's built-in test assertions and local stub executables; they do not contact Google or require authenticated credentials.

```sh
npm run build
npm test
```

## Limitations

- Available behavior depends on the installed gog version and its configured Google API access.
- This plugin does not implement OAuth setup, approval UI, or account/resource discovery beyond the listed gog commands.
- The plugin's `approved` flag is not cryptographically verified. Enforce approval in OpenClaw before invoking guarded writes.
