// Local MCP servers: a command the reader configured, spoken to over stdio.
//
// Each server is a child process. Every line it writes to stdout is a JSON-RPC
// message, passed to the webview as an "mcp-stdio" event; stderr lines go as
// "mcp-stdio-log", and its exit as "mcp-stdio-exit". The webview writes
// requests back with `mcp_send`. Each start is a `run` the webview names, and
// every event carries it: a server started again under the same id kills the
// one before, and that one's exit must not read as the new one's. Started through the reader's login shell, so
// `npx`, `uvx` and anything else on their PATH is found the way it is in
// Terminal -- a GUI app on macOS otherwise starts with almost no PATH.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;
use std::thread;

use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Default)]
pub struct Servers(Mutex<HashMap<String, Running>>);

pub struct Running {
    run: String,
    child: Child,
    stdin: ChildStdin,
}

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
    run: String,
    command: String,
    args: Vec<String>,
    env: HashMap<String, String>,
) -> Result<(), String> {
    let mut map = servers.0.lock().map_err(|e| e.to_string())?;
    if let Some(mut old) = map.remove(&id) {
        let _ = old.child.kill();
        let _ = old.child.wait();
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

    let (out_app, out_id, out_run) = (app.clone(), id.clone(), run.clone());
    thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            let Ok(line) = line else { break };
            let _ = out_app.emit("mcp-stdio", serde_json::json!({ "id": out_id, "run": out_run, "line": line }));
        }
        // Gone: forgotten here if it's still the one under its id (a newer
        // start may already have taken its place), and said with its run.
        let gone = out_app.state::<Servers>().0.lock().ok().and_then(|mut map| {
            map.get(&out_id).is_some_and(|r| r.run == out_run).then(|| map.remove(&out_id)).flatten()
        });
        // Reaped outside the lock: a server that closed its output but hasn't
        // quit mustn't hold up every other one.
        if let Some(mut gone) = gone {
            let _ = gone.child.wait();
        }
        let _ = out_app.emit("mcp-stdio-exit", serde_json::json!({ "id": out_id, "run": out_run }));
    });
    let (err_app, err_id, err_run) = (app.clone(), id.clone(), run.clone());
    thread::spawn(move || {
        for line in BufReader::new(stderr).lines() {
            let Ok(line) = line else { break };
            let _ = err_app.emit("mcp-stdio-log", serde_json::json!({ "id": err_id, "run": err_run, "line": line }));
        }
    });

    map.insert(id, Running { run, child, stdin });
    Ok(())
}

#[tauri::command]
pub fn mcp_send(servers: State<Servers>, id: String, line: String) -> Result<(), String> {
    let mut map = servers.0.lock().map_err(|e| e.to_string())?;
    let server = map.get_mut(&id).ok_or("that server isn't running")?;
    server.stdin.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
    server.stdin.write_all(b"\n").map_err(|e| e.to_string())?;
    server.stdin.flush().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn mcp_stop(servers: State<Servers>, id: String, run: Option<String>) -> Result<(), String> {
    let mut map = servers.0.lock().map_err(|e| e.to_string())?;
    // A run named: only that one -- a newer start under the id stays.
    if run.as_ref().is_some_and(|run| map.get(&id).is_some_and(|r| &r.run != run)) {
        return Ok(());
    }
    if let Some(mut server) = map.remove(&id) {
        let _ = server.child.kill();
        let _ = server.child.wait();
    }
    Ok(())
}

pub fn stop_all(app: &AppHandle) {
    if let Some(servers) = app.try_state::<Servers>() {
        if let Ok(mut map) = servers.0.lock() {
            for (_, mut server) in map.drain() {
                let _ = server.child.kill();
            }
        }
    }
}
