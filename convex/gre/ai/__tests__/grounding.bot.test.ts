// Grounding-floor parity tests (issue #1520). `contextAwareGrounding` is
// meant to REFINE `contextFreeGrounding`'s representative-magnitude floor
// against real board state — never regress below it. For a genuinely
// unmodeled dynamic amount (`counters`, `kickerCount`, `escaped`) the
// context-aware resolver used to fall back to a bare 0, strictly LESS
// informed than the context-free floor it's supposed to sharpen (a "damage
// equal to charge counters" card priced at zero in a tutor prior).

import { describe, it, expect } from "vitest";
import { contextFreeGrounding } from "../grounding";
import { contextAwareGroundingForChoice } from "../candidateValue";
import {
    makeState,
    makePlayer,
    makeInstance,
} from "../../../cards/__tests__/setup";
import { getCardByName } from "../../../cards";
import type { EffectValue } from "../../../cards/types";

const BEAR_ID = getCardByName("Grizzly Bears").id;

const cf = contextFreeGrounding();

describe("context-aware grounding never regresses below the context-free floor (issue #1520)", () => {
    function stateFor() {
        return makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
            priorityPlayerId: "p1",
            activePlayerId: "p1",
        });
    }

    it("counters: context-aware matches the context-free floor for an unmodeled object", () => {
        const v: EffectValue = {
            counters: { of: { ref: "$source" }, type: "charge" },
        };
        const cfFloor = cf.value(v).amount;
        const state = stateFor();
        const aware = contextAwareGroundingForChoice(state, "p1").value(v);
        expect(aware.amount).toBeGreaterThanOrEqual(cfFloor);
        expect(aware.amount).toBe(cfFloor);
    });

    it("kickerCount: context-aware matches the context-free floor when unresolvable pre-cast", () => {
        const v: EffectValue = { kickerCount: true };
        const cfFloor = cf.value(v).amount;
        const state = stateFor();
        const aware = contextAwareGroundingForChoice(state, "p1").value(v);
        expect(aware.amount).toBeGreaterThanOrEqual(cfFloor);
        expect(aware.amount).toBe(cfFloor);
    });

    it("escaped: context-aware matches the context-free floor for an unmodeled object", () => {
        const v: EffectValue = { escaped: { of: { ref: "$source" } } };
        const cfFloor = cf.value(v).amount;
        const state = stateFor();
        const aware = contextAwareGroundingForChoice(state, "p1").value(v);
        expect(aware.amount).toBeGreaterThanOrEqual(cfFloor);
        expect(aware.amount).toBe(cfFloor);
    });

    it("none of the three unmodeled amounts ground to a bare zero", () => {
        const state = stateFor();
        const grounding = contextAwareGroundingForChoice(state, "p1");
        const values: EffectValue[] = [
            { counters: { of: { ref: "$source" }, type: "charge" } },
            { kickerCount: true },
            { escaped: { of: { ref: "$source" } } },
        ];
        for (const v of values) {
            expect(grounding.value(v).amount).toBeGreaterThan(0);
        }
    });
});

// Every SCOPE and ZONE member of `EffectCountSpec` must be threaded through the
// context-aware count reader (`resolveCountSpecAgainstBoard`,
// `gre/ai/candidateValue.ts`). Its zone switch used to be a permissive
// `battlefield ? battlefield : graveyard` ternary and its scope switch had no
// `smallestAcrossPlayers` branch, so both new members FAILED OPEN: a library
// count read the GRAVEYARD, and a min-across-players count read the
// perspective player's zone alone. Neither is a crash — just a silently wrong
// bot valuation, which is exactly why it needs a test.
describe("context-aware count grounding threads every EffectCountSpec zone/scope (CR 122 / 401, issue #783)", () => {
    /** p1's library `own` deep, p2's `opp` deep, both graveyards `gy` deep. */
    function stateWith(own: number, opp: number, gy: number) {
        const pile = (
            owner: string,
            zone: "library" | "graveyard",
            n: number
        ) =>
            Array.from({ length: n }, (_, i) =>
                makeInstance(BEAR_ID, {
                    id: `${owner}-${zone}-${i}`,
                    controllerId: owner,
                    ownerId: owner,
                    zone,
                })
            );
        return makeState({
            players: [
                makePlayer("p1", {
                    library: pile("p1", "library", own),
                    graveyard: pile("p1", "graveyard", gy),
                }),
                makePlayer("p2", {
                    library: pile("p2", "library", opp),
                    graveyard: pile("p2", "graveyard", gy),
                }),
            ],
        });
    }

    it('CR 401 — a `zone: "library"` count reads the LIBRARY, not the graveyard', () => {
        // Distinct pile sizes: reading the wrong zone yields a different number.
        const state = stateWith(7, 30, 3);
        const v: EffectValue = {
            count: { zone: "library", controller: "controller" },
        };
        expect(
            contextAwareGroundingForChoice(state, "p1").value(v).amount
        ).toBe(7);
    });

    it("CR 122 — `smallestAcrossPlayers` takes the MIN across players, not the perspective player's own zone", () => {
        // The OPPONENT holds the small library — the shape Shelldock Isle's "if
        // a library has twenty or fewer cards in it" gate turns on.
        const state = stateWith(40, 12, 3);
        const v: EffectValue = {
            count: { zone: "library", smallestAcrossPlayers: true },
        };
        expect(
            contextAwareGroundingForChoice(state, "p1").value(v).amount
        ).toBe(12);
    });

    it("CR 122 — `acrossAllPlayers` still SUMS, and the single-player scope still reads one zone", () => {
        const state = stateWith(40, 12, 3);
        const grounding = contextAwareGroundingForChoice(state, "p1");
        expect(
            grounding.value({
                count: { zone: "library", acrossAllPlayers: true },
            }).amount
        ).toBe(52);
        expect(
            grounding.value({
                count: { zone: "graveyard", controller: "opponent" },
            }).amount
        ).toBe(3);
    });
});
