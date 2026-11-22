# Contributing to OpenPixel

Thanks for helping. Bug fixes, new tools, better agent support, docs and website improvements are all welcome.

## How it works

1. Fork the repository and create a branch.
2. Make your change. Keep each pull request to one topic.
3. Check it:
   - Core (Rust): `cd core && cargo test`
   - App: `cd desktop && npm ci && npm run build:core && npm run build:mcp && npm run typecheck && npm test`,
     then `npm run test:shell` for changes to the Electron shell and `npm run test:ui` for anything the window
     shows (the app clicks through itself; it needs `npm run build:core && npm run build:mcp` first, and on Linux
     `xvfb` when there is no display)
   - Website: `cd web && npm ci && npm run lint && npm run typecheck && npm run build`
4. Open a pull request against `main` and fill in the template.

CI checks only what your pull request changes. `app-ci` is the app on Linux: the core (build without warnings, tests,
the MCP program's self-test) and the desktop app (types, logic, build, shell, the UI test, the packed app, dependency
audit). These run as separate jobs side by side (`core`, `desktop`, `desktop: …`); `app-ci` passes when all of them do.
`web-ci` is the website (lint, types, build, audit). Both must pass. The app is also built, tested and packaged on
macOS and Windows; those jobs are not required, but look at them when they fail. CodeQL analyses the
JavaScript/TypeScript of a pull request. For first-time contributors a maintainer approves the CI run.
A maintainer reviews every pull request and merges it with **Squash and merge**. Merged changes ship with the next
release; you'll be credited in its notes automatically.

## Guidelines

- **One app for three systems.** A change has to be right on macOS, Windows and Linux: paths, key names (⌘ on the
  Mac, Ctrl elsewhere), where settings live. The page's wording goes through `desktop/src/lib/platform.ts`; say in
  the pull request which systems you tried.
- **Few dependencies.** The page ships React and nothing else, the core a short list of crates (JSON, PNG, GIF,
  deflate, base64 and little more: see the `Cargo.toml` files under `core/`), and the shell Electron. Everything
  added is code that ships to people and has to be kept up to date and audited, so please discuss new dependencies
  in an issue first.
- Files are read from the internet: any code that parses a file must check every length and offset, and add a
  damaged-file case to `core/engine/tests/selftest.rs`.
- The core does no file, clock or network access of its own: all of it goes through `HostIo` (`core/engine/src/io.rs`),
  so it keeps building for WebAssembly, and its answers must be the same natively and as WebAssembly
  (`core/wasm/tests` compares them).
- Anything shown in the app that comes from a file or an agent is rendered as text, never as markup
  (see `desktop/src/README.md`, which is the guide to the editor page).
- Never skip, disable or loosen a test to get a green run. If a test is wrong, fix the test and say why in it.
- Never commit secrets, certificates or personal paths.
- Changes to `.github/`, `desktop/electron-builder.yml`, `desktop/scripts/`, and the versions and dependencies in
  `desktop/package.json` and `core/Cargo.toml` need a maintainer from CODEOWNERS.

## Labels

Pull request labels sort the release notes: `feature`, `bug`, `security`, `website`, `docs`, or `skip-changelog`.

By contributing you agree that your work is released under the [MIT licence](LICENSE).
