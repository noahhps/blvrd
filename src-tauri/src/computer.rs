// Where an agent's computer is, and what starts it (src/lib/computer).
//
// The computer itself is computer/server.mjs, an MCP server on stdio, run
// through `mcp_spawn` like the reader's own local servers. This only says
// what to run: on this Mac, with a folder for the chat under
// ~/blvrd/Workspace, browsing in the reader's own browser through the blvrd
// extension (computer/extension; copied to ~/blvrd/Extension for them to add)
// -- or, if they chose a separate browser, one the computer starts with a
// profile of its own under ~/blvrd/Browser, in whichever Chromium browser
// they picked (src-tauri/src/browsers.rs), or the first one found.

use std::path::{Path, PathBuf};

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

// The computer's own files: while developing, the repository's copy; in the
// app, the bundled one.
fn computer_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if cfg!(debug_assertions) {
        return Ok(PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../computer")));
    }
    app.path().resource_dir().map(|dir| dir.join("computer")).map_err(|e| e.to_string())
}

fn copy_dir(from: &Path, to: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&entry.path(), &target)?;
        } else {
            std::fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

// The extension, where the reader can add it to their browser from: kept up
// to date with this blvrd each time (the browser picks a change up when it's
// reloaded on its extensions page).
fn extension_copy(app: &AppHandle) -> Result<PathBuf, String> {
    let from = computer_dir(app)?.join("extension");
    let to = home()?.join("blvrd").join("Extension");
    copy_dir(&from, &to).map_err(|e| format!("couldn't put the extension in {}: {e}", to.display()))?;
    Ok(to)
}

/// The extension's folder, shown in the Finder for the reader to add to
/// their browser (Load unpacked on its extensions page).
#[tauri::command]
pub fn extension_reveal(app: AppHandle) -> Result<String, String> {
    let dir = extension_copy(&app)?;
    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("/usr/bin/open").arg(&dir).status();
    #[cfg(target_os = "windows")]
    let result = std::process::Command::new("explorer").arg(&dir).status();
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let result = std::process::Command::new("xdg-open").arg(&dir).status();
    result.map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().into())
}

#[tauri::command]
pub fn computer_host(app: AppHandle, chat_id: String, own: Option<bool>, browser: Option<String>, show: Option<bool>) -> Result<Plan, String> {
    let base = home()?.join("blvrd");
    let root = base.join("Workspace").join(folder_for(&chat_id));
    let server = computer_dir(&app)?.join("server.mjs");
    if !server.exists() {
        return Err(format!("the computer isn't where it should be ({})", server.display()));
    }
    std::fs::create_dir_all(&root).map_err(|e| format!("couldn't make {}: {e}", root.display()))?;
    // The reader's own browser, through the extension.
    if own.unwrap_or(true) {
        let _ = extension_copy(&app);
        return Ok(Plan {
            command: "node".into(),
            args: vec![server.to_string_lossy().into(), "--root".into(), root.to_string_lossy().into(), "--own-browser".into()],
            root: root.to_string_lossy().into(),
        });
    }
    // The browser: the one picked, else the first found. A profile for each,
    // since browsers can't share one.
    let chosen = match browser.filter(|b| !b.trim().is_empty()) {
        Some(path) => Some(crate::browsers::browser_resolve(path)?),
        None => crate::browsers::browsers_found().into_iter().next(),
    };
    let profile = base.join("Browser").join(chosen.as_ref().map(|b| folder_for(&b.name_for_folder())).unwrap_or_else(|| "Default".into()));
    std::fs::create_dir_all(&profile).map_err(|e| format!("couldn't make {}: {e}", profile.display()))?;
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
