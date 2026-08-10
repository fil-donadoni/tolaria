// devotion — the fifteenth EffectValue grammar member (CR 700.5, issue #2070):
// `{ devotion: { of, color } }`, a player's devotion to one colour, read
// through `SpellContext.getDevotion` over the single `countDevotion` scan.
//
// Follows the same real-resolution-path convention as every other value-member
// test in `interpreter.test.ts` — a synthetic DSL-only card is registered,
// pushed on the stack and resolved via `resolveTopOfStack`, with a wire-format
// assertion through `projectPublicState` (ADR 0045/0046 testing convention).
// It lives in its own file rather than in `interpreter.test.ts` for the reason
// `pileDivision.test.ts` does: this file imports no `convex/game.ts`, so it
// stays runnable wherever the Convex-generated modules are not built.

import { describe, it, expect } from "vitest";
import type { CardDefinition, EffectOp } from "../../../cards/types";
import { registerTokenDefinition } from "../../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../cards/__tests__/setup";
import { resolveTopOfStack } from "../../state";
import { projectPublicState } from "../../../gameProjections";
import { countDevotion } from "../../../cards/devotion";

function registerScript(
    id: string,
    effects: EffectOp[],
    extra: Partial<CardDefinition> = {}
): string {
    registerTokenDefinition({
        id,
        name: id,
        rarity: "common",
        manaCost: { R: 1 },
        types: ["Sorcery"],
        effects,
        ...extra,
    });
    return id;
}

/** A synthetic permanent whose printed cost is exactly `manaCost` — the only
 *  thing devotion reads. */
function registerPermanent(id: string, manaCost: CardDefinition["manaCost"]) {
    registerTokenDefinition({
        id,
        name: id,
        rarity: "common",
        manaCost,
        types: ["Creature"],
        subtypes: ["Human"],
        power: 1,
        toughness: 1,
    });
    return id;
}

// CR 700.5 counting fixtures — one permanent per symbol shape.
const DOUBLE_BLUE = registerPermanent("test-dev-uu", { U: 2 });
const ONE_BLUE_GENERIC = registerPermanent("test-dev-4u", { X: 4, U: 1 });
const HYBRID_UB = registerPermanent("test-dev-hybrid-ub", {
    hybrid: [["U", "B"]],
});
const PHYREXIAN_U = registerPermanent("test-dev-phyrexian-u", {
    phyrexian: { U: 1 },
});
const COLOURLESS = registerPermanent("test-dev-colourless", { X: 3, C: 2 });

/** "Deal damage equal to your devotion to blue" — the shape every assertion
 *  below reads the count back through. */
const DAMAGE_BY_BLUE_DEVOTION = registerScript("test-dev-damage-blue", [
    {
        op: "dealDamage",
        amount: { devotion: { of: "controller", color: "U" } },
        to: { player: "opponent" },
    },
]);

function stateWithBoard(cardIds: string[], controllerId = "p1") {
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: cardIds.map((cid, i) =>
                    makeInstance(cid, {
                        id: `perm-${i}`,
                        controllerId,
                        ownerId: controllerId,
                    })
                ),
            }),
            makePlayer("p2"),
        ],
    });
}

describe("Effect Script value: devotion (CR 700.5, issue #2070)", () => {
    it("counts mana SYMBOLS, not permanents — one {U}{U} permanent is devotion 2", () => {
        const state = stateWithBoard([DOUBLE_BLUE]);
        pushSpell(state, DAMAGE_BY_BLUE_DEVOTION, "p1");
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(18); // 20 - 2
    });

    it("sums across permanents and ignores generic mana", () => {
        // {U}{U} (2) + {4}{U} (1) = 3 — the {4} contributes nothing (CR 700.5
        // counts coloured mana symbols only).
        const state = stateWithBoard([DOUBLE_BLUE, ONE_BLUE_GENERIC]);
        pushSpell(state, DAMAGE_BY_BLUE_DEVOTION, "p1");
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(17); // 20 - 3
    });

    it("counts a guild-hybrid pip toward BOTH its colours (CR 105.2)", () => {
        const blue = stateWithBoard([HYBRID_UB]);
        pushSpell(blue, DAMAGE_BY_BLUE_DEVOTION, "p1");
        resolveTopOfStack(blue);
        expect(blue.players[1].life).toBe(19); // {U/B} is a blue mana symbol

        const damageByBlack = registerScript("test-dev-damage-black", [
            {
                op: "dealDamage",
                amount: { devotion: { of: "controller", color: "B" } },
                to: { player: "opponent" },
            },
        ]);
        const black = stateWithBoard([HYBRID_UB]);
        pushSpell(black, damageByBlack, "p1");
        resolveTopOfStack(black);
        expect(black.players[1].life).toBe(19); // ...and a black one, same pip
    });

    it("counts a Phyrexian pip toward its colour (CR 105.2)", () => {
        const state = stateWithBoard([PHYREXIAN_U]);
        pushSpell(state, DAMAGE_BY_BLUE_DEVOTION, "p1");
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(19); // {U/P} is still a blue symbol
    });

    it("is 0 for a board of colourless permanents (CR 202.2 — no blue symbols)", () => {
        const state = stateWithBoard([COLOURLESS]);
        pushSpell(state, DAMAGE_BY_BLUE_DEVOTION, "p1");
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(20); // 0 damage
    });

    it("reads the permanents of the player the `of` selector names, not the resolver", () => {
        // CR 110.4 — devotion is scoped by CONTROL. p2 holds the blue board;
        // `of: "opponent"` from p1's spell must read p2's devotion, not p1's.
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(DOUBLE_BLUE, {
                            id: "p1-blue",
                            controllerId: "p1",
                        }),
                    ],
                }),
                makePlayer("p2", {
                    battlefield: [
                        makeInstance(DOUBLE_BLUE, {
                            id: "p2-blue-a",
                            controllerId: "p2",
                            ownerId: "p2",
                        }),
                        makeInstance(PHYREXIAN_U, {
                            id: "p2-blue-b",
                            controllerId: "p2",
                            ownerId: "p2",
                        }),
                    ],
                }),
            ],
        });
        const id = registerScript("test-dev-damage-opponent", [
            {
                op: "dealDamage",
                amount: { devotion: { of: "opponent", color: "U" } },
                to: { player: "opponent" },
            },
        ]);
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        // p2's devotion is 3 ({U}{U} + {U/P}), not p1's 2.
        expect(state.players[1].life).toBe(17);
    });

    it("gates a comparison predicate — the Thassa's Oracle win-check shape", () => {
        // `devotion >= cards in your library` (CR 700.5 read on the left, a
        // CR 401 library cardinality on the right).
        const id = registerScript("test-dev-vs-library", [
            {
                op: "if",
                predicate: {
                    left: { devotion: { of: "controller", color: "U" } },
                    op: "ge",
                    right: {
                        count: { zone: "library", controller: "controller" },
                    },
                },
                then: [
                    { op: "dealDamage", amount: 5, to: { player: "opponent" } },
                ],
                else: [
                    { op: "dealDamage", amount: 1, to: { player: "opponent" } },
                ],
            },
        ]);
        const withLibrary = (size: number) => {
            const state = stateWithBoard([DOUBLE_BLUE]);
            state.players[0].library = Array.from({ length: size }, (_, i) =>
                makeInstance(COLOURLESS, { id: `lib-${i}`, zone: "library" })
            );
            pushSpell(state, id, "p1");
            resolveTopOfStack(state);
            return state.players[1].life;
        };

        // Devotion 2 vs an EMPTY library — the branch the combo turns on.
        expect(withLibrary(0)).toBe(15);
        // Devotion 2 vs a 2-card library — `ge`, so exactly equal still wins.
        // This is the case that pins the MAGNITUDE: a devotion stuck at 0 (or
        // at 1) takes the else branch here, where the empty-library case above
        // would still read as a pass.
        expect(withLibrary(2)).toBe(15);
        // Devotion 2 vs a 3-card library — not enough.
        expect(withLibrary(3)).toBe(19);
    });

    it("survives the wire projection — the client reads the same devotion", () => {
        // The projection strips `card.card` to `{ id }` (`projectPublicState`),
        // which is exactly the field `getInstanceManaCost` falls back to the
        // registry through. A devotion read against the PROJECTED board must
        // therefore still see the printed pips.
        const state = stateWithBoard([DOUBLE_BLUE, HYBRID_UB]);
        const projected = projectPublicState(state, 1, "p1");
        const board = projected.players[0].battlefield;
        expect(board).toHaveLength(2);
        // {U}{U} + {U/B} = 3 blue symbols, read off the slim wire instances.
        expect(
            countDevotion(
                projected as unknown as Parameters<typeof countDevotion>[0],
                "p1",
                "U"
            )
        ).toBe(3);
    });
});
