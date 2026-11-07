/**
 * The classes issue #8271 fixed on the way to the Vintage Cube's level-2 pairs,
 * each pinned below the blade suite so a proof-of-failure can run in seconds.
 *
 *  - CR 601.2b / 119.4: "pay X life" announces an X. The Move used to carry
 *    none, so the only cast the Bot could weigh was X = 0.
 *  - CR 608.2d: a mandatory pick out of the opponent's hand is a decision node.
 *  - The two root predicates: an extra turn's credit needs a creature, and a
 *    sacrifice outlet is not idle while its fodder is in a live exchange.
 *
 * The entries themselves are the blade suite's; this file names the mechanism.
 */

import { describe, expect, it } from "vitest";
import { buildBladeState, findBladeScenario, runBladeScenario } from "..";
import { matchesMove, seatPlayerId } from "../matcher";
import { choiceCandidates } from "../../choiceCandidates";
import { enumerateMoves, type Move } from "../../../moves";
import { applyMoveInSearch } from "../../../search";
import { getPlayer } from "../../../state";
import { PAY_X_LIFE_ENUMERATION_CAP } from "../../../additionalCost";
import type { BladeScenario } from "../types";

function entry(label: string): BladeScenario {
    const found = findBladeScenario(label);
    if (!found) throw new Error(`No blade entry "${label}"`);
    return found;
}

const DELUGE = "life X: Toxic Deluge pays exactly what the sweep needs";
const DELUGE_AT_2 = "life X: Toxic Deluge never pays to lethal";
const STRIP_PICK =
    "strip: Thoughtseize takes the Shivan Dragon, not the Savannah Lions";

function deluges(label: string): Extract<Move, { kind: "cast-spell" }>[] {
    const state = buildBladeState(entry(label));
    return enumerateMoves(state, seatPlayerId(state, "me")).filter(
        (m): m is Extract<Move, { kind: "cast-spell" }> =>
            m.kind === "cast-spell"
    );
}

describe("pay X life announces an X (CR 601.2b / 119.4, issue #8271)", () => {
    it("offers one cast per X, up to the enumeration cap", () => {
        expect(deluges(DELUGE).map((m) => m.chosenX)).toEqual(
            Array.from({ length: PAY_X_LIFE_ENUMERATION_CAP + 1 }, (_, i) => i)
        );
    });

    it("offers every X the life total can pay, lethal included", () => {
        expect(deluges(DELUGE_AT_2).map((m) => m.chosenX)).toEqual([0, 1, 2]);
    });

    it("the Move carries the life, and the search's sandbox charges it", () => {
        const state = buildBladeState(entry(DELUGE));
        const me = seatPlayerId(state, "me");
        const three = deluges(DELUGE).find((m) => m.chosenX === 3)!;
        expect(three.payLife).toBe(3);
        applyMoveInSearch(state, me, three);
        expect(getPlayer(state, me).life).toBe(17);
    });
});

describe("a strip is a decision node, best card first (CR 608.2d, issue #8271)", () => {
    it("a mandatory pick out of the opponent's hand offers no empty answer and drops the far weaker card", () => {
        const state = buildBladeState(entry(STRIP_PICK));
        const choice = state.pendingChoices![0];
        const candidates = choiceCandidates(state, choice);
        expect(candidates.map((c) => c.key)).toHaveLength(1);
        expect(
            matchesMove(state, candidates[0].move, {
                kind: "resolution-choice",
                card: "Shivan Dragon",
            })
        ).toBe(true);
    });
});

describe("a strip over a hand worth nothing (issue #8271)", () => {
    it("still answers: a negative best card must not raise the floor above itself", () => {
        const base = entry(STRIP_PICK);
        const state = buildBladeState({
            ...base,
            spec: {
                ...base.spec,
                cards: [
                    ...base.spec.cards.filter(
                        (c) => c.zone !== "hand" || c.owner !== "opp"
                    ),
                    { name: "Pestilence", owner: "opp", zone: "hand" },
                ],
            },
            expect: { forbidden: [{ kind: "pass" }] },
        });
        const choice = state.pendingChoices![0];
        expect(choiceCandidates(state, choice).length).toBeGreaterThan(0);
    });
});

describe("root predicates, through the real search (issue #8271)", () => {
    it.each([
        "extra turn: holds Time Walk with no board",
        "sacrifice outlet: Goblin Bombardment takes the blocked creature before it dies",
    ])("%s", (label) => {
        const result = runBladeScenario(entry(label));
        expect(result.failureMessage).toBe("");
        expect(result.ok).toBe(true);
    });
});

describe("Skullclamp's minimal pair: the opponent's life flips the equip (issue #8298)", () => {
    it.each([
        "equipment: Skullclamp equips the 1-toughness creature and draws",
        "equipment: Skullclamp stays off the 1-toughness attacker with lethal on board",
    ])("%s", (label) => {
        const result = runBladeScenario(entry(label));
        expect(result.failureMessage).toBe("");
        expect(result.ok).toBe(true);
    });
});

describe("matcher: `x` and `ability` (issue #8271)", () => {
    it("`x` compares the announced X exactly, `ability` the activated ability's id", () => {
        const state = buildBladeState(entry(DELUGE));
        const two = deluges(DELUGE).find((m) => m.chosenX === 2)!;
        const base = { kind: "cast-spell", card: "Toxic Deluge" } as const;
        expect(matchesMove(state, two, { ...base, x: 2 })).toBe(true);
        expect(matchesMove(state, two, { ...base, x: 3 })).toBe(false);
        expect(matchesMove(state, two, { ...base, ability: "any" })).toBe(
            false
        );
    });
});
