// One span per Brain consult (issue #10321): what it carries, the boundary it
// keeps — nothing outside its allowlist, no text outside a closed vocabulary —
// and the promise that recording it never costs the game anything.
//
// That each consult records exactly one, timed by the game's clock, is proven
// through the recorder in `bot-search-telemetry.bot.test.ts`.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
    CONSULT_SPAN_KEYS,
    allowedSpanAttributes,
    botConsultSpanSink,
    consultSpanAttributes,
    emitConsultSpan,
    type TimedConsult,
} from "../bot-consult-span";
import type { DeviceClass } from "../bot-search-telemetry";

const DEVICE: DeviceClass = {
    engine: "gecko",
    os: "macos",
    cores: "5-8",
    mobile: false,
};

function consult(overrides: Partial<TimedConsult> = {}): TimedConsult {
    return {
        ordinal: 12,
        outcome: "move",
        via: "worker",
        consultMs: 3350.4,
        difficulty: "expert",
        postedAt: 90_000,
        idleMs: 21_999.6,
        calibration: 2.1849,
        board: { turn: 9, phase: "DECLARE_ATTACKERS", permanents: 21 },
        search: {
            iterationsRequested: 1320,
            iterationsCompleted: 50,
            elapsedMs: 3300,
            stoppedBy: "time",
            rolloutProbes: 2440,
        },
        ...overrides,
    };
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe("consultSpanAttributes", () => {
    it("carries one consult's numbers, the board's counts and the device class", () => {
        expect(consultSpanAttributes("game1", consult(), DEVICE)).toEqual({
            gameId: "game1",
            consult: 12,
            difficulty: "expert",
            outcome: "move",
            via: "worker",
            consultMs: 3350,
            idleMs: 22_000,
            searchMs: 3300,
            "iterations.requested": 1320,
            "iterations.completed": 50,
            stoppedBy: "time",
            // 3300 / 50
            msPerIteration: 66,
            probes: 2440,
            // 3300 / 2440
            msPerProbe: 1.352,
            turn: 9,
            phase: "DECLARE_ATTACKERS",
            permanents: 21,
            calibration: 2.18,
            "device.engine": "gecko",
            "device.os": "macos",
            "device.cores": "5-8",
            "device.mobile": false,
        });
    });

    it("names every attribute its allowlist holds, and none outside it", () => {
        const attributes = consultSpanAttributes("game1", consult(), DEVICE);
        expect(Object.keys(attributes).sort()).toEqual(
            [...CONSULT_SPAN_KEYS].sort()
        );
    });

    it("drops whatever the allowlist does not name", () => {
        // A consult that grew fields nobody reviewed — a hand, a card, a
        // player — reaches the span with none of them.
        const grown = {
            ...consult(),
            hand: ["Lightning Bolt"],
            playerId: "user-1",
            board: {
                turn: 9,
                phase: "DECLARE_ATTACKERS",
                permanents: 21,
                cards: ["Tarmogoyf"],
            },
            search: {
                ...consult().search!,
                chosen: "cast Lightning Bolt",
            },
        } as TimedConsult;
        const attributes = consultSpanAttributes("game1", grown, DEVICE);
        const allowed = new Set<string>(CONSULT_SPAN_KEYS);
        expect(Object.keys(attributes).filter((k) => !allowed.has(k))).toEqual(
            []
        );
        expect(JSON.stringify(attributes)).not.toMatch(/Bolt|Tarmogoyf|user-1/);
    });

    it("leaves a string outside its vocabulary out, rather than sending text", () => {
        const attributes = consultSpanAttributes(
            "game1",
            consult({
                outcome: "brand-new-outcome" as never,
                via: "somewhere else" as never,
                difficulty: "Expert (custom) 9000",
                board: { turn: 9, phase: "cast Tarmogoyf", permanents: 21 },
                search: {
                    ...consult().search!,
                    stoppedBy: "because I said so" as never,
                },
            }),
            DEVICE
        );
        for (const key of [
            "outcome",
            "via",
            "difficulty",
            "phase",
            "stoppedBy",
        ]) {
            expect(attributes).not.toHaveProperty(key);
        }
        expect(attributes.turn).toBe(9);
        expect(attributes.searchMs).toBe(3300);
    });

    it("leaves a number OUT when no measurement stands behind it", () => {
        const failed = consultSpanAttributes(
            "game1",
            {
                ordinal: 1,
                outcome: "timeout",
                via: "worker",
                consultMs: 5300,
                difficulty: "expert",
            },
            DEVICE
        );
        expect(failed.outcome).toBe("timeout");
        expect(failed.consultMs).toBe(5300);
        for (const key of [
            "idleMs",
            "calibration",
            "searchMs",
            "iterations.completed",
            "msPerIteration",
            "probes",
            "msPerProbe",
            "turn",
            "permanents",
        ]) {
            expect(failed).not.toHaveProperty(key);
        }

        const empty = consultSpanAttributes(
            "game1",
            consult({
                search: {
                    iterationsRequested: 1320,
                    iterationsCompleted: 0,
                    elapsedMs: Number.NaN,
                    stoppedBy: "time",
                    rolloutProbes: 0,
                },
            }),
            DEVICE
        );
        expect(empty).not.toHaveProperty("searchMs");
        expect(empty).not.toHaveProperty("msPerIteration");
        expect(empty).not.toHaveProperty("msPerProbe");
        expect(empty.probes).toBe(0);
        for (const value of Object.values(empty)) {
            if (typeof value === "number") {
                expect(Number.isFinite(value)).toBe(true);
            }
        }
    });
});

describe("allowedSpanAttributes", () => {
    it("passes nothing the allowlist does not name, whatever the raw record holds", () => {
        // The gate itself, fed a record with keys nobody reviewed.
        expect(
            allowedSpanAttributes({
                gameId: "abc123",
                consult: 3,
                hand: "Lightning Bolt",
                playerId: "user-1",
                "board.cards": 7,
                secret: true,
            })
        ).toEqual({ gameId: "abc123", consult: 3 });
    });

    it("sends a string only under a key with a vocabulary, and only inside it", () => {
        const attributes = allowedSpanAttributes({
            // Not ids: free text, a URL, upper case.
            gameId: "abc123?x=Lightning Bolt",
            "device.engine": "Mozilla/5.0 (Macintosh; Intel Mac OS X)",
            "device.os": "my laptop",
            "device.cores": "eight",
            // Numeric keys never carry text.
            consult: "the third one",
            turn: "cast Tarmogoyf",
            permanents: "Tarmogoyf",
            "device.mobile": "yes",
        });
        expect(attributes).toEqual({});

        expect(
            allowedSpanAttributes({
                gameId: "jh7396nx0a9",
                "device.engine": "gecko",
                "device.os": "macos",
                "device.cores": "9+",
            })
        ).toEqual({
            gameId: "jh7396nx0a9",
            "device.engine": "gecko",
            "device.os": "macos",
            "device.cores": "9+",
        });
    });
});

describe("emitConsultSpan", () => {
    it("records one span, ending when the verdict landed and starting the consult's length before", () => {
        const record = vi
            .spyOn(botConsultSpanSink, "record")
            .mockImplementation(() => {});
        emitConsultSpan("game1", consult({ consultMs: 3000 }), DEVICE, 50_000);

        expect(record).toHaveBeenCalledTimes(1);
        const [attributes, startedAt, endedAt] = record.mock.calls[0]!;
        expect(attributes).toMatchObject({ gameId: "game1", consult: 12 });
        expect(startedAt).toBe(47_000);
        expect(endedAt).toBe(50_000);
    });

    it("gives a consult it cannot time no length, rather than a wrong one", () => {
        const record = vi
            .spyOn(botConsultSpanSink, "record")
            .mockImplementation(() => {});
        emitConsultSpan(
            "game1",
            consult({ consultMs: Number.NaN }),
            DEVICE,
            50_000
        );
        expect(record.mock.calls[0]!.slice(1)).toEqual([50_000, 50_000]);
    });

    it("swallows a throwing sink", () => {
        vi.spyOn(botConsultSpanSink, "record").mockImplementation(() => {
            throw new Error("tracing is down");
        });
        expect(() => emitConsultSpan("game1", consult(), DEVICE)).not.toThrow();
    });

    it("records through the SDK without an initialised client, and does not throw", () => {
        // The real sink, no `Sentry.init`: a test, or a build with monitoring
        // stripped. The span is not recorded anywhere; nothing is thrown.
        expect(() =>
            botConsultSpanSink.record({ gameId: "game1" }, 47_000, 50_000)
        ).not.toThrow();
    });
});
