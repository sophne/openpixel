#!/bin/sh
# Starts a release: checks that main is clean, up to date and that the version moves forward, then pushes the tag
# v<version>. GitHub Actions (.github/workflows/release.yml) builds the app for macOS, Windows and Linux and
# publishes the release. Only repository admins can push v* tags (see RELEASING.md), so only maintainers can release.
#
#   scripts/tag-release.sh 1.2.0                    (or, in desktop/: npm run release:tag -- 1.2.0)
#   scripts/tag-release.sh 1.2.0 "Faster exports"   (release title "OpenPixel 1.2.0: Faster exports")
#   scripts/tag-release.sh 1.3.0-beta.1             (pre-release: not offered to users or the website)
set -eu
VERSION="${1:?usage: scripts/tag-release.sh <version, e.g. 1.2.0> [title]}"
VERSION="${VERSION#v}"
TAG="v$VERSION"
# Three numbers, and for a pre-release a dash and a name: what the app's updater can compare.
if ! printf '%s\n' "$VERSION" | grep -Eq '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z][0-9A-Za-z.-]*)?$'; then
  echo "error: version must look like 1.2.3 or 1.2.3-beta.1" >&2; exit 1
fi

[ "$(git rev-parse --abbrev-ref HEAD)" = "main" ] || { echo "error: switch to main first" >&2; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "error: commit or stash your changes first" >&2; exit 1; }
git fetch --quiet origin main --tags
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || { echo "error: main differs from origin/main — pull or push first" >&2; exit 1; }
if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then echo "error: $TAG already exists" >&2; exit 1; fi

LAST_STABLE="$(git tag -l 'v*' --sort=-v:refname | grep -v -e '-' | head -1 || true)"
if [ -n "$LAST_STABLE" ]; then
  # Installed apps only move forward: the updater installs a release only when its version is higher than the
  # one running. So a release must be newer than the newest stable one (a pre-release: of a version not out yet).
  NUMBERS="${VERSION%%-*}"
  NEWEST="$(printf '%s\n%s\n' "${LAST_STABLE#v}" "$NUMBERS" | sort -t. -k1,1n -k2,2n -k3,3n | tail -1)"
  if [ "$NUMBERS" = "${LAST_STABLE#v}" ] || [ "$NEWEST" != "$NUMBERS" ]; then
    echo "error: $TAG is not newer than $LAST_STABLE, the newest release: installed apps would never be offered it." >&2
    exit 1
  fi
  # The old Mac app (Sparkle) goes by the build number instead, which is the commit count: tagging the commit of
  # the last release again would give the same number. It also means there is nothing new to release.
  # (A beta and its final release may share a commit: betas reach nobody.)
  if [ "$(git rev-list --count HEAD)" -le "$(git rev-list --count "$LAST_STABLE")" ]; then
    echo "error: no new commits since $LAST_STABLE, so $TAG would get the same build number and installed copies" >&2
    echo "       of the old Mac app would never be offered it. Merge a pull request first." >&2
    exit 1
  fi
fi

# No CI check here: main only changes through pull requests that passed CI, and the release workflow runs the
# core's and the app's checks on every system before it publishes anything.

LAST="$(git describe --tags --abbrev=0 --match 'v*' 2>/dev/null || true)"
echo "Releasing $TAG. Changes since ${LAST:-the beginning}:"
git log --oneline ${LAST:+"$LAST"..}HEAD | head -50
printf "Push %s? [y/N] " "$TAG"
read -r answer
[ "$answer" = "y" ] || [ "$answer" = "Y" ] || { echo "Cancelled."; exit 1; }

TITLE="${2:-}"
git tag -a "$TAG" -m "${TITLE:-OpenPixel $VERSION}"
git push origin "$TAG"
echo "Pushed $TAG. Follow the build: gh run watch \$(gh run list --workflow release.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
