// CR 101.2 — "Spells and abilities your opponents control can't cause you to
// discard cards or sacrifice permanents" (issue #2607, Tamiyo, Collector of
// Tales). A `player-guard`'s `opponentsCantCause` clause, consulted at every
// effect-driven discard and sacrifice producer (census on
// `isOpponentCauseProhibited`, `gre/permanentGuard.ts`):
//   - the discard chokepoint `discardToGraveyard` and `discardCardsAtRandom`;
//   - the sacrifice funnel `removePermanentTo` (a resolving item's causer);
//   - `requestMayPay` — a sacrifice/discard payment leg can't be taken;
//   - `requestChoice` — a sacrifice/discard pick is answered empty.
// The guarded player's own spells and abilities are unaffected, and the rest of
// the opponent's spell still resolves.

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
    resolveActivated,
    submitChoice,
} from "../../cards/__tests__/setup.helper";
import { resolveTopOfStack, type GameState } from "../state";
import { applyNameCardSubmit } from "../pendingChoiceSubmit";
import { projectPublicState } from "../../gameProjections";
import { getDefinition, withTemporaryDefinition } from "../../cards";
import type { CardDefinition } from "../../cards/types";

const tamiyo = getDefinition("76776b24-a2e1-4590-88e7-8a421baf2fc4");
const liliana = getDefinition("ac506c17-adc8-49c6-9d8d-43db7cb1ec9d");
const mindRot = getDefinition("b91d355d-8409-4f0b-87ce-7590a8b9ebc0");
const innocentBlood = getDefinition("d26af8f6-df64-4027-880c-f2fae2d8103f");
const hymn = getDefinition("eb9273ea-9a41-42e3-8c9c-0d50b127a818");
const bears = getDefinition("ce2d603a-3231-4a8c-bf39-1617586ea870");
const elves = getDefinition("d4f1cc9e-4f99-4c26-ac1b-8ef069fa8ceb");
const bolt = getDefinition("d573ef03-4730-45aa-93dd-e45ac1dbaf4a");

const LILIANA_PLUS1 = "liliana-veil-plus1";
const LILIANA_MINUS2 = "liliana-veil-minus2";
const TAMIYO_PLUS1 = "tamiyo-collector-of-tales-plus1";
const TAMIYO_MINUS3 = "tamiyo-collector-of-tales-minus3";

function handOf(owner: string, ids: string[]) {
    return ids.map((id) =>
        makeInstance(bolt.id, {
            id,
            controllerId: owner,
            ownerId: owner,
            zone: "hand",
        })
    );
}

function creature(owner: string, id: string) {
    return makeInstance(bears.id, { id, controllerId: owner, ownerId: owner });
}

/** p1 controls Tamiyo (guarded); p2 is the opponent. */
function guardedBoard(opts: { withTamiyo?: boolean } = {}): GameState {
    const withTamiyo = opts.withTamiyo ?? true;
    return makeState({
        players: [
            makePlayer("p1", {
                hand: handOf("p1", ["p1-h1", "p1-h2"]),
                battlefield: [
                    ...(withTamiyo
                        ? [
                              makeInstance(tamiyo.id, {
                                  id: "tamiyo",
                                  controllerId: "p1",
                                  counters: { loyalty: 5 },
                              }),
                          ]
                        : []),
                    creature("p1", "p1-bear"),
                ],
            }),
            makePlayer("p2", {
                hand: handOf("p2", ["p2-h1", "p2-h2"]),
                battlefield: [
                    makeInstance(liliana.id, {
                        id: "liliana",
                        controllerId: "p2",
                        counters: { loyalty: 3 },
                    }),
                    creature("p2", "p2-bear"),
                ],
            }),
        ],
    });
}

const handIds = (state: GameState, i: number) =>
    state.players[i].hand.map((c) => c.id);
const battlefieldIds = (state: GameState, i: number) =>
    state.players[i].battlefield.map((c) => c.id);

describe("CR 101.2 — opponents can't cause you to discard (issue #2607)", () => {
    it("an opponent's targeted discard does nothing: no prompt opens, the hand is intact", () => {
        const state = guardedBoard();
        pushSpell(state, mindRot.id, "p2", [{ type: "player", id: "p1" }]);
        resolveTopOfStack(state);
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(handIds(state, 0)).toEqual(["p1-h1", "p1-h2"]);
        // The spell still resolved: Mind Rot is in p2's graveyard.
        expect(state.stack).toHaveLength(0);
        expect(state.players[1].graveyard.map((c) => c.card.id)).toContain(
            mindRot.id
        );
    });

    it("without the guard the same Mind Rot prompts p1 (the gate is the guard, not the fixture)", () => {
        const state = guardedBoard({ withTamiyo: false });
        pushSpell(state, mindRot.id, "p2", [{ type: "player", id: "p1" }]);
        resolveTopOfStack(state);
        expect(state.pendingChoices?.[0]?.kind).toBe("discard-hand");
        expect(state.pendingChoices?.[0]?.playerId).toBe("p1");
    });

    it("an opponent's random discard takes nothing", () => {
        const state = guardedBoard();
        pushSpell(state, hymn.id, "p2", [{ type: "player", id: "p1" }]);
        resolveTopOfStack(state);
        expect(handIds(state, 0)).toEqual(["p1-h1", "p1-h2"]);
        expect(state.players[0].graveyard).toHaveLength(0);
    });

    it("'each player discards a card' from the opponent's ability: only its controller discards", () => {
        const state = guardedBoard();
        const lili = state.players[1].battlefield[0];
        resolveActivated(state, lili, LILIANA_PLUS1);
        // Answer every discard prompt with the chooser's first card.
        while ((state.pendingChoices ?? []).length > 0) {
            const head = state.pendingChoices![0];
            const owner = state.players.find((p) => p.id === head.playerId)!;
            submitChoice(state, [owner.hand[0].id]);
        }
        expect(handIds(state, 0)).toEqual(["p1-h1", "p1-h2"]);
        expect(handIds(state, 1)).toEqual(["p2-h2"]);
    });

    it("the guarded player's OWN effect still makes them discard", () => {
        const state = guardedBoard();
        pushSpell(state, mindRot.id, "p1", [{ type: "player", id: "p1" }]);
        resolveTopOfStack(state);
        expect(state.pendingChoices?.[0]?.kind).toBe("discard-hand");
        submitChoice(state, ["p1-h1", "p1-h2"]);
        expect(handIds(state, 0)).toEqual([]);
    });
});

describe("CR 101.2 — opponents can't cause you to sacrifice (issue #2607)", () => {
    it("an opponent's edict does nothing: no prompt opens, the creature stays", () => {
        const state = guardedBoard();
        const lili = state.players[1].battlefield[0];
        resolveActivated(state, lili, LILIANA_MINUS2, [
            { type: "player", id: "p1" },
        ]);
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(battlefieldIds(state, 0)).toContain("p1-bear");
    });

    it("'each player sacrifices a creature' cast by the opponent: only the caster sacrifices", () => {
        const state = guardedBoard();
        pushSpell(state, innocentBlood.id, "p2");
        resolveTopOfStack(state);
        while ((state.pendingChoices ?? []).length > 0) {
            const head = state.pendingChoices![0];
            expect(head.playerId).toBe("p2");
            submitChoice(state, ["p2-bear"]);
        }
        expect(battlefieldIds(state, 0)).toContain("p1-bear");
        expect(battlefieldIds(state, 1)).not.toContain("p2-bear");
    });

    it("the guarded player's OWN edict still makes them sacrifice", () => {
        const state = guardedBoard();
        pushSpell(state, innocentBlood.id, "p1");
        resolveTopOfStack(state);
        while ((state.pendingChoices ?? []).length > 0) {
            const head = state.pendingChoices![0];
            submitChoice(
                state,
                head.playerId === "p1" ? ["p1-bear"] : ["p2-bear"]
            );
        }
        expect(battlefieldIds(state, 0)).not.toContain("p1-bear");
    });
});

// "Target player loses 2 life unless they sacrifice a creature" (CR 118.12a,
// the Mogis shape the Tamiyo ruling names): the option can't be taken, so the
// rest of the spell resolves as if declined.
const UNLESS_SACRIFICE: CardDefinition = {
    id: "test-2607-unless-sacrifice",
    name: "Test Unless Sacrifice",
    rarity: "common",
    manaCost: { B: 1 },
    types: ["Sorcery"],
    oracleText: "Target player loses 2 life unless they sacrifice a creature.",
    targetRequirement: { type: "player", count: 1 },
    effects: [
        {
            op: "mayPay",
            player: { target: 0 },
            cost: {
                permanent: {
                    action: "sacrifice",
                    filter: { types: "Creature" },
                    count: 1,
                },
            },
            prompt: "Sacrifice a creature?",
            bind: "$paid",
        },
        {
            op: "if",
            predicate: { not: { binding: "$paid" } },
            then: [{ op: "loseLife", player: { target: 0 }, amount: 2 }],
        },
    ],
};

describe("CR 101.2 / 118.12a — an 'unless you sacrifice' option can't be taken (issue #2607)", () => {
    it("the opponent's may-pay is declined inline and the rest of the spell resolves", () => {
        withTemporaryDefinition(UNLESS_SACRIFICE, () => {
            const state = guardedBoard();
            pushSpell(state, UNLESS_SACRIFICE.id, "p2", [
                { type: "player", id: "p1" },
            ]);
            resolveTopOfStack(state);
            expect(state.pendingChoices ?? []).toHaveLength(0);
            expect(battlefieldIds(state, 0)).toContain("p1-bear");
            expect(state.players[0].life).toBe(18);
        });
    });

    it("without the guard the payer is offered the sacrifice", () => {
        withTemporaryDefinition(UNLESS_SACRIFICE, () => {
            const state = guardedBoard({ withTamiyo: false });
            pushSpell(state, UNLESS_SACRIFICE.id, "p2", [
                { type: "player", id: "p1" },
            ]);
            resolveTopOfStack(state);
            expect(state.pendingChoices?.[0]?.kind).toBe("may-pay");
        });
    });

    it("the guarded player's OWN may-pay still offers the sacrifice", () => {
        withTemporaryDefinition(UNLESS_SACRIFICE, () => {
            const state = guardedBoard();
            pushSpell(state, UNLESS_SACRIFICE.id, "p1", [
                { type: "player", id: "p1" },
            ]);
            resolveTopOfStack(state);
            expect(state.pendingChoices?.[0]?.kind).toBe("may-pay");
        });
    });
});

describe("Tamiyo, Collector of Tales — +1 and −3 (issue #2607)", () => {
    const libraryOf = (cardIds: string[]) =>
        cardIds.map((cardId, i) =>
            makeInstance(cardId, {
                id: `lib-${i}`,
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            })
        );

    function tamiyoBoard(library: string[]): GameState {
        return makeState({
            players: [
                makePlayer("p1", {
                    library: libraryOf(library),
                    battlefield: [
                        makeInstance(tamiyo.id, {
                            id: "tamiyo",
                            controllerId: "p1",
                            counters: { loyalty: 5 },
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
    }

    it("+1: every revealed card with the chosen name goes to hand, the rest to the graveyard", () => {
        const state = tamiyoBoard([
            bears.id,
            elves.id,
            bears.id,
            elves.id,
            bolt.id,
        ]);
        resolveActivated(state, state.players[0].battlefield[0], TAMIYO_PLUS1);
        expect(state.pendingChoices?.[0]?.kind).toBe("name-card");
        applyNameCardSubmit(state, {
            playerId: "p1",
            cardName: "Grizzly Bears",
        });
        expect(handIds(state, 0).sort()).toEqual(["lib-0", "lib-2"]);
        expect(state.players[0].graveyard.map((c) => c.id).sort()).toEqual([
            "lib-1",
            "lib-3",
        ]);
        // Only the top four were revealed; the fifth stays in the library.
        expect(state.players[0].library.map((c) => c.id)).toEqual(["lib-4"]);
    });

    it("+1 with zero matches puts all four into the graveyard", () => {
        const state = tamiyoBoard([elves.id, elves.id, elves.id, elves.id]);
        resolveActivated(state, state.players[0].battlefield[0], TAMIYO_PLUS1);
        applyNameCardSubmit(state, {
            playerId: "p1",
            cardName: "Grizzly Bears",
        });
        expect(state.players[0].hand).toHaveLength(0);
        expect(state.players[0].graveyard).toHaveLength(4);
    });

    it("+1 refuses a land name (CR 201.4a 'nonland card name')", () => {
        const state = tamiyoBoard([elves.id]);
        resolveActivated(state, state.players[0].battlefield[0], TAMIYO_PLUS1);
        expect(() =>
            applyNameCardSubmit(state, { playerId: "p1", cardName: "Forest" })
        ).toThrow();
        expect(state.pendingChoices).toHaveLength(1);
    });

    it("+1's name choice crosses the projection without exposing the library", () => {
        const state = tamiyoBoard([bears.id, elves.id]);
        resolveActivated(state, state.players[0].battlefield[0], TAMIYO_PLUS1);
        const projected = projectPublicState(state, 1, "p2");
        expect(projected.pendingChoices?.[0]?.kind).toBe("name-card");
        expect(projected.pendingChoices?.[0]?.candidateIds).toBeUndefined();
    });

    it("−3: returns the target card from the graveyard to hand", () => {
        const state = tamiyoBoard([]);
        state.players[0].graveyard.push(
            makeInstance(bears.id, {
                id: "gy-bear",
                controllerId: "p1",
                ownerId: "p1",
                zone: "graveyard",
            })
        );
        resolveActivated(
            state,
            state.players[0].battlefield[0],
            TAMIYO_MINUS3,
            [{ type: "graveyard-card", id: "gy-bear", playerId: "p1" }]
        );
        expect(handIds(state, 0)).toEqual(["gy-bear"]);
        expect(state.players[0].graveyard).toHaveLength(0);
    });
});
