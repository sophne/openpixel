#!/bin/sh
# Starts a release: checks that main is clean, up to date and green, then pushes the tag v<version>.
# GitHub Actions (.github/workflows/release.yml) builds, signs, notarizes and publishes it.
# Only repository admins can push v* tags (see RELEASING.md), so only maintainers can release.
#
#   scripts/tag-release.sh 1.2.0          (or: make release-tag VERSION=1.2.0)
#   scripts/tag-release.sh 1.2.0 "Faster exports"   (release title "OpenPixel 1.2.0: Faster exports")
#   scripts/tag-release.sh 1.3.0-beta.1   (prerelease: not offered to users or the website)
set -eu
VERSION="${1:?usage: scripts/tag-release.sh <version, e.g. 1.2.0>}"
VERSION="${VERSION#v}"
TAG="v$VERSION"
case "$VERSION" in
  [0-9]*.[0-9]*.[0-9]*) ;;
  *) echo "error: version must look like 1.2.3 or 1.2.3-beta.1" >&2; exit 1 ;;
esac

[ "$(git rev-parse --abbrev-ref HEAD)" = "main" ] || { echo "error: switch to main first" >&2; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "error: commit or stash your changes first" >&2; exit 1; }
git fetch --quiet origin main --tags
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || { echo "error: main differs from origin/main — pull or push first" >&2; exit 1; }
if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then echo "error: $TAG already exists" >&2; exit 1; fi

# Installed apps only update to a higher build number, and the build number is the commit count
# (scripts/release.sh). Tagging the commit of the last release again would give the same number, so installed
# copies would never be offered it. (A beta and its final release may share a commit: betas reach nobody.)
LAST_STABLE="$(git tag -l 'v*' --sort=-v:refname | grep -v -e '-' | head -1 || true)"
if [ -n "$LAST_STABLE" ] && [ "$(git rev-list --count HEAD)" -le "$(git rev-list --count "$LAST_STABLE")" ]; then
  echo "error: no new commits since $LAST_STABLE, so $TAG would get the same build number and installed apps" >&2
  echo "       would never be offered it. Merge a pull request first." >&2
  exit 1
fi

# No CI check here: main only changes through pull requests that passed CI, and the release workflow runs the
# app's self-test before it publishes anything.

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
