# Releasing OpenPixel

A release is one command. Merging pull requests never ships anything by itself: `main` collects merged work
until a maintainer tags it.

```sh
cd app && make release-tag VERSION=1.2.0
```

Add `TITLE="Faster exports"` to name the release "OpenPixel 1.2.0: Faster exports" (the tag's message becomes the title).

That checks you're on a clean, up-to-date `main` with green CI, shows what changed since the last release, and
pushes the tag `v1.2.0`. The [release workflow](.github/workflows/release.yml) then:

1. builds a universal app (Apple silicon and Intel) with build number = commit count. Installed apps only update
   to a higher build number, so a release needs at least one new commit since the last one (the tag script and
   the workflow refuse otherwise; a beta and its final release may share a commit),
2. packs `OpenPixel.dmg`. With a Developer ID set up it also signs with the hardened runtime, notarizes and
   staples; without one the app is ad-hoc signed (see [Launching without a Developer ID](#launching-without-a-developer-id)),
3. signs the update for Sparkle and writes `appcast.xml`,
4. creates the GitHub release with both files and notes listing every merged pull request and contributor.

Within a day every installed copy offers the update, and the website's Download button
(`/releases/latest/download/OpenPixel.dmg`) serves the new version straight away.

A tag with a dash, like `v1.3.0-beta.1`, becomes a pre-release: installed apps and the website ignore it, so you can
test a build before shipping it.

## Who can release

- Anyone can open a pull request from a fork. CI runs without access to any secret.
- Only repository admins can push `v*` tags (tag ruleset), so only they can release.
- The signing secrets live in the `release` environment, which only `v*` tags can use.
- `main` only changes through squash-merged pull requests with green CI and a code owner's review.

`sh .github/setup-repo.sh` applies all of these settings.

## Launching without a Developer ID

OpenPixel can ship before you join the Apple Developer Program. Without the `MACOS_CERT_P12` secret the release
workflow skips Developer ID signing and notarization, and says so in the run log. What that means:

- The app runs on Apple silicon and Intel (it is ad-hoc signed), and updates work: Sparkle checks every update
  against OpenPixel's own EdDSA key, not against Apple's certificate.
- Gatekeeper blocks the first launch ("Apple could not verify…"). People open the app once, then go to
  **System Settings → Privacy & Security → Open Anyway**. The release notes say this automatically, and so does
  the downloads page while `NEXT_PUBLIC_NOTARIZED` isn't `true`.

### Adding the Developer ID later

1. Do [Apple Developer ID](#apple-developer-id-add-later) below and add its six secrets.
2. Tag the next release. It is signed and notarized, and installed copies update to it through Sparkle as usual
   (the Sparkle key doesn't change).
3. In Coolify set the build variable `NEXT_PUBLIC_NOTARIZED=true` and redeploy: the site drops the first-launch
   note and says releases are signed and notarized.

## Launch, step by step

Do these once, in this order. On GitHub's free plan, rulesets and environments only work on public repositories,
so the repository goes public before its protections are switched on. You are the only member of `sophne` and the
only collaborator, so nobody else can push in that short gap.

### Part 1: Get the code ready (on your Mac)

1. **Commit and push everything to `main`.** Once the rules in Part 2 are on, `main` only changes through pull
   requests.

   ```sh
   cd ~/Developer/openpixel
   git add -A && git commit -m "Prepare launch" && git push
   ```

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

### Part 3: Give CI the Sparkle key

The private key is in your login keychain (account `openpixel`); its public half is `SUPublicEDKey` in
`app/Info.plist`. CI signs every update with it, and installed apps accept only updates signed with it.

8. **Check the key in your keychain matches the app.** Both lines must show the same key.

   ```sh
   cd app && swift package resolve
   .build/artifacts/sparkle/Sparkle/bin/generate_keys --account openpixel -p
   /usr/libexec/PlistBuddy -c "Print :SUPublicEDKey" Info.plist
   ```

9. **Store it as a secret in the `release` environment**, then remove the file. Keep a copy in your password
   manager first: if the key is lost, installed apps can never update again.

   ```sh
   .build/artifacts/sparkle/Sparkle/bin/generate_keys --account openpixel -x sparkle-private.txt
   gh secret set SPARKLE_PRIVATE_KEY --env release --repo sophne/openpixel < sparkle-private.txt
   rm sparkle-private.txt
   gh secret list --env release --repo sophne/openpixel   # SPARKLE_PRIVATE_KEY
   ```

   Signing with an Apple Developer ID is optional; see [Apple Developer ID](#apple-developer-id-add-later).

### Part 4: Publish the first release

10. **Tag `v1.0.0`.** The script checks that `main` is clean, pushed and green, shows what's in the release and
    asks before pushing the tag.

    ```sh
    cd ~/Developer/openpixel/app && make release-tag VERSION=1.0.0
    gh run watch "$(gh run list --workflow release.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
    ```

11. **Check the release.** github.com/sophne/openpixel/releases/tag/v1.0.0 must have `OpenPixel.dmg` and
    `appcast.xml`. Download the DMG, drag the app to Applications and open it. Without a Developer ID macOS blocks the
    first launch: System Settings → Privacy & Security → **Open Anyway**. In the app, OpenPixel → Check for Updates…
    must say you're up to date.

### Part 5: The website on Coolify, with the GitHub App

12. **Create the GitHub App.** In Coolify: **Sources** → **+ Add** → **GitHub App**.
    - Name: `coolify-sophne`; Organization: `sophne`; leave **System Wide** off.
    - Webhook endpoint: your Coolify dashboard's HTTPS address.
    - **Register Now**. GitHub opens and creates the app under `sophne`; confirm.
    - Back in Coolify, **Install Repositories on GitHub** → **Only select repositories** → `sophne/openpixel` →
      **Install**. The app can now read the code and tell Coolify about pushes; it cannot push or merge.

13. **Create the resource.** Your project → **+ New** → **Private Repository (with GitHub App)** → `coolify-sophne`
    → `sophne/openpixel`, branch `main`.
    - Build Pack: **Dockerfile**
    - Base Directory: `/web`
    - Ports Exposes: `3000`
    - **Continue**.

14. **General settings.**
    - Domains: `https://your-domain` (add `https://www.your-domain` too if you want it, and pick redirect to non-www)
    - Dockerfile Location: `/Dockerfile`
    - Watch Paths: `web/**`, so changes to the app alone don't redeploy the site
    - **Save**.

15. **Environment variables.** Tick **Build Variable** for the `NEXT_PUBLIC_` ones: they are baked into the pages
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

16. **Health check.** Health Checks → enable, path `/`, port `3000`. (The image also has its own `HEALTHCHECK`.)

17. **Deployments.** Advanced:
    - **Auto Deploy**: on. Every push to `main` that touches `web/` redeploys the site.
    - **Preview Deployments**: off. With it on, a pull request from a stranger's fork would build and run their
      code on your server.

18. **DNS.** At your domain registrar, point an `A` record for `your-domain` (and `www`, if used) at your Coolify
    server's IP. Coolify gets the HTTPS certificate from Let's Encrypt once the name resolves.

19. **Deploy** and watch the build log. Then check:

    ```sh
    curl -sI https://your-domain | grep -i "content-security-policy\|x-frame-options"
    curl -s https://your-domain/robots.txt
    curl -s https://your-domain/sitemap.xml | head
    curl -sI https://your-domain/downloads/mac | grep -i location   # …/releases/latest/download/OpenPixel.dmg
    ```

    In a browser: the cookie banner appears, Decline loads nothing from Google, the Downloads page shows v1.0.0,
    and the Changelog lists it. The release list is cached for 10 minutes.

### Part 6: After launch

20. **Search engines.** Add the domain to Google Search Console and submit `https://your-domain/sitemap.xml`.
21. **Google Analytics.** Keep Google Signals and ad features off and data retention at 14 months or less, as the
    privacy policy says.
22. **Every release from now on:** merge pull requests whenever they're ready, then
    `cd app && make release-tag VERSION=x.y.z`. Installed apps offer the update within a day; the site picks up the
    new version within 10 minutes.

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
   openssl rand -base64 24 | gh secret set KEYCHAIN_PASSWORD $E
   base64 -i AuthKey_XXXXXXXXXX.p8 | gh secret set NOTARY_KEY_P8 $E
   gh secret set NOTARY_KEY_ID $E                # prompts
   gh secret set NOTARY_ISSUER_ID $E             # prompts
   rm developer-id.p12 AuthKey_*.p8              # after saving them in your password manager
   ```

5. Tag the next release, then set `NEXT_PUBLIC_NOTARIZED=true` in Coolify and redeploy.

## Building a release by hand

`make release VERSION=1.2.0` runs the same script locally. With `SIGN_ID`, `NOTARY_KEY_PATH`, `NOTARY_KEY_ID` and
`NOTARY_ISSUER_ID` set it signs and notarizes; without them it makes an ad-hoc signed build and says so.
