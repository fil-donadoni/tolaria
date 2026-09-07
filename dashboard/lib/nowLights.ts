import type { Tone } from "./tones";
import { plural } from "./format";
import type { NowPayload } from "./nowPayload";

/**
 * The four traffic lights of the Now view (PRD #3148 S2), ported from
 * `scripts/dashboard/now-lights.js` (#2630) with its derivation intact.
 *
 * ── THE LINE THIS MODULE MUST NOT CROSS ───────────────────────────────────
 *
 * `deriveLoopVerdict` (`scripts/lib/loop-status.ts`) is the single authority
 * on whether the LOOP is healthy, and it returns ONE `LoopVerdict` — not
 * per-subsystem states, so the four tones below cannot come from it. They are
 * derived here, from the same raw fields the CLI's own section renderers
 * branch on (`renderDriverLines`, `renderClaimsLines`, `renderQueueDepthLines`,
 * `renderReceiptsLines`).
 *
 * That is not a second verdict:
 *
 *   * A light states a fact about ITS OWN subsystem ("no driver process is
 *     recorded", "the queue read failed"). It never aggregates, never ranks
 *     one subsystem against another, and never answers "is the loop healthy".
 *   * The band above answers that, once, from the engine.
 *
 * So a light can never CONTRADICT `verdict.state`: the two are not making the
 * same claim. The guard that keeps it that way is mechanical — no light's word
 * may be a member of `LOOP_VERDICT_STATES`
 * (`scripts/__tests__/loop-status-dashboard.test.ts`). A light reading
 * `STALLED` would be a health verdict wearing a subsystem's clothes.
 *
 * ── UNAVAILABLE IS NOT EMPTY ──────────────────────────────────────────────
 *
 * `claims` / `queueDepth` are `null` with a sibling `*Error` when the
 * underlying `gh` read FAILED. Those get the `unknown` tone and the word
 * `UNAVAILABLE` — never `0` and never `good`. At 0/5000 GraphQL quota this
 * panel once rendered "no claimed issues", i.e. an idle drained loop, at the
 * exact moment GitHub was unreachable.
 *
 * Pure — the payload in, plain data out — so a test can CALL it.
 */

/** The ids of the detail sections a light scrolls to. `NowView` renders them
 *  from this same map, so a light can never point at an id nothing renders. */
export const SECTION_IDS = {
    driver: "ls-section-driver",
    queue: "ls-section-queue",
    claims: "ls-section-claims",
    batch: "ls-section-batch",
} as const;

export type LightId = keyof typeof SECTION_IDS;

/**
 * Every tone a light can take, with the NON-COLOUR carrier that ships beside
 * it. Colour is never the only carrier (#2630 AC): each light renders its
 * state as a WORD, and this glyph gives a third, shape-based channel for a
 * reader who sees neither hue nor prose weight.
 */
export const LIGHT_GLYPHS: Record<string, string> = {
    good: "●",
    warn: "▲",
    bad: "■",
    /** "I could not tell" — a failed read, distinct from both good and bad. */
    unknown: "?",
};

export const lightGlyph = (tone: Tone): string =>
    LIGHT_GLYPHS[tone] ?? LIGHT_GLYPHS.unknown;

export interface Light {
    id: LightId;
    label: string;
    target: string;
    tone: Tone;
    word: string;
    number: number | string;
    numberLabel: string;
    prose: string;
    /** A native `title` — today only the Batch light's full uuid. */
    title?: string;
}

/**
 * Driver. Mirrors `renderDriverLines`'s branches (armed / pid / pidAlive /
 * stop-file).
 *
 * `DriverState` has NO error sibling — it is read from the local filesystem,
 * never through `gh`, so it has no failure mode and therefore no `unknown`
 * tone. Inventing one would be a state the data can never reach.
 *
 * `NO DRIVER` is `warn`, not `bad`: no pid file is the ordinary state of a
 * loop nobody has started. A pid file whose process is gone is `bad` — that
 * one is a fault whatever else is true.
 *
 * The words are `ALIVE`/`DEAD`, not `RUNNING`/`NOT RUNNING`, deliberately:
 * `RUNNING` is a `LOOP_VERDICT_STATES` member, and a light must never wear a
 * verdict's word. These describe a PROCESS, which is all this light knows.
 */
export function driverLight(data: NowPayload): Light {
    const d = data.driver ?? ({} as NowPayload["driver"]);
    const passes = (d.recentPasses ?? []).length;
    const base = {
        id: "driver" as const,
        label: "Driver",
        number: passes,
        numberLabel: plural(passes, "recent pass", "recent passes"),
        target: SECTION_IDS.driver,
    };
    if (d.stopFilePresent) {
        return {
            ...base,
            tone: "warn",
            word: "STOP-FILE",
            prose: "A stop-file is present — nothing will start until it is removed.",
        };
    }
    if (d.pid === null || d.pid === undefined) {
        return {
            ...base,
            tone: "warn",
            word: "NO DRIVER",
            prose: `No pid file — no driver process is recorded, and the end-of-pass handoff ${d.armed ? "is armed" : "is not armed"}.`,
        };
    }
    if (!d.pidAlive) {
        return {
            ...base,
            tone: "bad",
            word: "DEAD",
            prose: `Stale pid file — pid ${d.pid} is not running.`,
        };
    }
    return {
        ...base,
        tone: "good",
        word: "ALIVE",
        prose: `Running as pid ${d.pid}; the end-of-pass handoff ${d.armed ? "will fire" : "will NOT fire"}.`,
    };
}

/**
 * Queue. Mirrors `renderQueueDepthLines`.
 *
 * The only thing that can be wrong with the QUEUE as a subsystem is that it
 * could not be read — a deep queue is work, not a fault, and calling it one
 * here would be re-deriving `STALLED`, which the engine already owns.
 */
export function queueLight(data: NowPayload): Light {
    const base = {
        id: "queue" as const,
        label: "Queue",
        target: SECTION_IDS.queue,
    };
    if (data.queueDepthError != null) {
        return {
            ...base,
            tone: "unknown",
            word: "UNAVAILABLE",
            number: "—",
            numberLabel: "not knowable",
            prose: `${data.queueDepthError} — cannot tell how deep the queue is, which is not the same as "queue empty".`,
        };
    }
    const qd = data.queueDepth ?? {
        P0: 0,
        P1: 0,
        P2: 0,
        unprioritized: 0,
        total: 0,
    };
    return {
        ...base,
        tone: "good",
        word: qd.total === 0 ? "EMPTY" : "WAITING",
        number: qd.total,
        numberLabel: plural(qd.total, "issue waiting", "issues waiting"),
        prose:
            qd.total === 0
                ? "Nothing is waiting — no unclaimed ready-for-agent issues."
                : `P0 ${qd.P0} · P1 ${qd.P1} · P2 ${qd.P2} · unprioritized ${qd.unprioritized}, waiting to be claimed.`,
    };
}

/** `claims.length`, or the word that says the count is not knowable. */
export const claimsHeaderCount = (data: NowPayload): number | "UNAVAILABLE" =>
    data.claims === null ? "UNAVAILABLE" : data.claims.length;

/**
 * Claims. Mirrors `renderClaimsLines`, and COUNTS `ClaimRow.verdict` —
 * `classifyClaim` (`loop-doctor.ts`) is the sole authority on
 * live/suspect/orphan and no second age threshold is introduced here.
 */
export function claimsLight(data: NowPayload): Light {
    const base = {
        id: "claims" as const,
        label: "Claims",
        target: SECTION_IDS.claims,
    };
    const count = claimsHeaderCount(data);
    if (count === "UNAVAILABLE" || data.claimsError != null) {
        return {
            ...base,
            tone: "unknown",
            word: "UNAVAILABLE",
            number: "—",
            numberLabel: "not knowable",
            prose: `${data.claimsError ?? "the claims read failed"} — cannot tell whether anything is claimed, which is not the same as "no claimed issues".`,
        };
    }
    const claims = data.claims ?? [];
    const orphans = claims.filter((c) => c.verdict?.state === "orphan").length;
    const suspects = claims.filter(
        (c) => c.verdict?.state === "suspect"
    ).length;
    const numbered = {
        ...base,
        number: count,
        numberLabel: plural(count, "issue claimed", "issues claimed"),
    };
    if (orphans > 0) {
        return {
            ...numbered,
            tone: "bad",
            word: "ORPHANED",
            prose: `${orphans} of ${claims.length} claimed ${plural(claims.length, "issue is", "issues are")} orphaned — nothing in the loop will release ${plural(orphans, "it", "them")}.`,
        };
    }
    if (suspects > 0) {
        return {
            ...numbered,
            tone: "warn",
            word: "UNSURE",
            prose: `${suspects} of ${claims.length} claimed ${plural(claims.length, "issue is", "issues are")} too young to judge — no branch and no PR yet.`,
        };
    }
    return {
        ...numbered,
        tone: "good",
        word: claims.length === 0 ? "NONE HELD" : "WORKING",
        prose:
            claims.length === 0
                ? "Nothing is claimed right now."
                : `${claims.length} claimed ${plural(claims.length, "issue is", "issues are")} being worked, all with a branch or a PR.`,
    };
}

/**
 * Batch. Mirrors `renderReceiptsLines`.
 *
 * `receiptErrors` is a PARTIAL read failure — receipt files that could not be
 * parsed — so the total may be short. That is an "I could not tell" fact, not
 * a "nothing there" one, and it takes the `unknown` tone for the same reason a
 * failed `gh` read does.
 */
export function batchLight(data: NowPayload): Light {
    const summary = data.receiptsSummary ?? {
        total: 0,
        counts: [],
        interesting: [],
    };
    const errors = (data.receiptErrors ?? []).length;
    const short = data.batch ? String(data.batch).slice(0, 8) : null;
    const base = {
        id: "batch" as const,
        label: "Batch",
        number: summary.total,
        numberLabel: plural(summary.total, "receipt", "receipts"),
        target: SECTION_IDS.batch,
        title: data.batch ?? undefined,
    };
    if (errors > 0) {
        return {
            ...base,
            tone: "unknown",
            word: "PARTIAL",
            prose: `${errors} receipt ${plural(errors, "file", "files")} could not be read — this count may be short of the truth.`,
        };
    }
    const attention = (summary.interesting ?? []).length;
    if (attention > 0) {
        return {
            ...base,
            tone: "warn",
            word: "ATTENTION",
            prose: `${attention} ${plural(attention, "receipt", "receipts")} in batch ${short} ${plural(attention, "is", "are")} wip, failed, blocking or a collision.`,
        };
    }
    if (short === null) {
        return {
            ...base,
            tone: "good",
            word: "NONE",
            prose: "No batch has recorded receipts yet.",
        };
    }
    return {
        ...base,
        tone: "good",
        word: "CLEAN",
        prose: `Batch ${short}: ${summary.total} ${plural(summary.total, "receipt", "receipts")}, none needing attention.`,
    };
}

/** The four lights, in reading order. */
export const nowLights = (data: NowPayload): Light[] => [
    driverLight(data),
    queueLight(data),
    claimsLight(data),
    batchLight(data),
];

/**
 * The card subtitle keeps the RAW driver facts; the verdict band below states
 * what they MEAN. Before #2624 this line was the only health signal on the
 * page, and it rendered the eight-hour outage of 2026-08-19 as `armed · no
 * driver pid · no stop-file` — three equal grey clauses, no cause, no remedy.
 */
export function nowSubtitleText(data: NowPayload): string {
    const d = data.driver ?? ({} as NowPayload["driver"]);
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
