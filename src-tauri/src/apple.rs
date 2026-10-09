// Calendar, Reminders, Music and Spotify on macOS, through their scripting
// interfaces.
//
// The scripts are fixed and compiled into the app (src-tauri/scripts); the
// webview can only name one and hand it arguments as a JSON string, which
// arrives in the script as argv[0] -- data, never code -- so nothing a model
// writes can become a script. macOS asks the reader once, per app, before
// blvrd may control each app (NSAppleEventsUsageDescription).

#[cfg(target_os = "macos")]
fn script_for(action: &str) -> Option<&'static str> {
    Some(match action {
        "calendar_list" => include_str!("../scripts/calendar_list.js"),
        "calendar_events" => include_str!("../scripts/calendar_events.js"),
        "calendar_add" => include_str!("../scripts/calendar_add.js"),
        "reminders_list" => include_str!("../scripts/reminders_list.js"),
        "reminders_add" => include_str!("../scripts/reminders_add.js"),
        "reminders_complete" => include_str!("../scripts/reminders_complete.js"),
        "music_now" => include_str!("../scripts/music_now.js"),
        "music_control" => include_str!("../scripts/music_control.js"),
        _ => return None,
    })
}

// Each script first says it's a background process. Otherwise osascript checks
// in as an app with a Dock icon the moment it talks to another app -- and
// since blvrd started it, macOS shows that icon as a second blvrd, for as long
// as Calendar takes to answer.
#[cfg(target_os = "macos")]
const IN_BACKGROUND: &str = "ObjC.import('AppKit');\n$.NSApplication.sharedApplication.setActivationPolicy($.NSApplicationActivationPolicyProhibited);\n";

#[tauri::command]
pub async fn apple_script(action: String, args: String) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        let script = format!("{IN_BACKGROUND}{}", script_for(&action).ok_or_else(|| format!("unknown action {action}"))?);
        // Off the main thread: Calendar can take a few seconds on a big range.
        let output = tauri::async_runtime::spawn_blocking(move || {
            std::process::Command::new("/usr/bin/osascript")
                .args(["-l", "JavaScript", "-e", &script, &args])
                .output()
        })
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
        if output.status.success() {
            Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
        } else {
            let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
            // -1743: the reader said no (or hasn't been asked) in Privacy & Security.
            if err.contains("-1743") || err.contains("Not authorized") {
                Err("blvrd isn't allowed to use this app yet. Allow it in System Settings → Privacy & Security → Automation.".into())
            } else {
                Err(err)
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (action, args);
        Err("Apple Calendar and Reminders are only available on macOS.".into())
    }
}
