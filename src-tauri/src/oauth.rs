// A one-shot listener for a sign-in coming back.
//
// OAuth for a desktop app sends the browser back to http://127.0.0.1:<port>/
// callback with a code in the query. This binds a free loopback port, returns
// it at once so the webview can build the sign-in URL, and waits -- up to five
// minutes -- for that one request. The query goes to the webview as an
// "oauth-callback" event; the browser gets a page saying it can close.

use std::io::{Read, Write};
use std::net::TcpListener;
use std::thread;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter};

const WAIT: Duration = Duration::from_secs(300);

const PAGE: &str = "<!doctype html><meta charset=utf-8><title>blvrd</title>\
<body style=\"font-family:-apple-system,Helvetica,sans-serif;padding:56px;color:#141414\">\
<div style=\"width:28px;height:28px;background:#fff;box-shadow:0 0 0 1px #ddd;position:relative;overflow:hidden;border-radius:6px\">\
<div style=\"position:absolute;left:-19px;bottom:-19px;width:38px;height:38px;border-radius:50%;background:#e5392b\"></div></div>\
<h2 style=\"margin:20px 0 6px\">You're connected.</h2><p style=\"color:#5e5e5b\">You can close this tab and go back to blvrd.</p>";

#[tauri::command]
pub fn oauth_listen(app: AppHandle) -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;

    thread::spawn(move || {
        let deadline = Instant::now() + WAIT;
        while Instant::now() < deadline {
            let (mut stream, _) = match listener.accept() {
                Ok(pair) => pair,
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(100));
                    continue;
                }
                Err(_) => break,
            };
            let _ = stream.set_nonblocking(false);
            let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
            let mut buf = [0u8; 8192];
            let n = stream.read(&mut buf).unwrap_or(0);
            let request = String::from_utf8_lossy(&buf[..n]);
            let path = request
                .lines()
                .next()
                .and_then(|line| line.split_whitespace().nth(1))
                .unwrap_or("/");
            // Anything else the browser asks for (a favicon) is not the callback.
            if !path.starts_with("/callback") {
                let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                continue;
            }
            let query = path.splitn(2, '?').nth(1).unwrap_or("").to_string();
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                PAGE.len(),
                PAGE
            );
            let _ = stream.write_all(response.as_bytes());
            let _ = app.emit("oauth-callback", serde_json::json!({ "port": port, "query": query }));
            return;
        }
        let _ = app.emit("oauth-callback", serde_json::json!({ "port": port, "error": "timed out" }));
    });

    Ok(port)
}
