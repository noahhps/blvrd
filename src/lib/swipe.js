/* The physics of a swiped row (components/SwipeRow.jsx), after Apple's
 * "Designing Fluid Interfaces": momentum projection, rubber-banding, and a
 * spring described by damping ratio and response. */

export const THRESHOLD = 72; // px a row travels before letting go does the action
export const REACH = 110; // px it follows freely; past this it rubber-bands

/** How far a gesture moving at `velocity` (px/s) would carry on, decelerating
 *  at `rate` per ms -- Apple's projection. 0.99 is snappy, right for a row. */
export const project = (velocity, rate = 0.99) => ((velocity / 1000) * rate) / (1 - rate);

/** Apple's rubber band: the further past the bound, the less it follows. */
export const rubberband = (over, dimension, c = 0.55) => (over * dimension * c) / (dimension + c * Math.abs(over));

/** Where the row shows for `x` of travel, in a row `width` wide. */
export const resist = (x, width) => {
  const far = Math.abs(x);
  return far <= REACH ? x : Math.sign(x) * (REACH + rubberband(far - REACH, width));
};

/** The travel that shows the row at `x`: `resist` undone, so a gesture that
 *  starts with the row out in the rubber band carries on from there. */
export const unresist = (x, width, c = 0.55) => {
  const far = Math.abs(x);
  if (far <= REACH) return x;
  const shown = Math.min(far - REACH, width * 0.99); // the band never reaches `width`
  return Math.sign(x) * (REACH + (shown * width) / (c * (width - shown)));
};

export const OPEN = 84; // px a row stays out when swiped left, showing its Delete button

/** Where a row goes when let go at `x` with velocity `v` (px/s), judged by
 *  where the gesture was heading rather than only where it stopped:
 *    "open"  -- swiped left far enough: it stays out, showing Delete, which
 *               must then be clicked (deleting is never done by the swipe);
 *    "right" -- swiped right far enough: compact;
 *    "close" -- anything short of those, or flicked back toward the middle.
 *  A row already `open` stays open unless it is moved back past halfway. */
export function settleTo(x, v, { open = false, rightDisabled = false } = {}) {
  const going = x + project(v);
  if (open) return going <= -OPEN / 2 && v <= 50 ? "open" : "close";
  if (going <= -THRESHOLD && v <= 50) return "open";
  if (going >= THRESHOLD && v >= -50 && !rightDisabled) return "right";
  return "close";
}

/** The spring to where it settles: critically damped after a plain drag, a little
 *  give only after a flick, which brought momentum of its own. */
export const springFor = (v) => (Math.abs(v) > 600 ? { damping: 0.82, response: 0.38 } : { damping: 1, response: 0.32 });

/** A spring toward 0 on a mass of 1: stiffness (2π/response)², damping
 *  4π·ratio/response. `advance(seconds)` moves it on in small fixed steps,
 *  so it behaves the same at any frame rate, and returns { x, v, done }. */
export function spring(x, v, { damping, response }) {
  const k = (2 * Math.PI / response) ** 2;
  const c = (4 * Math.PI * damping) / response;
  return {
    advance(seconds) {
      let dt = Math.min(0.064, seconds); // a long stall doesn't fling it
      while (dt > 0) {
        const h = Math.min(dt, 1 / 240);
        v += (-k * x - c * v) * h;
        x += v * h;
        dt -= h;
      }
      const done = Math.abs(x) < 0.5 && Math.abs(v) < 0.5;
      if (done) x = v = 0;
      return { x, v, done };
    },
  };
}
