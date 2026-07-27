// Draft Lab synthetic-mode engine tests (issue #1612, ADR 0074, PRD #1607
// slice 5). Covers the acceptance criteria the engine itself is responsible
// for: "same seed ⇒ same draft, every run", and that stepping produces the
// same result whole-draft-at-once does. Component-level rendering (the
// breakdown + provenance line, unreviewed profiles) is covered separately in
// `src/components/draft-lab/__tests__`; the "no Convex mutation" acceptance
// is covered by `draft-lab-no-mutation.test.ts`.
import { describe, it, expect } from "vitest";
import {
    DRAFT_LAB_SEAT_COUNT,
    buildDraftLabPickRating,
    initDraftLab,
    runFullDraftLab,
    standardPackSlots,
    stepDraftLab,
} from "../draftLabEngine";
import { CUBE_SOURCE_KEY } from "@convex/limited/cubeSource";
import type { ScopedCardProfile } from "@convex/limited/cardProfiles";

describe("Draft Lab synthetic mode engine (issue #1612, ADR 0074)", () => {
    it("same seed produces the same draft, every run", () => {
        const packSlots = standardPackSlots(CUBE_SOURCE_KEY);
        const a = runFullDraftLab(42, packSlots);
        const b = runFullDraftLab(42, packSlots);

        expect(a.completed).toBe(true);
        expect(b.completed).toBe(true);
        expect(a.pickLog.length).toBe(b.pickLog.length);
        expect(a.pickLog.map((r) => r.seatIndex)).toEqual(
            b.pickLog.map((r) => r.seatIndex)
        );
        expect(a.pickLog.map((r) => r.chosenPickId)).toEqual(
            b.pickLog.map((r) => r.chosenPickId)
        );
        // The breakdown itself is deterministic too, not just the choice —
        // otherwise a re-run could pick the same card for a different reason.
        expect(
            a.pickLog.map((r) => r.traces.map((t) => t?.score ?? null))
        ).toEqual(b.pickLog.map((r) => r.traces.map((t) => t?.score ?? null)));
        expect(a.seats).toEqual(b.seats);
    });

    it("a different seed produces a different draft", () => {
        const packSlots = standardPackSlots(CUBE_SOURCE_KEY);
        const a = runFullDraftLab(1, packSlots);
        const b = runFullDraftLab(2, packSlots);
        expect(a.pickLog.map((r) => r.chosenPickId)).not.toEqual(
            b.pickLog.map((r) => r.chosenPickId)
        );
    });

    it("deals round 0 to all 8 seats with a full pack each, no picks yet", () => {
        const state = initDraftLab(7, standardPackSlots(CUBE_SOURCE_KEY));
        expect(state.seats.length).toBe(DRAFT_LAB_SEAT_COUNT);
        for (const seat of state.seats) {
            expect(seat.isBot).toBe(true);
            expect(seat.currentPack?.length).toBeGreaterThan(0);
        }
        expect(state.completed).toBe(false);
        expect(state.pickLog).toEqual([]);
    });

    it("stepDraftLab advances exactly one pick and records its breakdown", () => {
        const packSlots = standardPackSlots(CUBE_SOURCE_KEY);
        const state = initDraftLab(7, packSlots);
        const getPickRating = buildDraftLabPickRating(packSlots);
        const next = stepDraftLab(state, getPickRating);

        expect(next.pickLog.length).toBe(1);
        const record = next.pickLog[0];
        expect(record.traces.length).toBe(record.pack.length);
        expect(record.traces.some((t) => t !== null)).toBe(true);
        expect(record.pack.some((c) => c.pickId === record.chosenPickId)).toBe(
            true
        );

        // The acting seat lost the picked card from its pack and gained one
        // pool entry; every other seat is untouched by this single step.
        const actingSeat = next.seats[record.seatIndex];
        expect(actingSeat.pool?.length).toBe(1);
        const untouchedSeat = next.seats.find(
            (s) => s.seatIndex !== record.seatIndex
        )!;
        expect(untouchedSeat.pool ?? []).toEqual([]);
    });

    it("is idempotent once completed", () => {
        const packSlots = standardPackSlots(CUBE_SOURCE_KEY);
        const getPickRating = buildDraftLabPickRating(packSlots);
        const full = runFullDraftLab(11, packSlots);
        const steppedAgain = stepDraftLab(full, getPickRating);
        expect(steppedAgain).toEqual(full);
    });

    it("replaying step-by-step yields the same result as running to completion", () => {
        const packSlots = standardPackSlots(CUBE_SOURCE_KEY);
        const getPickRating = buildDraftLabPickRating(packSlots);
        let stepped = initDraftLab(99, packSlots);
        let guard = 0;
        while (!stepped.completed && guard < 10_000) {
            stepped = stepDraftLab(stepped, getPickRating);
            guard += 1;
        }
        const full = runFullDraftLab(99, packSlots);
        expect(stepped.pickLog.map((r) => r.chosenPickId)).toEqual(
            full.pickLog.map((r) => r.chosenPickId)
        );
        expect(stepped.completed).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────
// Card Profiles are SCORE-BEARING now (ADR 0072, issue #1611), so the rows
// the Lab scores with are SNAPSHOTTED into `DraftLabState` at `initDraftLab`.
// These tests pin both halves of that: the rows genuinely move picks (so a
// live `useQuery` closure read per step WOULD have made the replay depend on
// when the query resolved), and a snapshot replays identically.
// ─────────────────────────────────────────────────────────────────────────
describe("Draft Lab Card Profile snapshot (ADR 0072, issue #1611)", () => {
    const packSlots = standardPackSlots(CUBE_SOURCE_KEY);

    /** A census over roughly half the cards this seed actually deals, derived
     *  from a profile-free run so the fixture can never drift out of sync with
     *  the cube's contents. Two complementary halves of one archetype pair, so
     *  both Archetype Fit and Capability Fit have something to bite on. */
    function censusFor(seed: number): ScopedCardProfile[] {
        const bare = runFullDraftLab(seed, packSlots);
        const cardIds = [
            ...new Set(
                bare.pickLog.flatMap((r) => r.pack.map((c) => c.cardId))
            ),
        ].sort();
        return cardIds
            .filter((_, i) => i % 2 === 0)
            .map((cardId, i) => ({
                scope: CUBE_SOURCE_KEY,
                cardId,
                archetypes: ["lab-archetype"],
                provides: i % 2 === 0 ? ["value-on-death"] : [],
                requires: i % 2 === 0 ? [] : ["value-on-death"],
                reviewed: true,
            }));
    }

    it("a snapshotted census actually moves picks — the reason it must not be read live", () => {
        const seed = 4242;
        const rows = censusFor(seed);
        expect(rows.length).toBeGreaterThan(0);
        const without = runFullDraftLab(seed, packSlots);
        const with_ = runFullDraftLab(
            seed,
            packSlots,
            DRAFT_LAB_SEAT_COUNT,
            rows
        );
        expect(with_.pickLog.map((r) => r.chosenPickId)).not.toEqual(
            without.pickLog.map((r) => r.chosenPickId)
        );
    });

    it("same seed AND same snapshot ⇒ same draft, every run", () => {
        const seed = 4242;
        const rows = censusFor(seed);
        const a = runFullDraftLab(seed, packSlots, DRAFT_LAB_SEAT_COUNT, rows);
        const b = runFullDraftLab(seed, packSlots, DRAFT_LAB_SEAT_COUNT, rows);
        expect(a.pickLog.map((r) => r.chosenPickId)).toEqual(
            b.pickLog.map((r) => r.chosenPickId)
        );
        expect(
            a.pickLog.map((r) => r.traces.map((t) => t?.score ?? null))
        ).toEqual(b.pickLog.map((r) => r.traces.map((t) => t?.score ?? null)));
    });

    it("the rows are frozen into the state at init — nothing outside it can change a running draft", () => {
        const seed = 4242;
        const rows = censusFor(seed);
        const state = initDraftLab(seed, packSlots, DRAFT_LAB_SEAT_COUNT, rows);
        expect(state.cardProfileRows).toEqual(rows);
        // Stepping carries the snapshot forward untouched: the ONLY inputs
        // `stepDraftLab` has are the state and the rating lookup, so no late
        // query result can reach it.
        const getPickRating = buildDraftLabPickRating(packSlots);
        const stepped = stepDraftLab(state, getPickRating);
        expect(stepped.cardProfileRows).toEqual(rows);
    });

    it("no snapshot at all degrades to the pre-#1611 draft, unchanged", () => {
        const seed = 99;
        const explicitlyEmpty = runFullDraftLab(
            seed,
            packSlots,
            DRAFT_LAB_SEAT_COUNT,
            []
        );
        const omitted = runFullDraftLab(seed, packSlots);
        expect(explicitlyEmpty.pickLog.map((r) => r.chosenPickId)).toEqual(
            omitted.pickLog.map((r) => r.chosenPickId)
        );
    });
});
