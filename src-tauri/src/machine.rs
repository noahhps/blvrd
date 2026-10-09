// The sandbox: a small Linux VM on this Mac, where an agent's computer
// (computer/server.mjs) runs and nothing it does touches the reader's files
// or accounts -- docs/computer.md §3.
//
// Lima on Apple's Virtualization framework. `limactl` from the reader's PATH
// if they have it (Homebrew), else a pinned release fetched into the app's
// own folder the first time. One VM, "blvrd", for every chat: each chat works
// in /work/<chat> inside it. It sees one folder of the Mac, ~/blvrd/Shared
// (as /shared), and the app's copy of the computer, read-only.
//
// Created and started on first use, with what Lima says passed on as
// "machine-progress"; stopped when the webview says it has been idle; reset to
// a fresh image on the reader's word.

use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

const NAME: &str = "blvrd";
const LIMA_VERSION: &str = "1.0.7";

#[derive(Serialize)]
pub struct Status {
    state: String, // "none" | "stopped" | "running" | "unknown"
    lima: bool,
}

#[derive(Serialize)]
pub struct Plan {
    command: String,
    args: Vec<String>,
    root: String,
}

fn home() -> Result<PathBuf, String> {
    std::env::var("HOME").map(PathBuf::from).map_err(|_| "no home folder".to_string())
}

fn app_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

// `limactl` on the reader's PATH, as their login shell sees it.
fn lima_on_path() -> Option<PathBuf> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let out = Command::new(shell).arg("-lc").arg("command -v limactl").output().ok()?;
    let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if out.status.success() && !path.is_empty() { Some(PathBuf::from(path)) } else { None }
}

fn lima_here(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_dir(app)?.join("lima").join("bin").join("limactl"))
}

fn limactl(app: &AppHandle) -> Option<PathBuf> {
    lima_on_path().or_else(|| lima_here(app).ok().filter(|p| p.exists()))
}

// Lima's own release, fetched with the Mac's curl and tar.
fn fetch_lima(app: &AppHandle) -> Result<PathBuf, String> {
    let os = if cfg!(target_os = "macos") { "Darwin" } else { "Linux" };
    let arch = if cfg!(target_arch = "aarch64") { "arm64" } else { "x86_64" };
    let url = format!("https://github.com/lima-vm/lima/releases/download/v{LIMA_VERSION}/lima-{LIMA_VERSION}-{os}-{arch}.tar.gz");
    let dir = app_dir(app)?.join("lima");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    progress(app, &format!("Fetching Lima {LIMA_VERSION}…"));
    let status = Command::new("/bin/sh")
        .arg("-c")
        .arg(r#"curl -fsSL "$0" | tar -xz -C "$1""#)
        .arg(&url)
        .arg(&dir)
        .status()
        .map_err(|e| e.to_string())?;
    let bin = lima_here(app)?;
    if !status.success() || !bin.exists() {
        return Err(format!("couldn't fetch Lima from {url}"));
    }
    Ok(bin)
}

fn progress(app: &AppHandle, line: &str) {
    let _ = app.emit("machine-progress", serde_json::json!({ "line": line }));
}

// Run limactl, passing each line it says on as progress. Err with its last
// words when it fails.
fn run(app: &AppHandle, lima: &Path, args: &[&str]) -> Result<(), String> {
    let mut child = Command::new(lima)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("couldn't run limactl: {e}"))?;
    let stderr = child.stderr.take();
    let err_app = app.clone();
    let tail = thread::spawn(move || {
        let mut last = Vec::new();
        if let Some(stderr) = stderr {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                progress(&err_app, &line);
                last.push(line);
                if last.len() > 5 { last.remove(0); }
            }
        }
        last
    });
    if let Some(stdout) = child.stdout.take() {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            progress(app, &line);
        }
    }
    let status = child.wait().map_err(|e| e.to_string())?;
    let last = tail.join().unwrap_or_default();
    if status.success() { Ok(()) } else { Err(format!("limactl {} failed: {}", args.join(" "), last.join(" "))) }
}

fn state(lima: &Path) -> String {
    let Ok(out) = Command::new(lima).args(["list", "--json"]).output() else { return "unknown".into() };
    for line in String::from_utf8_lossy(&out.stdout).lines() {
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else { continue };
        if v["name"] == NAME {
            return match v["status"].as_str() {
                Some("Running") => "running".into(),
                Some(_) => "stopped".into(),
                None => "unknown".into(),
            };
        }
    }
    "none".into()
}

fn computer_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if cfg!(debug_assertions) {
        return Ok(PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../computer")));
    }
    app.path().resource_dir().map(|d| d.join("computer")).map_err(|e| e.to_string())
}

// The VM, as Lima is told to make it.
fn template(app: &AppHandle) -> Result<PathBuf, String> {
    let shared = home()?.join("blvrd").join("Shared");
    std::fs::create_dir_all(&shared).map_err(|e| e.to_string())?;
    let computer = computer_dir(app)?;
    let vm_type = if cfg!(target_os = "macos") { "vmType: vz\nrosetta:\n  enabled: true\n  binfmt: true\nmountType: virtiofs\n" } else { "vmType: qemu\n" };
    let yaml = format!(
        r#"# blvrd's sandbox (src-tauri/src/machine.rs). Made by the app; changes here are kept until "Reset".
{vm_type}cpus: 2
memory: 3GiB
disk: 20GiB
images:
  - location: "https://cloud.debian.org/images/cloud/bookworm/latest/debian-12-genericcloud-arm64.qcow2"
    arch: aarch64
  - location: "https://cloud.debian.org/images/cloud/bookworm/latest/debian-12-genericcloud-amd64.qcow2"
    arch: x86_64
mounts:
  - location: "{computer}"
    mountPoint: /opt/blvrd-computer
    writable: false
  - location: "{shared}"
    mountPoint: /shared
    writable: true
containerd:
  system: false
  user: false
provision:
  - mode: system
    script: |
      #!/bin/bash
      set -eux -o pipefail
      export DEBIAN_FRONTEND=noninteractive
      command -v chromium && command -v node && exit 0
      apt-get update
      apt-get install -y --no-install-recommends nodejs chromium fonts-liberation git python3 python3-pip python3-venv ripgrep fd-find jq curl ca-certificates build-essential unzip
      mkdir -p /work
      chown "${{LIMA_CIDATA_USER}}" /work
probes:
  - description: "the computer's tools are installed"
    script: |
      #!/bin/bash
      set -eux -o pipefail
      timeout 900s bash -c "until command -v chromium >/dev/null && command -v node >/dev/null; do sleep 3; done"
    hint: Still installing Node and Chromium in the sandbox.
"#,
        computer = computer.display(),
        shared = shared.display(),
    );
    let path = app_dir(app)?.join("sandbox.yaml");
    std::fs::write(&path, yaml).map_err(|e| e.to_string())?;
    Ok(path)
}

// Lima there, the VM made and running.
fn ensure(app: &AppHandle) -> Result<PathBuf, String> {
    let lima = match limactl(app) {
        Some(lima) => lima,
        None => fetch_lima(app)?,
    };
    match state(&lima).as_str() {
        "running" => {}
        "none" => {
            progress(app, "Making the sandbox -- the first time takes a few minutes…");
            let yaml = template(app)?;
            let yaml = yaml.to_string_lossy().to_string();
            run(app, &lima, &["start", "--tty=false", &format!("--name={NAME}"), &yaml])?;
        }
        _ => {
            progress(app, "Starting the sandbox…");
            run(app, &lima, &["start", "--tty=false", NAME])?;
        }
    }
    Ok(lima)
}

fn folder_for(chat_id: &str) -> String {
    let clean: String = chat_id.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' }).collect();
    if clean.is_empty() { "chat".into() } else { clean }
}

/// What starts the chat's computer in the sandbox -- starting the sandbox
/// first, and making it the first time.
#[tauri::command]
pub async fn computer_sandbox(app: AppHandle, chat_id: String) -> Result<Plan, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let lima = ensure(&app)?;
        let root = format!("/work/{}", folder_for(&chat_id));
        Ok(Plan {
            command: lima.to_string_lossy().into(),
            args: vec![
                "shell".into(),
                "--workdir".into(),
                "/".into(),
                NAME.into(),
                "--".into(),
                "node".into(),
                "/opt/blvrd-computer/server.mjs".into(),
                "--root".into(),
                root.clone(),
            ],
            root,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn machine_status(app: AppHandle) -> Result<Status, String> {
    tauri::async_runtime::spawn_blocking(move || {
        Ok(match limactl(&app) {
            Some(lima) => Status { state: state(&lima), lima: true },
            None => Status { state: "none".into(), lima: false },
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn machine_stop(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(lima) = limactl(&app) else { return Ok(()) };
        if state(&lima) == "running" { run(&app, &lima, &["stop", NAME]) } else { Ok(()) }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Back to a fresh image: what agents installed and made in it goes; the
/// shared folder stays.
#[tauri::command]
pub async fn machine_reset(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(lima) = limactl(&app) else { return Ok(()) };
        if state(&lima) == "none" { return Ok(()) }
        if state(&lima) == "running" { run(&app, &lima, &["stop", NAME])?; }
        run(&app, &lima, &["factory-reset", NAME])
    })
    .await
    .map_err(|e| e.to_string())?
}
