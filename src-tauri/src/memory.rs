// Each agent's own memory: a Markdown file, MEMORY.md, in a folder of its own
// under the app's data directory --
//
//   <app data>/agents/<agent id>/MEMORY.md
//   <app data>/agents/<agent id>/.history/<when>.md   (the last few saves)
//
// The webview names an agent; the path is built here, so it can reach these
// files and nothing else. A save goes to a temporary file first and is then
// renamed over the old one, so a crash never leaves half a file.

use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::Manager;

const FILE: &str = "MEMORY.md";
const KEEP: usize = 20;

fn folder(app: &tauri::AppHandle, id: &str) -> Result<PathBuf, String> {
    if id.is_empty() || id.len() > 64 || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
        return Err(format!("{id:?} isn't an agent"));
    }
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(base.join("agents").join(id))
}

fn millis(time: SystemTime) -> u64 {
    time.duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

#[derive(serde::Serialize)]
pub struct Memory {
    /// None: there's no file yet.
    text: Option<String>,
    /// When the file was last written, by anyone (ms); 0 if there's none.
    modified: u64,
    path: String,
}

#[tauri::command]
pub fn agent_memory_read(app: tauri::AppHandle, id: String) -> Result<Memory, String> {
    let path = folder(&app, &id)?.join(FILE);
    let shown = path.to_string_lossy().into_owned();
    match fs::read_to_string(&path) {
        Ok(text) => {
            let modified = fs::metadata(&path).and_then(|m| m.modified()).map(millis).unwrap_or(0);
            Ok(Memory { text: Some(text), modified, path: shown })
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Memory { text: None, modified: 0, path: shown }),
        Err(e) => Err(e.to_string()),
    }
}

/// Saves `text`, keeping the file it replaces in .history (the last KEEP).
/// Returns when it was written (ms).
#[tauri::command]
pub fn agent_memory_write(app: tauri::AppHandle, id: String, text: String) -> Result<u64, String> {
    let dir = folder(&app, &id)?;
    let path = dir.join(FILE);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    if path.exists() {
        let history = dir.join(".history");
        fs::create_dir_all(&history).map_err(|e| e.to_string())?;
        let _ = fs::copy(&path, history.join(format!("{}.md", millis(SystemTime::now()))));
        let mut kept: Vec<PathBuf> = fs::read_dir(&history)
            .map_err(|e| e.to_string())?
            .filter_map(|entry| entry.ok().map(|e| e.path()))
            .filter(|p| p.extension().is_some_and(|x| x == "md"))
            .collect();
        kept.sort();
        let extra = kept.len().saturating_sub(KEEP);
        for old in kept.into_iter().take(extra) {
            let _ = fs::remove_file(old);
        }
    }
    let partial = dir.join(".MEMORY.md.partial");
    fs::write(&partial, text).map_err(|e| e.to_string())?;
    fs::rename(&partial, &path).map_err(|e| e.to_string())?;
    Ok(fs::metadata(&path).and_then(|m| m.modified()).map(millis).unwrap_or(0))
}

/// The file shown in Finder (or the folder opened, elsewhere).
#[tauri::command]
pub fn agent_memory_reveal(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let dir = folder(&app, &id)?;
    let path = dir.join(FILE);
    if !path.exists() {
        return Err("there's no memory file yet".into());
    }
    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("/usr/bin/open").arg("-R").arg(&path).status();
    #[cfg(target_os = "windows")]
    let result = std::process::Command::new("explorer").arg(format!("/select,{}", path.display())).status();
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let result = std::process::Command::new("xdg-open").arg(&dir).status();
    result.map(|_| ()).map_err(|e| e.to_string())
}

/// The agent's folder gone, history and all (the agent was deleted).
#[tauri::command]
pub fn agent_memory_remove(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let dir = folder(&app, &id)?;
    match fs::remove_dir_all(&dir) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
        _ => Ok(()),
    }
}
