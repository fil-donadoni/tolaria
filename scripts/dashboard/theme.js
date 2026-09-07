/**
 * BRIDGE (PRD #3148 S1). The theme is now a typed store owned by React —
 * `dashboard/lib/theme.ts` — and this file exists only so History can keep
 * registering its redraw listener with the import it already had.
 *
 * `history-boot.js` deliberately does NOT let the theme module import IT: that
 * would drag the whole History graph into the statically imported set that
 * must load before the Now panel can poll. History registers itself when — and
 * only when — it boots, so a page with no telemetry store still has a working
 * theme button. That reasoning survives the port unchanged; only the
 * implementation moved.
 *
 * Dies with the last vanilla module (S4).
 */
export { onThemeChange } from "../../dashboard/lib/theme";
