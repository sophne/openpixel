# Security policy

## Reporting a problem

Please report vulnerabilities **privately** through
[GitHub's private vulnerability reporting](https://github.com/sophne/openpixel/security/advisories/new), not in a
public issue. Include what you found, how to reproduce it, which version you used and on which system (macOS,
Windows or Linux). You'll get a reply within a week, and a fix is released as soon as it's ready, with credit to you
unless you prefer otherwise.

## Supported versions

Only the latest release gets security fixes. OpenPixel tells you when one is out and installs it itself where the
system lets it; see [RELEASING.md](RELEASING.md) for how updates reach each system.

## What OpenPixel trusts

- **Files**: `.openpixel`, `.vox` and images are treated as untrusted input and parsed with bounds checks.
- **The window's page** is the app's own page and nothing else: it cannot navigate away, open other windows or load
  anything from the network, and it reaches the app through one message channel (`window.openpixel`), with no access
  to Node or Electron. Text from files and agents is shown as text, never as markup.
- **Agents over stdio** (`openpixel --mcp`) run as you and can open and save files anywhere you can, like any local
  tool you give your agent.
- **Agents over HTTP** (`openpixel --mcp-http`) listen on 127.0.0.1 only, need a random secret in the URL, and can
  only open and save files inside the `OpenPixel` folder of your Documents. Anyone with the full URL can edit, so
  keep it private.
- **The app window** talks to agents over a local link, never a network port: on macOS and Linux a socket in
  OpenPixel's data folder that only your user can open, on Windows a named pipe on this computer
  (`\\.\pipe\openpixel-<user>`).
- **Agent Chat** starts the agent programs you have installed yourself (Claude Code, Codex, …) under your account
  and your subscriptions; OpenPixel holds no keys of its own.
- **Updates** are downloaded over HTTPS from the project's GitHub releases. How each system's update is checked
  before it is installed is described in [RELEASING.md](RELEASING.md).
- **Code signing.** Releases are not yet signed with a Developer ID or notarized by Apple, so macOS asks you to
  confirm the first launch (System Settings → Privacy & Security → Open Anyway), and other systems may warn about an
  unknown publisher. Each release's notes say how it was signed.
