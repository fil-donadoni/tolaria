// How the Bot's own searches went in one vs-Bot game, reported ONCE, somewhere
// a maintainer can read it (issue #9526).
//
// The Brain runs on the player's device, at a budget of iterations capped by
// wall-clock time. Every measurement of that budget was taken on a development
// machine; nothing said how much of it a real decision completes on a phone,
// a small laptop or another browser engine. A Bot cut short by the clock does
// not fail — it plays worse, and nothing on screen or in a bug report says so.
//
// The vs-Bot driver folds every Brain consult into a per-game accumulator
// (`openBotSearchReport`) and flushes it when the game ends or is left,
// whichever comes first: one structured log per game, never one per consult.
// A game with no consult reports nothing. A consult still in flight when the
// report is flushed is not in it, and a game whose tab is closed mid-play
// loses its report; both are accepted.
//
// WHAT TRAVELS, and the boundary it must keep. This report is NOT consented:
// it leaves the device without the bug-report consent gate
// (`components/bug-report/`), which is what protects the user agent, the hand,
// the decklist and the client diagnostics blob. So it carries counters and
// durations only, the game id, the difficulty preset, and a COARSE device
// class: the browser ENGINE family (three values), a core-count BUCKET and a
// mobile flag. The user-agent string is read here to derive the family and is
// never sent. No player, no card, no board state. `REPORT_KEYS` is the
// allowlist; a test reds on a key outside it.
//
// Monitoring is best-effort: a throwing sink never reaches the driver.

import * as Sentry from "@sentry/react";
import type { DecisionTrace } from "@convex/gre";
import type { BrainOutcome } from "./brain-request";

/** The search's own account of one decision — the four `DecisionTrace` fields
 *  this report reads. Absent when the consult produced no trace (a failed
 *  consult, or a window with no real decision to search). */
export type SearchStats = {
    iterationsRequested: number;
    iterationsCompleted: number;
    elapsedMs: number;
    stoppedBy: DecisionTrace["stoppedBy"];
};

/** One Brain consult, as the driver saw it end. */
export type ConsultSample = {
    outcome: BrainOutcome;
    via: "worker" | "inline";
    /** Wall-clock time from posting the consult to its verdict: the search
     *  plus whatever stood before it (Worker start, shard install, a queue). */
    consultMs: number;
    /** The difficulty preset the consult's budget came from. */
    difficulty: string;
    search?: SearchStats;
};

/** The coarse device class — see the module header for why it is this coarse. */
export type DeviceClass = {
    engine: "chromium" | "gecko" | "webkit" | "other";
    cores: "1-2" | "3-4" | "5-8" | "9+" | "unknown";
    mobile: boolean;
};

/** Every attribute a report may carry. Flat primitives: the shape a structured
 *  log's attributes accept. */
export const REPORT_KEYS = [
    "gameId",
    "difficulty",
    "consults",
    "consults.move",
    "consults.no-move",
    "consults.timeout",
    "consults.worker-error",
    "consults.search-error",
    "consults.inline",
    "searches",
    "iterations.requested",
    "iterations.completed",
    "iterations.ratio",
    "stopped.iterations",
    "stopped.time",
    "stopped.settled",
    "searchMs.p50",
    "searchMs.p90",
    "searchMs.max",
    "consultMs.p50",
    "consultMs.p90",
    "consultMs.max",
    "msPerIteration.p50",
    "msPerIteration.p90",
    "device.engine",
    "device.cores",
    "device.mobile",
] as const;

export type BotSearchReportKey = (typeof REPORT_KEYS)[number];
export type BotSearchReport = Partial<
    Record<BotSearchReportKey, string | number | boolean>
>;

/** Where a report goes. An object, so a test observes the routing by spying on
 *  it instead of mocking a module. */
export const botSearchSink = {
    log(report: BotSearchReport): void {
        Sentry.logger.info("bot search", report);
    },
};

/** A monotonic clock that exists wherever this module is imported. */
export function telemetryNow(): number {
    return typeof performance === "undefined" ? Date.now() : performance.now();
}

const finite = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value);

const maxOf = (values: readonly number[]): number =>
    values.reduce((max, value) => (value > max ? value : max), -Infinity);

/** The `p`-th percentile of `values` by nearest rank (`p` in 0..100), or
 *  `undefined` for no values. One value is every percentile of itself. */
export function percentile(
    values: readonly number[],
    p: number
): number | undefined {
    if (values.length === 0) return undefined;
    const sorted = [...values].sort((a, b) => a - b);
    const rank = Math.ceil((p / 100) * sorted.length);
    return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

const round = (value: number, digits = 0): number => {
    const scale = 10 ** digits;
    return Math.round(value * scale) / scale;
};

/** The browser engine family behind a user-agent string. Every browser on iOS
 *  is WebKit whatever its name says, so those are matched first. */
export function engineFamily(userAgent: string): DeviceClass["engine"] {
    if (/(CriOS|FxiOS|EdgiOS)\//.test(userAgent)) return "webkit";
    if (/Firefox\//.test(userAgent)) return "gecko";
    if (/(Chrome|Chromium)\//.test(userAgent)) return "chromium";
    if (/AppleWebKit\//.test(userAgent)) return "webkit";
    return "other";
}

/** The bucket a logical-core count falls in. */
export function coresBucket(cores: number | undefined): DeviceClass["cores"] {
    if (cores === undefined || !Number.isFinite(cores) || cores < 1) {
        return "unknown";
    }
    if (cores <= 2) return "1-2";
    if (cores <= 4) return "3-4";
    if (cores <= 8) return "5-8";
    return "9+";
}

type NavigatorLike = {
    userAgent?: string;
    hardwareConcurrency?: number;
    userAgentData?: { mobile?: boolean };
};

/** This device's coarse class. Reads the navigator; returns only the class. */
export function deviceClass(
    nav: NavigatorLike | undefined = typeof navigator === "undefined"
        ? undefined
        : (navigator as NavigatorLike)
): DeviceClass {
    const userAgent = nav?.userAgent ?? "";
    return {
        engine: engineFamily(userAgent),
        cores: coresBucket(nav?.hardwareConcurrency),
        mobile:
            nav?.userAgentData?.mobile ??
            /Mobi|Android|iPhone|iPad|iPod/.test(userAgent),
    };
}

/** Keep only the attributes the allowlist names. The counters below are keyed
 *  by the consult's outcome and the search's stop reason; a value added to
 *  either union — or a malformed trace — must not become an attribute nobody
 *  reviewed, so the boundary is enforced HERE, at runtime, and not only by the
 *  test that pins the list. */
function onlyAllowed(
    raw: Record<string, string | number | boolean>
): BotSearchReport {
    const report: BotSearchReport = {};
    for (const key of REPORT_KEYS) {
        if (key in raw) report[key] = raw[key];
    }
    return report;
}

/** A search's numbers, when every one of them is a usable measurement. */
function usableSearch(search: SearchStats | undefined): SearchStats | null {
    if (!search) return null;
    return finite(search.iterationsRequested) &&
        finite(search.iterationsCompleted) &&
        finite(search.elapsedMs)
        ? search
        : null;
}

/** Fold a game's consults into its report. Pure. A statistic with no sample
 *  behind it is LEFT OUT rather than reported as zero: "no search had a trace"
 *  and "every search took 0 ms" must not read the same. A number that is not
 *  finite is no sample. */
export function summarizeBotSearch(
    gameId: string,
    samples: readonly ConsultSample[],
    device: DeviceClass
): BotSearchReport {
    const difficulties = new Set(samples.map((s) => s.difficulty));
    const raw: Record<string, string | number | boolean> = {
        gameId,
        difficulty: difficulties.size === 1 ? [...difficulties][0]! : "mixed",
        consults: samples.length,
        "device.engine": device.engine,
        "device.cores": device.cores,
        "device.mobile": device.mobile,
    };
    const count = (key: string) => {
        raw[key] = ((raw[key] as number | undefined) ?? 0) + 1;
    };

    for (const sample of samples) {
        count(`consults.${sample.outcome}`);
        if (sample.via === "inline") count("consults.inline");
    }

    const consultMs = samples.map((s) => s.consultMs).filter(finite);
    if (consultMs.length > 0) {
        raw["consultMs.p50"] = round(percentile(consultMs, 50)!);
        raw["consultMs.p90"] = round(percentile(consultMs, 90)!);
        raw["consultMs.max"] = round(maxOf(consultMs));
    }

    const searches = samples.flatMap((s) => {
        const search = usableSearch(s.search);
        return search ? [search] : [];
    });
    raw.searches = searches.length;
    if (searches.length === 0) return onlyAllowed(raw);

    const requested = searches.reduce(
        (sum, s) => sum + s.iterationsRequested,
        0
    );
    const completed = searches.reduce(
        (sum, s) => sum + s.iterationsCompleted,
        0
    );
    raw["iterations.requested"] = requested;
    raw["iterations.completed"] = completed;
    if (requested > 0)
        raw["iterations.ratio"] = round(completed / requested, 3);

    for (const search of searches) count(`stopped.${search.stoppedBy}`);

    const searchMs = searches.map((s) => s.elapsedMs);
    raw["searchMs.p50"] = round(percentile(searchMs, 50)!);
    raw["searchMs.p90"] = round(percentile(searchMs, 90)!);
    raw["searchMs.max"] = round(maxOf(searchMs));

    const perIteration = searches
        .filter((s) => s.iterationsCompleted > 0)
        .map((s) => s.elapsedMs / s.iterationsCompleted);
    const p50 = percentile(perIteration, 50);
    const p90 = percentile(perIteration, 90);
    if (p50 !== undefined) raw["msPerIteration.p50"] = round(p50, 2);
    if (p90 !== undefined) raw["msPerIteration.p90"] = round(p90, 2);

    return onlyAllowed(raw);
}

/** One game's accumulator. Neither method ever throws. */
export type BotSearchRecorder = {
    /** Fold one consult in. A no-op once the report has been emitted. */
    record: (sample: ConsultSample) => void;
    /** Emit the game's report, once. With no consult recorded it emits
     *  nothing and stays open: a flush that came too early costs nothing. */
    flush: () => void;
};

/** Open the accumulator of one game's Bot searches. */
export function openBotSearchReport(gameId: string): BotSearchRecorder {
    const samples: ConsultSample[] = [];
    let emitted = false;
    return {
        record(sample) {
            if (!emitted) samples.push(sample);
        },
        flush() {
            if (emitted || samples.length === 0) return;
            emitted = true;
            try {
                botSearchSink.log(
                    summarizeBotSearch(gameId, samples, deviceClass())
                );
            } catch {
                // Monitoring never costs the game anything.
            }
        },
    };
}
