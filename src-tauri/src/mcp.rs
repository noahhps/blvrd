// Local MCP servers: a command the reader configured, spoken to over stdio.
//
// Each server is a child process. Every line it writes to stdout is a JSON-RPC
// message, passed to the webview as an "mcp-stdio" event; stderr lines go as
// "mcp-stdio-log", and its exit as "mcp-stdio-exit". The webview writes
// requests back with `mcp_send`. Started through the reader's login shell, so
// `npx`, `uvx` and anything else on their PATH is found the way it is in
// Terminal -- a GUI app on macOS otherwise starts with almost no PATH.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;
use std::thread;

use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Default)]
pub struct Servers(Mutex<HashMap<String, (Child, ChildStdin)>>);

fn shell_command(command: &str, args: &[String]) -> Command {
    #[cfg(unix)]
    {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
        let mut cmd = Command::new(shell);
        // `exec "$0" "$@"` runs the command with its arguments passed through
        // untouched -- no second round of shell parsing.
        cmd.arg("-lc").arg("exec \"$0\" \"$@\"").arg(command).args(args);
        cmd
    }
    #[cfg(not(unix))]
    {
        let mut cmd = Command::new(command);
        cmd.args(args);
        cmd
    }
}

#[tauri::command]
pub fn mcp_spawn(
    app: AppHandle,
    servers: State<Servers>,
    id: String,
    command: String,
    args: Vec<String>,
    env: HashMap<String, String>,
) -> Result<(), String> {
    let mut map = servers.0.lock().map_err(|e| e.to_string())?;
    if let Some((mut old, _)) = map.remove(&id) {
        let _ = old.kill();
    }
    let mut child = shell_command(&command, &args)
        .envs(&env)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("couldn't start {command}: {e}"))?;
    let stdin = child.stdin.take().ok_or("no stdin")?;
    let stdout = child.stdout.take().ok_or("no stdout")?;
    let stderr = child.stderr.take().ok_or("no stderr")?;

    let (out_app, out_id) = (app.clone(), id.clone());
    thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            let Ok(line) = line else { break };
            let _ = out_app.emit("mcp-stdio", serde_json::json!({ "id": out_id, "line": line }));
        }
        let _ = out_app.emit("mcp-stdio-exit", serde_json::json!({ "id": out_id }));
    });
    let (err_app, err_id) = (app.clone(), id.clone());
    thread::spawn(move || {
        for line in BufReader::new(stderr).lines() {
            let Ok(line) = line else { break };
            let _ = err_app.emit("mcp-stdio-log", serde_json::json!({ "id": err_id, "line": line }));
        }
    });

    map.insert(id, (child, stdin));
    Ok(())
}

#[tauri::command]
pub fn mcp_send(servers: State<Servers>, id: String, line: String) -> Result<(), String> {
    let mut map = servers.0.lock().map_err(|e| e.to_string())?;
    let (_, stdin) = map.get_mut(&id).ok_or("that server isn't running")?;
    stdin.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
    stdin.write_all(b"\n").map_err(|e| e.to_string())?;
    stdin.flush().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn mcp_stop(servers: State<Servers>, id: String) -> Result<(), String> {
    let mut map = servers.0.lock().map_err(|e| e.to_string())?;
    if let Some((mut child, _)) = map.remove(&id) {
        let _ = child.kill();
    }
    Ok(())
}

pub fn stop_all(app: &AppHandle) {
    if let Some(servers) = app.try_state::<Servers>() {
        if let Ok(mut map) = servers.0.lock() {
            for (_, (mut child, _)) in map.drain() {
                let _ = child.kill();
            }
        }
    }
}
