import { esc, fmtClock, fmtPct, issueLink } from "./format.js";
import { verdictBandHtml } from "./now-verdict-band.js";
import { lightsHtml, SECTION_IDS } from "./now-lights.js";
import { claimsSectionHtml } from "./now-claims-table.js";
import { timelineSectionHtml } from "./now-timeline.js";
import { activitySectionHtml } from "./now-activity.js";
import { liveSectionHtml } from "./now-live.js";
import { passOutcome } from "./now-timeline.js";
import {
    sectionHtml,
    statsHtml,
    badgeHtml,
    tableHtml,
    emptyHtml,
    unavailableHtml,
} from "./now-atoms.js";

/**
 * The Now view's composition root (#2630) — verdict band, four traffic
 * lights, then the detail sections each light points at.
 *
 * WHY THIS FILE EXISTS, given `now-loop-status.js` already rendered a band.
 * #2630 asked for a band and lights on a view that was not blank: the panel
 * already composed `verdictBandHtml` into `#loop-status-body`. Adding a
 * second renderer beside it would have put two compositions of the same
 * payload on one screen, free to disagree. So the composition moved HERE
 * instead, and `now-loop-status.js` kept only what it uniquely owns — the
 * fetch, the poll timer and the DOM write. One payload, one composition.
 *
 * PURE, deliberately: no DOM, no fetch, no module-level mutable state, so the
 * `node` vitest project can call `nowBodyHtml` on a fixture and assert what
 * the operator would actually see — including that every light points at a
 * section id this same function emits. The impure half lives in
 * `now-loop-status.js` (transport) and `now-nav.js` (click behaviour).
 *
 * ISSUE #3135 reshaped the detail sections: every one is a `sectionHtml`
 * frame (heading + `ⓘ` glossary mark), figures are rounded, and the
 * `·`-joined 11px lines became stat boxes, badges and tables
 * (`now-atoms.js`). Two sections joined the page — the hourly activity
 * chart (`now-activity.js`) and the live sessions list (`now-live.js`) —
 * both fed from the session transcripts, never the store.
 */

/**
 * The card subtitle keeps the RAW driver facts; the verdict band below states
 * what they MEAN. Before #2624 this line was the only health signal on the
 * page, and it rendered the eight-hour outage of 2026-08-19 as `armed · no
 * driver pid · no stop-file` — three equal grey clauses, no cause and no
 * remedy.
 */
export function nowSubtitleText(data) {
    const d = data.driver ?? {};
    return (
        `${d.armed ? "armed" : "not armed"} · ` +
        `${
            d.pid === null || d.pid === undefined
                ? "no driver pid"
                : d.pidAlive
                  ? `pid ${d.pid} running`
                  : `pid ${d.pid} NOT running`
        } · ` +
        `${d.stopFilePresent ? "STOP-FILE PRESENT" : "no stop-file"}` +
        (data.priorityWarning ? ` · ⚠ ${data.priorityWarning}` : "")
    );
}

const PASS_TONE = { landed: "good", "ran-nothing": "warn", died: "bad" };
const PASS_WORD = {
    landed: "landed",
    "ran-nothing": "ran, nothing landed",
    died: "died",
};

/** The three driver facts as badges — the light's word says the summary,
 *  these say each fact on its own. */
function driverFactsHtml(d) {
    const pid =
        d.pid === null || d.pid === undefined
            ? badgeHtml("no pid file", "warn")
            : d.pidAlive
              ? badgeHtml(`pid ${d.pid} alive`, "good")
              : badgeHtml(`pid ${d.pid} dead`, "bad");
    return (
        `<div class="ls-badges">` +
        pid +
        badgeHtml(
            d.armed ? "handoff armed" : "handoff not armed",
            d.armed ? "good" : "neutral"
        ) +
        (d.stopFilePresent
            ? badgeHtml("stop-file present", "warn")
            : badgeHtml("no stop-file", "neutral")) +
        `</div>`
    );
}

const PASS_COLUMNS = [
    { term: "pass.number", label: "pass", align: "right" },
    { term: "pass.outcome", label: "outcome" },
    { term: "pass.exit", label: "exit", align: "right" },
    { term: "pct", label: "budget used", align: "right" },
    { term: "queue", label: "queue before → after" },
    { term: "pass.reason", label: "reason" },
];

/**
 * Driver: the three process facts as badges, then the recent passes as a
 * table — outcome as a badge (`passOutcome`, the timeline's own mapping),
 * budget as a whole percent, the raw reason code last with its glossary
 * term on the header.
 */
function driverSectionHtml(data) {
    const d = data.driver ?? {};
    const passes = d.recentPasses ?? [];
    const rows = passes.map((p) => {
        const outcome = passOutcome(p.reason);
        return [
            esc(String(p.pass)),
            badgeHtml(
                PASS_WORD[outcome],
                PASS_TONE[outcome],
                `pass.${outcome}`
            ),
            esc(String(p.claudeExit)),
            esc(fmtPct(p.pct)),
            `${esc(String(p.queueBefore))} → ${esc(String(p.queueAfter))}`,
            `<code class="ls-cmd">${esc(p.reason)}</code>`,
        ];
    });
    const body =
        driverFactsHtml(d) +
        (rows.length
            ? tableHtml(PASS_COLUMNS, rows, { cls: "ls-pass-table" })
            : emptyHtml("No passes recorded."));
    return sectionHtml({
        id: SECTION_IDS.driver,
        term: "section.driver",
        title: "Driver",
        extra: `<span class="ls-section-meta">last ${passes.length} ${passes.length === 1 ? "pass" : "passes"}</span>`,
        body,
    });
}

/**
 * Queue: five stat boxes. `queueDepth` is `null` (with a sibling
 * `queueDepthError`) when the underlying `gh` read failed — rendered as an
 * explicit UNAVAILABLE note, never as a row of zeros, which is
 * indistinguishable from a healthy read that genuinely found nothing.
 */
function queueSectionHtml(data) {
    const qd = data.queueDepth;
    const body =
        data.queueDepthError != null
            ? unavailableHtml(
                  data.queueDepthError,
                  'cannot tell how deep the queue is — not the same as "queue empty"'
              )
            : statsHtml([
                  {
                      term: "queue.total",
                      label: "total waiting",
                      value: String(qd.total),
                  },
                  {
                      term: "queue.P0",
                      label: "P0",
                      value: String(qd.P0),
                      tone: qd.P0 > 0 ? "bad" : "",
                  },
                  {
                      term: "queue.P1",
                      label: "P1",
                      value: String(qd.P1),
                      tone: qd.P1 > 0 ? "warn" : "",
                  },
                  { term: "queue.P2", label: "P2", value: String(qd.P2) },
                  {
                      term: "queue.unprioritized",
                      label: "no priority",
                      value: String(qd.unprioritized),
                  },
              ]);
    return sectionHtml({
        id: SECTION_IDS.queue,
        term: "section.queue",
        title: "Queue",
        body,
    });
}

const plural = (n, one, many) => (n === 1 ? one : many);

/** Role → the stat box it renders as. `missing` is the receipt guard's own
 *  marker role (`MissingReceipt`, lib/receipt.ts) and is spelled out as
 *  "missing session markers" — the literal "missing missing: 389" is the bug
 *  this wording replaced (#2632). */
const ROLE_ORDER = ["implement", "review", "fixup", "missing"];

export function receiptStats(summary) {
    const byRole = new Map();
    for (const c of summary.counts) {
        byRole.set(c.role, (byRole.get(c.role) ?? 0) + c.count);
    }
    const roles = [...byRole.keys()].sort((a, b) => {
        const ai = ROLE_ORDER.indexOf(a);
        const bi = ROLE_ORDER.indexOf(b);
        return (
            (ai === -1 ? ROLE_ORDER.length : ai) -
            (bi === -1 ? ROLE_ORDER.length : bi)
        );
    });
    const stats = [
        {
            term: "receipts.total",
            label: plural(summary.total, "receipt", "receipts"),
            value: String(summary.total),
        },
    ];
    for (const role of roles) {
        const count = byRole.get(role);
        stats.push(
            role === "missing"
                ? {
                      term: "receipts.missing",
                      label: `missing session ${plural(count, "marker", "markers")}`,
                      value: String(count),
                  }
                : { term: `role.${role}`, label: role, value: String(count) }
        );
    }
    const attention = (summary.interesting ?? []).length;
    stats.push({
        term: "receipts.attention",
        label: "needing attention",
        value: String(attention),
        tone: attention > 0 ? "warn" : "good",
    });
    return stats;
}

const INTERESTING_COLUMNS = [
    { term: "issue", label: "issue" },
    { term: "role", label: "role" },
    { term: "state", label: "outcome" },
    { term: "prs", label: "PR" },
];

/**
 * Receipts render from `receiptsSummary`, not a raw list (PR #2545 review,
 * finding 3) — a live batch measured 232 receipts, almost all `missing
 * session=…` markers, which blew this panel to 3000-8000px tall on a phone.
 * The aggregate is a row of stat boxes (`receiptStats`); only
 * `wip`/`failed`/`blocking`/`collision` rows print individually, capped
 * server-side.
 *
 * The batch heading is `Batch #N · started HH:MM` (#2632 AC) — `#N` is
 * `summary.total` reused as a memorable stand-in for a real sequence number
 * (this project keeps no such counter, only a UUID directory name and an
 * mtime), and the UUID itself sits behind a native `title` tooltip on the
 * copy button (`.ls-copy`/`copyCommand`, `now-nav.js`).
 */
function batchSectionHtml(data) {
    const summary = data.receiptsSummary ?? {
        total: 0,
        counts: [],
        interesting: [],
    };
    if (data.batch == null) {
        return sectionHtml({
            id: SECTION_IDS.batch,
            term: "section.batch",
            title: "Batch",
            body: emptyHtml("No batch has recorded receipts yet."),
        });
    }
    const interestingRows = summary.interesting.map((r) =>
        r.role === "missing"
            ? [
                  `<span class="mini">missing · session ${esc(r.session)}</span>`,
                  badgeHtml("missing", "neutral"),
                  `<span class="mini">—</span>`,
                  `<span class="mini">—</span>`,
              ]
            : [
                  issueLink(r.issue),
                  badgeHtml(r.role, "neutral", `role.${r.role}`),
                  badgeHtml(
                      r.outcome,
                      r.outcome === "failed" || r.outcome === "blocking"
                          ? "bad"
                          : "warn"
                  ),
                  r.pr
                      ? `PR #${esc(String(r.pr))}`
                      : `<span class="mini">—</span>`,
              ]
    );
    const started = fmtClock(data.batchStartedAt);
    const title = `Batch #${summary.total}`;
    const meta =
        (started
            ? `<span class="ls-section-meta">started ${esc(started)}</span>`
            : "") +
        `<button type="button" class="ls-copy" data-copy="${esc(data.batch)}" ` +
        `aria-label="Copy batch id ${esc(data.batch)}" title="${esc(data.batch)}">copy id</button>`;
    return sectionHtml({
        id: SECTION_IDS.batch,
        term: "section.batch",
        title,
        extra: meta,
        body:
            statsHtml(receiptStats(summary)) +
            (interestingRows.length
                ? tableHtml(INTERESTING_COLUMNS, interestingRows, {
                      cls: "ls-batch-table",
                  })
                : ""),
    });
}

/**
 * The claims table owns its own markup (`now-claims-table.js`); the section
 * WRAPPER lives here, with the other three, so that `SECTION_IDS` has exactly
 * one consumer on the emitting side. Importing it into the claims module
 * instead would close an import cycle (`now-lights.js` already reads
 * `claimsHeaderCount` from there).
 */
function claimsSectionWrapperHtml(data, nowMs) {
    return claimsSectionHtml(data, SECTION_IDS.claims, nowMs);
}

/**
 * The whole Now body: band, lights, timeline, activity, then the sections
 * the lights target (PRD #2621 D2: "verdict, then lights, then timeline...
 * followed by the claims table and the batch summary"). `nowMs` threads down
 * to the sub-renderers whose output depends on the clock — a default keeps
 * every other call site (and every existing test) unchanged.
 */
export function nowBodyHtml(data, nowMs = Date.now()) {
    return (
        verdictBandHtml(data.verdict) +
        lightsHtml(data) +
        timelineSectionHtml(data, nowMs) +
        activitySectionHtml(data, nowMs) +
        `<div class="ls-grid">` +
        driverSectionHtml(data) +
        queueSectionHtml(data) +
        batchSectionHtml(data) +
        `</div>` +
        claimsSectionWrapperHtml(data, nowMs) +
        liveSectionHtml(data, nowMs)
    );
}
