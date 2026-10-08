/* "The calendar just changed": said by whatever adds an event (an agent's
 * Apple or Google Calendar tool), heard by the calendar's month cache
 * (lib/useMonthEvents.js), which then asks the calendars again at once --
 * so the widget and the calendar screen show a new event as soon as it's
 * made, not at the next scheduled refresh. */

const listeners = new Set();

export function calendarChanged() {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      // One listener failing doesn't stop the others hearing.
    }
  }
}

/** Calls `fn` on every change; returns how to stop. */
export function onCalendarChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
