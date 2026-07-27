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
