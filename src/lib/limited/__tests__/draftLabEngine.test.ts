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
    draftLabSeatCount,
    initDraftLab,
    runFullDraftLab,
    standardPackSlots,
    stepDraftLab,
} from "../draftLabEngine";
import { CUBE_SOURCE_KEY } from "@convex/limited/cubeSource";
import {
    buildCubePool,
    maxCubeSeats,
    CUBE_PACK_SIZE,
} from "@convex/limited/cube";
import type { ScopedCardProfile } from "@convex/limited/cardProfilesCore";

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

    it("deals round 0 to every seat with a full pack each, no picks yet", () => {
        const state = initDraftLab(7, standardPackSlots(CUBE_SOURCE_KEY));
        // A cube table is clamped to what the implemented pool can fill
        // SINGLETON (`draftLabSeatCount` / `maxCubeSeats`), so this is ≤ the
        // standard 8 — never more, and never a table dealt with duplicates.
        expect(state.seats.length).toBeGreaterThan(0);
        expect(state.seats.length).toBeLessThanOrEqual(DRAFT_LAB_SEAT_COUNT);
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

describe("Draft Lab cube singleton (ADR 0062 — the 8-seat duplicate bug)", () => {
    const packSlots = standardPackSlots(CUBE_SOURCE_KEY);

    it("clamps a cube table to what the implemented pool can fill singleton", () => {
        // The Lab used to ask for 8 seats unconditionally. 8 × 15 × 3 = 360
        // cards, more than the implemented pool holds, so the deal wrapped and
        // handed out the same cards twice. The clamp is computed from the SAME
        // `maxCubeSeats` authority the server caps a real event with.
        const poolSize = buildCubePool().length;
        const cap = maxCubeSeats(poolSize, CUBE_PACK_SIZE, packSlots.length);
        expect(draftLabSeatCount(8, packSlots, poolSize)).toBe(
            Math.min(8, cap)
        );
        // Asking for fewer than the cap is honoured as-is.
        expect(draftLabSeatCount(2, packSlots, poolSize)).toBe(2);
    });

    it("never clamps a per-set Pack Source (a set is sampled with replacement)", () => {
        expect(draftLabSeatCount(8, ["lea", "lea", "lea"], 0)).toBe(8);
    });

    it("deals a whole cube session with NO card dealt twice", () => {
        const state = runFullDraftLab(20260727, packSlots);
        expect(state.completed).toBe(true);
        const dealt = state.seats.flatMap((s) =>
            (s.pool ?? []).map((c) => c.scryfallId)
        );
        expect(dealt.length).toBeGreaterThan(0);
        expect(new Set(dealt).size).toBe(dealt.length);
    });

    it("freezes the pool on the session state, and every round slices that one snapshot", () => {
        const state = initDraftLab(11, packSlots);
        expect(state.cubePool).toEqual(buildCubePool());
        // A per-set session carries no cube pool at all.
        expect(
            initDraftLab(11, ["lea", "lea", "lea"]).cubePool
        ).toBeUndefined();
    });
});
