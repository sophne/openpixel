# Contributing to OpenPixel

Thanks for helping. Bug fixes, new tools, better agent support, docs and website improvements are all welcome.

## How it works

1. Fork the repository and create a branch.
2. Make your change. Keep each pull request to one topic.
3. Check it:
   - Mac app: `cd app && make test` (and `make ui-test` for editor changes)
   - Core (Rust): `cd core && cargo test`
   - Desktop app: `cd desktop && npm ci && npm run build:core && npm run build:mcp && npm run typecheck && npm test`
     (and `npm run test:ui` for editor changes)
   - Website: `cd web && npm ci && npm run lint && npm run typecheck && npm run build`
4. Open a pull request against `main` and fill in the template.

CI checks only what your pull request changes: the Mac app (build and self-test), the core and the desktop app (on Linux, macOS and Windows), the website (lint, types, build, audit) and CodeQL for JavaScript. For first-time contributors a maintainer approves the CI run.
A maintainer reviews every pull request and merges it with **Squash and merge**. Merged changes ship with the next
release; you'll be credited in its notes automatically.

## Guidelines

- The Mac app has no third-party dependencies apart from Sparkle, and the core and the desktop app keep theirs few.
  Please discuss new dependencies in an issue first.
- Files are read from the internet: any code that parses a file must check every length and offset, and add a
  damaged-file case to `app/Sources/OpenPixel/SelfTest.swift` and `core/engine/tests/selftest.rs`.
- The core does no file, clock or network access of its own: all of it goes through `HostIo` (`core/engine/src/io.rs`),
  so it keeps building for WebAssembly.
- Anything shown in the editor UI that comes from a file or an agent goes through `textContent` or `escapeHtml`,
  never raw `innerHTML`.
- Never commit secrets, certificates or personal paths.
- Changes to `.github/`, `app/scripts/`, `app/Info.plist` and `app/Package.*` need a maintainer from CODEOWNERS.
- The editor page exists twice while both apps ship: `app/web` (Mac app) and `desktop/src` (React). A change to one
  needs the same change in the other; `npm run test:ui` in `desktop/` compares them.

## Labels

Pull request labels sort the release notes: `feature`, `bug`, `security`, `website`, `docs`, or `skip-changelog`.

By contributing you agree that your work is released under the [MIT licence](LICENSE).
