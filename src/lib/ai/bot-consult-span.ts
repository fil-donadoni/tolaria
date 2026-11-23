// One Sentry span per Brain consult (issue #10321).
//
// The per-game `bot search` report (`./bot-search-telemetry`) is an aggregate:
// a median and a p90 over every board the game reached. It cannot say WHICH
// decisions ran short, or whether a slow game was a costly board or a busy
// machine: on 2026-11-21 a Gecko game reported 342–472 ms per iteration at the
// median while its final board cost 85–90 ms in the same browser on the same
// machine, and nothing in the report told the two readings apart. A span per
// consult carries the decision's own numbers, in order, beside what the board
// cost (permanents, the rollout policy's probes) and how long the Worker sat
// idle before it.
//
// Each span is its own transaction (`parentSpan: null`): a `/game` navigation
// closes on its idle timeout a second after the route settles, so nothing of a
// game's play would be inside it.
//
// THE BOUNDARY is the report's, unchanged: this leaves the device without the
// bug-report consent gate, so it carries counters, durations, the game id, the
// difficulty preset, the turn number and step, and the coarse device class.
// No player, no card, no hand, no board content, no free text.
// `CONSULT_SPAN_KEYS` is the allowlist, enforced at runtime and pinned by a
// test; a string attribute outside its own closed vocabulary is left out.
// The SDK dresses every transaction with the page's URL, the user-agent
// header, the session's breadcrumbs and the locale: for this one they are
// taken off before it is sent (`scrubBotConsultTransaction`,
// `~/lib/diagnostics/tracing`).
//
// Monitoring is best-effort: `emitConsultSpan` never throws.

import * as Sentry from "@sentry/react";
import { BOT_CONSULT_SPAN } from "~/lib/diagnostics/tracing";
import type { ConsultSample, DeviceClass } from "./bot-search-telemetry";

/** Every attribute a consult span may carry. */
export const CONSULT_SPAN_KEYS = [
    "gameId",
    "consult",
    "difficulty",
    "outcome",
    "via",
    "consultMs",
    "idleMs",
    "searchMs",
    "iterations.requested",
    "iterations.completed",
    "iterations.kept",
    "stoppedBy",
    "msPerIteration",
    "probes",
    "msPerProbe",
    "turn",
    "phase",
    "permanents",
    "calibration",
    "calibrationUnits",
    "calibrationWaitMs",
    "device.engine",
    "device.os",
    "device.cores",
    "device.mobile",
] as const;

export type ConsultSpanKey = (typeof CONSULT_SPAN_KEYS)[number];
export type ConsultSpanAttributes = Partial<
    Record<ConsultSpanKey, string | number | boolean>
>;

/** One consult as the game's recorder timed it: its place in the game and the
 *  idle time before it. */
export type TimedConsult = ConsultSample & {
    /** 1 for the game's first consult on this page. */
    ordinal: number;
    /** The game's latest calibration reading when the consult ended (issue
     *  #10451): what the machine made of the fixed calibration work,
     *  whatever this consult's board, in milliseconds per unit of that work,
     *  and the units behind the number. Absent until the game has one. */
    calibration?: { msPerUnit: number; units: number };
};

/** Where a span goes. An object, so a test observes the routing by spying on
 *  it instead of mocking the SDK. Times are epoch milliseconds. */
export const botConsultSpanSink = {
    record(
        attributes: ConsultSpanAttributes,
        startedAtMs: number,
        endedAtMs: number
    ): void {
        const span = Sentry.startInactiveSpan({
            name: BOT_CONSULT_SPAN,
            op: BOT_CONSULT_SPAN,
            // A root span: its own transaction, whatever navigation is open.
            parentSpan: null,
            forceTransaction: true,
            startTime: startedAtMs / 1000,
            attributes,
        });
        span.end(endedAtMs / 1000);
    },
};

const finite = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value);

const round = (value: number, digits = 0): number => {
    const scale = 10 ** digits;
    return Math.round(value * scale) / scale;
};

/** The closed vocabularies of the span's string attributes: every key that
 *  may hold a string has one. A value outside its own — a union member added
 *  later, a malformed trace, an id that is not an id — is left out rather
 *  than sent as text nobody reviewed, and a string under a key with no
 *  vocabulary is never sent. */
const VOCABULARY: Partial<Record<ConsultSpanKey, RegExp>> = {
    // A Convex document id: lower-case letters and digits.
    gameId: /^[a-z0-9]{1,64}$/,
    // A difficulty preset's name (`convex/gre/difficulty.ts`).
    difficulty: /^[a-z]{1,16}$/,
    outcome: /^(move|no-move|search-error|worker-error|timeout)$/,
    via: /^(worker|inline)$/,
    stoppedBy: /^(iterations|time|settled)$/,
    // A `Phase` (`convex/gre/types.ts`): an upper-case step name.
    phase: /^[A-Z_]{3,24}$/,
    // The `DeviceClass` unions (`./bot-search-telemetry`).
    "device.engine": /^(chromium|gecko|webkit|other)$/,
    "device.os": /^(macos|windows|linux|ios|android|other)$/,
    "device.cores": /^(1-2|3-4|5-8|9\+|unknown)$/,
};

/** Keep only what the allowlist names, each number finite and each string
 *  inside its key's vocabulary. The one gate everything a span carries goes
 *  through, whatever built the raw record. */
export function allowedSpanAttributes(
    raw: Record<string, unknown>
): ConsultSpanAttributes {
    const attributes: ConsultSpanAttributes = {};
    for (const key of CONSULT_SPAN_KEYS) {
        const value = raw[key];
        if (typeof value === "boolean" || finite(value)) {
            attributes[key] = value;
        } else if (typeof value === "string") {
            if (VOCABULARY[key]?.test(value)) attributes[key] = value;
        }
    }
    return attributes;
}

/** One consult's span attributes. Pure. A number with no measurement behind it
 *  is LEFT OUT, never sent as zero. */
export function consultSpanAttributes(
    gameId: string,
    consult: TimedConsult,
    device: DeviceClass
): ConsultSpanAttributes {
    const raw: Record<string, unknown> = {
        gameId,
        consult: consult.ordinal,
        difficulty: consult.difficulty,
        outcome: consult.outcome,
        via: consult.via,
        "device.engine": device.engine,
        "device.os": device.os,
        "device.cores": device.cores,
        "device.mobile": device.mobile,
    };
    if (finite(consult.consultMs)) raw.consultMs = round(consult.consultMs);
    if (finite(consult.idleMs)) raw.idleMs = round(consult.idleMs);

    if (consult.calibration && finite(consult.calibration.msPerUnit)) {
        raw.calibration = round(consult.calibration.msPerUnit, 2);
        raw.calibrationUnits = consult.calibration.units;
    }
    if (finite(consult.calibrationWaitMs)) {
        raw.calibrationWaitMs = round(consult.calibrationWaitMs);
    }

    const board = consult.board;
    if (board) {
        raw.turn = board.turn;
        raw.phase = board.phase;
        raw.permanents = board.permanents;
    }

    const search = consult.search;
    if (search) {
        raw["iterations.requested"] = search.iterationsRequested;
        raw["iterations.completed"] = search.iterationsCompleted;
        // Issue #10470 — the visits a kept subtree started this search with.
        if (finite(search.iterationsKept)) {
            raw["iterations.kept"] = search.iterationsKept;
        }
        raw.stoppedBy = search.stoppedBy;
        if (finite(search.elapsedMs)) {
            raw.searchMs = round(search.elapsedMs);
            if (search.iterationsCompleted > 0) {
                raw.msPerIteration = round(
                    search.elapsedMs / search.iterationsCompleted,
                    2
                );
            }
        }
        // The time per probe divides the WHOLE search's time by its probes:
        // it carries the tree's own work too, so it reads high on a search
        // of few iterations, where the tree is most of the time.
        if (finite(search.rolloutProbes)) {
            raw.probes = search.rolloutProbes;
            if (finite(search.elapsedMs) && search.rolloutProbes > 0) {
                raw.msPerProbe = round(
                    search.elapsedMs / search.rolloutProbes,
                    3
                );
            }
        }
    }
    return allowedSpanAttributes(raw);
}

/** Record one consult's span, ending at `endedAtMs` (epoch milliseconds, the
 *  moment its verdict landed) and starting `consultMs` before it. Never
 *  throws: a span that cannot be recorded is a lost measurement, never a lost
 *  move. */
export function emitConsultSpan(
    gameId: string,
    consult: TimedConsult,
    device: DeviceClass,
    endedAtMs: number = Date.now()
): void {
    try {
        const duration = finite(consult.consultMs)
            ? Math.max(0, consult.consultMs)
            : 0;
        botConsultSpanSink.record(
            consultSpanAttributes(gameId, consult, device),
            endedAtMs - duration,
            endedAtMs
        );
    } catch {
        // Monitoring never costs the game anything.
    }
}
