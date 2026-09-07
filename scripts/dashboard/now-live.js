import { esc, fmtAgoMs, fmtTokens, issueLink } from "./format.js";
import {
    sectionHtml,
    tableHtml,
    badgeHtml,
    emptyHtml,
    unavailableHtml,
} from "./now-atoms.js";

/**
 * The Now view's live-sessions section (issue #3135) — every Claude Code
 * session of this project whose transcript was written to in the last 30
 * minutes, with a Watch button that opens it in the tail drawer
 * (`now-tail.js`).
 *
 * WHY. The verdict band can read STALLED while three conversations started
 * by hand are mid-flight: the driver is not running, so as far as the loop
 * knows nothing is moving — but the operator's own sessions are exactly the
 * work that IS moving, and until #3135 nothing on the page showed them. The
 * data is `/api/live` (`lib/live-activity.ts`): transcripts, never the
 * store, so this section stands whether or not `telemetry.db` exists.
 *
 * PURE, like the rest of the Now renderers; the drawer it opens is the one
 * impure Now module besides the transport.
 */

/** Tone + glossary term per liveness word the server sends. */
const LIVENESS = {
    active: { tone: "good", term: "live.active", word: "active" },
    live: { tone: "warn", term: "live.live", word: "recent" },
    idle: { tone: "neutral", term: "live.idle", word: "idle" },
};

export function livenessBadgeHtml(liveness) {
    const l = LIVENESS[liveness] ?? LIVENESS.idle;
    return badgeHtml(l.word, l.tone, l.term);
}

/** A session's display name: its title, else its first prompt, else its id. */
export function sessionLabel(s) {
    const raw = s.title || s.lastPrompt || s.session;
    const oneLine = String(raw).replace(/\s+/g, " ").trim();
    return oneLine.length > 72 ? `${oneLine.slice(0, 72)}…` : oneLine;
}

/**
 * The Watch button. `data-session` is what the drawer opens; `data-label`
 * is the heading it shows; `data-issue` (optional) links the drawer back to
 * the issue the row is about. Keyed by session for the focus-preserving
 * poll write (`nowControlKey`, now-loop-status.js).
 */
export function watchButtonHtml(session, label, issue = null) {
    return (
        `<button type="button" class="ls-watch" data-session="${esc(session)}" ` +
        `data-label="${esc(label)}"` +
        (issue ? ` data-issue="${esc(String(issue))}"` : "") +
        ` data-term="live.watch" aria-label="Watch ${esc(label)}">Watch</button>`
    );
}

function issuesCellHtml(s) {
    const top = s.topIssues ?? [];
    if (!top.length) return `<span class="mini">—</span>`;
    return top.map((t) => issueLink(t.issue)).join(" ");
}

function rowHtml(s, nowMs) {
    const label = sessionLabel(s);
    return [
        livenessBadgeHtml(s.liveness),
        `<span class="ls-live-title" title="${esc(s.session)}">${esc(label)}</span>`,
        s.gitBranch
            ? `<code class="ls-cmd">${esc(s.gitBranch)}</code>`
            : `<span class="mini">—</span>`,
        esc(fmtAgoMs(s.lastWriteMs, nowMs)),
        esc(fmtTokens(s.outTok)),
        s.subagents ? esc(String(s.subagents)) : `<span class="mini">—</span>`,
        issuesCellHtml(s),
        watchButtonHtml(s.session, label, s.topIssues?.[0]?.issue ?? null),
    ];
}

export const LIVE_SECTION_ID = "ls-section-live";

export const LIVE_COLUMNS = [
    { term: "live.active", label: "status" },
    { term: "live.session", label: "session" },
    { term: "live.branch", label: "branch" },
    { term: "live.last", label: "last activity" },
    { term: "live.tokens", label: "output tokens", align: "right" },
    { term: "live.subagents", label: "subagents", align: "right" },
    { term: "claim.session", label: "issues named" },
    { term: "live.watch", label: "" },
];

export function liveSectionHtml(data, nowMs = Date.now()) {
    const live = data.live;
    let body;
    if (data.liveError != null) {
        body = unavailableHtml(
            data.liveError,
            "cannot tell which sessions are running — not the same as none"
        );
    } else {
        const sessions = live?.sessions ?? [];
        body = sessions.length
            ? tableHtml(
                  LIVE_COLUMNS,
                  sessions.map((s) => rowHtml(s, nowMs)),
                  { cls: "ls-live-table" }
              )
            : emptyHtml(
                  `No session has written to its transcript in the last ${live?.liveMinutes ?? 30} minutes.`
              );
    }
    const count = data.liveError == null ? (live?.sessions ?? []).length : null;
    return sectionHtml({
        id: LIVE_SECTION_ID,
        term: "section.live",
        title: "Live sessions",
        extra:
            count === null
                ? ""
                : `<span class="ls-section-meta">${count} in the last ${live?.liveMinutes ?? 30} min</span>`,
        body,
    });
}
