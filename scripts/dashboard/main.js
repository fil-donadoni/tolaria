import { startLoopStatusPolling } from "./now-loop-status.js";
import { installTooltipEngine } from "./tooltip.js";
import { installShortcuts } from "./shortcuts.js";

/**
 * The dashboard entry point (#2625) — the single module the shell loads.
 *
 * Static imports here are deliberately limited to the chrome (shortcuts) and
 * to Now. The tabs and the theme toggle became React in S1 and are mounted by
 * `dashboard/main.tsx` before this module is evaluated at all; History still
 * arrives through a dynamic `import()` inside the try/catch below, which is
 * what keeps #2519's guarantee intact after the split: the loop-status
 * panel reads no DB and must come up whether or not telemetry.db exists,
 * and it must not be taken down by anything on the
 * History side — neither a rejected `/api/meta` (the store-absent case) nor a
 * module that fails to load at all.
 *
 * Query params make a view shareable:
 *   ?view=now|history &table= &metric= &split= &from= &to= &theme=light|dark
 */
const params = new URLSearchParams(location.search);

// The keyboard layer (#2635) — chrome, like tabs/theme, so it installs
// unconditionally and before History even attempts to load.
installShortcuts();

// The glossary engine before anything renders (#2629): it is delegated plus a
// MutationObserver, so every `data-term` that arrives afterwards — including
// inside a table that re-renders by innerHTML — is picked up with no call at
// the render site.
installTooltipEngine();

// Now first, and unconditionally.
startLoopStatusPolling();

try {
    const { bootstrapHistory } = await import("./history-boot.js");
    await bootstrapHistory(params);
} catch (e) {
    // No telemetry.db (absent or stale — #2519 acceptance criterion): the
    // History view stays empty rather than taking the Now view down with it.
    document.getElementById("meta-line").textContent =
        `no telemetry store: ${e.message} — run "bun run telemetry:ingest"`;
}
