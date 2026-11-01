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
import { getDefinition, withTemporaryDefinition } from "../../cards";
import type { CardDefinition } from "../../cards/types";

const liliana = getDefinition("ac506c17-adc8-49c6-9d8d-43db7cb1ec9d");
const mindRot = getDefinition("b91d355d-8409-4f0b-87ce-7590a8b9ebc0");
const innocentBlood = getDefinition("d26af8f6-df64-4027-880c-f2fae2d8103f");
const hymn = getDefinition("eb9273ea-9a41-42e3-8c9c-0d50b127a818");
const bears = getDefinition("ce2d603a-3231-4a8c-bf39-1617586ea870");
const bolt = getDefinition("d573ef03-4730-45aa-93dd-e45ac1dbaf4a");

const LILIANA_PLUS1 = "liliana-veil-plus1";
const LILIANA_MINUS2 = "liliana-veil-minus2";

// The clause under test, on a bare carrier so the engine gate is exercised
// independently of any one card (Tamiyo, Collector of Tales declares it).
const GUARD: CardDefinition = {
    id: "test-2607-opponents-cant-cause",
    name: "Test Opponents Can't Cause",
    rarity: "common",
    manaCost: { G: 1 },
    types: ["Enchantment"],
    oracleText:
        "Spells and abilities your opponents control can't cause you to discard cards or sacrifice permanents.",
    staticEffects: [
        {
            kind: "player-guard",
            id: "test-2607-opponents-cant-cause",
            opponentsCantCause: ["discard", "sacrifice"],
        },
    ],
};

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

/** p1 controls the guard; p2 is the opponent. */
function guardedBoard(opts: { withGuard?: boolean } = {}): GameState {
    const withGuard = opts.withGuard ?? true;
    return makeState({
        players: [
            makePlayer("p1", {
                hand: handOf("p1", ["p1-h1", "p1-h2"]),
                battlefield: [
                    ...(withGuard
                        ? [
                              makeInstance(GUARD.id, {
                                  id: "guard",
                                  controllerId: "p1",
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

// "Target creature's controller sacrifices it" — the `sacrifice` Op's
// announced-target form, which reaches the sacrifice funnel with no pick.
const SACRIFICE_TARGET: CardDefinition = {
    id: "test-2607-sacrifice-target",
    name: "Test Sacrifice Target",
    rarity: "common",
    manaCost: { B: 1 },
    types: ["Sorcery"],
    oracleText: "Target creature's controller sacrifices it.",
    targetRequirement: { type: "Creature", count: 1 },
    effects: [{ op: "sacrifice", target: { target: 0 } }],
};

/** Every case runs with the guard carrier and the fixtures registered. */
function itGuarded(name: string, fn: () => void): void {
    it(name, () =>
        withTemporaryDefinition(GUARD, () =>
            withTemporaryDefinition(UNLESS_SACRIFICE, () =>
                withTemporaryDefinition(SACRIFICE_TARGET, fn)
            )
        )
    );
}

describe("CR 101.2 — opponents can't cause you to discard (issue #2607)", () => {
    itGuarded(
        "an opponent's targeted discard does nothing: no prompt opens, the hand is intact",
        () => {
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
        }
    );

    itGuarded(
        "without the guard the same Mind Rot prompts p1 (the gate is the guard, not the fixture)",
        () => {
            const state = guardedBoard({ withGuard: false });
            pushSpell(state, mindRot.id, "p2", [{ type: "player", id: "p1" }]);
            resolveTopOfStack(state);
            expect(state.pendingChoices?.[0]?.kind).toBe("discard-hand");
            expect(state.pendingChoices?.[0]?.playerId).toBe("p1");
        }
    );

    itGuarded("an opponent's random discard takes nothing", () => {
        const state = guardedBoard();
        pushSpell(state, hymn.id, "p2", [{ type: "player", id: "p1" }]);
        resolveTopOfStack(state);
        expect(handIds(state, 0)).toEqual(["p1-h1", "p1-h2"]);
        expect(state.players[0].graveyard).toHaveLength(0);
        // No random pick is drawn for a discard that cannot happen.
        expect(state.rngCounter).toBe(0);
    });

    itGuarded(
        "'each player discards a card' from the opponent's ability: only its controller discards",
        () => {
            const state = guardedBoard();
            const lili = state.players[1].battlefield[0];
            resolveActivated(state, lili, LILIANA_PLUS1);
            // Answer every discard prompt with the chooser's first card.
            while ((state.pendingChoices ?? []).length > 0) {
                const head = state.pendingChoices![0];
                const owner = state.players.find(
                    (p) => p.id === head.playerId
                )!;
                submitChoice(state, [owner.hand[0].id]);
            }
            expect(handIds(state, 0)).toEqual(["p1-h1", "p1-h2"]);
            expect(handIds(state, 1)).toEqual(["p2-h2"]);
        }
    );

    itGuarded(
        "the guarded player's OWN effect still makes them discard",
        () => {
            const state = guardedBoard();
            pushSpell(state, mindRot.id, "p1", [{ type: "player", id: "p1" }]);
            resolveTopOfStack(state);
            expect(state.pendingChoices?.[0]?.kind).toBe("discard-hand");
            submitChoice(state, ["p1-h1", "p1-h2"]);
            expect(handIds(state, 0)).toEqual([]);
        }
    );
});

describe("CR 101.2 — opponents can't cause you to sacrifice (issue #2607)", () => {
    itGuarded(
        "an opponent's edict does nothing: no prompt opens, the creature stays",
        () => {
            const state = guardedBoard();
            const lili = state.players[1].battlefield[0];
            resolveActivated(state, lili, LILIANA_MINUS2, [
                { type: "player", id: "p1" },
            ]);
            expect(state.pendingChoices ?? []).toHaveLength(0);
            expect(battlefieldIds(state, 0)).toContain("p1-bear");
        }
    );

    itGuarded(
        "an opponent's 'its controller sacrifices it' leaves the creature on the battlefield",
        () => {
            const state = guardedBoard();
            pushSpell(state, SACRIFICE_TARGET.id, "p2", [
                { type: "permanent", id: "p1-bear" },
            ]);
            resolveTopOfStack(state);
            expect(battlefieldIds(state, 0)).toContain("p1-bear");
            expect(state.players[0].graveyard).toHaveLength(0);
        }
    );

    itGuarded(
        "the same spell on the opponent's own creature still sacrifices it",
        () => {
            const state = guardedBoard();
            pushSpell(state, SACRIFICE_TARGET.id, "p2", [
                { type: "permanent", id: "p2-bear" },
            ]);
            resolveTopOfStack(state);
            expect(battlefieldIds(state, 1)).not.toContain("p2-bear");
        }
    );

    itGuarded(
        "'each player sacrifices a creature' cast by the opponent: only the caster sacrifices",
        () => {
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
        }
    );

    itGuarded(
        "the guarded player's OWN edict still makes them sacrifice",
        () => {
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
        }
    );
});

describe("CR 101.2 / 118.12a — an 'unless you sacrifice' option can't be taken (issue #2607)", () => {
    itGuarded(
        "the opponent's may-pay is declined inline and the rest of the spell resolves",
        () => {
            const state = guardedBoard();
            pushSpell(state, UNLESS_SACRIFICE.id, "p2", [
                { type: "player", id: "p1" },
            ]);
            resolveTopOfStack(state);
            expect(state.pendingChoices ?? []).toHaveLength(0);
            expect(battlefieldIds(state, 0)).toContain("p1-bear");
            expect(state.players[0].life).toBe(18);
        }
    );

    itGuarded("without the guard the payer is offered the sacrifice", () => {
        const state = guardedBoard({ withGuard: false });
        pushSpell(state, UNLESS_SACRIFICE.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        resolveTopOfStack(state);
        expect(state.pendingChoices?.[0]?.kind).toBe("may-pay");
    });

    itGuarded(
        "the guarded player's OWN may-pay still offers the sacrifice",
        () => {
            const state = guardedBoard();
            pushSpell(state, UNLESS_SACRIFICE.id, "p1", [
                { type: "player", id: "p1" },
            ]);
            resolveTopOfStack(state);
            expect(state.pendingChoices?.[0]?.kind).toBe("may-pay");
        }
    );
});
