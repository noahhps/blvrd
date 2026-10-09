// Where an agent's computer is, and what starts it (src/lib/computer).
//
// The computer itself is computer/server.mjs, an MCP server on stdio, run
// through `mcp_spawn` like the reader's own local servers. This only says
// what to run: on this Mac, with a folder for the chat under
// ~/blvrd/Workspace and a browser profile of its own under ~/blvrd/Browser
// -- never the reader's own profile -- in whichever Chromium browser the
// reader picked (src-tauri/src/browsers.rs), or the first one found.

use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
pub struct Plan {
    command: String,
    args: Vec<String>,
    root: String,
}

fn home() -> Result<PathBuf, String> {
    std::env::var("HOME").map(PathBuf::from).map_err(|_| "no home folder".to_string())
}

// A chat id as a folder name: letters, digits, - and _ only.
fn folder_for(chat_id: &str) -> String {
    let clean: String = chat_id.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' }).collect();
    if clean.is_empty() { "chat".into() } else { clean }
}

fn server_path(app: &AppHandle) -> Result<PathBuf, String> {
    // While developing, the repository's own copy; in the app, the bundled one.
    if cfg!(debug_assertions) {
        return Ok(PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../computer/server.mjs")));
    }
    app.path()
        .resource_dir()
        .map(|dir| dir.join("computer").join("server.mjs"))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn computer_host(app: AppHandle, chat_id: String, browser: Option<String>, show: Option<bool>) -> Result<Plan, String> {
    let base = home()?.join("blvrd");
    let root = base.join("Workspace").join(folder_for(&chat_id));
    // The browser: the one picked, else the first found. A profile for each,
    // since browsers can't share one.
    let chosen = match browser.filter(|b| !b.trim().is_empty()) {
        Some(path) => Some(crate::browsers::browser_resolve(path)?),
        None => crate::browsers::browsers_found().into_iter().next(),
    };
    let profile = base.join("Browser").join(chosen.as_ref().map(|b| folder_for(&b.name_for_folder())).unwrap_or_else(|| "Default".into()));
    std::fs::create_dir_all(&root).map_err(|e| format!("couldn't make {}: {e}", root.display()))?;
    std::fs::create_dir_all(&profile).map_err(|e| format!("couldn't make {}: {e}", profile.display()))?;
    let server = server_path(&app)?;
    if !server.exists() {
        return Err(format!("the computer isn't where it should be ({})", server.display()));
    }
    Ok(Plan {
        command: "node".into(),
        args: vec![
            server.to_string_lossy().into(),
            "--root".into(),
            root.to_string_lossy().into(),
            "--profile".into(),
            profile.to_string_lossy().into(),
        ]
        .into_iter()
        .chain(chosen.iter().flat_map(|b| ["--browser".to_string(), b.program()]))
        .chain(show.unwrap_or(false).then(|| "--show".to_string()))
        .collect(),
        root: root.to_string_lossy().into(),
    })
}
