// Tasks (src/lib/schedule.js) keep time here as well as in the
// webview. A webview's timers slow right down while its window is hidden, so
// this thread sleeps until the soonest task is due -- waking every 30 seconds
// regardless, so a Mac that slept or a clock that changed is noticed -- and
// then tells the webview (`schedule-due`), which runs it.
//
// While any task is waiting, blvrd stays in the menu bar when its window is
// closed (unless the reader turned that off), so the tasks still run; the
// icon's menu brings the window back or quits.

use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, State};

const TRAY: &str = "tasks";
const CHECK: Duration = Duration::from_secs(30);

#[derive(Default)]
struct Plan {
    next: Option<f64>, // ms since the epoch
    waiting: u32,
    background: bool,
}

#[derive(Default, Clone)]
pub struct Clock(Arc<(Mutex<Plan>, Condvar)>);

fn now_ms() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as f64)
        .unwrap_or(0.0)
}

pub fn start(app: &AppHandle) {
    let clock = app.state::<Clock>().inner().clone();
    let app = app.clone();
    thread::spawn(move || {
        let (lock, wake) = &*clock.0;
        let mut plan = lock.lock().unwrap_or_else(|e| e.into_inner());
        loop {
            match plan.next {
                Some(next) if next <= now_ms() => {
                    // Said once; the webview sends the next time when it has
                    // run this one.
                    plan.next = None;
                    let _ = app.emit("schedule-due", ());
                }
                Some(next) => {
                    let wait = Duration::from_millis((next - now_ms()).max(0.0) as u64).min(CHECK);
                    plan = wake.wait_timeout(plan, wait).unwrap_or_else(|e| e.into_inner()).0;
                }
                None => plan = wake.wait(plan).unwrap_or_else(|e| e.into_inner()),
            }
        }
    });
}

/// What the webview has scheduled: when the soonest task is due, how many
/// are waiting, and whether blvrd may stay in the menu bar for them.
#[tauri::command]
pub fn schedule_set(app: AppHandle, clock: State<Clock>, next: Option<f64>, waiting: u32, background: bool) -> Result<(), String> {
    {
        let (lock, wake) = &*clock.0;
        let mut plan = lock.lock().map_err(|e| e.to_string())?;
        plan.next = next;
        plan.waiting = waiting;
        plan.background = background;
        wake.notify_one();
    }
    let show = waiting > 0 && background;
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let _ = tray(&handle, show);
    })
    .map_err(|e| e.to_string())
}

/// Whether closing the window should leave blvrd running for its tasks.
pub fn keep_running(app: &AppHandle) -> bool {
    app.try_state::<Clock>()
        .and_then(|clock| clock.0 .0.lock().ok().map(|plan| plan.waiting > 0 && plan.background))
        .unwrap_or(false)
}

pub fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

pub fn hide_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
}

fn tray(app: &AppHandle, show: bool) -> tauri::Result<()> {
    let have = app.tray_by_id(TRAY).is_some();
    if show && !have {
        let open = MenuItem::with_id(app, "open", "Open blvrd", true, None::<&str>)?;
        let list = MenuItem::with_id(app, "tasks", "Tasks…", true, None::<&str>)?;
        let quit = MenuItem::with_id(app, "quit", "Quit blvrd", true, None::<&str>)?;
        let menu = Menu::with_items(app, &[&open, &list, &quit])?;
        let mut builder = TrayIconBuilder::with_id(TRAY)
            .tooltip("blvrd: tasks are waiting")
            .menu(&menu)
            .on_menu_event(|app, event| match event.id().as_ref() {
                "open" => show_main(app),
                "tasks" => {
                    show_main(app);
                    let _ = app.emit("open-tasks", ());
                }
                "quit" => app.exit(0),
                _ => {}
            });
        if let Some(icon) = app.default_window_icon() {
            builder = builder.icon(icon.clone());
        }
        builder.build(app)?;
    } else if !show && have {
        let _ = app.remove_tray_by_id(TRAY);
    }
    Ok(())
}
