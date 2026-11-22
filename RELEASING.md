# Releasing OpenPixel

A release is one command. Merging pull requests never ships anything by itself: `main` collects merged work
until a maintainer tags it.

```sh
cd desktop && npm run release:tag -- 1.2.0
```

Add a title to name the release "OpenPixel 1.2.0: Faster exports" (the tag's message becomes the title):
`npm run release:tag -- 1.2.0 "Faster exports"`.

That checks you're on a clean, up-to-date `main` and that the version moves forward, shows what changed since the
last release, and pushes the tag `v1.2.0`. The [release workflow](.github/workflows/release.yml) then:

1. checks the tag (it is on `main`, newer than the newest release, with new commits since) and stamps its version
   into the app and the core ([`set-version.mjs`](desktop/scripts/set-version.mjs)),
2. on macOS, Windows and Linux at the same time: runs the core's and the app's checks, builds the app and packs
   that system's installers ([`release-build.mjs`](desktop/scripts/release-build.mjs)), then starts the packed app
   and checks it ([`packaged-app.mjs`](desktop/tests/packaged-app.mjs)),
3. on macOS, with a Developer ID set up, signs with the hardened runtime, notarizes and staples; without one the
   app is ad-hoc signed (see [Launching without a Developer ID](#launching-without-a-developer-id)),
4. when all three succeeded, checks that the release is complete ([`check-release.mjs`](desktop/scripts/check-release.mjs))
   and creates the GitHub release with every file at once and notes listing every merged pull request and
   contributor. If any system fails, nothing is published.

Installed copies learn of the release the next time they start, and the website's download buttons
(`/releases/latest/download/…`) serve the new version straight away.

A tag with a dash, like `v1.3.0-beta.1`, becomes a pre-release: installed apps and the website ignore it, so you can
test a build before shipping it.

## What a release contains

Every release carries the same files, under the same names (the website, the README and the app's updater link to
them):

| System | File | What |
| --- | --- | --- |
| macOS | `OpenPixel.dmg` | universal (Apple silicon and Intel), macOS 12 or later: what people download |
| macOS | `OpenPixel-mac.zip` | the same app, zipped: what the app's updater installs |
| Windows | `OpenPixel-Setup.exe` | installer (NSIS), x64, for the person who runs it: no administrator rights, installs to `%LOCALAPPDATA%\Programs\OpenPixel` |
| Linux | `OpenPixel.AppImage` | x64 |
| Linux | `openpixel.deb` | amd64, installs to `/opt/OpenPixel` |
| all | `latest-mac.yml`, `latest.yml` (Windows), `latest-linux.yml` | the update feeds: the version, and the size and SHA-512 of each installer |
| macOS | `appcast.xml` | only with the Sparkle key: the feed of the old Mac app (see [The bridge](#the-bridge-for-the-old-mac-app)) |

The native `openpixel` program (the MCP server agents start) is inside each of them; on macOS it is universal too.
Linux builds need glibc 2.34 or newer (Ubuntu 22.04, Debian 12).

**Versions only move forward.** The app's updater installs a release only when its version is higher than the one
running (semantic versioning: `1.10.0` is newer than `1.9.2`; `1.3.0-beta.1` is older than `1.3.0`). So every
release must be newer than the newest stable one; a pre-release must be of a version that is not out yet. The tag
script and the workflow refuse anything else. (The old Mac app's updater went by a build number, the commit count,
instead; the Mac app still carries it as `CFBundleVersion`, which is why a release also needs at least one new
commit since the last one. A beta and its final release may share a commit.)

### What is signed, and what is not

- **macOS**: with the Developer ID secrets, signed (hardened runtime) and notarized by Apple. Without them, ad-hoc
  signed: it runs on Apple silicon and Intel, but Gatekeeper asks people to confirm the first launch. The disk
  image itself is not signed; the app inside is.
- **Windows**: not code-signed (there is no certificate). SmartScreen may show "Windows protected your PC" on the
  first run: **More info → Run anyway**. The release notes say so.
- **Linux**: neither the AppImage nor the `.deb` is signed (no GPG signature, no signed apt repository).
- **The update feeds** (`latest*.yml`) are not signed. They carry each installer's SHA-512, which the updater
  checks (see [What the app sends](#what-the-app-sends-to-the-update-feed), point (d)); they come over HTTPS from
  the same release.
- **`appcast.xml`** (the old Mac app's feed) is not signed itself, but it carries an Ed25519 signature of
  `OpenPixel.dmg` made with OpenPixel's Sparkle key, which the old app checks before installing.
- The native `openpixel` program inside each app is signed with the app on macOS (ad hoc or Developer ID) and not
  at all on Windows and Linux.
- The release notes of every release say how it was signed, automatically.

## How updates reach people

When the app starts it reads its system's update feed once, in the background (exactly what it sends, and when,
is in [What the app sends to the update feed](#what-the-app-sends-to-the-update-feed) below). If a newer version is
out, an **Update** button appears in the tab bar. Nothing is downloaded or installed until the person says so. What the button does depends on whether that copy can replace itself:

| Copy | Update button | How the download is checked before it is installed |
| --- | --- | --- |
| Windows (installer) | downloads in the background, then asks **Restart to Update** | HTTPS from GitHub; SHA-512 from the feed. (No signature check: the installer is not signed.) |
| Linux AppImage | the same: the AppImage file is replaced and opens again | HTTPS from GitHub; SHA-512 from the feed |
| macOS, signed with a Developer ID | the same | HTTPS; SHA-512 from the feed; and macOS only swaps in an app signed by the same Developer ID as the one running |
| macOS, ad-hoc signed | opens the [download page](https://openpixel.dev/downloads) | the person installs it by hand |
| Linux `.deb` | opens the download page | the person installs it with their package manager |

The self-installing copies use [electron-updater](https://www.electron.build/auto-update)
([`desktop/electron/updater.ts`](desktop/electron/updater.ts)) with automatic download and install-on-quit both
switched off: it downloads only after **Download Update**, and installs only after **Restart to Update** (the app
saves first, as when quitting). A download whose checksum differs from the feed's is thrown away and the dialog
offers the download page instead. Whether a copy installs by itself is decided when it is built
(`openpixel.selfUpdate` in the packaged `package.json`, set by `release-build.mjs`: Windows and Linux yes, macOS
only for Developer ID builds) and by how it runs (on Linux only when started from the AppImage).

Pre-releases: a stable copy is only ever told about, and only ever installs, stable releases. A copy of a
pre-release (`1.3.0-beta.1`) is told once a newer stable release is out; its installer then takes the newest
release of any kind that is newer than itself (electron-updater's default for pre-release builds), and the dialog
names the version it will install.

Agents use the native `openpixel` program inside the app. It does not update by itself: it is replaced with the
app (on Linux the app refreshes the copy at `~/.local/share/OpenPixel/bin/openpixel` every time it starts), and
`check_for_updates` tells an agent to reconnect when the app is newer than its connection.

### What the app sends to the update feed

Written for the website's privacy page; keep the two in step when this changes. "The feed" is the file of the
person's system in the newest stable GitHub release: `latest-mac.yml` (macOS), `latest.yml` (Windows) or
`latest-linux.yml` (Linux).

**(a) When, and how often.**
- **At every start of the installed app**, one request for the feed, in the background (no dialog, no download).
  Development builds, `--screenshot` runs and the UI test do not ask. There is no timer: a copy that stays open
  does not ask again by itself.
- **When the person asks**: **Check for Updates…** (menu) and the **Update** button in the tab bar each read the
  feed again. When that finds a newer version on a copy that installs updates itself, the update dialog then also
  lets electron-updater look up the newest release (the requests under (b) below), and, only after **Download
  Update**, download the installer. An agent's `check_for_updates` with `install=true` opens the same dialog.
- **When an agent calls `check_for_updates`**: with the window open the app answers it, reading the feed unless it
  did in the last ten minutes (or the agent asks for `refresh`); with no window open the `openpixel` program the
  agent started reads the feed itself, at most once per ten minutes for that program unless asked to `refresh`.
- Nothing else in the app contacts the update feed. (Separately, and not part of updates: the star count in the
  tab bar comes from `https://api.github.com/repos/sophne/openpixel`, at most once an hour, with
  `User-Agent: OpenPixel` and no other information of the app's.)

**(b) Exactly which addresses, and what is sent.** Every request is an HTTPS `GET` without a body, without
cookies and without any account or token. Each request reaches GitHub (and the GitHub file host
`*.githubusercontent.com` it redirects release files to), which sees the computer's IP address, as any web server
does. OpenPixel runs no server of its own for updates.
- The app's own check (at start, **Check for Updates…**, the Update button, an agent through the window):
  `https://github.com/sophne/openpixel/releases/latest/download/latest-mac.yml` (or `…/latest.yml`,
  `…/latest-linux.yml`). Headers: `User-Agent: OpenPixel/<version>` (the running version, e.g. `OpenPixel/2.0.0`),
  and the ones Node's HTTP client adds to every request: `Accept: */*`, `Accept-Language: *`,
  `Accept-Encoding: gzip, deflate`, `Sec-Fetch-Mode: cors`, `Cache-Control: no-cache`, `Pragma: no-cache`. No
  language, system name, ID or file information.
- The `openpixel` program (an agent's `check_for_updates` with no window open): the same address, with
  `User-Agent: OpenPixel/<version>`, `Cache-Control: no-cache` and `Accept: */*`.
- electron-updater (only on copies that install updates themselves, only after the Update button):
  `https://github.com/sophne/openpixel/releases.atom` (the list of releases),
  `https://github.com/sophne/openpixel/releases/latest` (which release is the newest; a copy of a pre-release
  picks from the list instead), `https://github.com/sophne/openpixel/releases/download/v<version>/<feed>`, and,
  after **Download Update**, the installer next to it (`OpenPixel-Setup.exe`, `OpenPixel.AppImage` or
  `OpenPixel-mac.zip`). Headers: `User-Agent: electron-builder`, `Cache-Control: no-cache`,
  `x-user-staging-id: 00000000-0000-0000-0000-000000000000`, `Accept-Language: *`, on some an `Accept` header, and the ones
  Electron's network stack adds: `Accept-Encoding: gzip, deflate, br, zstd`, `Sec-Fetch-Site: none`,
  `Sec-Fetch-Mode: no-cors`, `Sec-Fetch-Dest: empty`. electron-updater would put a random ID of the installation
  in `x-user-staging-id` (it keeps one in the app's data folder, `.updaterId`, for staged roll-outs), and Electron
  would send the app's language (e.g. `en-US`); OpenPixel overrides both with the same values for everyone
  ([`updater.ts`](desktop/electron/updater.ts); [`update-e2e.mjs`](desktop/tests/update-e2e.mjs) checks every
  request it sees). The `.updaterId` file is still written on the computer; it is not sent.
- No request carries an ID of the person or the installation, an account, the operating system's name or version
  (beyond which feed file is asked for), the language, or anything about files or use. The version in
  `User-Agent: OpenPixel/<version>` is the only fact about the app.

**(c) Switching the automatic check off.** There is no setting for it in the app's window. The check at start is
skipped when the app is started with the environment variable `OPENPIXEL_NO_UPDATE_CHECK=1` (any value but empty or
`0`; [`updater.ts`](desktop/electron/updater.ts)), e.g. `OPENPIXEL_NO_UPDATE_CHECK=1 openpixel-desktop` (Linux
`.deb`), the same in front of the AppImage's path, `OPENPIXEL_NO_UPDATE_CHECK=1
/Applications/OpenPixel.app/Contents/MacOS/OpenPixel` on macOS, or a user environment variable on Windows. It
switches off only the check at start: **Check for Updates…**, the Update button and agents' `check_for_updates`
still read the feed when used. Blocking `github.com` stops all of it; the app works the same without it.

**(d) How a downloaded update is checked before it is installed.** Only the self-installing copies download
anything (Windows installer, Linux AppImage, macOS builds signed with a Developer ID). The download comes over
HTTPS from the release, and electron-updater compares its SHA-512 with the one in the feed (which came over HTTPS
from the same release); a file that does not match is deleted and never installed. Beyond that checksum:
- **Windows**: no signature check, because the installer is not code-signed (electron-updater checks the
  publisher's signature only when the app was built with one).
- **macOS**: only Developer ID builds install updates themselves, and macOS (Squirrel.Mac) then also requires the
  new app to be signed by the same Developer ID as the running one. Ad-hoc signed builds never download updates:
  their Update button opens the download page.
- **Linux AppImage**: no signature (neither the AppImage nor the feed is signed); the checksum is all.
- **Linux `.deb`** and ad-hoc signed macOS copies download nothing themselves; the person installs the new version
  from the download page.
Nothing is installed without the person choosing **Restart to Update**. The feed and the installer come from the
same GitHub release, so the checksum protects against a damaged or swapped download in transit or on a mirror, not
against someone who can publish releases of this repository: that is what the release protections under
[Who can release](#who-can-release) are for, and what code signing will add on macOS and Windows.

### The bridge for the old Mac app

People who still run the old Mac-only app (the Swift one, up to 1.5.x) update through Sparkle, which reads
`appcast.xml` from the newest release and only accepts updates signed with OpenPixel's EdDSA key (public half:
`0ZMX6aWYd1gU6FG/581KjJha7kM3taUsl2nZoyGym3U=`, built into that app). So that they are moved to the new app
instead of being stranded, the macOS build writes that file when the `SPARKLE_PRIVATE_KEY` secret exists
([`appcast.mjs`](desktop/scripts/appcast.mjs)): it offers the new universal `OpenPixel.dmg` (same bundle id,
`com.sophne.openpixel`; build number = commit count, higher than any the old app shipped) with an Ed25519
signature over the disk image, as Sparkle's `sign_update` made it. The script refuses a key that is not the one
installed apps trust and verifies its own signature before it writes the file; the publish step verifies it again
against the disk image it is about to upload.

> **Not yet tried against a real Sparkle client.** The file's format and signature are checked by tests
> (RFC 8032 vectors, a round trip through the public key), but no old app has installed the new one through it.
> Before relying on it, do this once, with the first release that carries `appcast.xml` (a pre-release is fine,
> and safer):
>
> 1. On a Mac, install the last Swift release (1.5.1) from its `OpenPixel.dmg` and open it.
> 2. Point it at the new feed (Sparkle reads this setting before the address built into the app):
>    `defaults write com.sophne.openpixel SUFeedURL
>    "https://github.com/sophne/openpixel/releases/download/v<new>/appcast.xml"`, then **OpenPixel → Check for
>    Updates…**. (For a stable release no setting is needed: the app reads `releases/latest`.)
> 3. It must offer the new version, install it without a signature error, and open the new app. In the new app the
>    Agents page must show the new command, and your recent files must still be there.
> 4. Remove the override: `defaults delete com.sophne.openpixel SUFeedURL`.
>
> What could go wrong, so look for it: Sparkle refusing the EdDSA signature (a key in another form than the one the
> old app was built with); Sparkle refusing the new app's code signature (Sparkle 2 also compares the code signing
> of the old and the new app when the old one has a Developer ID; SECURITY.md says releases so far were not signed
> with one, which would make this not apply, but check what `codesign -dv` says of the installed 1.5.1); the disk
> image's layout (the new one also holds an `Applications` link next to `OpenPixel.app`); 1.5.1 ignoring the
> `SUFeedURL` setting of step 2 (then this check can only be done with the stable release itself, which reaches
> everyone at once); macOS asking again to confirm the first launch
> of the new, ad-hoc signed app.
>
> If Sparkle refuses the update, old copies stay as they are (nothing breaks for them); delete `appcast.xml` from
> the release and tell people to download the new app from the website.

Without the secret no `appcast.xml` is written, and old copies simply are not told about new releases.

## Who can release

- Anyone can open a pull request from a fork. CI runs without access to any secret.
- Only repository admins can push `v*` tags (tag ruleset), so only they can release.
- The signing secrets live in the `release` environment, which only `v*` tags can use. Of the workflow's jobs only
  the macOS build is handed the signing keys; only the last job may write to the repository (to create the release).
- `main` only changes through squash-merged pull requests with green CI and a code owner's review.

`sh .github/setup-repo.sh` applies all of these settings.

## Trying the pipeline without releasing (dry run)

GitHub → Actions → **release** → **Run workflow** (on `main` or any branch). It builds, checks and packs
everything for all three systems exactly as a release does, then checks that a release made of those files would
be complete. It publishes nothing, creates no tag, and uses no secret (so the Mac app is ad-hoc signed and no
`appcast.xml` is written). The installers are kept for three days as the run's artifacts (`dry-run-mac`,
`dry-run-win`, `dry-run-linux`): download them to try the packed apps by hand. Its version is
`0.0.0-dryrun.<run number>`, below every real release.

Do a dry run after any change to the release workflow, the build action, `electron-builder.yml` or the release
scripts, and before the first release from this pipeline.

## Launching without a Developer ID

OpenPixel ships without the Apple Developer Program. Without the `MACOS_CERT_P12` secret the release workflow skips
Developer ID signing and notarization, and says so in the run log. What that means:

- The app runs on Apple silicon and Intel (it is ad-hoc signed).
- Gatekeeper blocks the first launch ("Apple could not verify…"). People open the app once, then go to
  **System Settings → Privacy & Security → Open Anyway**. The release notes say this automatically, and so does
  the downloads page while `NEXT_PUBLIC_NOTARIZED` isn't `true`.
- The app cannot install its own updates on macOS (macOS will not swap in an update whose signature it cannot
  check): its Update button opens the download page. Windows and the AppImage update themselves regardless.

### Adding the Developer ID later

1. Do [Apple Developer ID](#apple-developer-id-add-later) below and add its secrets.
2. Tag the next release. It is signed and notarized. People on an ad-hoc signed copy get it from the download page
   once (their Update button takes them there); from then on the Mac app updates itself.
3. In Coolify set the build variable `NEXT_PUBLIC_NOTARIZED=true` and redeploy: the site drops the first-launch
   note and says releases are signed and notarized.

## First release from this pipeline

The newest public release is **v1.5.1**, the last of the old Mac app (Swift). The first release from here must be
a **higher version than 1.5.1** (for example `2.0.0`): the tag script and the workflow refuse anything else, and
neither the old app (Sparkle) nor anything else would offer a lower one. Until it is out, `releases/latest` is
1.5.1, which has none of the new files: the website's `/downloads/windows`, `/downloads/linux` and
`/downloads/linux-deb` lead nowhere and new copies cannot read a feed. So the website (`web/`) and the release go
out together. Once, in this order:

1. **Dry run** (above). All three builds and the completeness check must be green: until then no macOS or Windows
   step of this pipeline has ever run. Download the three artifacts and open each app once on a real machine.
2. **Check the Sparkle key** on the machine that has it, without printing it:
   `node desktop/scripts/appcast.mjs --check-key --key-file sparkle-private.txt` must say it matches. It must be
   the 32-byte key `generate_keys -x` exports (44 characters of base64). `gh secret list --env release` must show
   `SPARKLE_PRIVATE_KEY`. (Without it the release is still made, but people on the Swift app are not told.)
3. **Tag a pre-release first**: `npm run release:tag -- 2.0.0-beta.1`. Nobody is offered a pre-release. Check the
   release page: all eight files of [What a release contains](#what-a-release-contains), plus `appcast.xml`, and
   the run log's note on how the Mac app was signed.
4. **Try that pre-release**: install it on macOS, Windows and Linux (AppImage and `.deb`). In each: the app opens,
   and the Agents page's command works in your agent (on macOS also the old
   `/Applications/OpenPixel.app/Contents/MacOS/OpenPixel --mcp`). **Check for Updates…** cannot find a feed yet
   (the newest stable release is still 1.5.1) and must say so without harm. On a Mac, do
   [the bridge's manual check](#the-bridge-for-the-old-mac-app) from 1.5.1, against this pre-release's
   `appcast.xml`.
5. **Check an update** on Windows and with the AppImage. A second pre-release does not help here (installed copies
   read the newest *stable* release's feed), so point an installed copy at a folder of your own: serve a folder
   holding the beta's installer and a feed naming a higher version (what
   [`update-e2e.mjs`](desktop/tests/update-e2e.mjs) builds), and start the app with
   `OPENPIXEL_UPDATE_FEED=http://127.0.0.1:<port>/`. The Update button must appear, download, ask, and reopen as
   the new version.
6. **Tag `2.0.0`** and wait for the release to be published.
7. **Deploy the website from `main` right away** (Coolify → the resource → **Redeploy**, unless Auto Deploy already
   did it with the last push to `web/`; if the new site went out earlier, its new download routes were broken until
   this release). Its privacy page must state what [What the app sends](#what-the-app-sends-to-the-update-feed)
   says. Then check: the Downloads page shows 2.0.0 for every system, and all four routes answer (Part 5, step 18).
8. Update the agents' instructions people may have copied: the command is now the one the Agents page shows; the
   old `/Applications/OpenPixel.app/Contents/MacOS/OpenPixel --mcp` keeps working.

Still open, to decide before or after: the `.deb`'s maintainer line is a placeholder
(`OpenPixel contributors <noreply@openpixel.dev>` in [`electron-builder.yml`](desktop/electron-builder.yml)); put a
real address there when the project has one.

## Launch, step by step

These were done once, when the project went public; they are kept here because they describe how the repository
and the website are set up. On GitHub's free plan, rulesets and environments only work on public repositories, so
the repository went public before its protections were switched on.

### Part 1: Get the code ready

1. **Commit and push everything to `main`.** Once the rules in Part 2 are on, `main` only changes through pull
   requests.

2. **Check the whole history for secrets.** It must say `no leaks found`.

   ```sh
   gitleaks git .
   ```

### Part 2: Open source the repository and lock it down (GitHub)

3. **Make it public.** GitHub → `sophne/openpixel` → Settings → General → Danger zone → **Change visibility** →
   **Make public**.

4. **Switch on the protections.** Run this as `eminvkc` (`gh auth status` shows who you are):

   ```sh
   sh .github/setup-repo.sh
   ```

   It sets up:
   - **Release tags**: only admins (you) can create, move or delete `v*` tags. Pushing one is the only way to release.
   - **main**: changes arrive only as squash-merged pull requests, with `app-ci` and `web-ci` green and approved by
     the code owner (you, see `.github/CODEOWNERS`). You can merge your own pull requests without a second reviewer.
   - **The `release` environment**: holds the release secrets, usable only by `v*` tags. Pull requests, including
     ones from forks, never see them.
   - Squash merges only, branches deleted after merging, Dependabot alerts and fixes, private vulnerability
     reporting, and secret scanning with push protection.

5. **Check that the rules are on.**

   ```sh
   gh api repos/sophne/openpixel/rulesets --jq '.[].name'                # Release tags, main
   gh api repos/sophne/openpixel/environments --jq '.environments[].name' # release
   ```

6. **Actions settings.** Settings → Actions → General:
   - Fork pull request workflows from outside collaborators: **Require approval for all external contributors**
   - Workflow permissions: **Read repository contents and packages permissions**
   - Untick **Allow GitHub Actions to create and approve pull requests**

7. **Organisation settings** (github.com/organizations/sophne/settings): Member privileges → Base permissions:
   **Read** (already set). Keep yourself the only owner. Anyone you add later with Write could merge only with your
   approval, and only admins can release.

### Part 3: The old Mac app's update key (Sparkle)

The private key is in your login keychain (account `openpixel`); its public half is the `SUPublicEDKey` the old
Mac app was built with (it is written out in [`appcast.mjs`](desktop/scripts/appcast.mjs)). The release signs the
bridge's `appcast.xml` with it, and old copies accept only updates signed with it. The new app does not use it.

8. **The key is a secret in the `release` environment.** Keep a copy in your password manager: if it is lost, old
   copies can no longer be told about new releases (they keep working). To export it again you need Sparkle's own
   tools (from the Sparkle release the old app used, 2.10.1: `bin/generate_keys`):

   ```sh
   generate_keys --account openpixel -x sparkle-private.txt
   node desktop/scripts/appcast.mjs --check-key --key-file sparkle-private.txt   # must match the old app's key
   gh secret set SPARKLE_PRIVATE_KEY --env release --repo sophne/openpixel < sparkle-private.txt
   rm sparkle-private.txt
   gh secret list --env release --repo sophne/openpixel   # SPARKLE_PRIVATE_KEY
   ```

   Signing with an Apple Developer ID is optional; see [Apple Developer ID](#apple-developer-id-add-later).

### Part 4: Publish a release

9. **Tag it.** The script checks that `main` is clean and pushed and that the version moves forward, shows what's
   in the release and asks before pushing the tag.

   ```sh
   cd ~/Developer/openpixel/desktop && npm run release:tag -- 2.0.0
   gh run watch "$(gh run list --workflow release.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
   ```

10. **Check the release.** github.com/sophne/openpixel/releases/tag/v2.0.0 must have the files of
    [What a release contains](#what-a-release-contains). Download your system's installer and open the app. On a
    Mac without a Developer ID, macOS blocks the first launch: System Settings → Privacy & Security → **Open
    Anyway**. In the app, **Check for Updates…** must say you're up to date.

### Part 5: The website on Coolify, with the GitHub App

11. **Create the GitHub App.** In Coolify: **Sources** → **+ Add** → **GitHub App**.
    - Name: `coolify-sophne`; Organization: `sophne`; leave **System Wide** off.
    - Webhook endpoint: your Coolify dashboard's HTTPS address.
    - **Register Now**. GitHub opens and creates the app under `sophne`; confirm.
    - Back in Coolify, **Install Repositories on GitHub** → **Only select repositories** → `sophne/openpixel` →
      **Install**. The app can now read the code and tell Coolify about pushes; it cannot push or merge.

12. **Create the resource.** Your project → **+ New** → **Private Repository (with GitHub App)** → `coolify-sophne`
    → `sophne/openpixel`, branch `main`.
    - Build Pack: **Dockerfile**
    - Base Directory: `/web`
    - Ports Exposes: `3000`
    - **Continue**.

13. **General settings.**
    - Domains: `https://your-domain` (add `https://www.your-domain` too if you want it, and pick redirect to non-www)
    - Dockerfile Location: `/Dockerfile`
    - Watch Paths: `web/**`, so changes to the app alone don't redeploy the site
    - **Save**.

14. **Environment variables.** Tick **Build Variable** for the `NEXT_PUBLIC_` ones: they are baked into the pages
    when the image is built.

    | Name | Value | Build variable |
    | --- | --- | --- |
    | `NEXT_PUBLIC_SITE_URL` | `https://your-domain` (no trailing slash) | yes |
    | `NEXT_PUBLIC_X_URL` | `https://x.com/eminvkc` | yes |
    | `NEXT_PUBLIC_NOTARIZED` | `false` (`true` once releases are notarized) | yes |
    | `GITHUB_REPO` | `sophne/openpixel` | no |
    | `GITHUB_TOKEN` | optional: fine-grained token, public repositories read-only, no permissions | no |

    `NEXT_PUBLIC_GTM_ID` is only needed to use another Tag Manager container, or `off` to remove analytics and the
    cookie banner.

15. **Health check.** Health Checks → enable, path `/`, port `3000`. (The image also has its own `HEALTHCHECK`.)

16. **Deployments.** Advanced:
    - **Auto Deploy**: on. Every push to `main` that touches `web/` redeploys the site.
    - **Preview Deployments**: off. With it on, a pull request from a stranger's fork would build and run their
      code on your server.

17. **DNS.** At your domain registrar, point an `A` record for `your-domain` (and `www`, if used) at your Coolify
    server's IP. Coolify gets the HTTPS certificate from Let's Encrypt once the name resolves.

18. **Deploy** and watch the build log. Then check:

    ```sh
    curl -sI https://your-domain | grep -i "content-security-policy\|x-frame-options"
    curl -s https://your-domain/robots.txt
    curl -s https://your-domain/sitemap.xml | head
    curl -sI https://your-domain/downloads/mac | grep -i location        # …/releases/latest/download/OpenPixel.dmg
    curl -sI https://your-domain/downloads/windows | grep -i location    # …/OpenPixel-Setup.exe
    curl -sI https://your-domain/downloads/linux | grep -i location      # …/OpenPixel.AppImage
    curl -sI https://your-domain/downloads/linux-deb | grep -i location  # …/openpixel.deb
    ```

    In a browser: the cookie banner appears, Decline loads nothing from Google, the Downloads page shows the
    newest version for every system, and the Changelog lists it. The release list is cached for 10 minutes.

### Part 6: After launch

19. **Search engines.** Add the domain to Google Search Console and submit `https://your-domain/sitemap.xml`.
20. **Google Analytics.** Keep Google Signals and ad features off and data retention at 14 months or less, as the
    privacy policy says.
21. **Every release from now on:** merge pull requests whenever they're ready, then
    `cd desktop && npm run release:tag -- x.y.z`. Installed apps show the update the next time they start; the
    site picks up the new version within 10 minutes.

## Apple Developer ID (add later)

1. Join the [Apple Developer Program](https://developer.apple.com/programs/) (as an organisation for sophne,
   which needs a D-U-N-S number, or as an individual).
2. Certificates → **Developer ID Application** → create it, install it, then in Keychain Access export it with its
   private key as `developer-id.p12` with a strong password.
3. App Store Connect → Users and Access → Integrations → App Store Connect API → create a key with the
   **Developer** role. Download the `.p8` (only possible once) and note its Key ID and Issuer ID.
4. Add the secrets (signing and notarization switch on by themselves when these exist):

   ```sh
   E="--env release --repo sophne/openpixel"
   base64 -i developer-id.p12 | gh secret set MACOS_CERT_P12 $E
   gh secret set MACOS_CERT_PASSWORD $E          # prompts for the .p12 password
   base64 -i AuthKey_XXXXXXXXXX.p8 | gh secret set NOTARY_KEY_P8 $E
   gh secret set NOTARY_KEY_ID $E                # prompts
   gh secret set NOTARY_ISSUER_ID $E             # prompts
   rm developer-id.p12 AuthKey_*.p8              # after saving them in your password manager
   ```

   The build hands them to electron-builder under its own names (`CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_API_KEY`,
   `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`). The `KEYCHAIN_PASSWORD` secret of the old pipeline is no longer used
   (electron-builder makes its own temporary keychain) and can be deleted.

5. A [dry run](#trying-the-pipeline-without-releasing-dry-run) cannot try this: it has no secrets. Tag a
   pre-release instead, check in its run log that the Mac build says "signed with the Developer ID … notarized",
   and on a Mac that `spctl --assess --type execute -vv /Applications/OpenPixel.app` says "Notarized Developer ID".
   Then tag the release, set `NEXT_PUBLIC_NOTARIZED=true` in Coolify and redeploy.

## Building a release by hand

The workflow runs these same commands; each system builds its own installers (a Mac cannot make the Windows
installer here, and so on).

```sh
cd desktop
npm ci
node scripts/set-version.mjs 1.2.0          # into desktop/package.json and core/Cargo.toml (do not commit it)
npm run build:core                          # the core as WebAssembly (needs wasm-bindgen-cli 0.2.100)
npm run build:mcp                           # the native openpixel program for this machine
npm run build                               # the app
npm run release:build                       # this system's installers → release/upload/
npm run test:packaged                       # start the packed app and check it
npm run test:update                         # Linux: the update path against a local feed
```

On a Mac the app is universal, so the native program is needed for both processors before `release:build`:

```sh
rustup target add x86_64-apple-darwin aarch64-apple-darwin
for t in x86_64-apple-darwin aarch64-apple-darwin; do
  MACOSX_DEPLOYMENT_TARGET=12.0 cargo build --release --manifest-path ../core/Cargo.toml --bin openpixel --target $t
done
npm run release:build -- --build-number "$(git rev-list --count HEAD)"
```

Without signing variables the Mac build is ad-hoc signed and says so. To sign and notarize by hand, set
`CSC_NAME="Developer ID Application: …"` (a certificate in your keychain) or `MACOS_CERT_P12` and
`MACOS_CERT_PASSWORD`, and for notarization `NOTARY_KEY_P8`, `NOTARY_KEY_ID` and `NOTARY_ISSUER_ID`, as the
workflow does. To write the old Mac app's feed, from the key in a file (not on the command line, where your shell's
history would keep it), and delete the file afterwards:
`node scripts/appcast.mjs --key-file sparkle-private.txt --dmg release/upload/OpenPixel.dmg --version 1.2.0
--build <commit count> --out release/upload/appcast.xml`. The build number must be the commit count of the tagged
commit (`git rev-list --count v1.2.0`), as the Mac app's own `CFBundleVersion`.

To publish by hand (for when the tag is pushed but the workflow could not publish): collect all three systems'
`release/upload/` folders into one folder `upload` (if the workflow's builds succeeded, their files are the run's
artifacts: `gh run download <run id> --repo sophne/openpixel --pattern 'release-*' --dir upload`, then move the
files out of the per-system folders into `upload` itself), then:

```sh
node desktop/scripts/check-release.mjs upload --version 1.2.0     # complete, and every checksum right
gh release create v1.2.0 upload/* --repo sophne/openpixel --verify-tag --latest --generate-notes
```

For a pre-release use `--prerelease` instead of `--latest`. Never upload a single system's files on their own:
`releases/latest` would then point everyone at a release without their system's files.
