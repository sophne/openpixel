//! Whether a newer OpenPixel is out, read from the update feed the desktop app's own updater uses
//! (electron-builder's `latest-mac.yml`, `latest.yml` for Windows and `latest-linux.yml`, attached to every
//! GitHub release), so agents can tell the person and work on the newest version. Nothing is installed here.
//!
//! Fetching the feed (through `HostIo`) is kept apart from reading it: `parse`, `report_for` and
//! `report_from_feed` are pure, so a host that fetched the feed itself gets the same answer.
//!
//! The feed is a file from the internet. It is read as text, line by line, never as general YAML: only the
//! top-level `version:` and `releaseDate:` lines count, both are bounded and checked letter by letter, and a
//! feed that is too large or names no version is an error, never a guess.
use std::sync::Mutex;

use serde_json::json;

use crate::io::{self, HostIo};
use crate::{JsonMap, PcError, VERSION};

/// Where the newest stable release's files are; the feed for a system is `FEED_BASE` + `Os::feed_file()`.
pub const FEED_BASE: &str = "https://github.com/sophne/openpixel/releases/latest/download/";
/// A release's page is this + its version.
pub const RELEASE_PAGE: &str = "https://github.com/sophne/openpixel/releases/tag/v";
/// Where people get OpenPixel for every system.
pub const DOWNLOADS_PAGE: &str = "https://openpixel.dev/downloads";
/// Answers are reused for this long unless `refresh` is asked for.
pub const CACHE_SECONDS: f64 = 600.0;
/// A feed is a few hundred bytes; anything beyond this is not one.
pub const MAX_FEED_BYTES: usize = 256 * 1024;
const MAX_VERSION_CHARS: usize = 64;
const MAX_DATE_CHARS: usize = 40;

/// The systems OpenPixel ships for. Each has its own feed file.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Os {
    Mac,
    Windows,
    Linux,
}

impl Os {
    /// The feed's file name, as electron-builder writes it.
    pub fn feed_file(self) -> &'static str {
        match self {
            Os::Mac => "latest-mac.yml",
            Os::Windows => "latest.yml",
            Os::Linux => "latest-linux.yml",
        }
    }

    /// The system this program was built for; none under WebAssembly, where the host says which it is.
    pub fn native() -> Option<Os> {
        if cfg!(target_os = "macos") {
            Some(Os::Mac)
        } else if cfg!(target_os = "windows") {
            Some(Os::Windows)
        } else if cfg!(target_os = "linux") {
            Some(Os::Linux)
        } else {
            None
        }
    }

    /// From the names hosts use: Node's `process.platform` ("darwin", "win32", "linux") and the plain ones.
    pub fn from_name(name: &str) -> Option<Os> {
        match name.trim().to_ascii_lowercase().as_str() {
            "darwin" | "mac" | "macos" => Some(Os::Mac),
            "win32" | "win" | "windows" => Some(Os::Windows),
            "linux" => Some(Os::Linux),
            _ => None,
        }
    }
}

/// The release feed for a system.
pub fn default_feed_for(os: Os) -> String {
    format!("{FEED_BASE}{}", os.feed_file())
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Release {
    pub version: String,
    /// When it was published (ISO 8601), when the feed says so.
    pub date: Option<String>,
}

impl Release {
    /// The release's page on GitHub, with its notes.
    pub fn notes(&self) -> String {
        format!("{RELEASE_PAGE}{}", self.version)
    }

    /// Where the person downloads it.
    pub fn download(&self) -> &'static str {
        DOWNLOADS_PAGE
    }
}

struct State {
    feed_override: Option<String>,
    os: Option<Os>,
    cached: Option<(f64, Release)>,
    installed: Option<fn() -> Option<String>>,
}

static STATE: Mutex<State> = Mutex::new(State { feed_override: None, os: None, cached: None, installed: None });

fn state() -> std::sync::MutexGuard<'static, State> {
    STATE.lock().unwrap_or_else(|e| e.into_inner())
}

/// Reads the feed from here instead of the release feed: an http(s) URL, or a file (a path or a
/// file:// URL). Never one an agent chooses; tests point it at a local file.
pub fn set_feed_override(feed: Option<String>) {
    state().feed_override = feed;
}

/// Which system's feed is read. Natively that is the system the program was built for and nothing needs
/// setting; under WebAssembly the host says it once (`None` goes back to the built-in answer).
pub fn set_os(os: Option<Os>) {
    state().os = os;
}

/// The feed that is read; none when no system is known (WebAssembly before the host said which).
pub fn feed_url() -> Option<String> {
    let s = state();
    s.feed_override.clone().or_else(|| s.os.or_else(Os::native).map(default_feed_for))
}

/// How to find the version of OpenPixel installed on disk now. It differs from the running version when
/// the app was updated while this process kept running (an agent's MCP server started before the update).
/// The Mac app read its bundle's Info.plist; here the program that knows where it is installed sets this.
pub fn set_installed_version_lookup(lookup: Option<fn() -> Option<String>>) {
    state().installed = lookup;
}

/// The installed version, when a lookup is set and finds one.
pub fn installed_version() -> Option<String> {
    let lookup = state().installed;
    lookup.and_then(|f| f())
}

/// -1, 0 or 1, comparing versions the way the app's updater does (semantic versioning): the dotted numbers
/// first ("1.10.0" is newer than "1.9.2", "1.0" equals "1.0.0"), then a version with a pre-release part is
/// older than the same without ("1.3.0-beta.1" < "1.3.0"), and pre-release parts compare piece by piece
/// ("beta.2" < "beta.10" < "rc.1"). A leading "v" and build metadata ("+…") do not count.
pub fn compare(a: &str, b: &str) -> i32 {
    fn split(s: &str) -> (Vec<i64>, Option<&str>) {
        let s = s.trim();
        let s = s.strip_prefix('v').unwrap_or(s);
        let s = s.split('+').next().unwrap_or("");
        let (core, pre) = match s.split_once('-') {
            Some((core, pre)) => (core, Some(pre)),
            None => (s, None),
        };
        let numbers = core
            .split('.')
            .filter(|p| !p.is_empty())
            .map(|p| p.chars().take_while(|c| c.is_ascii_digit()).collect::<String>().parse::<i64>().unwrap_or(0))
            .collect();
        (numbers, pre)
    }
    fn sign(o: std::cmp::Ordering) -> i32 {
        match o {
            std::cmp::Ordering::Less => -1,
            std::cmp::Ordering::Equal => 0,
            std::cmp::Ordering::Greater => 1,
        }
    }
    let ((x, pre_a), (y, pre_b)) = (split(a), split(b));
    for i in 0..x.len().max(y.len()) {
        let (p, q) = (x.get(i).copied().unwrap_or(0), y.get(i).copied().unwrap_or(0));
        if p != q {
            return if p < q { -1 } else { 1 };
        }
    }
    match (pre_a, pre_b) {
        (None, None) => 0,
        (None, Some(_)) => 1,
        (Some(_), None) => -1,
        (Some(p), Some(q)) => {
            let (mut ps, mut qs) = (p.split('.'), q.split('.'));
            loop {
                match (ps.next(), qs.next()) {
                    (None, None) => return 0,
                    (None, Some(_)) => return -1,
                    (Some(_), None) => return 1,
                    (Some(i), Some(j)) => {
                        let number = |s: &str| if !s.is_empty() && s.bytes().all(|c| c.is_ascii_digit()) { s.parse::<u64>().ok() } else { None };
                        let order = match (number(i), number(j)) {
                            (Some(m), Some(n)) => m.cmp(&n),
                            // Numbers come before words.
                            (Some(_), None) => std::cmp::Ordering::Less,
                            (None, Some(_)) => std::cmp::Ordering::Greater,
                            (None, None) => i.cmp(j),
                        };
                        if order != std::cmp::Ordering::Equal {
                            return sign(order);
                        }
                    }
                }
            }
        }
    }
}

/// The value of a top-level `key: value` line: no indentation, the key spelled exactly. Quotes around the
/// value and a trailing comment go; what is left is the value.
fn top_level_value<'a>(line: &'a str, key: &str) -> Option<&'a str> {
    let rest = line.strip_prefix(key)?.strip_prefix(':')?;
    // "version:1.2.3" is not a mapping in YAML; a value follows a space (or the line ends).
    if !rest.is_empty() && !rest.starts_with([' ', '\t']) {
        return None;
    }
    let value = rest.trim();
    for quote in ['\'', '"'] {
        if let Some(inside) = value.strip_prefix(quote) {
            // A quote that never closes is a damaged line: the caller sees a value that is not a version.
            return Some(inside.find(quote).map_or(value, |end| inside[..end].trim()));
        }
    }
    // An unquoted value ends where a comment starts.
    Some(value.split(" #").next().unwrap_or("").trim())
}

/// A version as releases are tagged: starts with a digit, then digits, letters, ".", "-" and "+" only.
fn is_version(v: &str) -> bool {
    !v.is_empty()
        && v.len() <= MAX_VERSION_CHARS
        && v.as_bytes()[0].is_ascii_digit()
        && v.bytes().all(|c| c.is_ascii_alphanumeric() || matches!(c, b'.' | b'-' | b'+'))
}

/// A date as electron-builder writes it ("2026-11-22T11:24:00.000Z"): digits and the marks of ISO 8601.
fn is_date(v: &str) -> bool {
    v.len() >= 10
        && v.len() <= MAX_DATE_CHARS
        && v.as_bytes()[0].is_ascii_digit()
        && v.bytes().all(|c| c.is_ascii_digit() || matches!(c, b'-' | b':' | b'.' | b'+' | b'T' | b'Z'))
}

/// The release a feed announces: its top-level `version:`, and `releaseDate:` when it is there and looks
/// like a date. Anything else in the file (the list of installers and their checksums) is the updater's.
pub fn parse(feed: &str) -> Option<Release> {
    if feed.len() > MAX_FEED_BYTES {
        return None;
    }
    let (mut version, mut date) = (None, None);
    for line in feed.trim_start_matches('\u{feff}').lines() {
        let line = line.trim_end_matches('\r');
        if version.is_none() {
            if let Some(v) = top_level_value(line, "version") {
                // The first version line decides; one that is not a version makes the feed unreadable.
                if !is_version(v) {
                    return None;
                }
                version = Some(v.to_string());
                continue;
            }
        }
        if date.is_none() {
            if let Some(d) = top_level_value(line, "releaseDate") {
                if is_date(d) {
                    date = Some(d.to_string());
                }
            }
        }
    }
    version.map(|version| Release { version, date })
}

/// The newest release, from the feed (cached for 10 minutes).
pub fn latest(io: &dyn HostIo, refresh: bool) -> Result<Release, PcError> {
    let now = io.now();
    let feed = {
        let s = state();
        if !refresh {
            if let Some((at, release)) = &s.cached {
                if now - at < CACHE_SECONDS {
                    return Ok(release.clone());
                }
            }
        }
        s.feed_override.clone().or_else(|| s.os.or_else(Os::native).map(default_feed_for))
    };
    let Some(feed) = feed else {
        return Err(PcError::invalid("the update feed is not known here: the app has not said which system it runs on"));
    };
    let data = if feed.starts_with("http://") || feed.starts_with("https://") {
        io.http_get(&feed).map_err(|reason| {
            if let Some(code) = reason.strip_prefix("HTTP ") {
                PcError::invalid(format!("the update feed answered HTTP {code}"))
            } else if reason.to_lowercase().contains("timed out") {
                PcError::invalid("the update feed did not answer (offline?)")
            } else {
                PcError::invalid(format!("could not reach the update feed: {reason}"))
            }
        })?
    } else {
        io::read_file(io, feed.strip_prefix("file://").unwrap_or(&feed))?
    };
    if data.len() > MAX_FEED_BYTES {
        return Err(PcError::invalid("the update feed is too large to be one"));
    }
    let r = parse(&String::from_utf8_lossy(&data)).ok_or_else(|| PcError::invalid("the update feed lists no release"))?;
    state().cached = Some((now, r.clone()));
    Ok(r)
}

/// What check_for_updates answers about `release` for a program running version `running`, when
/// `installed` is the version on disk (if known).
pub fn report_for(release: &Release, running: &str, installed: Option<&str>) -> JsonMap {
    let newer = compare(&release.version, running) > 0;
    let mut o = JsonMap::new();
    o.insert("running_version".into(), json!(running));
    o.insert("latest_version".into(), json!(release.version));
    o.insert("update_available".into(), json!(newer));
    o.insert("release_notes".into(), json!(release.notes()));
    o.insert("download".into(), json!(release.download()));
    if let Some(d) = &release.date {
        o.insert("release_date".into(), json!(d));
    }
    if let Some(disk) = installed {
        if compare(disk, running) > 0 {
            o.insert("installed_version".into(), json!(disk));
            o.insert(
                "restart_needed".into(),
                json!(format!("OpenPixel {disk} is installed but this program still runs {running}. Restart it to use the new version.")),
            );
        }
    }
    o.insert(
        "next".into(),
        json!(if newer {
            format!("Tell the person OpenPixel {} is out. check_for_updates install=true shows the update dialog in the OpenPixel window for them to confirm (or they click Update in the tab bar). After it restarts, reconnect the OpenPixel MCP server so you get the new version's tools.", release.version)
        } else {
            "OpenPixel is up to date.".to_string()
        }),
    );
    o
}

/// The same answer from feed text a host fetched itself.
pub fn report_from_feed(feed: &str, running: &str, installed: Option<&str>) -> Result<JsonMap, PcError> {
    let r = parse(feed).ok_or_else(|| PcError::invalid("the update feed lists no release"))?;
    Ok(report_for(&r, running, installed))
}

/// What check_for_updates answers for the program that runs it, reading the feed through `io`.
pub fn report_with(io: &dyn HostIo, running: &str, refresh: bool) -> Result<JsonMap, PcError> {
    let r = latest(io, refresh)?;
    Ok(report_for(&r, running, installed_version().as_deref()))
}

/// What check_for_updates answers (reads the release feed; cached unless `refresh`), with the engine's
/// default host: the real network natively.
pub fn report(refresh: bool) -> Result<JsonMap, PcError> {
    report_with(io::default_io().as_ref(), VERSION, refresh)
}

#[cfg(test)]
mod tests {
    use super::*;

    const FEED: &str = "version: 1.4.2\nfiles:\n  - url: OpenPixel.AppImage\n    sha512: q83vEjRWeJ==\n    size: 104857600\n    blockMapSize: 110000\npath: OpenPixel.AppImage\nsha512: q83vEjRWeJ==\nreleaseDate: '2026-11-22T11:24:00.000Z'\n";

    #[test]
    fn reads_what_electron_builder_writes() {
        let r = parse(FEED).expect("a release");
        assert_eq!(r, Release { version: "1.4.2".into(), date: Some("2026-11-22T11:24:00.000Z".into()) });
        assert_eq!(r.notes(), "https://github.com/sophne/openpixel/releases/tag/v1.4.2");
        assert_eq!(r.download(), "https://openpixel.dev/downloads");
        // Windows line endings, a byte order mark, double quotes, a comment and a pre-release version.
        let other = "\u{feff}# made by electron-builder\r\nversion: \"2.0.0-beta.1\"  # the tag\r\nreleaseDate: 2026-01-02T03:04:05Z\r\n";
        assert_eq!(parse(other), Some(Release { version: "2.0.0-beta.1".into(), date: Some("2026-01-02T03:04:05Z".into()) }));
        // No date is no problem; a date that is not one is left out.
        assert_eq!(parse("version: 3.0.0\n"), Some(Release { version: "3.0.0".into(), date: None }));
        assert_eq!(parse("version: 3.0.0\nreleaseDate: <script>\n").and_then(|r| r.date), None);
    }

    #[test]
    fn only_top_level_lines_count() {
        // A nested or list `version:` is not the release's; neither is a key that only starts the same.
        assert_eq!(parse("files:\n  - url: a\n    version: 9.9.9\n  version: 8.8.8\nversions: 7.7.7\nversion: 1.0.0\n").map(|r| r.version), Some("1.0.0".into()));
        assert_eq!(parse("files:\n  - version: 9.9.9\n"), None);
        // The first top-level version decides.
        assert_eq!(parse("version: 1.0.0\nversion: 9.0.0\n").map(|r| r.version), Some("1.0.0".into()));
    }

    #[test]
    fn damaged_and_hostile_feeds_are_no_release() {
        for bad in [
            "",
            "\n\n",
            "<html><body>Not Found</body></html>",
            "<rss><channel></channel></rss>",
            "version:\n",
            "version: \n",
            "version:1.2.3\n",
            "version: latest\n",
            "version: 1.2.3 <script>alert(1)</script>\n",
            "version: 1.2.3\u{0}\n",
            "version: \"1.2.3\n",
            "version: '1.2.3\n",
            "version: '../../etc/passwd'\n",
            "version: 1.0.0/../../x\n",
            "version: ｖ1.0.0\n",
            "version: [1, 2, 3]\n",
            "version: {a: 1}\n",
            "version: |\n  1.2.3\n",
            "\u{0}\u{1}\u{2}\u{ffff}",
        ] {
            assert_eq!(parse(bad), None, "{bad:?}");
        }
        // A version longer than any real one, a feed larger than any real one, and bytes that are not text.
        assert_eq!(parse(&format!("version: 1.{}\n", "0".repeat(MAX_VERSION_CHARS))), None);
        assert_eq!(parse(&format!("version: 1.2.3\n{}", "#".repeat(MAX_FEED_BYTES))), None);
        assert_eq!(parse(&String::from_utf8_lossy(&[0xff, 0xfe, b'v', 0x80, b'\n', 0xc3])), None);
        // Very long lines and very many lines neither crash nor hang.
        assert_eq!(parse(&"x".repeat(MAX_FEED_BYTES)), None);
        assert_eq!(parse(&"\n".repeat(MAX_FEED_BYTES)), None);
        assert_eq!(parse(&format!("{}version: 4.5.6\n", "a: b\n".repeat(1000))).map(|r| r.version), Some("4.5.6".into()));
        // Numbers too large to count are not newer than anything.
        assert_eq!(compare("99999999999999999999999999.0.0", "1.0.0"), -1);
        assert_eq!(report_from_feed("nothing", "1.0.0", None).map_err(|e| e.0), Err("the update feed lists no release".to_string()));
    }

    #[test]
    fn versions_compare_like_the_updater() {
        assert_eq!(compare("1.10.0", "1.9.2"), 1);
        assert_eq!(compare("1.0", "1.0.0"), 0);
        assert_eq!(compare("1.99.99", "2.0.0"), -1);
        assert_eq!(compare("v1.2.3", "1.2.3"), 0);
        assert_eq!(compare("1.2.3+build.7", "1.2.3"), 0);
        // A pre-release is older than its release, and newer than the release before.
        assert_eq!(compare("1.3.0-beta.1", "1.3.0"), -1);
        assert_eq!(compare("1.3.0", "1.3.0-beta.1"), 1);
        assert_eq!(compare("1.3.0-beta.1", "1.2.9"), 1);
        assert_eq!(compare("1.3.0-beta.2", "1.3.0-beta.10"), -1);
        assert_eq!(compare("1.3.0-beta.1", "1.3.0-rc.1"), -1);
        assert_eq!(compare("1.3.0-beta", "1.3.0-beta.1"), -1);
        assert_eq!(compare("1.3.0-1", "1.3.0-alpha"), -1);
        assert_eq!(compare("1.3.0-beta.1", "1.3.0-beta.1"), 0);
    }

    #[test]
    fn every_system_has_its_feed() {
        assert_eq!(default_feed_for(Os::Mac), "https://github.com/sophne/openpixel/releases/latest/download/latest-mac.yml");
        assert_eq!(default_feed_for(Os::Windows), "https://github.com/sophne/openpixel/releases/latest/download/latest.yml");
        assert_eq!(default_feed_for(Os::Linux), "https://github.com/sophne/openpixel/releases/latest/download/latest-linux.yml");
        assert_eq!([Os::from_name("darwin"), Os::from_name("win32"), Os::from_name("Linux"), Os::from_name("web")], [Some(Os::Mac), Some(Os::Windows), Some(Os::Linux), None]);
    }

    #[test]
    fn the_report_keeps_its_keys() {
        let o = report_from_feed(FEED, "1.4.0", Some("1.4.2")).expect("a report");
        let keys: Vec<&str> = o.keys().map(String::as_str).collect();
        for k in ["running_version", "latest_version", "update_available", "release_notes", "download", "release_date", "installed_version", "restart_needed", "next"] {
            assert!(keys.contains(&k), "{k} in {keys:?}");
        }
        assert_eq!(o["update_available"], json!(true));
        assert_eq!(o["download"], json!("https://openpixel.dev/downloads"));
        // Someone on a pre-release is told when the release itself is out.
        assert_eq!(report_from_feed(FEED, "1.4.2-beta.3", None).expect("a report")["update_available"], json!(true));
        assert_eq!(report_from_feed(FEED, "1.4.2", None).expect("a report")["update_available"], json!(false));
        assert_eq!(report_from_feed(FEED, "1.5.0-beta.1", None).expect("a report")["update_available"], json!(false));
    }
}
