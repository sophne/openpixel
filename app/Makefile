# OpenPixel
#   make             build OpenPixel.app
#   make test        run the built-in checks
#   make ui-test     click through the editor and check the layout (pictures in shots/uitest)
#   make dmg         installable disk image in dist/
#   make release VERSION=1.2.0      signed + notarized dist/OpenPixel.dmg and dist/appcast.xml (CI runs this)
#   make release-tag VERSION=1.2.0  tag main and push the tag: GitHub Actions builds and publishes the release
#                                   (add TITLE="Faster exports" to name it "OpenPixel 1.2.0: Faster exports")
.PHONY: all build app test ui-test screenshot dmg release release-tag clean

all: app

build:
	swift build -c release

app:
	sh build.sh

test: build
	.build/release/OpenPixel --selftest

ui-test: app
	mkdir -p shots/uitest
	OpenPixel.app/Contents/MacOS/OpenPixel --ui-test "$(CURDIR)/shots/uitest"
	@python3 -c "import json;r=json.load(open('shots/uitest/report.json'));print(r.get('passed'),'passed,',r.get('failed'),'failed')"

screenshot: app
	mkdir -p shots
	OpenPixel.app/Contents/MacOS/OpenPixel --screenshot "$(CURDIR)/shots/now.png"

dmg: app
	sh tools/make-dmg.sh

release:
	@test -n "$(VERSION)" || (echo "usage: make release VERSION=1.2.0" && exit 1)
	sh scripts/release.sh $(VERSION)

release-tag:
	sh scripts/tag-release.sh $(VERSION) "$(TITLE)"

clean:
	rm -rf .build OpenPixel.app build dist
