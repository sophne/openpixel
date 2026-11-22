//! Everything the engine needs from outside itself: files, the clock and the network. The engine never
//! touches the operating system directly, so the same code runs natively and as WebAssembly.
use crate::PcError;

/// Files, time and network for the engine. Paths are plain text, handed over as the tool received them
/// (after "~" expansion and extension fixes); errors are short reasons such as "No such file or directory".
pub trait HostIo {
    fn read(&self, path: &str) -> Result<Vec<u8>, String>;
    /// Writes the whole file or nothing (write to a temporary file, then rename).
    fn write(&self, path: &str, data: &[u8]) -> Result<(), String>;
    fn exists(&self, path: &str) -> bool;
    fn create_dir_all(&self, path: &str) -> Result<(), String>;
    fn home_dir(&self) -> Option<String>;
    /// Seconds since 1970.
    fn now(&self) -> f64;
    fn http_get(&self, url: &str) -> Result<Vec<u8>, String>;
    /// The path as an absolute one, when the host has a current folder to resolve it against (the Mac
    /// app reported saved files this way). The default leaves it as given.
    fn absolute(&self, path: &str) -> String {
        path.to_string()
    }
}

/// The engine's host, boxed. Natively it must be `Send` (the engine moves between threads).
#[cfg(not(target_arch = "wasm32"))]
pub type BoxedIo = Box<dyn HostIo + Send>;
#[cfg(target_arch = "wasm32")]
pub type BoxedIo = Box<dyn HostIo>;

/// A host with nothing: every file and network call fails, the clock stands at 0. The default under
/// WebAssembly until the page gives the engine a real one.
#[derive(Debug, Clone, Copy, Default)]
pub struct NoIo;

impl HostIo for NoIo {
    fn read(&self, _path: &str) -> Result<Vec<u8>, String> {
        Err("this host cannot read files".into())
    }
    fn write(&self, _path: &str, _data: &[u8]) -> Result<(), String> {
        Err("this host cannot write files".into())
    }
    fn exists(&self, _path: &str) -> bool {
        false
    }
    fn create_dir_all(&self, _path: &str) -> Result<(), String> {
        Err("this host cannot create folders".into())
    }
    fn home_dir(&self) -> Option<String> {
        None
    }
    fn now(&self) -> f64 {
        0.0
    }
    fn http_get(&self, _url: &str) -> Result<Vec<u8>, String> {
        Err("this host has no network".into())
    }
}

/// The real thing: `std::fs`, the system clock and HTTPS.
#[cfg(not(target_arch = "wasm32"))]
#[derive(Debug, Clone, Copy, Default)]
pub struct StdIo;

#[cfg(not(target_arch = "wasm32"))]
impl HostIo for StdIo {
    fn read(&self, path: &str) -> Result<Vec<u8>, String> {
        std::fs::read(path).map_err(|e| e.to_string())
    }

    fn write(&self, path: &str, data: &[u8]) -> Result<(), String> {
        use std::sync::atomic::{AtomicU64, Ordering};
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let target = std::path::Path::new(path);
        let name = target.file_name().ok_or_else(|| "not a file path".to_string())?;
        let mut tmp_name = std::ffi::OsString::from(".");
        tmp_name.push(name);
        tmp_name.push(format!(".tmp-{}-{}", std::process::id(), COUNTER.fetch_add(1, Ordering::Relaxed)));
        let tmp = target.with_file_name(tmp_name);
        let result = std::fs::write(&tmp, data).and_then(|_| std::fs::rename(&tmp, target));
        if result.is_err() {
            let _ = std::fs::remove_file(&tmp);
        }
        result.map_err(|e| e.to_string())
    }

    fn exists(&self, path: &str) -> bool {
        std::path::Path::new(path).exists()
    }

    fn create_dir_all(&self, path: &str) -> Result<(), String> {
        std::fs::create_dir_all(path).map_err(|e| e.to_string())
    }

    fn home_dir(&self) -> Option<String> {
        std::env::home_dir().map(|p| p.to_string_lossy().into_owned())
    }

    fn now(&self) -> f64 {
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs_f64()).unwrap_or(0.0)
    }

    fn http_get(&self, url: &str) -> Result<Vec<u8>, String> {
        use std::io::Read;
        let agent = ureq::AgentBuilder::new().timeout(std::time::Duration::from_secs(10)).build();
        let response = agent
            .get(url)
            .set("User-Agent", &format!("OpenPixel/{}", crate::VERSION))
            .set("Cache-Control", "no-cache")
            .call()
            .map_err(|e| match e {
                ureq::Error::Status(code, _) => format!("HTTP {code}"),
                ureq::Error::Transport(t) => t.to_string(),
            })?;
        let mut data = Vec::new();
        // The update feed is a few hundred bytes; never read an endless answer.
        response.into_reader().take(8 << 20).read_to_end(&mut data).map_err(|e| e.to_string())?;
        Ok(data)
    }

    fn absolute(&self, path: &str) -> String {
        std::path::absolute(path).map(|p| p.to_string_lossy().into_owned()).unwrap_or_else(|_| path.to_string())
    }
}

/// The host an engine gets when none is given: the real one natively, none under WebAssembly.
pub fn default_io() -> BoxedIo {
    #[cfg(not(target_arch = "wasm32"))]
    {
        Box::new(StdIo)
    }
    #[cfg(target_arch = "wasm32")]
    {
        Box::new(NoIo)
    }
}

// MARK: - the engine's own file calls, with the error texts tools answer

pub fn read_file(io: &dyn HostIo, path: &str) -> Result<Vec<u8>, PcError> {
    io.read(path).map_err(|e| PcError::invalid(format!("could not read {path}: {e}")))
}

pub fn write_file(io: &dyn HostIo, path: &str, data: &[u8]) -> Result<(), PcError> {
    io.write(path, data).map_err(|e| PcError::invalid(format!("could not write {path}: {e}")))
}

/// Creates the folder a file will go into (nothing to do for a bare file name or a drive root).
pub fn create_parent(io: &dyn HostIo, path: &str) -> Result<(), PcError> {
    match paths::parent(path) {
        Some(dir) => io.create_dir_all(dir).map_err(|e| PcError::invalid(format!("could not create folder {dir}: {e}"))),
        None => Ok(()),
    }
}

/// Path arithmetic on plain text, right for "/" and "\" paths alike (under WebAssembly there is no
/// operating system to ask).
pub mod paths {
    use super::HostIo;

    fn is_sep(c: char) -> bool {
        c == '/' || c == '\\'
    }

    /// The last component: "/a/b.png" → "b.png".
    pub fn file_name(path: &str) -> &str {
        let trimmed = path.trim_end_matches(is_sep);
        match trimmed.rfind(is_sep) {
            Some(i) => &trimmed[i + 1..],
            None => trimmed,
        }
    }

    /// The extension without its dot ("" when there is none; ".hidden" has none).
    pub fn extension(path: &str) -> &str {
        let name = file_name(path);
        match name.rfind('.') {
            Some(i) if i > 0 => &name[i + 1..],
            _ => "",
        }
    }

    /// The last component without its extension: "/a/b.png" → "b".
    pub fn file_stem(path: &str) -> &str {
        let name = file_name(path);
        match name.rfind('.') {
            Some(i) if i > 0 && i + 1 < name.len() => &name[..i],
            _ => name,
        }
    }

    /// The path with ".ext" added.
    pub fn append_extension(path: &str, ext: &str) -> String {
        format!("{path}.{ext}")
    }

    /// The path without its extension: "/a/b.obj" → "/a/b".
    pub fn without_extension(path: &str) -> &str {
        let ext = extension(path);
        if ext.is_empty() {
            path
        } else {
            &path[..path.len() - ext.len() - 1]
        }
    }

    /// The folder a file is in, when the path names one that may need creating.
    pub fn parent(path: &str) -> Option<&str> {
        let i = path.rfind(is_sep)?;
        let dir = path[..i].trim_end_matches(is_sep);
        if dir.is_empty() || dir.ends_with(':') {
            None
        } else {
            Some(dir)
        }
    }

    /// "~" and "~/…" become the home folder (when the host has one).
    pub fn expand_tilde(path: &str, io: &dyn HostIo) -> String {
        let Some(rest) = path.strip_prefix('~') else { return path.to_string() };
        if !(rest.is_empty() || rest.starts_with(is_sep)) {
            return path.to_string();
        }
        match io.home_dir() {
            Some(home) => format!("{}{}", home.trim_end_matches(is_sep), rest),
            None => path.to_string(),
        }
    }
}
