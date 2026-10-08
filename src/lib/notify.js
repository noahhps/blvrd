/* A notification from the system -- for a scheduled task that posted while
 * blvrd wasn't in front (App.jsx). Asked for once, the first time; a no is
 * kept, and the message still waits in its chat. */

import { inDesktop } from "./http.js";

export async function tellOS(title, body) {
  try {
    if (!inDesktop()) {
      if (typeof Notification === "undefined") return;
      if (Notification.permission === "default") await Notification.requestPermission();
      if (Notification.permission === "granted") new Notification(title, { body });
      return;
    }
    const n = await import("@tauri-apps/plugin-notification");
    let allowed = await n.isPermissionGranted();
    if (!allowed) allowed = (await n.requestPermission()) === "granted";
    if (allowed) n.sendNotification({ title, body });
  } catch {
    // Not shown; the message is in the chat all the same.
  }
}
