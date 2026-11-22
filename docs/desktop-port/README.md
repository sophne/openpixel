# Old page against React page

What was run to check that the Electron + React app looks and behaves like the Mac app's editor. Nothing here is
needed to build or use the app; it is the record of the comparison at the time the port was made.

## How

There is no Mac in the place this was built, so the Mac app itself could not be run. Its editor is a web page
(`app/web`), and that page runs unchanged in the new Electron shell (`--legacy-ui`), on the same Rust/WebAssembly core
and the same TypeScript app logic as the React page. So the two pages were compared in one window, on one engine:

- The Mac app's own UI test (`app/web/uitest.js`: 59 cases and 3 audits, 62 results) was run, unchanged, on both
  pages. It clicks through the whole app: drawing tools, colours, layers, frames, 2D and 3D, menus, dialogs,
  tooltips, shortcuts, the home screen, folders, the archive, the New file page, the Agents page with real agent
  connections, tabs, every export, panel resizing, and the smallest (980×620) and a large (1680×1050) window.
- At each of its 56 checkpoints both pages were pictured (1440×900 unless the case resizes the window), and the
  pictures compared pixel by pixel.
- Both runs were recorded.

`cd desktop && npm run test:ui` does all of it again (it needs the core built: `npm run build:core && npm run build:mcp`).

## Result

| | Old page | React page |
|---|---|---|
| Passed | 59 of 62 | 59 of 62 |
| Failed | 3 | the same 3 |
| Pictures identical byte for byte | | 54 of 56 |
| Pictures with a visible difference | | 0 |

The three results that fail fail on the old page too, on this machine (Chromium on Linux with software rendering,
where the Mac app uses WebKit on a Mac):

- *3D: pencil click adds a voxel*: the click at the exact centre of the canvas misses the model at this window size
  (the camera fit depends on the canvas size). With the window 40 px smaller the case passes.
- *buttons … centred*: five labels sit 1.2 px off centre with Linux's fonts.
- *accessibility*: the search field's placeholder has a contrast of 3.87:1 in Chromium's rendering.

One more case (*Agents page: table of 7 agents*, which waits 260 ms for the "Copied" cross-fade) fails now and then
on either page when the machine is busy; the runner repeats the React run once before it counts such a case.

Video of both runs side by side: [ui-test-old-vs-react.mp4](ui-test-old-vs-react.mp4)

## Every checkpoint, old next to new

| Picture | What it shows | Size | Old against new |
|---|---|---|---|
| [01-home](shots/01-home.webp) | Home | 1440×900 | identical |
| [01b-new-page](shots/01b-new-page.webp) | New file page | 1440×900 | identical |
| [01c-new-file-dialog](shots/01c-new-file-dialog.webp) | New file dialog | 1440×900 | identical |
| [02-picker-added](shots/02-picker-added.webp) | Colour picker | 1440×900 | 3 pixels differ by 1 level (a rounded corner) |
| [03-dropdown](shots/03-dropdown.webp) | Dropdown | 1440×900 | identical |
| [04-3d](shots/04-3d.webp) | 3D view | 1440×900 | identical |
| [05-review](shots/05-review.webp) | Review | 1440×900 | identical |
| [05b-grid-on](shots/05b-grid-on.webp) | Pixel grid | 1440×900 | identical |
| [06-export-menu](shots/06-export-menu.webp) | Export menu | 1440×900 | identical |
| [06a-file-menu](shots/06a-file-menu.webp) | File menu | 1440×900 | identical |
| [06b-review-dialog](shots/06b-review-dialog.webp) | Review dialog | 1440×900 | identical |
| [07-home-recents](shots/07-home-recents.webp) | Home: Recents | 1440×900 | identical |
| [07b-tabs](shots/07b-tabs.webp) | Tabs | 1440×900 | identical |
| [08-right-max](shots/08-right-max.webp) | Right panel width | 1440×900 | identical |
| [08-right-mid](shots/08-right-mid.webp) | Right panel width | 1440×900 | identical |
| [08-right-min](shots/08-right-min.webp) | Right panel width | 1440×900 | identical |
| [09-left-max](shots/09-left-max.webp) | Left panel width | 1440×900 | identical |
| [09-left-min](shots/09-left-min.webp) | Left panel width | 1440×900 | identical |
| [09a-chat-empty](shots/09a-chat-empty.webp) | Agent Chat, empty | 1440×900 | identical |
| [09b-left-hidden](shots/09b-left-hidden.webp) | Sidebar hidden | 1440×900 | identical |
| [09c-doc-menu](shots/09c-doc-menu.webp) | File options menu | 1440×900 | identical |
| [10-frames-max](shots/10-frames-max.webp) | Frames panel height | 1440×900 | identical |
| [10-frames-mid](shots/10-frames-mid.webp) | Frames panel height | 1440×900 | identical |
| [10-frames-min](shots/10-frames-min.webp) | Frames panel height | 1440×900 | identical |
| [11-small-window-3d](shots/11-small-window-3d.webp) | Smallest window (980×620) | 980×620 | identical |
| [11-small-window-slice](shots/11-small-window-slice.webp) | Smallest window (980×620) | 980×620 | identical |
| [12-small-home](shots/12-small-home.webp) | Smallest window: home | 980×620 | identical |
| [12b-small-new-page](shots/12b-small-new-page.webp) | Smallest window: New file page | 980×620 | identical |
| [13-large-window](shots/13-large-window.webp) | Large window (1680×1050) | 1680×1050 | identical |
| [14-agent-info](shots/14-agent-info.webp) | Agent set-up guide | 1440×900 | identical |
| [15-agents](shots/15-agents.webp) | Agents page | 1440×900 | identical |
| [16-agents-connected](shots/16-agents-connected.webp) | Agents / frames folded / no folders | 1440×900 | 64 pixels differ by up to 9 levels (the pulsing "Connected" dot, caught at another moment) |
| [16-frames-folded](shots/16-frames-folded.webp) | Agents / frames folded / no folders | 1440×900 | identical |
| [16b-no-folders](shots/16b-no-folders.webp) | All folders, empty | 1440×900 | identical |
| [17-move-menu](shots/17-move-menu.webp) | Move to… menu / shortcuts | 1440×900 | identical |
| [17-shortcuts](shots/17-shortcuts.webp) | Move to… menu / shortcuts | 1440×900 | identical |
| [17b-folder-cards](shots/17b-folder-cards.webp) | Folder cards | 1440×900 | identical |
| [18-folder](shots/18-folder.webp) | Folder / tooltip | 1440×900 | identical |
| [18-tooltip](shots/18-tooltip.webp) | Folder / tooltip | 1440×900 | identical |
| [18b-renamed](shots/18b-renamed.webp) | Renamed | 1440×900 | identical |
| [19-archive](shots/19-archive.webp) | Archive | 1440×900 | identical |
| [20-new-page-recents](shots/20-new-page-recents.webp) | New file page: recents | 1440×900 | identical |
| [21-home-list](shots/21-home-list.webp) | Home: list layout | 1440×900 | identical |
| [22-empty-search](shots/22-empty-search.webp) | Empty search | 1440×900 | identical |
| [23-empty-archive](shots/23-empty-archive.webp) | Empty archive | 1440×900 | identical |
| [24-update-button](shots/24-update-button.webp) | Update button | 1440×900 | identical |
| [panel-3d-230](shots/panel-3d-230.webp) | Right panel at every width | 1440×900 | identical |
| [panel-3d-264](shots/panel-3d-264.webp) | Right panel at every width | 1440×900 | identical |
| [panel-3d-300](shots/panel-3d-300.webp) | Right panel at every width | 1440×900 | identical |
| [panel-3d-360](shots/panel-3d-360.webp) | Right panel at every width | 1440×900 | identical |
| [panel-3d-460](shots/panel-3d-460.webp) | Right panel at every width | 1440×900 | identical |
| [panel-slice-230](shots/panel-slice-230.webp) | Right panel at every width | 1440×900 | identical |
| [panel-slice-264](shots/panel-slice-264.webp) | Right panel at every width | 1440×900 | identical |
| [panel-slice-300](shots/panel-slice-300.webp) | Right panel at every width | 1440×900 | identical |
| [panel-slice-360](shots/panel-slice-360.webp) | Right panel at every width | 1440×900 | identical |
| [panel-slice-460](shots/panel-slice-460.webp) | Right panel at every width | 1440×900 | identical |

## What this does not show

- The Mac app's own window (WebKit, the Mac's glass, traffic lights): only its page, in Chromium.
- macOS and Windows: everything above ran on Linux. CI builds and checks the core and the app logic on all three.
- Agent Chat beyond its empty state (the UI test never starts a person's agents). The chat panel was compared
  separately, old against new, with a scripted agent.
