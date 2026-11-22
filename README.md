# OpenPixel

An editor for pixel art, for macOS, Windows and Linux: flat 2D sprites and 3D voxel models that render to crisp
sprites. It has a built-in [MCP](https://modelcontextprotocol.io) server, so AI agents can draw, review and refine
art with you. Agent edits appear live in the open window and can be undone.

| System | Download | Needs |
|---|---|---|
| macOS | **[OpenPixel.dmg](https://github.com/sophne/openpixel/releases/latest/download/OpenPixel.dmg)** | macOS 12 or later, Apple silicon or Intel |
| Windows | **[OpenPixel-Setup.exe](https://github.com/sophne/openpixel/releases/latest/download/OpenPixel-Setup.exe)** | Windows 10 or later, 64-bit; installs for your user, no administrator rights |
| Linux | **[OpenPixel.AppImage](https://github.com/sophne/openpixel/releases/latest/download/OpenPixel.AppImage)** or **[openpixel.deb](https://github.com/sophne/openpixel/releases/latest/download/openpixel.deb)** | 64-bit (x64) Linux with glibc |

All of them are also on [openpixel.dev/downloads](https://openpixel.dev/downloads). OpenPixel tells you when a new
version is out and installs it itself where the system lets it (Windows, the AppImage, and macOS once releases are
signed with a Developer ID); otherwise its Update button takes you to the download page.
Until releases are notarized by Apple, macOS asks you to confirm the first launch: open the app once, then
**System Settings → Privacy & Security → Open Anyway**. Each release's notes say how it was signed.

![The OpenPixel editor](web/public/editor.png)

- **2D canvas**: pencil, eraser, recolour, fill, eyedropper, rectangle, line and move tools, mirror drawing, layers,
  frames, onion skin and palettes.
- **3D voxel view** with the same tools, isometric pixel-art previews, and Make 3D for any sprite.
- **Exports**: PNG, SVG, HTML, animated GIF, sprite sheets, MagicaVoxel `.vox`, OBJ.
- **Agents**: ChatGPT, Codex, Claude, Claude Code, Cursor, OpenClaw, Hermes Agent and any other MCP client. The
  Agents page in the app shows who is connected and how to set each one up.
- **Agent review loop**: every agent edit comes back with a score and the problems it introduced or fixed; agents can
  read the canvas as text (pixel grid with rulers, values, silhouette, frame diffs), lock a style for a whole set of
  assets, run many calls in one batch and review saved files side by side. They can check for updates too
  (`check_for_updates`), and are told to reconnect when the app is newer than their connection.

## Connect an agent

Agents start the `openpixel` program that comes inside the app, with `--mcp`. The **Agents page in the app shows the
exact command for your computer** and a guide for each agent; these are the usual places:

```sh
# macOS
claude mcp add --scope user openpixel -- /Applications/OpenPixel.app/Contents/Resources/core/openpixel --mcp
# Linux (AppImage and .deb: the app keeps a copy of the program here)
claude mcp add --scope user openpixel -- ~/.local/share/OpenPixel/bin/openpixel --mcp
```

```bat
:: Windows
claude mcp add --scope user openpixel -- "%LOCALAPPDATA%\Programs\OpenPixel\resources\core\openpixel.exe" --mcp
```

Other agents take the same command (`openpixel --mcp`) in their MCP settings. The command older set-ups use,
`/Applications/OpenPixel.app/Contents/MacOS/OpenPixel --mcp`, keeps working. `openpixel --mcp-http 8765` serves MCP
over HTTP on this computer only, for ChatGPT through a tunnel; agents connected that way can only open and save files
in the `OpenPixel` folder of your Documents.

## Repository

| Folder | What it is |
|---|---|
| [`core/`](core) | The core in Rust: document model, undo, every tool, rendering voxels to sprites, file formats, reviews. Builds natively (the `openpixel` program agents start) and to WebAssembly with wasm-bindgen (one package for the app and for a browser) |
| [`desktop/`](desktop) | The app: Electron shell (`electron/`), the editor page in React + Vite (`src/`), the app's logic in TypeScript on top of the WebAssembly core (`host/`), its tests (`tests/`). See [how it fits together](docs/desktop-architecture.md) |
| [`web/`](web) | The website (Next.js), deployed with Docker |
| [`docs/`](docs) | How the app fits together, and records of past work |
| [`.github/`](.github) | CI, CodeQL, release workflow, templates |

Build and run the app (needs Node 22, Rust with the `wasm32-unknown-unknown` target, and
`cargo install wasm-bindgen-cli --version 0.2.100`):

```sh
cd desktop
npm install
npm run build:core && npm run build:mcp   # the core as WebAssembly, and the MCP program
npm run dev                               # the app, rebuilding as you edit
npm test                                  # the app logic's checks
npm run test:shell                        # the Electron shell: window, menus, messages
npm run test:ui                           # the app clicks through itself: every tool, page and dialog, with pictures
npm run pack                              # the app as a folder, unsigned (release/)
```

`cd core && cargo test` checks the core: the engine's self-test, golden files (every model in `web/artwork` exported
and compared with the pictures in `web/public`), the MCP program, and one session run natively and through
WebAssembly with every answer compared.

Run the website: `cd web && npm install && npm run dev`.

## Contributing and security

Pull requests are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md). Report security problems privately as described
in [SECURITY.md](SECURITY.md). How releases work: [RELEASING.md](RELEASING.md).

## Credits

- Built with [Electron](https://www.electronjs.org) (MIT), [React](https://react.dev) (MIT) and
  [Rust](https://www.rust-lang.org); the libraries it uses are listed in `desktop/package.json` and the
  `Cargo.toml` files under `core/`.
- Icons: [Lucide](https://lucide.dev) (ISC), `desktop/src/lib/LUCIDE-LICENSE.txt`
- Agent logos: [LobeHub icons](https://github.com/lobehub/lobe-icons) (MIT),
  `desktop/src/lib/AGENT-LOGOS-ATTRIBUTION.txt`. The logos are trademarks of their owners and only identify
  compatible apps.
- Palettes: DawnBringer 16/32 (Richard Fhager), PICO-8 (Lexaloffle), Endesga 32 (Endesga)

OpenPixel began as a Mac-only app written in Swift; that app was replaced by this one and is in the repository's
history.

OpenPixel is released under the [MIT licence](LICENSE).
