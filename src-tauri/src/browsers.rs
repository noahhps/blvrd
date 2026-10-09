// The browsers on this Mac the computer can drive: those built on Chromium
// (Chrome, Dia, Arc, Brave, Edge, Vivaldi, Opera, ...), which Playwright can
// start from their own program. Safari and Firefox can't be driven that way.
//
// Each is found as an app in /Applications or ~/Applications; its program is
// the one its Info.plist names.

use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;

#[derive(Serialize, Clone)]
pub struct Found {
    name: String,
    app: String,
    path: String,
}

// Apps known to be built on Chromium, by the name they install as.
const KNOWN: &[&str] = &[
    "Dia",
    "Arc",
    "Google Chrome",
    "Google Chrome Beta",
    "Google Chrome Canary",
    "Chromium",
    "Brave Browser",
    "Microsoft Edge",
    "Vivaldi",
    "Opera",
    "Opera GX",
    "Thorium",
    "Comet",
    "Helium",
    "Sidekick",
    "Ungoogled Chromium",
];

impl Found {
    pub fn name_for_folder(&self) -> String {
        self.name.clone()
    }
    pub fn program(&self) -> String {
        self.path.clone()
    }
    pub fn app(&self) -> String {
        self.app.clone()
    }
}

/// The program inside an app (`…/Name.app`), or the path itself when it is
/// already a program.
pub fn executable_of(path: &Path) -> Option<PathBuf> {
    if path.extension().map(|e| e == "app").unwrap_or(false) {
        let plist = path.join("Contents").join("Info.plist");
        let out = Command::new("/usr/libexec/PlistBuddy").arg("-c").arg("Print :CFBundleExecutable").arg(&plist).output().ok()?;
        let name = String::from_utf8_lossy(&out.stdout).trim().to_string();
        let exe = path.join("Contents").join("MacOS").join(if name.is_empty() { path.file_stem()?.to_string_lossy().to_string() } else { name });
        return exe.exists().then_some(exe);
    }
    path.exists().then(|| path.to_path_buf())
}

fn apps_dirs() -> Vec<PathBuf> {
    let mut dirs = vec![PathBuf::from("/Applications")];
    if let Ok(home) = std::env::var("HOME") {
        dirs.push(PathBuf::from(home).join("Applications"));
    }
    dirs
}

/// Every Chromium browser installed, in the order of KNOWN.
#[tauri::command]
pub fn browsers_found() -> Vec<Found> {
    let mut found = Vec::new();
    if cfg!(target_os = "macos") {
        for name in KNOWN {
            for dir in apps_dirs() {
                let app = dir.join(format!("{name}.app"));
                if let Some(exe) = executable_of(&app) {
                    found.push(Found { name: (*name).into(), app: app.to_string_lossy().into(), path: exe.to_string_lossy().into() });
                    break;
                }
            }
        }
    } else {
        for (name, path) in [("Chromium", "/usr/bin/chromium"), ("Chromium", "/usr/bin/chromium-browser"), ("Google Chrome", "/usr/bin/google-chrome"), ("Brave Browser", "/usr/bin/brave-browser"), ("Microsoft Edge", "/usr/bin/microsoft-edge")] {
            if Path::new(path).exists() && !found.iter().any(|f: &Found| f.name == name) {
                found.push(Found { name: name.into(), app: path.into(), path: path.into() });
            }
        }
    }
    found
}

/// What the reader picked with "Other…": an app or a program, as a browser.
#[tauri::command]
pub fn browser_resolve(path: String) -> Result<Found, String> {
    let given = PathBuf::from(path.trim());
    let exe = executable_of(&given).ok_or_else(|| format!("there is no program at {}", given.display()))?;
    let name = given.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "Browser".into());
    Ok(Found { name, app: given.to_string_lossy().into(), path: exe.to_string_lossy().into() })
}
