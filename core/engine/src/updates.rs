//! Whether a newer OpenPixel is out (port of Updates.swift), read from the same appcast the Mac app's
//! updater uses, so agents can tell the person and work on the newest version. Nothing is installed here.
//!
//! Fetching the feed (through `HostIo`) is kept apart from reading it: `parse`, `report_for` and
//! `report_from_feed` are pure, so a host that fetched the feed itself gets the same answer.
use std::sync::Mutex;

use serde_json::json;

use crate::io::{self, HostIo};
use crate::{JsonMap, PcError, VERSION};

pub const DEFAULT_FEED: &str = "https://github.com/sophne/openpixel/releases/latest/download/appcast.xml";
/// Answers are reused for this long unless `refresh` is asked for.
pub const CACHE_SECONDS: f64 = 600.0;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Release {
    pub version: String,
    pub notes: Option<String>,
    pub download: Option<String>,
}

struct State {
    feed_override: Option<String>,
    cached: Option<(f64, Release)>,
    installed: Option<fn() -> Option<String>>,
}

static STATE: Mutex<State> = Mutex::new(State { feed_override: None, cached: None, installed: None });

fn state() -> std::sync::MutexGuard<'static, State> {
    STATE.lock().unwrap_or_else(|e| e.into_inner())
}

/// Reads the feed from here instead of the release feed: an http(s) URL, or a file (a path or a
/// file:// URL). Never one an agent chooses; tests point it at a local file.
pub fn set_feed_override(feed: Option<String>) {
    state().feed_override = feed;
}

/// The feed that is read.
pub fn feed_url() -> String {
    state().feed_override.clone().unwrap_or_else(|| DEFAULT_FEED.to_string())
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

/// -1, 0 or 1, comparing dotted version numbers ("1.10.0" is newer than "1.9.2").
pub fn compare(a: &str, b: &str) -> i32 {
    let parts = |s: &str| -> Vec<i64> {
        s.split('.')
            .filter(|p| !p.is_empty())
            .map(|p| p.chars().take_while(|c| c.is_numeric()).collect::<String>().parse::<i64>().unwrap_or(0))
            .collect()
    };
    let (x, y) = (parts(a), parts(b));
    for i in 0..x.len().max(y.len()) {
        let (p, q) = (x.get(i).copied().unwrap_or(0), y.get(i).copied().unwrap_or(0));
        if p != q {
            return if p < q { -1 } else { 1 };
        }
    }
    0
}

/// The text of the first `<tag>…</tag>` whose content has no "<" in it.
fn first_element(item: &str, tag: &str) -> Option<String> {
    let (open, close) = (format!("<{tag}>"), format!("</{tag}>"));
    let mut from = 0;
    while let Some(i) = item[from..].find(&open) {
        let start = from + i + open.len();
        let rest = &item[start..];
        let end = rest.find('<').unwrap_or(rest.len());
        if rest[end..].starts_with(&close) {
            return Some(rest[..end].trim().to_string());
        }
        from = from + i + 1;
    }
    None
}

/// The enclosure's url attribute (the pattern `<enclosure[^>]*url="[^"]*"` of the Swift source).
fn enclosure_url(item: &str) -> Option<String> {
    const TAG: &str = "<enclosure";
    const ATTR: &str = "url=\"";
    let mut from = 0;
    while let Some(i) = item[from..].find(TAG) {
        let start = from + i;
        let after = start + TAG.len();
        let tag_end = item[after..].find('>').map(|e| after + e).unwrap_or(item.len());
        // The last url=" inside the tag that is closed by a quote.
        let mut search_end = tag_end;
        while let Some(p) = item[after..search_end].rfind(ATTR) {
            let value_start = after + p + ATTR.len();
            if let Some(q) = item[value_start..].find('"') {
                let matched = &item[start..value_start + q + 1];
                // As the Swift did: the text after the first url=" of the match, without the closing quote.
                let first = matched.find(ATTR)? + ATTR.len();
                return Some(matched[first..matched.len() - 1].to_string());
            }
            search_end = after + p;
        }
        from = start + 1;
    }
    None
}

/// The newest release listed in an appcast.
pub fn parse(xml: &str) -> Option<Release> {
    let mut best: Option<Release> = None;
    for chunk in xml.split("<item>").skip(1) {
        let item = chunk.split("</item>").next().unwrap_or("");
        let Some(v) = first_element(item, "sparkle:shortVersionString") else { continue };
        let notes = first_element(item, "sparkle:fullReleaseNotesLink");
        let download = enclosure_url(item);
        if best.as_ref().is_none_or(|b| compare(&v, &b.version) > 0) {
            best = Some(Release { version: v, notes, download });
        }
    }
    best
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
        s.feed_override.clone().unwrap_or_else(|| DEFAULT_FEED.to_string())
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
    if let Some(n) = &release.notes {
        o.insert("release_notes".into(), json!(n));
    }
    if let Some(d) = &release.download {
        o.insert("download".into(), json!(d));
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
            format!("Tell the person OpenPixel {} is out. check_for_updates install=true shows the update dialog in the OpenPixel window for them to confirm (or they click Update at the bottom of the sidebar). After it restarts, reconnect the OpenPixel MCP server so you get the new version's tools.", release.version)
        } else {
            "OpenPixel is up to date.".to_string()
        }),
    );
    o
}

/// The same answer from feed text a host fetched itself.
pub fn report_from_feed(xml: &str, running: &str, installed: Option<&str>) -> Result<JsonMap, PcError> {
    let r = parse(xml).ok_or_else(|| PcError::invalid("the update feed lists no release"))?;
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
