// Bot reachability for the numeric nomination (CR 107.1b / 107.3f, issue
// #1701): can the search ANSWER a `number-pick`, and is its candidate set
// finite, legal and self-pruning?
//
// The failure this guards is the silent one. Without a generator the kind is
// not an in-tree decision node at all: the settle cannot get past the suspended
// prompt, and the brain's minimal-legal fallback answers every "you may pay
// {X}" with the floor — zero — so Decree of Justice cycles into no Soldiers and
// Power Leak never prevents a point. No suite reds on that; the bot just plays
// the card as if it had no second half.

import { describe, it, expect } from "vitest";
import {
    CHOICE_CANDIDATE_GENERATORS,
    hasChoiceCandidateGenerator,
    isSearchableChoiceNode,
} from "../choiceCandidates";
import { applyMoveInSearch } from "../../search";
import { numberChoiceRange } from "../../state";
import type { GameState, PendingChoice } from "../../state";
import { makePlayer, makeState } from "../../../cards/__tests__/setup";
import { registerTokenDefinition } from "../../../cards";
import { pushSpell } from "../../../cards/__tests__/setup";
import { resolveTopOfStack } from "../../state";

const NOMINATOR_ID = "test-bot-payvariable-nominator";
registerTokenDefinition({
    id: NOMINATOR_ID,
    name: NOMINATOR_ID,
    rarity: "common",
    manaCost: { R: 1 },
    types: ["Sorcery"],
    effects: [
        {
            op: "payVariableMana",
            player: "controller",
            prompt: "Pay any amount of mana",
            bind: "$paid",
        },
        { op: "gainLife", player: "controller", amount: { ref: "$paid" } },
    ],
});

/** A real suspended nomination: the script is pushed and resolved through the
 *  engine, so the `PendingChoice` under test is the one the engine actually
 *  builds — not a hand-written literal that could drift from it. */
function suspendedNomination(pool: Record<string, number>): GameState {
    const state = makeState({
        players: [makePlayer("p1", { manaPool: pool }), makePlayer("p2")],
    });
    pushSpell(state, NOMINATOR_ID, "p1");
    resolveTopOfStack(state);
    return state;
}

const generate = (state: GameState, choice: PendingChoice) =>
    CHOICE_CANDIDATE_GENERATORS["number-pick"]!(state, choice);

describe("number-pick candidate generator (CR 107.3f, issue #1701)", () => {
    it("is a registered, searchable decision node", () => {
        const state = suspendedNomination({ R: 5 });
        expect(hasChoiceCandidateGenerator("number-pick")).toBe(true);
        expect(isSearchableChoiceNode(state.pendingChoices![0])).toBe(true);
    });

    it("emits a FINITE, self-pruned set spanning both ends of the range", () => {
        const state = suspendedNomination({ R: 8 });
        const choice = state.pendingChoices![0];
        const candidates = generate(state, choice);
        const amounts = candidates.map((c) =>
            c.move.kind === "number-choice" ? c.move.amount : -1
        );
        // Bounded: never the whole 0..8 lattice.
        expect(amounts.length).toBeLessThanOrEqual(5);
        // Both ends are there — the decline (CR 107.3f's X = 0) and the full
        // pool, which is the only interesting answer for a count-scaled
        // consequence like Decree of Justice's X Soldiers.
        expect(amounts).toContain(0);
        expect(amounts).toContain(8);
        // …and the small values, which is where a CAPPED consequence lives
        // (Power Leak prevents at most 2 of 2).
        expect(amounts).toContain(1);
        expect(amounts).toContain(2);
        // No duplicates: each amount is one branch.
        expect(new Set(amounts).size).toBe(amounts.length);
    });

    it("every candidate is legal by construction — inside the live range", () => {
        const state = suspendedNomination({ R: 2, G: 1 });
        const choice = state.pendingChoices![0];
        const { min, max } = numberChoiceRange(choice, state.players[0]);
        for (const candidate of generate(state, choice)) {
            expect(candidate.move.kind).toBe("number-choice");
            if (candidate.move.kind !== "number-choice") continue;
            expect(candidate.move.amount).toBeGreaterThanOrEqual(min);
            expect(candidate.move.amount).toBeLessThanOrEqual(max);
        }
    });

    it("collapses to the decline alone when the pool is empty — never an empty candidate set", () => {
        const state = suspendedNomination({});
        const candidates = generate(state, state.pendingChoices![0]);
        expect(candidates).toHaveLength(1);
        expect(candidates[0].move).toEqual({
            kind: "number-choice",
            amount: 0,
        });
    });

    it("the search APPLIES the answer through the authoritative resolver — the mana is really spent and the playout moves past the node", () => {
        const state = suspendedNomination({ R: 5 });
        applyMoveInSearch(state, "p1", { kind: "number-choice", amount: 3 });
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.players[0].manaPool.R).toBe(2);
        expect(state.players[0].life).toBe(23);
        expect(state.stack).toHaveLength(0);
    });
});
