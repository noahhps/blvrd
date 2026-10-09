// The whole app is the webview: agents, chats and settings live in its storage,
// and model servers are reached through the HTTP plugin. Rust hosts it, and
// does the things a webview can't do for itself:
//
//   * hear a sign-in come back (`oauth_listen`) -- a one-shot listener on a
//     loopback port, for Google and for MCP servers that sign in with OAuth;
//   * talk to Calendar and Reminders on macOS (`apple_script`) -- fixed
//     scripts, compiled into the app, with the arguments passed separately;
//   * run local MCP servers (`mcp_spawn` / `mcp_send` / `mcp_stop`) -- a
//     command the reader configured, spoken to over stdin and stdout;
//   * keep each agent's own memory as a file, MEMORY.md, the reader can open
//     (`agent_memory_*`);
//   * keep time for scheduled tasks while the window is hidden, and stay in
//     the menu bar for them when it is closed (`schedule_set`);
//   * say where an agent's computer is and what starts it (`computer_*`),
//     and run the sandbox VM it can live in (`machine_*`).
//
// It also carries the global-shortcut plugin, which the main window uses to
// open the quickview (the "quick" window) from any app.

mod apple;
mod browsers;
mod computer;
mod machine;
mod mcp;
mod memory;
mod oauth;
mod schedule;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        // Links in answers and "Get a key" open in the reader's own browser.
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        // A scheduled task that posted while blvrd wasn't in front says so.
        .plugin(tauri_plugin_notification::init())
        .manage(mcp::Servers::default())
        .manage(schedule::Clock::default())
        .setup(|app| {
            schedule::start(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            oauth::oauth_listen,
            apple::apple_script,
            mcp::mcp_spawn,
            mcp::mcp_send,
            mcp::mcp_stop,
            memory::agent_memory_read,
            memory::agent_memory_write,
            memory::agent_memory_reveal,
            memory::agent_memory_remove,
            schedule::schedule_set,
            computer::computer_host,
            browsers::browsers_found,
            browsers::browser_resolve,
            machine::computer_sandbox,
            machine::machine_status,
            machine::machine_stop,
            machine::machine_reset,
        ])
        .build(tauri::generate_context!())
        .expect("error while building blvrd")
        .run(|app, event| match event {
            // With scheduled tasks waiting, closing the window leaves blvrd in
            // the menu bar so they still run (lib/schedule.js).
            tauri::RunEvent::WindowEvent { label, event: tauri::WindowEvent::CloseRequested { api, .. }, .. }
                if label == "main" && schedule::keep_running(app) =>
            {
                api.prevent_close();
                schedule::hide_main(app);
            }
            // Its Dock icon brings the window back.
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen { .. } => schedule::show_main(app),
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
