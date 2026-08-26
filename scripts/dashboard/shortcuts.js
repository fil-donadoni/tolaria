import { esc } from "./format.js";
import { viewFromParams, switchView } from "./tabs.js";
import { refreshLoopStatus } from "./now-loop-status.js";
import { trapFocus as trapFocusIn } from "./dialog.js";
import { actionDialogOpen } from "./actions.js";

/**
 * The dashboard's keyboard layer (#2635, PRD #2621 D5/user stories 31-36):
 * `1`/`2` switch views, `r` refreshes the visible one, `/` focuses its search
 * box, `?` opens a sheet listing all of this, `Esc` closes it. Bound once, on
 * `document` — every view's markup is destroyed and rebuilt by `innerHTML` on
 * every render (the same reason `tooltip.js` and `now-nav.js` delegate rather
 * than bind per element), so a listener anywhere but the document would need
 * re-attaching after the next poll or filter change and the one that gets
 * forgotten is a dead shortcut nobody notices until they rely on it.
 *
 * ── STATICALLY REACHABLE FROM main.js — the Now/History data boundary ─────
 *
 * `scripts/__tests__/telemetry-serve.test.ts` crawls every module reachable
 * from `main.js` over a STATIC `import`/`export …from` edge and asserts none
 * of them is a `history-*` module and none reaches any `/api/*` route but
 * `/api/loop-status` (#2519's guarantee: the Now panel must render with no
 * telemetry.db). This module IS statically imported by `main.js` (the
 * keyboard layer is chrome, like `tabs.js`/`theme.js`, not a History
 * component), so it is bound by both rules: its own imports stay inside that
 * closure (`tabs.js`, `now-loop-status.js`, `format.js`, `dialog.js`,
 * `actions.js` — the last already reachable transitively via
 * `now-loop-status.js`, so importing `actionDialogOpen` from it directly adds
 * no new module to the closure), and reaching
 * History's `refresh()` for the `r` shortcut goes through a DYNAMIC
 * `import()` inside `refreshVisibleView` below — the same sanctioned
 * mechanism `main.js` itself uses for `history-boot.js`, and for the same
 * reason: a static edge here would drag the store-backed graph into every
 * page load, telemetry.db or not.
 */

/** One row per shortcut — the single list the sheet renders AND the keydown
 *  switch dispatches from, so a key can never appear in one without the
 *  other. */
const SHORTCUTS = [
    { key: "1", desc: "Switch to the Now view" },
    { key: "2", desc: "Switch to the History view" },
    { key: "r", desc: "Refresh the visible view" },
    { key: "/", desc: "Focus the visible view's search box" },
    { key: "?", desc: "Show or hide this list" },
    { key: "Esc", desc: "Close this list, or any other open overlay" },
];

const NON_TEXT_INPUT_TYPES = new Set([
    "button",
    "checkbox",
    "color",
    "file",
    "hidden",
    "image",
    "radio",
    "range",
    "reset",
    "submit",
]);

/**
 * Whether `el` is somewhere a keystroke inserts a character OR drives native
 * typeahead rather than triggering a shortcut — the #2635 AC's hard case:
 * typing `1` into History's issue search must filter the table, never jump
 * to the Now view. `<input type="date">`/`type="search"` (the filter bar's
 * own fields) count exactly as much as a bare text field — a date input
 * still consumes digit keys, and the AC's wording ("a text input, textarea,
 * or contenteditable") is deliberately about what the element DOES with a
 * keystroke, not its literal tag.
 *
 * `SELECT` (round 2 review, medium): History renders five native comboboxes
 * (`if-family`/`if-tier`/`if-state` in `history-issues-table.js`, `sf-cmd` in
 * `history-sessions-table.js`, plus the filter bar's own dataset/metric/split
 * pickers) where a letter or digit key is the browser's own typeahead —
 * jump-to-option, not "type a shortcut". Proven with a scratch test: focus
 * `#if-family`, dispatch `1`, and the view switched to Now underneath the
 * still-focused dropdown.
 *
 * `role="textbox"` (defensive): no such ARIA widget exists in this dashboard
 * today, but a future custom text-entry host built without a real `<input>`
 * would otherwise ship silently broken.
 *
 * Deliberately NOT a blanket `[tabindex]` check, despite that shape covering
 * `SELECT` and `role="textbox"` for free — `tooltip.js`'s `enhanceTerms`
 * (#2629) gives every glossary TERM `tabindex="0"` purely so it can open a
 * tooltip on focus (nearly every table header, plus every claim-stage cell,
 * `now-loop-status.js`), and none of those consume a keystroke as text.
 * Suppressing every shortcut while ANY of those merely holds focus would
 * make `1`/`2`/`r` unusable for most of a keyboard user's time on the page —
 * the opposite of what #2635 asks for — so the guard stays keyed on what an
 * element DOES with a key, never on whether it is merely focusable.
 *
 * Exported for direct testing without dispatching a synthetic `keydown`.
 */
export function isTypingTarget(el) {
    if (!el) return false;
    const tag = el.tagName;
    if (tag === "TEXTAREA" || tag === "SELECT") return true;
    if (tag === "INPUT") {
        const type = (el.getAttribute("type") || "text").toLowerCase();
        return !NON_TEXT_INPUT_TYPES.has(type);
    }
    if (el.isContentEditable) return true;
    return el.getAttribute("role") === "textbox";
}

const currentView = () => viewFromParams(new URLSearchParams(location.search));

/**
 * `/` focuses the FIRST visible search box in DOM order — History currently
 * renders two (`#if-text` for Issues, `#sf-text` for Sessions; both cards are
 * on screen at once, there is no sub-tab between them), and the Issues card
 * leads the view, so it is the one a person reaches for first. Now has none
 * today; querying finds nothing and this is a silent no-op rather than an
 * error, which is also the correct behaviour for a view that never gets one.
 */
function focusVisibleSearchBox() {
    const root = document.getElementById(`view-${currentView()}`);
    const box = root?.querySelector('input[type="search"]');
    if (!box) return;
    box.focus();
    box.select?.();
}

/**
 * `r` refreshes whichever view is on screen. Now's transport
 * (`now-loop-status.js`) is always loaded (`main.js` imports it statically),
 * so that half is a direct call. History's is reached only through the same
 * dynamic `import()` `main.js` itself uses — see the module header — and
 * gated on `getMeta()` returning non-null: `history-refresh.js`'s `refresh()`
 * dereferences `getMeta()` unconditionally (`seedColors`/`renderTiles`), so
 * calling it before `/api/meta` has ever resolved (no telemetry.db, or the
 * fetch still in flight) would throw instead of doing nothing. `#meta-line`
 * already told the operator once that the store is unavailable; refreshing a
 * view with nothing loaded should be quiet, not a second error.
 */
async function refreshVisibleView() {
    if (currentView() === "now") {
        refreshLoopStatus();
        return;
    }
    const { getMeta } = await import("./history-state.js");
    if (!getMeta()) return;
    const { refresh } = await import("./history-refresh.js");
    await refresh();
}

// ─────────────────────────────────────────────────────────────────────────────
// The shortcut sheet — `?` opens it, and it is also reachable from a header
// button (#2635 AC: "reachable without already knowing a shortcut").
// ─────────────────────────────────────────────────────────────────────────────

let sheetEl = null;
let openerEl = null;

/**
 * Built once, lazily, and appended to `document.body` — the same "resolve on
 * first use" shape `tooltip.js` uses for `#tip`, chosen for the same reason:
 * it keeps this module importable with no DOM present until something
 * actually needs one.
 *
 * The sheet is its OWN overlay, not a repurposed `#tip`: `#tip` is a
 * `pointer-events: none`, 280px-wide layer positioned next to a cursor or an
 * anchor element, sized for a one-line glossary tooltip. A list of six
 * shortcuts with a close button needs pointer events and a fixed, centred
 * position instead of a cursor-relative one — reusing `#tip`'s element would
 * mean fighting its own CSS on every property. What IS reused is the
 * design: escaped text, a `dialog`-shaped a11y contract, and the theme's own
 * surface/border tokens rather than new colours (`dashboard.css`).
 */
function buildSheet() {
    const backdrop = document.createElement("div");
    backdrop.id = "shortcuts-backdrop";
    backdrop.className = "shortcuts-backdrop";
    backdrop.hidden = true;
    const rows = SHORTCUTS.map(
        (s) => `<dt><kbd>${esc(s.key)}</kbd></dt><dd>${esc(s.desc)}</dd>`
    ).join("");
    backdrop.innerHTML =
        `<div class="shortcuts-sheet" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title">` +
        `<h2 id="shortcuts-title">Keyboard shortcuts</h2>` +
        `<dl>${rows}</dl>` +
        `<button type="button" class="shortcuts-close">Close</button>` +
        `</div>`;
    backdrop.addEventListener("click", (e) => {
        if (e.target === backdrop) closeSheet();
    });
    backdrop
        .querySelector(".shortcuts-close")
        .addEventListener("click", closeSheet);
    document.body.appendChild(backdrop);
    return backdrop;
}

function sheet() {
    if (!sheetEl || sheetEl.isConnected === false) sheetEl = buildSheet();
    return sheetEl;
}

/** Whether the sheet is currently open. Exported so the keydown switch can
 *  make every other shortcut inert while it has focus (a modal that still let
 *  `1` change the view underneath it would not read as modal at all). */
export function sheetOpen() {
    return !!sheetEl && !sheetEl.hidden;
}

/** Opens the sheet and moves focus into it — AC: "Focus is visible wherever
 *  the keyboard can land". `openerEl` remembers whatever was focused before
 *  (a header button, or nothing after a bare `?` keypress) so `closeSheet`
 *  can give it back, the standard modal-dialog focus contract. */
export function openSheet() {
    const el = sheet();
    openerEl =
        document.activeElement && document.activeElement !== document.body
            ? document.activeElement
            : null;
    el.hidden = false;
    el.querySelector(".shortcuts-close")?.focus();
}

export function closeSheet() {
    if (!sheetEl) return;
    sheetEl.hidden = true;
    if (openerEl && typeof openerEl.focus === "function") openerEl.focus();
    openerEl = null;
}

function toggleSheet() {
    if (sheetOpen()) closeSheet();
    else openSheet();
}

/**
 * A real focus trap for the sheet (round 2 review, medium). `aria-modal`
 * declares that nothing behind the dialog is reachable, but nothing
 * previously enforced it: Tab could walk focus off the sheet's own close
 * button and onto the page behind it — and once there, the sheet stayed
 * open with no keyboard way back in, since the typing-suppression check
 * (`isTypingTarget`) could then also swallow Escape (see `handleKeydown`).
 * Cycles Tab/Shift+Tab between the sheet's first and last focusable
 * descendant; today that is the SAME element (only the close button is
 * focusable), so this degrades to "Tab always returns to the close button",
 * exactly the right trap for a one-control dialog, and stays correct if a
 * later change adds a second one.
 *
 * Thin wrapper over the shared `dialog.js` trap (#2636) — this sheet's own
 * contribution is only "which element is the dialog root right now", looked
 * up from module state; the Tab-cycling mechanics live there so the
 * action-confirmation dialog does not duplicate them.
 */
function trapFocus(e, doc) {
    trapFocusIn(sheetEl?.querySelector(".shortcuts-sheet"), e, doc);
}

// ─────────────────────────────────────────────────────────────────────────────
// The keydown switch
// ─────────────────────────────────────────────────────────────────────────────

/** Exported for direct testing with a hand-built event-like object, the same
 *  shape `dashboard-glossary.test.ts` drives `tooltip.js` with — a real
 *  `KeyboardEvent` dispatch exercises the wiring in `installShortcuts`'s own
 *  test, this one exercises the decision table in isolation. */
export function handleKeydown(e, doc = document) {
    // Cmd/Ctrl/Alt+key are the browser's own shortcuts (Cmd+R reload, etc.);
    // never intercept a modified keypress.
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    if (sheetOpen()) {
        // While the sheet is open it owns Tab and Escape/`?` UNCONDITION-
        // ALLY, regardless of where focus has drifted to — round 2 review,
        // medium: `isTypingTarget`'s early return used to sit AHEAD of the
        // Escape branch, so once focus left the sheet (no trap existed
        // before this fix) onto a text input behind it, Escape stopped
        // closing the sheet at all. Both the check and the branch now live
        // inside this block, before that early return is ever reached.
        if (e.key === "Tab") {
            trapFocus(e, doc);
            return;
        }
        if (e.key === "Escape" || e.key === "?") {
            e.preventDefault();
            closeSheet();
            return;
        }
        // Every other shortcut is inert while the sheet is open, so `1`
        // typed to dismiss-and-read never also jumps the view underneath.
        return;
    }

    // `actions.js`'s own confirmation dialog is a SECOND modal this module
    // knows nothing about building — but the same "nothing outside a modal
    // reacts to a key" contract still has to hold for it (#2636 review
    // round 1, finding 2: `sheetOpen()` was the only gate here, so `2`
    // pressed while the Release/Stop confirmation was open switched the
    // whole view out from under it, and `?` stacked the shortcut sheet on
    // top). UNLIKE the sheet above, this module does not own that dialog's
    // Tab trap or Escape handling — `actions.js` binds its own `keydown`
    // listener on `document` for that (see its module header) — so there is
    // nothing to do here but go inert and let that listener run.
    if (actionDialogOpen()) return;

    if (isTypingTarget(doc.activeElement)) return;

    if (e.key === "?") {
        e.preventDefault();
        toggleSheet();
        return;
    }

    switch (e.key) {
        case "1":
            e.preventDefault();
            switchView("now");
            break;
        case "2":
            e.preventDefault();
            switchView("history");
            break;
        case "r":
            e.preventDefault();
            refreshVisibleView();
            break;
        case "/":
            e.preventDefault();
            focusVisibleSearchBox();
            break;
        default:
            break;
    }
}

let installed = false;

/** Idempotent — safe to call once from `main.js` regardless of load order. */
export function installShortcuts() {
    if (installed) return;
    installed = true;
    document.addEventListener("keydown", handleKeydown);
    document.getElementById("shortcuts-btn")?.addEventListener("click", () => {
        toggleSheet();
    });
}

/** Reset every module-level latch — test-only, mirrors
 *  `tooltip.js`'s `resetTooltipEngine`: the `node` vitest project shares one
 *  worker's module registry (`isolate: false`), so a swapped `document`
 *  needs a matching reset or the next test inherits a stale `sheetEl`. */
export function resetShortcuts() {
    installed = false;
    sheetEl = null;
    openerEl = null;
}
