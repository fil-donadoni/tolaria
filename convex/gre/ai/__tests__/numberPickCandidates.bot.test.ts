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
import { MAX_CHOSEN_NUMBER } from "../../constants";
import type { GameState, PendingChoice } from "../../state";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../cards/__tests__/setup";
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

// --- the BARE nomination (CR 107.1c, issue #1421) ---------------------------
//
// `numberChoiceRange` bounds "choose a number" only by the engine cap
// (`MAX_CHOSEN_NUMBER`) — a range no generator should bisect, since its
// midpoint is a branch no line of play distinguishes. The generator therefore
// derives its own searchable ceiling off the board. Two silent failures live
// here: a ceiling left at the cap (999 and 499 become branches, and the four
// answers that matter share the remaining slots), and a ceiling collapsed to
// the floor (every candidate is 0, so the bot answers Void by destroying
// nothing, and no suite reds).

const BARE_NOMINATOR_ID = "test-bot-choosenumber-nominator";
registerTokenDefinition({
    id: BARE_NOMINATOR_ID,
    name: BARE_NOMINATOR_ID,
    rarity: "common",
    manaCost: { R: 1 },
    types: ["Sorcery"],
    effects: [
        {
            op: "chooseNumber",
            player: "controller",
            prompt: "Choose a number",
            bind: "$n",
        },
        { op: "gainLife", player: "controller", amount: { ref: "$n" } },
    ],
});

/** Synthetic permanents/cards whose only interesting property is their mana
 *  value — the axis the board-derived ceiling reads (CR 202.3). */
function registerCostedCard(id: string, generic: number): string {
    registerTokenDefinition({
        id,
        name: id,
        rarity: "common",
        manaCost: { generic },
        types: ["Creature"],
        subtypes: ["Golem"],
        power: 1,
        toughness: 1,
    });
    return id;
}

const MV4_ID = registerCostedCard("test-bot-choosenumber-mv4", 4);
const MV6_ID = registerCostedCard("test-bot-choosenumber-mv6", 6);
const MV2_ID = registerCostedCard("test-bot-choosenumber-mv2", 2);

function suspendedBareNomination(
    build: (p1: ReturnType<typeof makePlayer>) => void = () => {}
): GameState {
    const p1 = makePlayer("p1");
    build(p1);
    const state = makeState({ players: [p1, makePlayer("p2")] });
    pushSpell(state, BARE_NOMINATOR_ID, "p1");
    resolveTopOfStack(state);
    return state;
}

const amountsOf = (state: GameState, choice: PendingChoice) =>
    generate(state, choice).map((c) =>
        c.move.kind === "number-choice" ? c.move.amount : -1
    );

describe("number-pick candidates for a BARE nomination (CR 107.1c, issue #1421)", () => {
    it("bounds the capped legal range down to the board's highest mana value", () => {
        const state = suspendedBareNomination((p1) => {
            p1.battlefield = [
                makeInstance(MV4_ID, { controllerId: "p1" }),
                makeInstance(MV2_ID, { controllerId: "p1" }),
            ];
        });
        const choice = state.pendingChoices![0];
        // The LEGAL range runs to the engine cap — the generator must not
        // narrow what a human may answer.
        expect(numberChoiceRange(choice, state.players[0]).max).toBe(
            MAX_CHOSEN_NUMBER
        );
        const amounts = amountsOf(state, choice);
        // …and the SEARCHED set is finite, ends at the highest mana value on
        // the board, and spans both ends.
        expect(amounts.every((n) => Number.isFinite(n))).toBe(true);
        expect(amounts.length).toBeLessThanOrEqual(5);
        expect(amounts).toContain(0);
        expect(amounts).toContain(4);
        expect(Math.max(...amounts)).toBe(4);
    });

    it("reads the OPPONENT's battlefield too — their permanents are what the number is usually about", () => {
        const state = suspendedBareNomination();
        state.players[1].battlefield = [
            makeInstance(MV6_ID, { controllerId: "p2", ownerId: "p2" }),
        ];
        const amounts = amountsOf(state, state.pendingChoices![0]);
        expect(Math.max(...amounts)).toBe(6);
    });

    it("reads EVERY hand, the opponent's included — Void's discard half names a target player", () => {
        // Not a hidden-information leak: inside ISMCTS the state handed to a
        // generator is the DETERMINIZED one, a sampled member of the
        // information set, which is the same reason reading the opponent's
        // battlefield is fair. Narrowing to the chooser's own hand would make
        // the search blind to the half of Void that hits someone else's.
        const state = suspendedBareNomination();
        state.players[0].hand = [
            makeInstance(MV4_ID, { controllerId: "p1", zone: "hand" }),
        ];
        state.players[1].hand = [
            makeInstance(MV6_ID, {
                controllerId: "p2",
                ownerId: "p2",
                zone: "hand",
            }),
        ];
        const amounts = amountsOf(state, state.pendingChoices![0]);
        expect(Math.max(...amounts)).toBe(6);
    });

    it("never bisects the engine cap — 499 and 999 are not branches", () => {
        const state = suspendedBareNomination((p1) => {
            p1.battlefield = [makeInstance(MV2_ID, { controllerId: "p1" })];
        });
        const amounts = amountsOf(state, state.pendingChoices![0]);
        expect(amounts).not.toContain(MAX_CHOSEN_NUMBER);
        expect(amounts.every((n) => n <= 2)).toBe(true);
    });

    it("collapses to the decline alone on an empty board — never an empty set, never Infinity", () => {
        const state = suspendedBareNomination();
        const candidates = generate(state, state.pendingChoices![0]);
        expect(candidates).toHaveLength(1);
        expect(candidates[0].move).toEqual({
            kind: "number-choice",
            amount: 0,
        });
    });

    it("the search APPLIES a bare answer through the authoritative resolver, spending nothing", () => {
        const state = suspendedBareNomination((p1) => {
            p1.manaPool = { W: 0, U: 0, B: 0, R: 3, G: 0, C: 0 };
            p1.battlefield = [makeInstance(MV4_ID, { controllerId: "p1" })];
        });
        applyMoveInSearch(state, "p1", { kind: "number-choice", amount: 4 });
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.players[0].manaPool.R).toBe(3); // a bare nomination pays nothing
        expect(state.players[0].life).toBe(24);
        expect(state.stack).toHaveLength(0);
    });
});
