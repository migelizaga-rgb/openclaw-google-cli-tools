// Common credential patterns redacted from command output.
'use strict';

module.exports = Object.freeze([
  { id: "private-key-block", source: "-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----[\\s\\S]*?(?:-----END (?:[A-Z0-9]+ )?PRIVATE KEY-----|$)", flags: "gi" },
  { id: "authorization-credential", source: "\\b(?:Bearer|Basic)\\s+[A-Za-z0-9._~+/=-]{6,}", flags: "gi" },
  { id: "provider-api-key", source: "(?<![A-Za-z])(?:sk-[A-Za-z0-9_*.-]{2,}|gsk_[A-Za-z0-9_-]{6,}|sk_live_[A-Za-z0-9]{8,})", flags: "g" },
  { id: "github-token", source: "\\b(?:github_pat_[A-Za-z0-9_]{8,}|gh[pousr]_[A-Za-z0-9_]{8,})\\b", flags: "g" },
  { id: "slack-token", source: "\\b(?:xoxe\\.)?xox[baprs]-[A-Za-z0-9_-]{10,}\\b", flags: "g" },
  { id: "aws-access-key", source: "\\b(?:AKIA|ASIA)[0-9A-Z]{16}\\b", flags: "g" },
  { id: "google-api-key", source: "\\bAIza[0-9A-Za-z_-]{20,}\\b", flags: "g" },
  { id: "google-oauth-token", source: "\\b(?:ya29\\.[A-Za-z0-9._-]+|1//[A-Za-z0-9_-]{8,})", flags: "g" },
  { id: "gog-keyring-password", source: "\\bGOG_KEYRING_PASSWORD=\\S+", flags: "g" },
  { id: "telegram-bot-token", source: "(?<!\\d)\\d{8,10}(?!\\d):[A-Za-z0-9_-]{35,}", flags: "g" },
  { id: "jwt", source: "\\beyJ[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}\\b", flags: "g" },
  { id: "long-hex-secret", source: "\\b[A-Fa-f0-9]{64,}\\b", flags: "g" },
  { id: "plaid-access-token", source: "\\baccess-(?:sandbox|development|production)-[A-Za-z0-9-]{8,}\\b", flags: "g" },
  { id: "credential-url-userinfo", source: "(?<=:\\/\\/)[^\\s/@]+(?=@)", flags: "gi" },
  { id: "oauth-json-field", source: "(\\\\*)\"(access_token|refresh_token|client_secret)\\1\"\\s*:\\s*\\1\"(?:\\\\.|[^\"\\\\])*?\\1\"", flags: "gi" },
]);
