// The app icon the reader picked (Settings → Appearance → App icon): one of
// the characters, light or dark (icons/variants, drawn by icons/variants.mjs).
// It's the Dock's icon while blvrd runs, set again at each launch; the app in
// the Finder keeps the one it was built with -- changing that would mean
// writing into the app itself. "default" goes back to that one.

macro_rules! variants {
    ($($name:literal),* $(,)?) => {
        #[cfg(target_os = "macos")]
        fn png_for(name: &str) -> Option<&'static [u8]> {
            match name {
                $($name => Some(include_bytes!(concat!("../icons/variants/", $name, ".png"))),)*
                _ => None,
            }
        }
    };
}

variants!(
    "arc-light", "arc-dark",
    "heart-light", "heart-dark",
    "star-light", "star-dark",
    "magnifier-light", "magnifier-dark",
    "pencil-light", "pencil-dark",
    "book-light", "book-dark",
    "palette-light", "palette-dark",
    "envelope-light", "envelope-dark",
);

#[tauri::command]
pub fn app_icon(app: tauri::AppHandle, name: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use objc2::{AllocAnyThread, MainThreadMarker};
        use objc2_app_kit::{NSApplication, NSImage};
        use objc2_foundation::NSData;

        let png = if name == "default" { None } else { Some(png_for(&name).ok_or_else(|| format!("no icon called {name}"))?) };
        // AppKit only on the main thread.
        app.run_on_main_thread(move || {
            let Some(mtm) = MainThreadMarker::new() else { return };
            let image = png.and_then(|bytes| NSImage::initWithData(NSImage::alloc(), &NSData::with_bytes(bytes)));
            unsafe { NSApplication::sharedApplication(mtm).setApplicationIconImage(image.as_deref()) };
        })
        .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, name);
        Ok(())
    }
}
