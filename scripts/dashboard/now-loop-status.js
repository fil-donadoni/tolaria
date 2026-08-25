import { esc } from "./format.js";
import { verdictBandHtml } from "./now-verdict-band.js";
import { claimsSectionHtml } from "./now-claims-table.js";

/**
 * The Now view (#2519, split out in #2625) — polls GET /api/loop-status, which
 * reads no DB, so it must render whether or not telemetry.db exists.
 *
 * DATA BOUNDARY: this module and everything it imports touch `/api/loop-status`
 * and nothing else. No History module may be imported from here, directly or
 * transitively — `scripts/__tests__/telemetry-serve.test.ts` asserts it.
 *
 * The only mutable state is `loopStatusTimer`, private to this module and
 * reachable only through `startLoopStatusPolling()`.
 */

export function renderLoopStatus(data) {
    const sub = document.getElementById("loop-status-sub");
    const body = document.getElementById("loop-status-body");
    const d = data.driver ?? {};

    // The subtitle keeps the RAW driver facts; the verdict band
    // below states what they MEAN. Before #2624 this line was the
    // only health signal on the page, and it rendered the
    // eight-hour outage of 2026-08-19 as
    // `armed · no driver pid · no stop-file` — three equal grey
    // clauses, no cause and no remedy.
    sub.textContent =
        `${d.armed ? "armed" : "not armed"} · ` +
        `${
            d.pid === null || d.pid === undefined
                ? "no driver pid"
                : d.pidAlive
                  ? `pid ${d.pid} running`
                  : `pid ${d.pid} NOT running`
        } · ` +
        `${d.stopFilePresent ? "STOP-FILE PRESENT" : "no stop-file"}` +
        (data.priorityWarning ? ` · ⚠ ${esc(data.priorityWarning)}` : "");

    const verdictHtml = verdictBandHtml(data.verdict);

    const passesHtml = (d.recentPasses ?? []).length
        ? d.recentPasses
              .map(
                  (p) =>
                      `<div class="ls-pass">pass ${p.pass} · exit ${p.claudeExit} · pct ${esc(p.pct)} · queue ${p.queueBefore}→${p.queueAfter} · ${esc(p.reason)}</div>`
              )
              .join("")
        : `<div class="ls-empty">no passes recorded</div>`;

    // `queueDepth` is `null` (with a sibling `queueDepthError`) when the
    // underlying `gh` read failed — rendered as an explicit UNAVAILABLE
    // banner, never as a zeroed section, which is indistinguishable from a
    // healthy read that genuinely found nothing.
    const qd = data.queueDepth;
    const queueHtml =
        data.queueDepthError != null
            ? `<div class="ls-unavailable">⚠ ${esc(data.queueDepthError)}<br>cannot tell how deep the queue is — not the same as "queue empty"</div>`
            : `<div class="ls-driver">P0 <b>${qd.P0}</b> · P1 <b>${qd.P1}</b> · P2 <b>${qd.P2}</b> · ` +
              `unprioritized <b>${qd.unprioritized}</b> · total <b>${qd.total}</b></div>`;

    // Receipts render from `receiptsSummary`, not a raw list
    // (PR #2545 review, finding 3) — a live batch measured 232
    // receipts, almost all `missing session=…` markers, which
    // blew this panel to 3000-8000px tall on a phone (it is
    // deliberately the FIRST card, so that pushed the rest of
    // the dashboard ~8 screens below the fold). Counts by
    // (role, outcome) are cheap and complete — no cap needed;
    // only `wip`/`failed`/`blocking`/`collision` rows print
    // individually, capped server-side.
    const summary = data.receiptsSummary ?? {
        total: 0,
        counts: [],
        interesting: [],
    };
    const countsHtml = summary.counts.length
        ? summary.counts
              .map(
                  (c) =>
                      `<div class="ls-pass">${esc(c.role)} ${esc(c.outcome)}: <b>${c.count}</b></div>`
              )
              .join("")
        : `<div class="ls-empty">no receipts in this batch</div>`;
    const interestingHtml = summary.interesting.length
        ? summary.interesting
              .map((r) =>
                  r.role === "missing"
                      ? `<div class="ls-pass">missing · session ${esc(r.session)}</div>`
                      : `<div class="ls-pass">#${r.issue} · ${esc(r.role)} · ${esc(r.outcome)}${r.pr ? ` · PR #${r.pr}` : ""}</div>`
              )
              .join("")
        : "";
    const receiptsHtml = countsHtml + interestingHtml;

    body.innerHTML =
        verdictHtml +
        `<div class="ls-grid">` +
        `<div><b>Driver</b>${passesHtml}</div>` +
        `<div><b>Queue depth</b>${queueHtml}</div>` +
        `<div><b>Batch ${esc(data.batch ?? "(none)")} (${summary.total})</b>${receiptsHtml}</div>` +
        `</div>` +
        claimsSectionHtml(data);
}

export async function refreshLoopStatus() {
    try {
        const res = await fetch("/api/loop-status");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        renderLoopStatus(data);
    } catch (e) {
        document.getElementById("loop-status-sub").textContent =
            `error: ${e.message}`;
    }
}

const LOOP_STATUS_POLL_MS = 10_000;
let loopStatusTimer = null;

export function startLoopStatusPolling() {
    refreshLoopStatus();
    if (loopStatusTimer) clearInterval(loopStatusTimer);
    loopStatusTimer = setInterval(() => {
        // A forgotten background tab must not poll `gh` forever.
        if (document.visibilityState === "visible") refreshLoopStatus();
    }, LOOP_STATUS_POLL_MS);
}

document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refreshLoopStatus();
});
