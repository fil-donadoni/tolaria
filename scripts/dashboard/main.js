import { installTooltipEngine } from "./tooltip.js";

/**
 * The legacy entry (#2625) — an EMPTY SHELL since PRD #3148 S3.
 *
 * S2 ported the Now view to React and S3 the History view, so everything this
 * module used to start is owned by the React tree: the loop-status poll, the
 * keyboard layer, and now History's bootstrap and its six cards
 * (`dashboard/components/history/HistoryView.tsx`, reached through the same
 * kind of dynamic import this file used for `history-boot.js`, and for the
 * same #2519 reason — the Now view must come up with no telemetry store).
 *
 * What is left is the tooltip engine, and it currently serves NOTHING: it
 * scans for `data-term` attributes, and no surface on this page paints one any
 * more — every React term declares itself as a prop (`<Term>`, `<DynamicTerm>`)
 * against the same table. It is still installed because `dashboard.css`, the
 * `#tip` host and this module are one unit that S4 deletes together, and
 * removing half of it now would only mean a second edit there.
 */
installTooltipEngine();
