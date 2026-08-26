import { esc, fmtClock, issueLink } from "./format.js";
import { verdictBandHtml } from "./now-verdict-band.js";
import { lightsHtml, SECTION_IDS } from "./now-lights.js";
import { claimsSectionHtml } from "./now-claims-table.js";
import { timelineSectionHtml } from "./now-timeline.js";

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

function driverSectionHtml(data) {
    const d = data.driver ?? {};
    const passes = d.recentPasses ?? [];
    const body = passes.length
        ? passes
              .map(
                  (p) =>
                      `<div class="ls-pass">pass ${p.pass} · exit ${p.claudeExit} · pct ${esc(p.pct)} · queue ${p.queueBefore}→${p.queueAfter} · ${esc(p.reason)}</div>`
              )
              .join("")
        : `<div class="ls-empty">no passes recorded</div>`;
    return `<div id="${SECTION_IDS.driver}" class="ls-section"><b>Driver</b>${body}</div>`;
}

/**
 * `queueDepth` is `null` (with a sibling `queueDepthError`) when the
 * underlying `gh` read failed — rendered as an explicit UNAVAILABLE banner,
 * never as a zeroed section, which is indistinguishable from a healthy read
 * that genuinely found nothing.
 */
function queueSectionHtml(data) {
    const qd = data.queueDepth;
    const body =
        data.queueDepthError != null
            ? `<div class="ls-unavailable">⚠ ${esc(data.queueDepthError)}<br>cannot tell how deep the queue is — not the same as "queue empty"</div>`
            : `<div class="ls-driver">P0 <b>${qd.P0}</b> · P1 <b>${qd.P1}</b> · P2 <b>${qd.P2}</b> · ` +
              `unprioritized <b>${qd.unprioritized}</b> · total <b>${qd.total}</b></div>`;
    return `<div id="${SECTION_IDS.queue}" class="ls-section"><b>Queue depth</b>${body}</div>`;
}

const plural = (n, one, many) => (n === 1 ? one : many);

/** `role` → the role-level total's noun, restated as a sentence fragment
 *  (#2632 AC: "389 receipts · 4 implement, 2 review, 383 missing session
 *  markers" replaces "missing missing: 389"). Roles that never appear in a
 *  batch's `counts` simply contribute no fragment — this is a naming table,
 *  not a completeness list. */
const ROLE_ORDER = ["implement", "review", "fixup", "missing"];

/**
 * `receiptsSummary.counts` (per (role, outcome) bucket) reduced to ONE
 * sentence, role-level (#2632 AC) — the per-OUTCOME breakdown a reader might
 * want for `wip`/`failed`/`blocking`/`collision` is already the
 * `interesting` rows rendered individually below; repeating it here would
 * restate the same numbers twice. `missing` is spelled out as "missing
 * session markers" (its own role/outcome pair is always `missing`/`missing`
 * — `MissingReceipt`, `lib/receipt.ts` — which is exactly the literal bug
 * this replaces: "missing missing: 389").
 */
function receiptSentence(summary) {
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
    const parts = roles.map((role) => {
        const count = byRole.get(role);
        // NOT `esc(role)` here — the caller (`batchSectionHtml`) `esc()`s
        // this whole sentence already; escaping twice is harmless only
        // because a role is a fixed enum with no HTML-special characters,
        // but it is still double work on every render (#2632 review finding
        // 8).
        return role === "missing"
            ? `${count} missing session ${plural(count, "marker", "markers")}`
            : `${count} ${role}`;
    });
    return (
        `${summary.total} ${plural(summary.total, "receipt", "receipts")}` +
        (parts.length ? ` · ${parts.join(", ")}` : "")
    );
}

/**
 * Receipts render from `receiptsSummary`, not a raw list (PR #2545 review,
 * finding 3) — a live batch measured 232 receipts, almost all `missing
 * session=…` markers, which blew this panel to 3000-8000px tall on a phone
 * (it is deliberately the FIRST card, so that pushed the rest of the
 * dashboard ~8 screens below the fold). The aggregate renders as ONE
 * sentence (`receiptSentence`, above); only `wip`/`failed`/`blocking`/
 * `collision` rows print individually, capped server-side.
 *
 * The batch heading is `Batch #N · started HH:MM` (#2632 AC) — `#N` is
 * `summary.total` reused as a memorable stand-in for a real sequence number
 * (this project keeps no such counter, only a UUID directory name and an
 * mtime), and the UUID itself moves behind a native `title` tooltip on the
 * copy button, which already exists and is already wired
 * (`.ls-copy`/`copyCommand`, `now-nav.js` — nothing new to bind).
 */
function batchSectionHtml(data) {
    const summary = data.receiptsSummary ?? {
        total: 0,
        counts: [],
        interesting: [],
    };
    const interestingHtml = summary.interesting
        .map((r) =>
            r.role === "missing"
                ? `<div class="ls-pass">missing · session ${esc(r.session)}</div>`
                : `<div class="ls-pass">${issueLink(r.issue)} · ${esc(r.role)} · ${esc(r.outcome)}${r.pr ? ` · PR #${r.pr}` : ""}</div>`
        )
        .join("");
    if (data.batch == null) {
        return (
            `<div id="${SECTION_IDS.batch}" class="ls-section">` +
            `<b>Batch</b><div class="ls-empty">No batch has recorded receipts yet.</div>` +
            `</div>`
        );
    }
    const started = fmtClock(data.batchStartedAt);
    const heading =
        `Batch #${summary.total}` +
        (started ? ` · started ${esc(started)}` : "");
    const copyBtn =
        `<button type="button" class="ls-copy" data-copy="${esc(data.batch)}" ` +
        `aria-label="Copy batch id ${esc(data.batch)}" title="${esc(data.batch)}">copy id</button>`;
    return (
        `<div id="${SECTION_IDS.batch}" class="ls-section">` +
        `<b>${heading}</b> ${copyBtn}` +
        `<div class="ls-driver">${esc(receiptSentence(summary))}</div>` +
        interestingHtml +
        `</div>`
    );
}

/**
 * The claims table owns its own markup (`now-claims-table.js`); the section
 * WRAPPER lives here, with the other three, so that `SECTION_IDS` has exactly
 * one consumer on the emitting side. Importing it into the claims module
 * instead would close an import cycle (`now-lights.js` already reads
 * `claimsHeaderCount` from there).
 */
function claimsSectionWrapperHtml(data) {
    return `<div id="${SECTION_IDS.claims}" class="ls-section">${claimsSectionHtml(data)}</div>`;
}

/**
 * The whole Now body: band, lights, timeline, then the sections the lights
 * target (PRD #2621 D2: "verdict, then lights, then timeline... followed by
 * the claims table and the batch summary"). `nowMs` threads down to
 * `timelineSectionHtml`, the one sub-renderer whose output depends on the
 * clock rather than on `data` alone — a default keeps every other call site
 * (and every existing test) unchanged.
 */
export function nowBodyHtml(data, nowMs = Date.now()) {
    return (
        verdictBandHtml(data.verdict) +
        lightsHtml(data) +
        timelineSectionHtml(data, nowMs) +
        `<div class="ls-grid">` +
        driverSectionHtml(data) +
        queueSectionHtml(data) +
        batchSectionHtml(data) +
        `</div>` +
        claimsSectionWrapperHtml(data)
    );
}
