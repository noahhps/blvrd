// The whole app is the webview: agents, chats and settings live in its storage,
// and model servers are reached through the HTTP plugin. Rust only hosts it.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        // Links in answers and "Get a key" open in the reader's own browser.
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("error while running blvrd");
}
