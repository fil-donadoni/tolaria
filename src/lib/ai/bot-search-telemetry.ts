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
// WHAT A SLOW GAME WAS (issue #10321). Three readings say whether a slow search
// was a costly board or a slow machine, and how much time the Worker had to
// spare: the rollout policy's probes per iteration and the time per probe
// (`probesPerIteration.p50`, `msPerProbe.p50`: a probe is one candidate move
// the rollout cloned, applied and evaluated, where a late board's iteration
// spends 67–78% of its time), and the idle time between two consults
// (`idleMs.p50`). They are counters and durations like the rest. The owner
// consented on 2026-11-22 to telemetry keys of this kind being added without
// asking per key; the boundary above is unchanged. Each consult also records
// a span of its own (`./bot-consult-span`), under the same boundary.
//
// The report is flushed out of the SDK's log buffer the moment it is logged:
// a phone backgrounding the page gives no second chance.
//
// Monitoring is best-effort: a throwing sink never reaches the driver.

import * as Sentry from "@sentry/react";
import type { DecisionTrace } from "@convex/gre";
import type { BrainOutcome } from "./brain-request";
import { emitConsultSpan, type TimedConsult } from "./bot-consult-span";

/** The search's own account of one decision — the `DecisionTrace` fields
 *  this report reads. Absent when the consult produced no trace (a failed
 *  consult, or a window with no real decision to search). */
export type SearchStats = {
    iterationsRequested: number;
    iterationsCompleted: number;
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
    /** `telemetryNow()` when the consult was posted (issue #10321): with
     *  `consultMs` it dates the consult, so the recorder can read the idle
     *  time before the next one. */
    postedAt?: number;
    /** The board the consult searched, as counts. */
    board?: BoardFacts;
    /** The time from the previous consult's verdict to this consult's post:
     *  what the Worker had to spare. Filled in by the game's recorder from
     *  `postedAt`; a caller leaves it out. Absent on a game's first consult. */
    idleMs?: number;
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
    "msPerIteration.first",
    "probesPerIteration.p50",
    "msPerProbe.p50",
    "idleMs.p50",
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
    const probesPerIteration = percentile(
        probed
            .filter((s) => s.iterationsCompleted > 0)
            .map((s) => s.rolloutProbes! / s.iterationsCompleted),
        50
    );
    const msPerProbe = percentile(
        probed.map((s) => s.elapsedMs / s.rolloutProbes!),
        50
    );
    if (probesPerIteration !== undefined) {
        raw["probesPerIteration.p50"] = round(probesPerIteration, 1);
    }
    if (msPerProbe !== undefined) {
        raw["msPerProbe.p50"] = round(msPerProbe, 3);
    }

    return onlyAllowed(raw);
}

/** Times one game's consults in the order they end: each one's place in the
 *  game and the idle time before it. */
export type ConsultClock = (sample: ConsultSample) => TimedConsult;

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
        lastAnsweredAt =
            posted !== undefined && finite(sample.consultMs)
                ? posted + sample.consultMs
                : undefined;
        // The idle time is the clock's reading, never the caller's.
        const timed: TimedConsult = { ...sample, ordinal };
        if (idle !== undefined && idle >= 0) timed.idleMs = idle;
        else delete timed.idleMs;
        return timed;
    };
}

/** Time one consult and record its span (`./bot-consult-span`). Never throws;
 *  a consult the clock could not time is returned as it came. */
function timeAndTrace(
    gameId: string,
    clock: ConsultClock,
    sample: ConsultSample
): ConsultSample {
    try {
        const timed = clock(sample);
        emitConsultSpan(gameId, timed, deviceClass());
        return timed;
    } catch {
        // Monitoring never costs the game anything.
        return sample;
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
    clock: ConsultClock = consultClock()
): BotSearchRecorder {
    const samples: ConsultSample[] = [];
    let emitted = false;
    return {
        record(sample) {
            const timed = timeAndTrace(gameId, clock, sample);
            if (!emitted) samples.push(timed);
        },
        flush() {
            if (emitted || samples.length === 0) return;
            emitted = true;
            onEmit?.();
            try {
                botSearchSink.log(
                    summarizeBotSearch(gameId, samples, deviceClass())
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
/** Each game's consult clock on this page. It outlives the game's report: a
 *  consult that lands after the report went out still records its span, and
 *  its place in the game continues where the report left off. */
const clocks = new Map<string, ConsultClock>();
let listeningForPageHide = false;

function clockOf(gameId: string): ConsultClock {
    let clock = clocks.get(gameId);
    if (!clock) {
        clock = consultClock();
        clocks.set(gameId, clock);
    }
    return clock;
}

/** The recorder of a game already reported: it adds nothing to a report, and
 *  each consult still records its span. */
function reportedRecorder(gameId: string): BotSearchRecorder {
    const clock = clockOf(gameId);
    return {
        record(sample) {
            timeAndTrace(gameId, clock, sample);
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
export function acquireBotSearchReport(gameId: string): BotSearchRecorder {
    if (current?.gameId === gameId) {
        cancelLeave(current);
        return current.recorder;
    }
    closeCurrent();
    const recorder = reported.has(gameId)
        ? reportedRecorder(gameId)
        : openBotSearchReport(
              gameId,
              () => reported.add(gameId),
              clockOf(gameId)
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
    clocks.clear();
}
