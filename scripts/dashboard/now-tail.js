import { esc, fmtAgoMs, issueLink } from "./format.js";

/**
 * The session tail drawer (issue #3135) — one conversation, followed live,
 * the way `tail -f` on its transcript would read in a terminal: prompts,
 * replies, tool calls with their one-line summary, tool results, system
 * notes. Opened from a Watch button on a claim row or a live-session row.
 *
 * TRANSPORT. `/api/tail?session=<uuid>` returns the last entries and a byte
 * `offset`; every poll after that passes the offset back and receives only
 * what was appended, so following a multi-megabyte transcript costs a few
 * hundred bytes a tick. Two seconds, while the drawer is open and the tab
 * visible; nothing polls when it is closed.
 *
 * ONE DRAWER, OUTSIDE THE NOW BODY. Appended to `document.body` like the
 * shortcuts sheet and the confirmation dialog, for the same reason: the Now
 * body is rewritten wholesale on every loop-status poll, and a drawer
 * inside it would be torn down every ten seconds. Non-modal (`aria-modal`
 * false): the page behind stays usable, and the dashboard's own polls keep
 * running.
 *
 * FOLLOW MODE. New entries scroll into view until the operator scrolls up,
 * at which point following pauses and a "Jump to latest" button appears —
 * the terminal convention. Escape closes; focus returns to the button that
 * opened it.
 *
 * This is the one Now module besides `now-loop-status.js` that touches the
 * DOM, and nothing here runs at import time.
 */

export const TAIL_POLL_MS = 2_000;
const TAIL_PATH = "/api/tail";
/** How many entries the log keeps in the DOM before trimming the oldest. */
const MAX_ENTRIES = 600;

/** How each entry kind is labelled — the terminal's own vocabulary. */
export const KIND_LABEL = {
    user: "you",
    assistant: "claude",
    thinking: "thinking",
    tool_use: "tool",
    tool_result: "result",
    system: "system",
};

const state = {
    el: null,
    session: null,
    offset: null,
    timer: null,
    follow: true,
    opener: null,
    inflight: false,
};

const fmtTime = (ms) => {
    if (ms == null) return "";
    const d = new Date(ms);
    return [d.getHours(), d.getMinutes(), d.getSeconds()]
        .map((n) => String(n).padStart(2, "0"))
        .join(":");
};

/** One entry's markup — pure, exported for the test. */
export function entryHtml(e) {
    const label =
        e.kind === "tool_use"
            ? (e.tool ?? "tool")
            : (KIND_LABEL[e.kind] ?? e.kind);
    const err = e.kind === "tool_result" && e.isError ? " is-error" : "";
    return (
        `<div class="ls-tail-entry kind-${esc(e.kind)}${err}">` +
        `<span class="ls-tail-ts">${esc(fmtTime(e.ts))}</span>` +
        `<span class="ls-tail-kind">${esc(label)}</span>` +
        `<pre class="ls-tail-text">${esc(e.text)}</pre>` +
        `</div>`
    );
}

function ensureDrawer() {
    if (state.el) return state.el;
    const el = document.createElement("aside");
    el.id = "ls-tail";
    el.className = "ls-tail";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "false");
    el.setAttribute("aria-label", "Session tail");
    el.hidden = true;
    el.innerHTML =
        `<div class="ls-tail-head">` +
        `<div class="ls-tail-titles">` +
        `<div class="ls-tail-title" id="ls-tail-title"></div>` +
        `<div class="ls-tail-sub" id="ls-tail-sub"></div>` +
        `</div>` +
        `<div class="ls-tail-controls">` +
        `<button type="button" class="ls-tail-follow" id="ls-tail-follow" aria-pressed="true">Following</button>` +
        `<button type="button" class="ls-tail-close" id="ls-tail-close" aria-label="Close session tail">Close</button>` +
        `</div>` +
        `</div>` +
        `<div class="ls-tail-log" id="ls-tail-log" tabindex="0" aria-live="polite" aria-label="Transcript"></div>` +
        `<div class="ls-tail-foot"><span id="ls-tail-status" class="ls-tail-status">connecting…</span>` +
        `<button type="button" class="ls-tail-jump" id="ls-tail-jump" hidden>Jump to latest</button></div>`;
    document.body.appendChild(el);

    el.querySelector("#ls-tail-close").addEventListener("click", closeTail);
    el.querySelector("#ls-tail-follow").addEventListener("click", () =>
        setFollow(!state.follow)
    );
    el.querySelector("#ls-tail-jump").addEventListener("click", () =>
        setFollow(true)
    );
    const log = el.querySelector("#ls-tail-log");
    log.addEventListener("scroll", () => {
        // Scrolling up pauses following; scrolling back to the bottom
        // resumes it — the terminal convention.
        const atBottom =
            log.scrollHeight - log.scrollTop - log.clientHeight < 24;
        if (!atBottom && state.follow) setFollow(false, { keepScroll: true });
        else if (atBottom && !state.follow) setFollow(true);
    });
    // Escape closes; Tab is NOT trapped — the drawer is non-modal
    // (`aria-modal="false"`) and the page beside it stays reachable, so a
    // keyboard user can leave it the same way a pointer user can (review of
    // PR #3136: a trap here was a modal wearing a non-modal role).
    el.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            e.preventDefault();
            closeTail();
        }
    });
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible" && state.session)
            void poll();
    });
    state.el = el;
    return el;
}

function setFollow(on, { keepScroll = false } = {}) {
    state.follow = on;
    const el = state.el;
    if (!el) return;
    const btn = el.querySelector("#ls-tail-follow");
    btn.setAttribute("aria-pressed", String(on));
    btn.textContent = on ? "Following" : "Paused";
    el.querySelector("#ls-tail-jump").hidden = on;
    if (on && !keepScroll) scrollToEnd();
}

function scrollToEnd() {
    const log = state.el?.querySelector("#ls-tail-log");
    if (log) log.scrollTop = log.scrollHeight;
}

function setStatus(text, tone = "") {
    const s = state.el?.querySelector("#ls-tail-status");
    if (!s) return;
    s.textContent = text;
    s.className = `ls-tail-status${tone ? ` ${tone}` : ""}`;
}

/** Render the drawer's heading from the tail page's `summary`. */
function renderSummary(summary, label, issue) {
    const el = state.el;
    el.querySelector("#ls-tail-title").textContent = label;
    const parts = [];
    if (issue) parts.push(`issue ${issueLink(issue)}`);
    if (summary?.gitBranch)
        parts.push(`<code class="ls-cmd">${esc(summary.gitBranch)}</code>`);
    if (summary?.liveness)
        parts.push(
            `<span class="ls-badge ${summary.liveness === "active" ? "good" : summary.liveness === "live" ? "warn" : "neutral"}">${esc(summary.liveness === "live" ? "recent" : summary.liveness)}</span>`
        );
    parts.push(
        `<span class="mini" title="${esc(state.session)}">${esc(state.session.slice(0, 8))}</span>`
    );
    el.querySelector("#ls-tail-sub").innerHTML = parts.join(" · ");
}

function appendEntries(entries) {
    if (!entries.length) return;
    const log = state.el.querySelector("#ls-tail-log");
    log.insertAdjacentHTML("beforeend", entries.map(entryHtml).join(""));
    while (log.childElementCount > MAX_ENTRIES) log.firstElementChild.remove();
    if (state.follow) scrollToEnd();
}

async function poll() {
    if (
        !state.session ||
        state.inflight ||
        document.visibilityState !== "visible"
    )
        return;
    state.inflight = true;
    const session = state.session;
    try {
        const q = new URLSearchParams({ session });
        if (state.offset !== null) q.set("offset", String(state.offset));
        const res = await fetch(`${TAIL_PATH}?${q}`);
        const page = await res.json();
        if (!res.ok) throw new Error(page.error || `HTTP ${res.status}`);
        // The drawer may have been re-pointed while this request was out.
        if (state.session !== session) return;
        const first = state.offset === null;
        state.offset = page.offset;
        if (first) {
            const log = state.el.querySelector("#ls-tail-log");
            log.innerHTML = page.truncated
                ? `<div class="ls-tail-entry kind-system"><span class="ls-tail-ts"></span><span class="ls-tail-kind">tail</span><pre class="ls-tail-text">… earlier entries not shown …</pre></div>`
                : "";
        }
        renderSummary(page.summary, state.label, state.issue);
        appendEntries(page.entries);
        setStatus(
            `following · last write ${fmtAgoMs(page.lastWriteMs)} · ${page.entries.length} new`,
            ""
        );
    } catch (e) {
        if (state.session === session) setStatus(`error: ${e.message}`, "bad");
    } finally {
        state.inflight = false;
    }
}

/**
 * Open (or re-point) the drawer on a session.
 * @param {{ session: string, label?: string, issue?: number|string|null, opener?: Element|null }} opts
 */
export function openTail({ session, label, issue = null, opener = null }) {
    const el = ensureDrawer();
    const changed = state.session !== session;
    state.session = session;
    state.label = label || session;
    state.issue = issue;
    state.opener = opener ?? state.opener;
    if (changed) {
        state.offset = null;
        el.querySelector("#ls-tail-log").innerHTML = "";
        setStatus("connecting…");
        setFollow(true);
    }
    el.querySelector("#ls-tail-title").textContent = state.label;
    el.hidden = false;
    document.body.classList.add("ls-tail-open");
    if (state.timer) clearInterval(state.timer);
    state.timer = setInterval(() => void poll(), TAIL_POLL_MS);
    void poll();
    el.querySelector("#ls-tail-close").focus();
}

export function closeTail() {
    const el = state.el;
    if (!el || el.hidden) return;
    el.hidden = true;
    document.body.classList.remove("ls-tail-open");
    if (state.timer) clearInterval(state.timer);
    state.timer = null;
    state.session = null;
    state.offset = null;
    const opener = state.opener;
    state.opener = null;
    if (opener && typeof opener.focus === "function" && opener.isConnected) {
        opener.focus({ preventScroll: true });
    }
}

/** True while the drawer is open — the transport uses it to keep the
 *  drawer's own polls off when nobody is watching. */
export const isTailOpen = () => !!state.el && !state.el.hidden;
