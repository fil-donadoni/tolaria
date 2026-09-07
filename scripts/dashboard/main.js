import { installTooltipEngine } from "./tooltip.js";

/**
 * The legacy entry (#2625), now HISTORY ONLY (PRD #3148 S2).
 *
 * S2 ported the Now view to React, so the two things this module used to start
 * before anything else — the loop-status poll and the keyboard layer — are
 * owned by the React tree and start with it (`dashboard/components/now/
 * NowView.tsx`, `dashboard/lib/shortcuts.ts`). What is left here is History:
 * the tooltip engine that serves the `data-term` strings it still paints, and
 * its bootstrap.
 *
 * History still arrives through a DYNAMIC `import()` inside the try/catch
 * below, which is what keeps #2519's guarantee intact: the Now view reads no
 * DB and must come up whether or not telemetry.db exists, and it must not be
 * taken down by anything on the History side — neither a rejected `/api/meta`
 * (the store-absent case) nor a module that fails to load at all. That
 * guarantee now has a second, stronger enforcement: Now is not in this
 * module's import graph at all.
 *
 * Query params make a view shareable:
 *   ?view=now|history &table= &metric= &split= &from= &to= &theme=light|dark
 */
const params = new URLSearchParams(location.search);

// The glossary engine before History renders (#2629): it is delegated plus a
// MutationObserver, so every `data-term` that arrives afterwards — including
// inside a table that re-renders by innerHTML — is picked up with no call at
// the render site. The React views declare their terms as props instead
// (`<Term>`), so this serves only what S3 has yet to port.
installTooltipEngine();

try {
    const { bootstrapHistory } = await import("./history-boot.js");
    await bootstrapHistory(params);
} catch (e) {
    // No telemetry.db (absent or stale — #2519 acceptance criterion): the
    // History view stays empty rather than taking the Now view down with it.
    document.getElementById("meta-line").textContent =
        `no telemetry store: ${e.message} — run "bun run telemetry:ingest"`;
}
