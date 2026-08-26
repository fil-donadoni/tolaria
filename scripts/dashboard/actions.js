import { trapFocus } from "./dialog.js";

/**
 * Action buttons and their confirmation dialog (#2636) — the remedy a
 * verdict names becomes something an operator can DO from the page they
 * noticed the problem on, wired to `/api/action` (#2628).
 *
 * Three operations, both named STRUCTURALLY, never by pattern-matching
 * rendered prose:
 *   - `driver.stop` / `driver.resume` — offered when `verdict.remedyAction`
 *     (`scripts/lib/loop-status.ts`) names one; `deriveLoopVerdict` is the
 *     SOLE place that decides which of the two (or neither) makes sense for
 *     the current state, so this module never re-derives that judgement from
 *     `verdict.state` or `verdict.remedy`'s text.
 *   - `claim.release` — offered per ROW on the claims table, on exactly the
 *     rows `now-claims-table.js` marks `c.verdict.state === "orphan"`; that
 *     predicate is `classifyClaim`'s own output, consumed the same way the
 *     rest of this dashboard consumes it, never re-derived here either.
 *
 * DELEGATED click handling, matching `now-nav.js`'s own reasoning: the verdict
 * band and the claims table are both rewritten wholesale by
 * `writeBodyPreservingFocus` on every poll, so a listener bound to an
 * individual button would be discarded with it. One listener on the
 * container, matched by `closest()`.
 *
 * The CONFIRMATION DIALOG lives outside `#loop-status-body` (appended to
 * `document.body`, the same place `shortcuts.js`'s sheet lives) — DELIBERATELY,
 * because a poll can land while the dialog is open. `writeBodyPreservingFocus`
 * only ever rewrites the loop-status panel; a dialog outside it survives every
 * poll untouched, so an in-flight confirmation is never yanked out from under
 * an operator mid-click. The trade-off this accepts: the dialog's text is
 * captured at OPEN time from the button that triggered it, so if the
 * underlying verdict changes while the dialog is still open the wording does
 * not live-update — cancelling and re-opening picks up the fresh state. The
 * triggering button itself may not even exist anymore by the time Confirm is
 * pressed (the poll may have re-rendered it away); the dialog holds no
 * reference back to it, only the action/issue/effect text it read at open
 * time, so that is harmless.
 */

const ACTION_PATH = "/api/action";
const ACTION_TOKEN_META = "loop-action-token";
const ACTION_TOKEN_HEADER = "x-loop-action-token";

/** What each action is CALLED on a button, and what it DOES — the sentence a
 *  confirmation dialog states before anything is sent (AC: "naming its exact
 *  effect"). `claim.release`'s effect names the specific issue, so it is
 *  built per-click rather than listed here. */
const ACTION_LABEL = {
    "driver.stop": "Stop driver",
    "driver.resume": "Resume driver",
    "claim.release": "Release claim",
};

const ACTION_EFFECT = {
    "driver.stop": "Ask the running driver to stop after its current pass.",
    "driver.resume":
        "Arm the loop if needed, clear any stop-file, and start a detached driver.",
};

function effectFor(action, issue) {
    if (action === "claim.release") {
        return `Remove the in-progress label from #${issue}. The next pass may claim it again.`;
    }
    return ACTION_EFFECT[action] ?? "";
}

/**
 * Coerces a `.ls-action` button's `data-issue` (a DOM attribute — always a
 * string, or absent) to the positive integer `/api/action`'s `claim.release`
 * handler requires (`telemetry-serve.ts`'s `ACTION_ALLOW_LIST`, #2628).
 * That handler deliberately REFUSES a numeric string rather than coercing it
 * itself (`"2628 2629"` and `"2628"` are both strings — see its own
 * comment), so the coercion has to happen here, once, before the request is
 * built. Returns `undefined` for anything that is not a clean positive
 * integer, including a missing attribute — a malformed row then fails
 * closed by never opening a dialog, rather than opening one for an action
 * the server would refuse anyway (#2636 review round 1, finding 1: the
 * client posted the raw string and the server 400'd every release).
 */
function coerceIssue(raw) {
    if (raw === undefined) return undefined;
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? n : undefined;
}

function actionToken() {
    return (
        document.querySelector(`meta[name="${ACTION_TOKEN_META}"]`)?.content ??
        ""
    );
}

/**
 * POSTs one action. Returns the parsed `{ok, ...}` body always — including on
 * a network failure or a non-JSON response, both folded into `{ok:false,
 * error}` so the caller has exactly one shape to branch on, never a thrown
 * exception to also catch.
 */
async function postAction(action, extra = {}) {
    try {
        const res = await fetch(ACTION_PATH, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                [ACTION_TOKEN_HEADER]: actionToken(),
            },
            body: JSON.stringify({ action, ...extra }),
        });
        let body;
        try {
            body = await res.json();
        } catch {
            body = { ok: false, error: `HTTP ${res.status}` };
        }
        if (typeof body?.ok !== "boolean") {
            body = { ok: false, error: `HTTP ${res.status}` };
        }
        return body;
    } catch (e) {
        return { ok: false, error: e?.message ?? "network error" };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// The confirmation dialog — its own overlay, appended to `document.body` the
// same way `shortcuts.js`'s sheet is (see module header for why it must NOT
// live inside `#loop-status-body`). Reuses that sheet's own CSS classes
// (`.shortcuts-backdrop` / `.shortcuts-sheet`, dashboard.css) for identical
// modal chrome — including the `[hidden]` cascade fix that file's own comment
// documents — rather than a parallel set of rules for the same look.
// ─────────────────────────────────────────────────────────────────────────────

let dialogEl = null;
let openerEl = null;
/** Set for the lifetime of one open dialog; cleared on close. Guards against
 *  a stray keydown/click reaching a handler for a dialog that already closed. */
let pending = null;
/**
 * Re-entrancy guard for `confirmPending`, INDEPENDENT of the `disabled`
 * attribute `setBusy` also sets on the Confirm/Cancel buttons. The `disabled`
 * attribute is a UI reflection for sighted/assistive users; whether it also
 * suppresses a synthetic or double-dispatched click is not something this
 * module gets to assume (browsers vary, and a script-dispatched click is not
 * user interaction at all) — the AC ("a double click cannot send two") is
 * enforced HERE, by simply refusing to start a second request while one is
 * outstanding, regardless of what reached the listener.
 */
let inFlight = false;

function buildDialog() {
    const backdrop = document.createElement("div");
    backdrop.id = "action-confirm-backdrop";
    backdrop.className = "shortcuts-backdrop";
    backdrop.hidden = true;
    backdrop.innerHTML =
        `<div class="shortcuts-sheet action-confirm-sheet" role="dialog" aria-modal="true" ` +
        `aria-labelledby="action-confirm-title" aria-describedby="action-confirm-body">` +
        `<h2 id="action-confirm-title"></h2>` +
        `<p id="action-confirm-body"></p>` +
        `<div class="err action-confirm-error" role="alert" hidden></div>` +
        `<div class="action-confirm-buttons">` +
        `<button type="button" class="action-confirm-cancel">Cancel</button>` +
        `<button type="button" class="action-confirm-ok">Confirm</button>` +
        `</div></div>`;
    backdrop.addEventListener("click", (e) => {
        if (e.target === backdrop) closeDialog();
    });
    backdrop
        .querySelector(".action-confirm-cancel")
        .addEventListener("click", closeDialog);
    backdrop
        .querySelector(".action-confirm-ok")
        .addEventListener("click", () => confirmPending());
    // Bound on `document`, not on `backdrop` (shortcuts.js round 2 review,
    // medium — the same bug class, avoided here from the start): a listener
    // on the backdrop only fires while focus is still SOMEWHERE inside it,
    // but nothing before the trap below guarantees that stays true (a
    // programmatic `.focus()` elsewhere, or a future control this dialog
    // grows). Gating on `actionDialogOpen()` up front is what makes Escape
    // and the Tab trap work regardless of where focus has drifted to, and
    // what keeps this inert while no dialog is open.
    document.addEventListener("keydown", (e) => {
        if (!actionDialogOpen()) return;
        trapFocus(
            backdrop.querySelector(".action-confirm-sheet"),
            e,
            backdrop.ownerDocument
        );
        if (e.key === "Escape") {
            e.preventDefault();
            closeDialog();
        }
    });
    document.body.appendChild(backdrop);
    return backdrop;
}

function dialog() {
    if (!dialogEl || dialogEl.isConnected === false) dialogEl = buildDialog();
    return dialogEl;
}

/** Whether the confirmation dialog is currently open. Exported so a test can
 *  assert it without reaching into module-private state. */
export function actionDialogOpen() {
    return !!dialogEl && !dialogEl.hidden;
}

function setError(message) {
    const el = dialog().querySelector(".action-confirm-error");
    if (message) {
        el.textContent = message;
        el.hidden = false;
    } else {
        el.textContent = "";
        el.hidden = true;
    }
}

function setBusy(busy) {
    const el = dialog();
    el.querySelector(".action-confirm-cancel").disabled = busy;
    const ok = el.querySelector(".action-confirm-ok");
    ok.disabled = busy;
    ok.textContent = busy ? "Working…" : "Confirm";
}

/**
 * Opens the dialog for one action, naming its exact effect (AC) before
 * anything is sent. `onSuccess` is called once the operation actually
 * succeeds — the caller (`initActions`) wires it to an immediate re-poll
 * rather than waiting up to 10s for the next scheduled one.
 */
function openDialog(action, { issue, onSuccess } = {}) {
    const el = dialog();
    openerEl =
        document.activeElement && document.activeElement !== document.body
            ? document.activeElement
            : null;
    el.querySelector("#action-confirm-title").textContent =
        ACTION_LABEL[action] ?? action;
    el.querySelector("#action-confirm-body").textContent = effectFor(
        action,
        issue
    );
    setError(null);
    setBusy(false);
    pending = { action, issue, onSuccess };
    el.hidden = false;
    el.querySelector(".action-confirm-ok").focus();
}

function closeDialog() {
    if (!dialogEl) return;
    dialogEl.hidden = true;
    pending = null;
    // Cleared here too, not only after a resolved fetch (#2636 review round
    // 1, finding 4): Escape/backdrop/Cancel can close the dialog while a
    // request is still in flight (there is no reason to force the operator
    // to wait one out), and if `inFlight` stayed `true` the NEXT dialog's
    // own Confirm click would be silently swallowed by the re-entrancy guard
    // below — no fetch, no error, nothing visibly wrong.
    inFlight = false;
    if (openerEl && typeof openerEl.focus === "function") openerEl.focus();
    openerEl = null;
}

async function confirmPending() {
    if (!pending || inFlight) return;
    inFlight = true;
    // Captured by IDENTITY, not just truthiness: cancelling this dialog
    // (`closeDialog` above) nulls `pending`, but cancelling and then
    // opening a DIFFERENT one reassigns it to a new object — `!pending`
    // alone missed that second case entirely (#2636 review round 1, finding
    // 4). Comparing identity after the await catches both: a stale response
    // for a dialog that is no longer open, or no longer THIS open dialog,
    // is inert either way.
    const ownPending = pending;
    const { action, issue, onSuccess } = pending;
    setBusy(true);
    setError(null);
    const extra = action === "claim.release" ? { issue } : {};
    const result = await postAction(action, extra);
    if (pending !== ownPending) return;
    inFlight = false;
    if (result.ok) {
        closeDialog();
        onSuccess?.();
        return;
    }
    // Refused or failed: surface the reason (AC) and leave the dialog open —
    // the operator can retry or Cancel. The copyable command this action's
    // remedy also renders (`now-verdict-band.js`'s `remedyHtml`, or the
    // orphan band's `bun run loop:doctor` remedy for a release) is still on
    // the page underneath, unaffected by this failure — that IS the fallback
    // the AC asks for, with nothing further to build here.
    setError(result.error || "the action was refused");
    setBusy(false);
}

// ─────────────────────────────────────────────────────────────────────────────
// Click dispatch — delegated on the loop-status container, same shape as
// `now-nav.js`.
// ─────────────────────────────────────────────────────────────────────────────

let installed = false;

export function initActions(
    root = document.getElementById("loop-status-body"),
    onSuccess = () => {}
) {
    if (installed || !root) return;
    installed = true;
    root.addEventListener("click", (e) => {
        const btn = e.target.closest?.(".ls-action");
        if (!btn || btn.disabled) return;
        const action = btn.dataset.action;
        if (!ACTION_LABEL[action]) return;
        const issue = coerceIssue(btn.dataset.issue);
        // `claim.release` with no legible issue number is a malformed row —
        // refuse to open a dialog for a request the server will 400 anyway.
        if (action === "claim.release" && issue === undefined) return;
        openDialog(action, { issue, onSuccess });
    });
}

/** Reset every module-level latch — test-only, mirrors `shortcuts.js`'s
 *  `resetShortcuts`: the `node` vitest project shares one worker's module
 *  registry (`isolate: false`), so a swapped `document` needs a matching
 *  reset or the next test inherits a stale `dialogEl`. */
export function resetActions() {
    installed = false;
    dialogEl = null;
    openerEl = null;
    pending = null;
    inFlight = false;
}
