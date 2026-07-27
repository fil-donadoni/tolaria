// Draft Lab replay-mode engine tests (issue #1613, ADR 0074, PRD #1607 slice
// 6). Covers the issue's Acceptance list directly:
//   - replaying an unmodified event reproduces its stored pools exactly
//   - with a deliberately altered weight, the divergence point is detected
//     and displayed
//   - a pool entry that can't be found in the regenerated pack is handled
//     (never a crash / silent wrong answer)
// "Zero writes / no new table" is covered by the catalogue-wide
// `draft-lab-no-mutation.test.ts`, which scans this file's directory too.
import { describe, it, expect } from "vitest";
import {
    buildDraftLabPickRating,
    runFullDraftLab,
    standardPackSlots,
} from "../draftLabEngine";
import { draftLabGetCardEvalMeta } from "../draftLabCardMeta";
import {
    reconstructDraftReplay,
    type ReplayEventSeatInput,
} from "../draftReplayEngine";
import { CUBE_SOURCE_KEY } from "@convex/limited/cubeSource";
import type { GetPickRating } from "@convex/limited/botDrafter";

const packSlots = standardPackSlots(CUBE_SOURCE_KEY);

/** Builds the replay-engine seat input from a completed synthetic draft's
 *  final state — the SAME shape `eventProjection.ts` would hand the client
 *  for a fully-visible (admin) viewer of a real completed event: every
 *  seat's actual, final, stored `pool`. */
function seatInputsFrom(
    seats: readonly { seatIndex: number; isBot?: boolean; pool?: unknown }[]
): ReplayEventSeatInput[] {
    return seats.map((s) => ({
        seatIndex: s.seatIndex,
        isBot: s.isBot ?? true,
        pool: (s.pool as ReplayEventSeatInput["pool"]) ?? [],
    }));
}

describe("reconstructDraftReplay — unmodified event (issue #1613 AC1)", () => {
    it("reproduces every seat's stored pool exactly", () => {
        const getPickRating = buildDraftLabPickRating(packSlots);
        const ground = runFullDraftLab(42, packSlots);

        const result = reconstructDraftReplay(
            42,
            packSlots,
            seatInputsFrom(ground.seats),
            draftLabGetCardEvalMeta,
            getPickRating
        );

        expect(result.complete).toBe(true);
        expect(result.stopReason).toBeNull();
        expect(result.picks.length).toBe(ground.pickLog.length);

        // The real claim (issue #1613 fixup, non-blocking finding 1): the
        // ORIGINAL assertion here compared `historicalCardId` — read FROM
        // `seatInput.pool`, i.e. `ground.seats[...].pool` itself — back
        // against that SAME pool, which is tautological by construction
        // (`reconstructDraftReplay` always sets `historicalCardId` straight
        // from its `seats` input; it can never disagree with it). Seed
        // fidelity means something stronger: the FRESHLY REGENERATED pack at
        // each pick — built from the seed alone, independent of the stored
        // pool — actually CONTAINS the historically-recorded card. If the
        // seed didn't reproduce the same packs, `pack.find(...)` inside
        // `reconstructDraftReplay` would have failed and the reconstruction
        // would have stopped with `"pool-mismatch"` instead of `complete`.
        for (const entry of result.picks) {
            expect(
                entry.pack.some((c) => c.cardId === entry.historicalCardId)
            ).toBe(true);
        }
    });

    it("has zero divergence when nothing about the scorer changed", () => {
        const getPickRating = buildDraftLabPickRating(packSlots);
        const ground = runFullDraftLab(7, packSlots);

        const result = reconstructDraftReplay(
            7,
            packSlots,
            seatInputsFrom(ground.seats),
            draftLabGetCardEvalMeta,
            getPickRating
        );

        expect(result.firstDivergedPickIndex).toBeNull();
        expect(result.picks.every((p) => !p.diverged)).toBe(true);
        // Every bot pick got a real recomputed annotation (this synthetic
        // draft is all-bot).
        expect(result.picks.every((p) => p.recomputedCardId !== null)).toBe(
            true
        );
    });

    it("same seed reconstructs the same result, every run", () => {
        const getPickRating = buildDraftLabPickRating(packSlots);
        const ground = runFullDraftLab(13, packSlots);
        const seatInputs = seatInputsFrom(ground.seats);

        const a = reconstructDraftReplay(
            13,
            packSlots,
            seatInputs,
            draftLabGetCardEvalMeta,
            getPickRating
        );
        const b = reconstructDraftReplay(
            13,
            packSlots,
            seatInputs,
            draftLabGetCardEvalMeta,
            getPickRating
        );
        expect(a).toEqual(b);
    });
});

describe("reconstructDraftReplay — divergence detection (issue #1613 AC2)", () => {
    it("detects and marks the FIRST pick a deliberately altered weight moves", () => {
        const baselineRating = buildDraftLabPickRating(packSlots);
        const ground = runFullDraftLab(21, packSlots);

        // Pick 1 is always seat 0's first pick (seat order, empty pools).
        const firstPick = ground.pickLog[0];
        const historicalCardId = ground.seats[0].pool![0].cardId;
        // Any OTHER candidate in that same pack is a legal "the retuned
        // scorer prefers this instead" target.
        const alternate = firstPick.pack.find(
            (c) => c.cardId !== historicalCardId
        )!;

        // A "deliberately altered weight": force the alternate candidate's
        // Pick Rating to the maximum (5) and everything else in the pack to
        // the minimum (0) — a real, supported tuning lever (ADR 0073's
        // rating scale), not a change to `botDrafter.ts` itself.
        const alteredRating: GetPickRating = (cardId) => {
            if (cardId === alternate.cardId) return 5;
            if (firstPick.pack.some((c) => c.cardId === cardId)) return 0;
            return baselineRating(cardId);
        };

        const result = reconstructDraftReplay(
            21,
            packSlots,
            seatInputsFrom(ground.seats),
            draftLabGetCardEvalMeta,
            alteredRating
        );

        expect(result.firstDivergedPickIndex).toBe(1);
        const first = result.picks[0];
        expect(first.diverged).toBe(true);
        expect(first.historicalCardId).toBe(historicalCardId);
        expect(first.recomputedCardId).toBe(alternate.cardId);

        // Nothing past the divergence point is silently hidden — every
        // later pick is still present, computed, and returned.
        expect(result.picks.length).toBe(ground.pickLog.length);
        expect(result.complete).toBe(true);
    });

    it("a fully unaltered rerun of the SAME baseline never diverges (sanity check for the divergence lever above)", () => {
        const baselineRating = buildDraftLabPickRating(packSlots);
        const ground = runFullDraftLab(21, packSlots);
        const result = reconstructDraftReplay(
            21,
            packSlots,
            seatInputsFrom(ground.seats),
            draftLabGetCardEvalMeta,
            baselineRating
        );
        expect(result.firstDivergedPickIndex).toBeNull();
    });
});

describe("reconstructDraftReplay — stop conditions (issue #1613 AC3)", () => {
    it("stops with 'hidden-pool' when a seat's historical pool isn't visible to this viewer", () => {
        const getPickRating = buildDraftLabPickRating(packSlots);
        const ground = runFullDraftLab(5, packSlots);
        const seatInputs = seatInputsFrom(ground.seats).map((s) =>
            s.seatIndex === 0 ? { ...s, pool: null } : s
        );

        const result = reconstructDraftReplay(
            5,
            packSlots,
            seatInputs,
            draftLabGetCardEvalMeta,
            getPickRating
        );

        expect(result.complete).toBe(false);
        expect(result.stopReason).toBe("hidden-pool");
        expect(result.stoppedAtSeat).toBe(0);
        // Nothing after the stop point is fabricated.
        expect(result.picks.every((p) => p.seatIndex !== 0)).toBe(true);
    });

    it("stops with 'pool-mismatch' when a stored pool entry can't be found in the regenerated pack", () => {
        const getPickRating = buildDraftLabPickRating(packSlots);
        const ground = runFullDraftLab(9, packSlots);
        const seatInputs = seatInputsFrom(ground.seats).map((s) =>
            s.seatIndex === 0
                ? {
                      ...s,
                      pool: [
                          {
                              scryfallId: "not-a-real-scryfall-id",
                              cardId: "not-a-real-card-id",
                              cardName: "Not A Real Card",
                          },
                          ...(s.pool ?? []).slice(1),
                      ],
                  }
                : s
        );

        const result = reconstructDraftReplay(
            9,
            packSlots,
            seatInputs,
            draftLabGetCardEvalMeta,
            getPickRating
        );

        expect(result.complete).toBe(false);
        expect(result.stopReason).toBe("pool-mismatch");
        expect(result.stoppedAtSeat).toBe(0);
    });
});
