// The reader's own widgets (src/lib/widgets.js), each a small HTML page run
// in a sandboxed frame. The app's own policy rightly lets no inline script
// run in its pages -- frames included -- so a widget's page is served from an
// address of its own, blvrd-widget://localhost/<key>, with a policy of its
// own: its scripts and styles run; it may load pictures and fonts and fetch
// from https; and nothing else. The webview hands each page over first
// (`widget_serve`), and the frame loads it from here.

use std::collections::HashMap;
use std::sync::Mutex;

use tauri::http::{header, Request, Response, StatusCode};
use tauri::{Manager, Runtime, State, UriSchemeContext};

pub const SCHEME: &str = "blvrd-widget";

const POLICY: &str = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob: https:; media-src data: blob: https:; font-src data: https:; connect-src https:; form-action 'none'; base-uri 'none'";

#[derive(Default)]
pub struct Pages(Mutex<HashMap<String, String>>);

/// A widget's page, kept under `key` for its frame to load.
#[tauri::command]
pub fn widget_serve(pages: State<Pages>, key: String, html: String) -> Result<(), String> {
    if html.len() > 2_000_000 {
        return Err("that widget is too big".into());
    }
    let mut map = pages.0.lock().map_err(|e| e.to_string())?;
    // A few hundred at most: a page is kept per frame and version.
    if map.len() > 400 {
        map.clear();
    }
    map.insert(key, html);
    Ok(())
}

/// The page a widget frame asks for.
pub fn serve<R: Runtime>(ctx: UriSchemeContext<'_, R>, request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let key = request.uri().path().trim_start_matches('/').to_string();
    let page = ctx.app_handle().state::<Pages>().0.lock().ok().and_then(|map| map.get(&key).cloned());
    match page {
        Some(html) => Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
            .header("Content-Security-Policy", POLICY)
            .header(header::CACHE_CONTROL, "no-store")
            .body(html.into_bytes())
            .unwrap_or_default(),
        None => Response::builder().status(StatusCode::NOT_FOUND).body(Vec::new()).unwrap_or_default(),
    }
}

/// A widget saved as a file in Downloads, shown in the Finder: the way to
/// pass one on. Its name made safe for a file.
#[tauri::command]
pub fn widget_export(name: String, html: String) -> Result<String, String> {
    let home = std::env::var("HOME").map_err(|_| "no home folder".to_string())?;
    let clean: String = name.chars().map(|c| if c.is_alphanumeric() || " -_".contains(c) { c } else { '-' }).collect();
    let base = clean.trim().trim_matches('-');
    let base = if base.is_empty() { "widget" } else { base };
    let dir = std::path::PathBuf::from(home).join("Downloads");
    let mut path = dir.join(format!("{base}.html"));
    let mut n = 2;
    while path.exists() {
        path = dir.join(format!("{base} {n}.html"));
        n += 1;
    }
    std::fs::write(&path, html).map_err(|e| format!("couldn't save {}: {e}", path.display()))?;
    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("/usr/bin/open").arg("-R").arg(&path).status();
    Ok(path.to_string_lossy().into())
}
