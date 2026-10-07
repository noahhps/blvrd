// The whole app is the webview: agents, chats and settings live in its storage,
// and model servers are reached through the HTTP plugin. Rust hosts it, and
// does the three things a webview can't do for itself:
//
//   * hear a sign-in come back (`oauth_listen`) -- a one-shot listener on a
//     loopback port, for Google and for MCP servers that sign in with OAuth;
//   * talk to Calendar and Reminders on macOS (`apple_script`) -- fixed
//     scripts, compiled into the app, with the arguments passed separately;
//   * run local MCP servers (`mcp_spawn` / `mcp_send` / `mcp_stop`) -- a
//     command the reader configured, spoken to over stdin and stdout.
//
// It also carries the global-shortcut plugin, which the main window uses to
// open the quickview (the "quick" window) from any app.

mod apple;
mod mcp;
mod oauth;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        // Links in answers and "Get a key" open in the reader's own browser.
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(mcp::Servers::default())
        .invoke_handler(tauri::generate_handler![
            oauth::oauth_listen,
            apple::apple_script,
            mcp::mcp_spawn,
            mcp::mcp_send,
            mcp::mcp_stop,
        ])
        .build(tauri::generate_context!())
        .expect("error while building blvrd")
        .run(|app, event| match event {
            // Closing the main window quits, as it did before the quickview:
            // its hidden window would otherwise keep the app running with no
            // way back to the main one.
            tauri::RunEvent::WindowEvent { label, event: tauri::WindowEvent::Destroyed, .. } if label == "main" => {
                app.exit(0);
            }
            // Local MCP servers go when the app does.
            tauri::RunEvent::Exit => mcp::stop_all(app),
            _ => {}
        });
}
