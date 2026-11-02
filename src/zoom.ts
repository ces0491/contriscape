export const ZOOM_MIN = 0.05;
export const ZOOM_MAX = 18;
/** Any closer and the chase camera would sit inside the ship's tail. */
export const COCKPIT_BELOW = 0.25;

/** The zoom after a scroll or pinch. The cockpit is one stop below the chase range, so the smallest step out leaves it. */
export function nextZoom(current: number, factor: number): number {
  const from = current <= ZOOM_MIN && factor > 1 ? COCKPIT_BELOW : current;
  const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, from * factor));
  return next < COCKPIT_BELOW ? ZOOM_MIN : next;
}
