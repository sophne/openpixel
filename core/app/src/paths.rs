//! Where OpenPixel keeps things on each system, and small path helpers.
use std::path::{Component, Path, PathBuf};

pub fn home() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("."))
}

/// The per-user data folder the window keeps its socket in (the same one `desktop/host` works out):
/// macOS `~/Library/Application Support/OpenPixel`, Windows `%APPDATA%\OpenPixel`, Linux `$XDG_DATA_HOME/OpenPixel`
/// (`~/.local/share/OpenPixel` when that is not set).
pub fn data_folder() -> PathBuf {
    dirs::data_dir().unwrap_or_else(|| home().join(".local").join("share")).join("OpenPixel")
}

/// Where new files are saved, and the only folder agents over HTTP can reach: `~/Documents/OpenPixel`.
pub fn files_folder() -> PathBuf {
    dirs::document_dir().unwrap_or_else(|| home().join("Documents")).join("OpenPixel")
}

/// `~` and `~/…` as the home folder.
pub fn expand_tilde(raw: &str) -> String {
    if raw == "~" {
        return text(&home());
    }
    match raw.strip_prefix("~/") {
        Some(rest) => text(&home().join(rest)),
        None => raw.to_string(),
    }
}

pub fn text(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

/// Removes `.` and `..` without looking at the disk (and makes the path absolute).
pub fn standardize(p: &Path) -> PathBuf {
    let abs = if p.is_absolute() { p.to_path_buf() } else { std::env::current_dir().unwrap_or_default().join(p) };
    let mut out = PathBuf::new();
    for c in abs.components() {
        match c {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// The path with every symbolic link followed, as far as the path exists; the rest is kept as written.
pub fn resolve_symlinks(p: &Path) -> PathBuf {
    let p = standardize(p);
    let mut rest: Vec<std::ffi::OsString> = Vec::new();
    let mut cur = p.clone();
    loop {
        if let Ok(real) = std::fs::canonicalize(&cur) {
            let mut out = simplify(real);
            for part in rest.iter().rev() {
                out.push(part);
            }
            return out;
        }
        match (cur.file_name().map(|n| n.to_os_string()), cur.parent().map(Path::to_path_buf)) {
            (Some(name), Some(parent)) => {
                rest.push(name);
                cur = parent;
            }
            _ => return p,
        }
    }
}

/// Windows answers `\\?\C:\…` for a resolved path; plain `C:\…` is what people and tools expect.
fn simplify(p: PathBuf) -> PathBuf {
    if cfg!(windows) {
        let s = text(&p);
        if let Some(rest) = s.strip_prefix(r"\\?\") {
            if rest.as_bytes().get(1) == Some(&b':') {
                return PathBuf::from(rest);
            }
        }
    }
    p
}

/// A new identifier like `UUID().uuidString` on the Mac (upper case).
pub fn new_uuid() -> String {
    uuid::Uuid::new_v4().to_string().to_uppercase()
}
