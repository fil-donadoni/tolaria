// How the Bot's own searches went in one vs-Bot game, reported ONCE, somewhere
// a maintainer can read it (issue #9526).
//
// The Brain runs on the player's device, at a budget of iterations capped by
// wall-clock time. Every measurement of that budget was taken on a development
// machine; nothing said how much of it a real decision completes on a phone,
// a small laptop or another browser engine. A Bot cut short by the clock does
// not fail — it plays worse, and nothing on screen or in a bug report says so.
//
// The vs-Bot driver folds every Brain consult into a per-game accumulator and
// flushes it ONCE (issue #10022): at game over, when the game is left, or when
// the page is hidden, whichever comes first — one structured log per game,
// never one per consult and never one per driver mount. The accumulator lives
// HERE, outside the driver (`acquireBotSearchReport`): a driver that unmounts
// and mounts again on the same game folds into the report it left open, so a
// remount no longer splits one game into several reports. A game with no
// consult reports nothing. A consult still in flight when the report is
// flushed is not in it, and neither is one that lands after a page-hide flush
// on a page the player came back to; both are accepted.
//
// WHAT TRAVELS, and the boundary it must keep. This report is NOT consented:
// it leaves the device without the bug-report consent gate
// (`components/bug-report/`), which is what protects the user agent, the hand,
// the decklist and the client diagnostics blob. So it carries counters and
// durations only, the game id, the difficulty preset, and a COARSE device
// class: the browser ENGINE family (three values), the OS FAMILY (five), a
// core-count BUCKET and a mobile flag. The user-agent string is read here to
// derive the families and is never sent. No player, no card, no board state. `REPORT_KEYS` is the
// allowlist; a test reds on a key outside it.
//
// WHAT A SLOW GAME WAS. Three readings say whether a slow search
// was a costly board or a slow machine, and how much time the Worker had to
// spare: the rollout policy's probes per iteration and the time per probe
// (`probesPerIteration.p50`, `msPerProbe.p50`: a probe is one candidate move
// the rollout cloned, applied and evaluated, where a late board's iteration
// spends 67–78% of its time), and the idle time between two consults
// (`idleMs.p50`). The time per probe divides a search's whole time by its
// probes, so it also carries the tree's own work and reads high on a search
// of few iterations. A median bounds the probe-heavy searches from one side
// only, so `probesPerIteration.p90` reads the game's tail: whether its
// searches reached late boards. `iterations.p10` (a search's fresh
// iterations) and `rootVisits.p10` (fresh plus kept: what the root held
// against the budget) read the low tail per search, where
// `iterations.completed` over `searches` is a mean. They are counters and
// durations like the rest. The owner consented on 2026-11-22 to telemetry
// keys of this kind being added without asking per key; the boundary above
// is unchanged. Each consult also records a span of its own
// (`./bot-consult-span`), under the same boundary.
//
// WHAT THE MACHINE WAS WORTH. Every reading above moves with the board the
// game reached. The calibration reading does not: the Worker times units of
// the same fixed work on the same fixed board (`convex/gre/ai/calibration.ts`)
// after each of the game's first `CALIBRATION_WARMUP_READINGS` consults and
// then at most once every `CALIBRATION_INTERVAL_MS`. The report carries the
// first, the latest and the best, each beside the units it stands on, how
// many readings there were and how many were skipped (`calibration.first`,
// `.last`, `.min`, their `...Units`, `.count`, `.skipped`). They are
// milliseconds per UNIT — a board built and one iteration searched with its
// root read — and so not comparable with a consult's `msPerIteration`. The
// first readings run colder — the browser has not compiled the calibration's
// own paths yet — so `.min` is the machine at its best. A duration like the
// rest; it reads nothing of the game.
//
// The report is flushed out of the SDK's log buffer the moment it is logged:
// a phone backgrounding the page gives no second chance.
//
// Monitoring is best-effort: a throwing sink never reaches the driver.

import * as Sentry from "@sentry/react";
import type { DecisionTrace } from "@convex/gre";
import type { BrainOutcome } from "./brain-request";
import { emitConsultSpan, type TimedConsult } from "./bot-consult-span";
import type { CalibrationReading } from "./brain-calibration";

/** The search's own account of one decision — the `DecisionTrace` fields
 *  this report reads. Absent when the consult produced no trace (a failed
 *  consult, or a window with no real decision to search). */
export type SearchStats = {
    iterationsRequested: number;
    iterationsCompleted: number;
    /** Root visits kept from the previous consult's tree (issue #10470). */
    iterationsKept?: number;
    /** Pondering since the previous consult (issue #10472): iterations
     *  grown while the human decided, the root visits of this search they
     *  grew (part of `iterationsKept`), and the time spent pondering. */
    ponder?: { iterations: number; kept: number; ms: number };
    elapsedMs: number;
    stoppedBy: DecisionTrace["stoppedBy"];
    /** Candidates the rollout policy probed in this search (issue #10321). */
    rolloutProbes?: number;
};

/** What the searched board cost, as counts (issue #10321): no card and no
 *  player, only how far the game was and how many permanents stood. */
export type BoardFacts = {
    turn: number;
    /** The step the decision was taken in (a `Phase`). */
    phase: string;
    /** Permanents on the battlefield, every player's together. */
    permanents: number;
};

type BoardLike = {
    turn?: unknown;
    phase?: unknown;
    players?: readonly { battlefield?: readonly unknown[] }[];
};

/** The counts of a projected state. Reads the board; returns only the counts.
 *  Total: a state it cannot read has no counts, and never throws. */
export function boardFacts(state: BoardLike): BoardFacts | undefined {
    try {
        if (typeof state.turn !== "number" || typeof state.phase !== "string") {
            return undefined;
        }
        let permanents = 0;
        for (const player of state.players ?? []) {
            permanents += player.battlefield?.length ?? 0;
        }
        return { turn: state.turn, phase: state.phase, permanents };
    } catch {
        return undefined;
    }
}

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
    /** The wall-clock cap of the consult's search budget, when it had one:
     *  how far past it the search ran says how much of the consult timeout's
     *  margin a slow iteration used. */
    budgetMs?: number;
    /** `telemetryNow()` when the consult was posted (issue #10321): with
     *  `consultMs` it dates the consult, so the recorder can read the idle
     *  time before the next one. */
    postedAt?: number;
    /** The board the consult searched, as counts. */
    board?: BoardFacts;
    /** The time from the previous consult's verdict to this consult's post:
     *  what the Worker had to spare. Filled in by the game's recorder from
     *  `postedAt`; a caller leaves it out. Absent on a game's first consult,
     *  and whenever the Worker was not known to be idle in between: after a
     *  consult it did not answer (a timeout or a failure may leave it
     *  searching), after one that ran in-thread, and for a consult posted
     *  while a calibration was running. */
    idleMs?: number;
    /** How long the consult waited in the Worker behind a calibration
     *  reading; that wait is already out of `consultMs`. Filled in by the
     *  game's recorder; absent when it waited behind none. */
    calibrationWaitMs?: number;
};

/** The coarse device class — see the module header for why it is this coarse. */
export type DeviceClass = {
    engine: "chromium" | "gecko" | "webkit" | "other";
    os: "macos" | "windows" | "linux" | "ios" | "android" | "other";
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
    "iterations.kept",
    "iterations.ratio",
    "iterations.p10",
    "rootVisits.p10",
    "ponder.iterations",
    "ponder.kept",
    "ponderMs.p50",
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
    "msPerIteration.first",
    "probesPerIteration.p50",
    "probesPerIteration.p90",
    "msPerProbe.p50",
    "idleMs.p50",
    "calibration.first",
    "calibration.firstUnits",
    "calibration.last",
    "calibration.lastUnits",
    "calibration.min",
    "calibration.minUnits",
    "calibration.count",
    "calibration.skipped",
    "device.engine",
    "device.os",
    "device.cores",
    "device.mobile",
] as const;

export type BotSearchReportKey = (typeof REPORT_KEYS)[number];
export type BotSearchReport = Partial<
    Record<BotSearchReportKey, string | number | boolean>
>;

/** How long the forced flush after a report may wait for the transport. The
 *  request is ISSUED synchronously at the flush; this only bounds the wait. */
export const BOT_SEARCH_FLUSH_TIMEOUT_MS = 2_000;

/** Where a report goes. An object, so a test observes the routing by spying on
 *  it instead of mocking a module. */
export const botSearchSink = {
    log(report: BotSearchReport): void {
        Sentry.logger.info("bot search", report);
    },
    /** Send the SDK's buffered logs NOW (issue #10320). The logger only
     *  buffers; its buffer goes out on a 5 s timer or on the SDK's own
     *  `visibilitychange` listener — registered at `Sentry.init`, so on page
     *  hide it runs BEFORE ours and empties a buffer the report is not in yet.
     *  A backgrounded iPhone suspends the timer and may kill the page, so the
     *  report never left. Flushing here issues the request while the page
     *  still runs, and the fetch transport sends it with `keepalive`. */
    flush(): Promise<unknown> {
        return Sentry.flush(BOT_SEARCH_FLUSH_TIMEOUT_MS);
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
    maxTouchPoints?: number;
    userAgentData?: { mobile?: boolean; platform?: string };
};

/** A desktop Mac agent on a touch screen: an Apple device presenting itself
 *  as a Mac (see `isMobileDevice`). No Mac has a touch screen. */
const touchMacAgent = (nav: NavigatorLike | undefined): boolean =>
    /Macintosh/.test(nav?.userAgent ?? "") && (nav?.maxTouchPoints ?? 0) > 1;

/** `userAgentData.platform` values, by OS family. ChromeOS is `other`. */
const PLATFORM_HINT_OS: Readonly<Record<string, DeviceClass["os"]>> = {
    macos: "macos",
    windows: "windows",
    linux: "linux",
    ios: "ios",
    android: "android",
};

/** The OS family a device runs (issue #10128): the machines behind two engines
 *  are told apart only by it. The browser's own hint wins where it exists
 *  (Chromium's `userAgentData.platform`); else the user agent decides. Every
 *  iOS agent names an iPhone, iPad or iPod and every Android one names Android
 *  — both before Linux, which Android's agent also names — and a desktop Mac
 *  agent on a touch screen is iPadOS (or a desktop-site iPhone): `ios`. */
export function osFamily(nav: NavigatorLike | undefined): DeviceClass["os"] {
    const platform = nav?.userAgentData?.platform;
    if (typeof platform === "string" && platform !== "") {
        const hinted = PLATFORM_HINT_OS[platform.toLowerCase()];
        if (hinted) return hinted;
        if (platform !== "Unknown") return "other";
    }
    const userAgent = nav?.userAgent ?? "";
    if (/iPhone|iPad|iPod/.test(userAgent)) return "ios";
    if (/Android/.test(userAgent)) return "android";
    if (/Windows/.test(userAgent)) return "windows";
    if (/CrOS/.test(userAgent)) return "other";
    if (/Macintosh/.test(userAgent)) {
        return touchMacAgent(nav) ? "ios" : "macos";
    }
    if (/Linux|X11/.test(userAgent)) return "linux";
    return "other";
}

/** Whether a device is mobile (issue #10022). The browser's own hint wins
 *  where it exists (Chromium's `userAgentData.mobile`, which calls an Android
 *  TABLET desktop — so does this flag, there); Safari and
 *  Firefox have none, so the user agent decides — a phone or tablet token, or
 *  a DESKTOP Mac agent on a touch screen. That last case is an Apple device
 *  presenting itself as a Mac: iPadOS sends the Mac agent by default, and an
 *  iPhone sends it under "Request Desktop Website". No Mac has a touch
 *  screen, so `maxTouchPoints > 1` tells them apart. */
export function isMobileDevice(nav: NavigatorLike | undefined): boolean {
    const hint = nav?.userAgentData?.mobile;
    if (typeof hint === "boolean") return hint;
    const userAgent = nav?.userAgent ?? "";
    if (/Mobi|Android|iPhone|iPad|iPod/.test(userAgent)) return true;
    return touchMacAgent(nav);
}

/** This device's coarse class. Reads the navigator; returns only the class. */
export function deviceClass(
    nav: NavigatorLike | undefined = typeof navigator === "undefined"
        ? undefined
        : (navigator as NavigatorLike)
): DeviceClass {
    return {
        engine: engineFamily(nav?.userAgent ?? ""),
        os: osFamily(nav),
        cores: coresBucket(nav?.hardwareConcurrency),
        mobile: isMobileDevice(nav),
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
        finite(search.elapsedMs) &&
        // A clock that ran backwards measured nothing.
        search.elapsedMs >= 0
        ? search
        : null;
}

/** The root visits a search kept from the previous consult's tree (issue
 *  #10470); none when unknown, never negative. */
const keptVisits = (search: SearchStats): number =>
    finite(search.iterationsKept) ? Math.max(0, search.iterationsKept) : 0;

/** Fold a game's consults into its report. Pure. A statistic with no sample
 *  behind it is LEFT OUT rather than reported as zero: "no search had a trace"
 *  and "every search took 0 ms" must not read the same. A number that is not
 *  finite is no sample. */
export function summarizeBotSearch(
    gameId: string,
    samples: readonly ConsultSample[],
    device: DeviceClass,
    calibration: CalibrationSummary = NO_CALIBRATION
): BotSearchReport {
    const difficulties = new Set(samples.map((s) => s.difficulty));
    const raw: Record<string, string | number | boolean> = {
        gameId,
        difficulty: difficulties.size === 1 ? [...difficulties][0]! : "mixed",
        consults: samples.length,
        "device.engine": device.engine,
        "device.os": device.os,
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

    // What the machine was worth, whatever the board (issue #10451): the
    // game's first calibration reading, its latest and its best, each beside
    // the units it stands on. The first ones run colder, so the best is
    // the machine's own speed. `skipped` counts the readings that were due
    // and not taken because a search had just run long past its cap: on a
    // device where that is every late search, `last` is an early reading.
    const readings = calibration.readings.filter(
        (r) => finite(r.msPerUnit) && finite(r.units)
    );
    if (readings.length > 0) {
        const first = readings[0]!;
        const last = readings[readings.length - 1]!;
        const best = readings.reduce((min, r) =>
            r.msPerUnit < min.msPerUnit ? r : min
        );
        raw["calibration.first"] = round(first.msPerUnit, 2);
        raw["calibration.firstUnits"] = first.units;
        raw["calibration.last"] = round(last.msPerUnit, 2);
        raw["calibration.lastUnits"] = last.units;
        raw["calibration.min"] = round(best.msPerUnit, 2);
        raw["calibration.minUnits"] = best.units;
        raw["calibration.count"] = readings.length;
    }
    if (finite(calibration.skipped) && calibration.skipped > 0) {
        raw["calibration.skipped"] = calibration.skipped;
    }

    // What the Worker had to spare between two consults (issue #10321).
    const idleMs = samples
        .map((s) => s.idleMs)
        .filter((idle): idle is number => finite(idle) && idle >= 0);
    if (idleMs.length > 0) raw["idleMs.p50"] = round(percentile(idleMs, 50)!);

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
    // Issue #10470 — the root visits the game's searches started from: a
    // kept subtree's. `completed + kept` is what the roots held.
    raw["iterations.kept"] = searches.reduce(
        (sum, s) => sum + keptVisits(s),
        0
    );
    if (requested > 0)
        raw["iterations.ratio"] = round(completed / requested, 3);
    // Issue #10993 — the game's LOW tail, per search: the fresh iterations
    // of a consult, and the root visits it held against the budget (fresh
    // plus kept). The totals above are means; the owner's ruling that
    // `expert` reaches its budget is about every search.
    const freshIterations = searches.map((s) => s.iterationsCompleted);
    const rootVisits = searches.map(
        (s) => s.iterationsCompleted + keptVisits(s)
    );
    raw["iterations.p10"] = round(percentile(freshIterations, 10)!);
    raw["rootVisits.p10"] = round(percentile(rootVisits, 10)!);

    // Issue #10472 — pondering: the game's iterations grown while the human
    // decided, the root visits they grew at the Bot's next decisions, and the
    // median pondering time of a consult that followed one. Left out when
    // nothing was pondered. Split by `device.mobile`, these check the
    // owner's ruling that pondering runs on phones too.
    const pondered = searches.flatMap((s) => {
        const p = s.ponder;
        return p && finite(p.iterations) && finite(p.kept) && finite(p.ms)
            ? [p]
            : [];
    });
    if (pondered.length > 0) {
        raw["ponder.iterations"] = pondered.reduce(
            (sum, p) => sum + Math.max(0, p.iterations),
            0
        );
        raw["ponder.kept"] = pondered.reduce(
            (sum, p) => sum + Math.max(0, p.kept),
            0
        );
        raw["ponderMs.p50"] = round(
            percentile(
                pondered.map((p) => p.ms),
                50
            )!
        );
    }

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

    // The machine's speed at an EARLY board (issue #10128): the game's first
    // search that completed an iteration. The percentiles above weigh every
    // board the game reached, and later boards cost more, so a long game reads
    // slower on the same machine; this one reading is comparable across games.
    const first = searches.find((s) => s.iterationsCompleted > 0);
    if (first) {
        raw["msPerIteration.first"] = round(
            first.elapsedMs / first.iterationsCompleted,
            2
        );
    }

    // What the boards cost and what the machine made of them (issue #10321):
    // the rollout policy's probes per iteration, and the time per probe. A
    // slow game with many probes per iteration reached costly boards; one
    // with a high time per probe ran on a slow or busy machine.
    const probed = searches.filter(
        (s) => finite(s.rolloutProbes) && s.rolloutProbes > 0
    );
    const probeRatios = probed
        .filter((s) => s.iterationsCompleted > 0)
        .map((s) => s.rolloutProbes! / s.iterationsCompleted);
    const probesPerIteration = percentile(probeRatios, 50);
    // Issue #10993 — the probe-heavy tail: does the game reach late boards?
    const probesPerIterationP90 = percentile(probeRatios, 90);
    const msPerProbe = percentile(
        probed.map((s) => s.elapsedMs / s.rolloutProbes!),
        50
    );
    if (probesPerIteration !== undefined) {
        raw["probesPerIteration.p50"] = round(probesPerIteration, 1);
    }
    if (probesPerIterationP90 !== undefined) {
        raw["probesPerIteration.p90"] = round(probesPerIterationP90, 1);
    }
    if (msPerProbe !== undefined) {
        raw["msPerProbe.p50"] = round(msPerProbe, 3);
    }

    return onlyAllowed(raw);
}

/** Times one game's consults in the order they end: each one's place in the
 *  game and the idle time before it. */
export type ConsultClock = (sample: ConsultSample) => TimedConsult;

/** Whether the Brain's Worker itself answered this consult: it ran there and
 *  came back with a verdict. */
function workerAnswered(sample: ConsultSample): boolean {
    return (
        sample.via === "worker" &&
        (sample.outcome === "move" || sample.outcome === "no-move")
    );
}

/** A game's consult clock, starting at its first consult. */
export function consultClock(): ConsultClock {
    let ordinal = 0;
    let lastAnsweredAt: number | undefined;
    return (sample) => {
        ordinal += 1;
        const posted = finite(sample.postedAt) ? sample.postedAt : undefined;
        const idle =
            posted !== undefined && lastAnsweredAt !== undefined
                ? posted - lastAnsweredAt
                : undefined;
        // The Worker is known to be idle only after a consult IT answered: a
        // timeout or a failure may leave it searching, and a consult that
        // ran in-thread says nothing about it.
        lastAnsweredAt =
            posted !== undefined &&
            finite(sample.consultMs) &&
            workerAnswered(sample)
                ? posted + sample.consultMs
                : undefined;
        // The idle time is the clock's reading, never the caller's.
        const timed: TimedConsult = { ...sample, ordinal };
        if (idle !== undefined && idle >= 0) timed.idleMs = idle;
        else delete timed.idleMs;
        return timed;
    };
}

/** Asks the Brain's Worker for one calibration reading (`calibrateBrain`,
 *  `./brain-client`): milliseconds per unit beside the units behind it, or
 *  `null` for no reading. */
export type Calibrator = () => Promise<CalibrationReading | null>;

/** What a game's calibration log holds when its report goes out. */
export type CalibrationSummary = {
    /** The readings, oldest first. */
    readings: readonly CalibrationReading[];
    /** Readings that were due and not taken after a search that ran long
     *  past its cap (`CALIBRATION_SKIP_OVERRUN_MS`). */
    skipped: number;
};

const NO_CALIBRATION: CalibrationSummary = { readings: [], skipped: 0 };

/** The least time between two calibration readings of one game, once it has
 *  its first `CALIBRATION_WARMUP_READINGS`: often enough to date a slow
 *  stretch of a game, rare enough to cost the Worker next to nothing. */
export const CALIBRATION_INTERVAL_MS = 30_000;

/** How many readings a game takes back to back, one after each of its first
 *  consults, before the interval applies. A browser compiles the
 *  calibration's own code paths over its first runs, so the first readings
 *  run colder; a few early ones reach the steady speed inside the game's
 *  first turns, so even a short game has one
 *  (`docs/research/calibration-reading.md`). */
export const CALIBRATION_WARMUP_READINGS = 3;

/** How far past its cap a time-stopped search may have run for a reading to
 *  follow it. A search stops at the first iteration that ends past the cap,
 *  so the overrun is one iteration's length: a long one is a board or a
 *  machine on which the NEXT consult may need the whole overrun margin of
 *  the consult timeout (issue #10408), and a calibration ahead of it in the
 *  Worker would spend some. A fifth of that margin. */
export const CALIBRATION_SKIP_OVERRUN_MS = 300;

/** Whether the page is hidden, and how many times its visibility has
 *  changed: what a calibration reading must not span. A hidden page's Worker
 *  may be throttled or frozen, and a reading taken across a freeze times the
 *  freeze. */
export type PageVisibility = {
    hidden: () => boolean;
    changes: () => number;
};

let visibilityChanges = 0;
let countingVisibility = false;

/** The page's own visibility. Counts `visibilitychange` events from its
 *  first use on; a context with no document is never hidden. */
export const pageVisibility: PageVisibility = {
    hidden() {
        return (
            typeof document !== "undefined" &&
            document.visibilityState === "hidden"
        );
    },
    changes() {
        if (!countingVisibility && typeof document !== "undefined") {
            countingVisibility = true;
            document.addEventListener("visibilitychange", () => {
                visibilityChanges += 1;
            });
        }
        return visibilityChanges;
    },
};

/** One game's calibration readings on this page (issue #10451). */
export type CalibrationLog = {
    /** The readings so far, oldest first. */
    readings: () => readonly CalibrationReading[];
    /** The readings and the count of skipped ones, for the game's report. */
    summary: () => CalibrationSummary;
    /** A consult just ended, at `now` (`telemetryNow()`): ask for a reading
     *  if one is due. Never throws, and never waits. */
    after: (sample: ConsultSample, now: number) => void;
    /** How long a consult posted at `postedAt` and answered at `answeredAt`
     *  waited in the Worker behind the latest calibration: 0 when it was not
     *  posted while that calibration was in flight, `null` when the wait is
     *  not known — the calibration is still in flight, or it came back with
     *  no reading (the page's own timeout, a dead Worker), so the Worker may
     *  still have been on it. */
    waitedBehind: (postedAt: number, answeredAt: number) => number | null;
};

/** A game's calibration log. A reading is due after a consult the WORKER
 *  answered — never after the in-thread fallback, and never behind a Worker
 *  that timed out or failed, where it would queue behind the search that is
 *  stuck — while the game has asked for fewer than
 *  `CALIBRATION_WARMUP_READINGS`, or once the last one was asked for
 *  `CALIBRATION_INTERVAL_MS` ago; never while one is in flight. A due
 *  reading is not asked for while the page is hidden, and is SKIPPED (and
 *  counted) after a search whose last iteration ran long past its cap
 *  (`CALIBRATION_SKIP_OVERRUN_MS`). A reading during which the page's
 *  visibility changed is discarded: it may have spanned a freeze. With no
 *  `calibrate` the log stays empty.
 *
 *  A reading is asked for the moment a verdict lands. The driver posts its
 *  next consult no sooner than its think beat after the board changes, and a
 *  reading lasts its budget plus one unit (`convex/gre/ai/calibration.ts`),
 *  so a consult rarely finds one ahead of it; when it does, `waitedBehind`
 *  says for how long. `clock` is `telemetryNow`, injectable for a test. */
export function calibrationLog(
    calibrate?: Calibrator,
    clock: () => number = telemetryNow,
    visibility: PageVisibility = pageVisibility
): CalibrationLog {
    const readings: CalibrationReading[] = [];
    let skipped = 0;
    let askedAt: number | undefined;
    /** When the Worker is known to have finished the latest calibration:
     *  when its reading came back. `undefined` while it is in flight, and
     *  after it came back with NO reading — the page gave up on it or the
     *  Worker died, which says nothing of when the Worker was free — until
     *  the Worker answers a consult posted after it, which it could only do
     *  with the calibration out of its queue. */
    let settledAt: number | undefined;
    let asked = 0;
    let asking = false;
    return {
        readings: () => readings,
        summary: () => ({ readings, skipped }),
        waitedBehind(postedAt, answeredAt) {
            if (askedAt === undefined || postedAt < askedAt) return 0;
            if (settledAt === undefined) return null;
            const until = Math.min(settledAt, answeredAt);
            return until > postedAt ? until - postedAt : 0;
        },
        after(sample, now) {
            // The Worker answered a consult posted after a calibration that
            // never reported back: its queue is past that calibration.
            if (
                !asking &&
                askedAt !== undefined &&
                settledAt === undefined &&
                workerAnswered(sample) &&
                finite(sample.postedAt) &&
                sample.postedAt >= askedAt
            ) {
                settledAt = askedAt;
            }
            if (!calibrate || asking) return;
            if (!workerAnswered(sample)) return;
            if (
                asked >= CALIBRATION_WARMUP_READINGS &&
                askedAt !== undefined &&
                now - askedAt < CALIBRATION_INTERVAL_MS
            ) {
                return;
            }
            // A reading is due. Not on a hidden page: its Worker may be
            // throttled, and nobody is waiting on the game.
            if (visibility.hidden()) return;
            const search = sample.search;
            if (
                search?.stoppedBy === "time" &&
                !(
                    finite(sample.budgetMs) &&
                    search.elapsedMs - sample.budgetMs <=
                        CALIBRATION_SKIP_OVERRUN_MS
                )
            ) {
                skipped += 1;
                return;
            }
            asking = true;
            asked += 1;
            askedAt = now;
            settledAt = undefined;
            const changesBefore = visibility.changes();
            /** `answered`: the Worker's own answer came back. */
            const settle = (answered: boolean) => {
                asking = false;
                if (!answered) return;
                try {
                    settledAt = clock();
                } catch {
                    settledAt = askedAt;
                }
            };
            try {
                void Promise.resolve(calibrate())
                    .then((reading) => {
                        const usable =
                            reading !== null &&
                            reading !== undefined &&
                            finite(reading.msPerUnit) &&
                            reading.msPerUnit > 0 &&
                            finite(reading.units) &&
                            reading.units > 0;
                        // Only a reading is proof the Worker finished: no
                        // reading is also what the page's timeout and a dead
                        // Worker look like.
                        settle(usable);
                        // A reading the page was hidden or shown during may
                        // have spanned a freeze: it is not a measurement.
                        if (visibility.changes() !== changesBefore) return;
                        if (usable) readings.push(reading);
                    })
                    .catch(() => settle(false));
            } catch {
                // Monitoring never costs the game anything.
                settle(false);
            }
        },
    };
}

/** Time one consult and record its span (`./bot-consult-span`), with the
 *  game's latest calibration reading beside it. A consult the Worker
 *  answered that was posted while a calibration was running waited behind it
 *  in the Worker: that wait is taken out of its `consultMs` and carried
 *  beside it (`calibrationWaitMs`), and it has no idle reading (the Worker
 *  was not idle). When the calibration never settled the wait is not known:
 *  the consult keeps its time, and still has no idle reading. Never throws;
 *  a consult the clock could not time is returned as it came. */
function timeAndTrace(
    gameId: string,
    clock: ConsultClock,
    sample: ConsultSample,
    calibration?: CalibrationLog
): ConsultSample {
    try {
        const timed = clock(sample);
        if (
            calibration &&
            workerAnswered(timed) &&
            finite(timed.postedAt) &&
            finite(timed.consultMs)
        ) {
            const waited = calibration.waitedBehind(
                timed.postedAt,
                timed.postedAt + timed.consultMs
            );
            if (waited === null) {
                delete timed.idleMs;
            } else if (waited > 0) {
                timed.calibrationWaitMs = waited;
                timed.consultMs = Math.max(0, timed.consultMs - waited);
                delete timed.idleMs;
            }
        }
        const readings = calibration?.readings() ?? [];
        const latest = readings[readings.length - 1];
        emitConsultSpan(
            gameId,
            latest ? { ...timed, calibration: latest } : timed,
            deviceClass()
        );
        return timed;
    } catch {
        // Monitoring never costs the game anything.
        return sample;
    }
}

/** A consult just ended: let the game's calibration log ask for a reading if
 *  one is due. Never throws. */
function calibrateAfter(calibration: CalibrationLog, sample: ConsultSample) {
    try {
        calibration.after(sample, telemetryNow());
    } catch {
        // Monitoring never costs the game anything.
    }
}

/** One game's accumulator. Neither method ever throws. */
export type BotSearchRecorder = {
    /** Fold one consult in, and record its span. Once the report has been
     *  emitted the consult still records its span, and is not folded in. */
    record: (sample: ConsultSample) => void;
    /** Emit the game's report, once. With no consult recorded it emits
     *  nothing and stays open: a flush that came too early costs nothing. */
    flush: () => void;
};

/** Open the accumulator of one game's Bot searches. `onEmit` runs once, when
 *  the report goes out. */
export function openBotSearchReport(
    gameId: string,
    onEmit?: () => void,
    clock: ConsultClock = consultClock(),
    calibration: CalibrationLog = calibrationLog()
): BotSearchRecorder {
    const samples: ConsultSample[] = [];
    let emitted = false;
    return {
        record(sample) {
            const timed = timeAndTrace(gameId, clock, sample, calibration);
            if (!emitted) samples.push(timed);
            calibrateAfter(calibration, sample);
        },
        flush() {
            if (emitted || samples.length === 0) return;
            emitted = true;
            onEmit?.();
            try {
                botSearchSink.log(
                    summarizeBotSearch(
                        gameId,
                        samples,
                        deviceClass(),
                        calibration.summary()
                    )
                );
            } catch {
                // Monitoring never costs the game anything.
                return;
            }
            try {
                // One forced flush per game: the report is emitted once.
                void Promise.resolve(botSearchSink.flush()).catch(() => {});
            } catch {
                // Neither a throwing nor a rejecting flush reaches the driver.
            }
        },
    };
}

// ── One report per GAME, not per driver mount (issue #10022) ────────────────

/** How long a report stays open after its driver unmounts before the game
 *  counts as LEFT and the report goes out. A remount of the same game inside
 *  this window folds into the open report; one after it finds the game
 *  already reported and adds nothing. Page hide and a different game flush
 *  sooner. */
export const BOT_SEARCH_LEAVE_GRACE_MS = 30_000;

type OpenReport = {
    gameId: string;
    recorder: BotSearchRecorder;
    leave: ReturnType<typeof setTimeout> | null;
};

/** The one game whose report is open on this page: a page drives one vs-Bot
 *  game at a time. */
let current: OpenReport | null = null;
/** Games whose report has gone out from this page: a game is reported once. */
const reported = new Set<string>();
/** What times one game on this page: its consult clock and its calibration
 *  log. */
type GameTiming = { clock: ConsultClock; calibration: CalibrationLog };

/** Each game's timing on this page. It outlives the game's report: a consult
 *  that lands after the report went out still records its span, and its
 *  place in the game continues where the report left off. */
const timings = new Map<string, GameTiming>();
let listeningForPageHide = false;

function timingOf(gameId: string, calibrate?: Calibrator): GameTiming {
    let timing = timings.get(gameId);
    if (!timing) {
        timing = {
            clock: consultClock(),
            calibration: calibrationLog(calibrate),
        };
        timings.set(gameId, timing);
    }
    return timing;
}

/** The recorder of a game already reported: it adds nothing to a report, and
 *  each consult still records its span. */
function reportedRecorder(
    gameId: string,
    { clock, calibration }: GameTiming
): BotSearchRecorder {
    return {
        record(sample) {
            timeAndTrace(gameId, clock, sample, calibration);
            calibrateAfter(calibration, sample);
        },
        flush() {},
    };
}

function cancelLeave(open: OpenReport): void {
    if (open.leave !== null) clearTimeout(open.leave);
    open.leave = null;
}

function closeCurrent(): void {
    if (!current) return;
    cancelLeave(current);
    current.recorder.flush();
    current = null;
}

function flushOnPageHide(): void {
    current?.recorder.flush();
}

/** The page is going away (`pagehide`), or into the background, where a phone
 *  may kill it with no further event — an iOS app switch fires
 *  `visibilitychange`, never `pagehide`. Either way the report goes out now;
 *  the owner chose a truncated report over a lost one (issue #10022). */
function listenForPageHide(): void {
    if (listeningForPageHide) return;
    if (typeof window === "undefined" || typeof document === "undefined") {
        return;
    }
    listeningForPageHide = true;
    window.addEventListener("pagehide", flushOnPageHide);
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") flushOnPageHide();
    });
}

/** The report of `gameId`, for a driver that starts driving it. The SAME game
 *  gets the report already open — a remount continues it; a different game
 *  flushes the open one (its game was left) and starts from zero; a game
 *  already reported gets a recorder that records nothing. */
export function acquireBotSearchReport(
    gameId: string,
    calibrate?: Calibrator
): BotSearchRecorder {
    if (current?.gameId === gameId) {
        cancelLeave(current);
        return current.recorder;
    }
    closeCurrent();
    const timing = timingOf(gameId, calibrate);
    const recorder = reported.has(gameId)
        ? reportedRecorder(gameId, timing)
        : openBotSearchReport(
              gameId,
              () => reported.add(gameId),
              timing.clock,
              timing.calibration
          );
    current = { gameId, recorder, leave: null };
    listenForPageHide();
    return recorder;
}

/** The driver holding `recorder` stopped driving its game. The report is not
 *  flushed yet: it waits `BOT_SEARCH_LEAVE_GRACE_MS` for a remount of the same
 *  game, then goes out. */
export function releaseBotSearchReport(recorder: BotSearchRecorder): void {
    const open = current;
    if (!open || open.recorder !== recorder) return;
    cancelLeave(open);
    open.leave = setTimeout(() => {
        if (current === open) closeCurrent();
    }, BOT_SEARCH_LEAVE_GRACE_MS);
}

/** Forget every report on this page without sending any: a test's fresh page. */
export function clearBotSearchReports(): void {
    if (current) cancelLeave(current);
    current = null;
    reported.clear();
    timings.clear();
}
