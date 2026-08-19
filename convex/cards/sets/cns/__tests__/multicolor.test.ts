// CNS — multicolor card behavior tests. Dack Fayden is the set's first card
// (issues #2360 / #1571): a loyalty-framework planeswalker (CR 606, ADR 0058)
// whose ultimate creates a TRIGGERED emblem (CR 114.4, 113.3) reading the
// BECAME_TARGET seam (CR 601.2c).
//
// The emblem is where the interesting coverage is. `BECAME_TARGET` fires for
// EVERY targeting source, so the trigger is narrower than the event in two
// directions, and both are asserted here:
//   - SPELL vs ABILITY (`sourceKind`) — an activated ability of your own that
//     targets a permanent must NOT steal it. Driven through the REAL producer
//     (`activateAbilityOnState`, game.ts) rather than a hand-written event, so
//     the classification is proven at the emitter, not restated at the reader.
//   - PERMANENT vs PLAYER target — a spell aimed at a player steals nothing.
// Plus the CR 603.2c multi-target shape (N triggers, one per targeted
// permanent) and a departed-target case that proves resolution survives an
// unresolvable ref — see the SCOPE note on that `it` for what it does NOT
// cover.

import { describe, it, expect } from "vitest";
import { dackFayden } from "../multicolor";
import { DACK_FAYDEN_EMBLEM_ID } from "../../../emblems";
import { registerTokenDefinition, getCardByName } from "../../../index";
import type { EffectOp, TargetSelection } from "../../../types";
import type { GameState } from "../../../../gre/state";
import {
    emitBecameTargetEvents,
    processPendingActionTriggers,
    resolveTopOfStack,
} from "../../../../gre/state";
import { projectPublicState } from "../../../../gameProjections";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import {
    activateAbilityOnState,
    finalizeTargetSelection,
} from "../../../../game";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";

const PLUS1 = "dack-fayden-plus1";
const MINUS2 = "dack-fayden-minus2";
const MINUS6 = "dack-fayden-minus6";

const BEARS = getCardByName("Balduvian Bears").id;
const ORNITHOPTER = getCardByName("Ornithopter").id;
const TIM = getCardByName("Prodigal Sorcerer").id;

/** A spell that targets ONE permanent, registered once for these tests. */
const ONE_TARGET_SPELL = "cns-test-one-permanent-target";
/** A spell that targets TWO permanents — the CR 603.2c multi-target shape. */
const TWO_TARGET_SPELL = "cns-test-two-permanent-targets";
/** A spell that targets a PLAYER only — must not fire the emblem. */
const PLAYER_TARGET_SPELL = "cns-test-player-target";

registerTokenDefinition({
    id: ONE_TARGET_SPELL,
    name: ONE_TARGET_SPELL,
    rarity: "common",
    manaCost: { U: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: 1 },
    effects: [
        { op: "tapUntap", target: { target: 0 }, action: "tap" },
    ] as EffectOp[],
});
registerTokenDefinition({
    id: TWO_TARGET_SPELL,
    name: TWO_TARGET_SPELL,
    rarity: "common",
    manaCost: { U: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: 2 },
    effects: [
        { op: "tapUntap", target: { target: 0 }, action: "tap" },
    ] as EffectOp[],
});
registerTokenDefinition({
    id: PLAYER_TARGET_SPELL,
    name: PLAYER_TARGET_SPELL,
    rarity: "common",
    manaCost: { U: 1 },
    types: ["Instant"],
    targetRequirement: { type: "player", count: 1 },
    effects: [{ op: "draw", player: { target: 0 }, count: 1 }] as EffectOp[],
});

function dackOnBattlefield(loyalty = 3) {
    return makeInstance(dackFayden.id, {
        id: "dack1",
        controllerId: "p1",
        ownerId: "p1",
        counters: { loyalty },
    });
}

/** Pushes one of Dack's loyalty abilities on the stack and resolves it through
 *  the real path (loyalty-cost payment itself is exercised in game.ts). */
function activate(
    state: GameState,
    abilityId: string,
    targets?: TargetSelection[]
): void {
    const dack = state.players[0].battlefield.find((c) => c.id === "dack1")!;
    state.stack.push({
        ...dack,
        zone: "stack",
        castById: "p1",
        abilityId,
        ...(targets ? { targets } : {}),
    });
    resolveTopOfStack(state);
}

/** p1 controls Dack's emblem; p2 controls the permanents worth stealing. */
function emblemBoard(
    opts: {
        p1Battlefield?: ReturnType<typeof makeInstance>[];
        p2Battlefield?: ReturnType<typeof makeInstance>[];
    } = {}
): GameState {
    const state = makeState({
        players: [
            makePlayer("p1", {
                battlefield: opts.p1Battlefield ?? [],
                library: [
                    makeInstance(BEARS, {
                        id: "p1-top",
                        ownerId: "p1",
                        zone: "library",
                    }),
                ],
            }),
            makePlayer("p2", {
                battlefield: opts.p2Battlefield ?? [
                    makeInstance(BEARS, {
                        id: "victim1",
                        controllerId: "p2",
                        ownerId: "p2",
                    }),
                ],
            }),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
    state.emblems = [
        {
            id: "emblem-1",
            ownerId: "p1",
            emblemId: DACK_FAYDEN_EMBLEM_ID,
            name: "Dack Fayden emblem",
            text: "Whenever you cast a spell that targets one or more permanents, gain control of those permanents.",
        },
    ];
    return state;
}

function controllerOf(
    state: GameState,
    instanceId: string
): string | undefined {
    for (const p of state.players) {
        const found = p.battlefield.find((c) => c.id === instanceId);
        if (found) return found.controllerId;
    }
    return undefined;
}

/** Every queued BECAME_TARGET event, read BEFORE the trigger pass drains
 *  `pendingEvents`. Guards against a vacuous negative assertion: "no emblem
 *  trigger appeared" proves nothing unless the event that could have raised
 *  one actually existed. */
function queuedBecameTargets(state: GameState) {
    return (state.pendingEvents ?? []).filter(
        (e) => e.type === "BECAME_TARGET"
    );
}

describe("Dack Fayden — loyalty abilities (CR 606.2 / 606.4, ADR 0058)", () => {
    it("+1 makes the TARGET player draw two, then discard two (CR 608.2 order)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [dackOnBattlefield()] }),
                makePlayer("p2", {
                    hand: [
                        makeInstance(BEARS, {
                            id: "held",
                            controllerId: "p2",
                            ownerId: "p2",
                            zone: "hand",
                        }),
                    ],
                    library: [
                        makeInstance(BEARS, {
                            id: "lib1",
                            ownerId: "p2",
                            zone: "library",
                        }),
                        makeInstance(BEARS, {
                            id: "lib2",
                            ownerId: "p2",
                            zone: "library",
                        }),
                    ],
                }),
            ],
        });

        activate(state, PLUS1, [{ type: "player", id: "p2" }]);

        // Both draws land BEFORE the discard, so the freshly drawn cards are
        // themselves discardable (CR 608.2 sequencing).
        const choice = state.pendingChoices![0];
        expect(choice.kind).toBe("discard-hand");
        expect(choice.playerId).toBe("p2");
        expect(state.players[1].hand.map((c) => c.id).sort()).toEqual([
            "held",
            "lib1",
            "lib2",
        ]);

        applyPendingChoiceSubmit(state, {
            playerId: "p2",
            stackItemId: choice.stackItemId,
            step: choice.step,
            choiceId: choice.choiceId,
            cardInstanceIds: ["lib1", "lib2"],
        });

        expect(state.players[1].hand.map((c) => c.id)).toEqual(["held"]);
        expect(state.players[1].graveyard.map((c) => c.id).sort()).toEqual([
            "lib1",
            "lib2",
        ]);
    });

    it("−2 gains control of the target artifact indefinitely (CR 613.1b)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [dackOnBattlefield()] }),
                makePlayer("p2", {
                    battlefield: [
                        makeInstance(ORNITHOPTER, {
                            id: "thopter",
                            controllerId: "p2",
                            ownerId: "p2",
                        }),
                    ],
                }),
            ],
        });

        activate(state, MINUS2, [{ type: "permanent", id: "thopter" }]);

        expect(controllerOf(state, "thopter")).toBe("p1");
        expect(
            state.players[0].battlefield.some((c) => c.id === "thopter")
        ).toBe(true);
        // Indefinite (CR 611.2b): the control-change entry carries neither a
        // "for as long as" condition nor an until-end-of-turn duration, so
        // nothing reverts it on its own (the Ghazbán Ogre shape).
        const stolen = state.players[0].battlefield.find(
            (c) => c.id === "thopter"
        )!;
        expect(stolen.controlChanges).toHaveLength(1);
        expect(stolen.controlChanges![0].previousControllerId).toBe("p2");
        expect(stolen.controlChanges![0].condition).toBeUndefined();
        expect(stolen.controlChanges![0].duration).toBeUndefined();
    });

    it("−2's control change survives projectPublicState (wire format)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [dackOnBattlefield()] }),
                makePlayer("p2", {
                    battlefield: [
                        makeInstance(ORNITHOPTER, {
                            id: "thopter",
                            controllerId: "p2",
                            ownerId: "p2",
                        }),
                    ],
                }),
            ],
        });
        activate(state, MINUS2, [{ type: "permanent", id: "thopter" }]);

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "thopter"
        );
        expect(slim).toBeDefined();
        expect(slim!.controllerId).toBe("p1");
        expect(slim!.ownerId).toBe("p2");
        expect(
            projected.players[1].battlefield.some((c) => c.id === "thopter")
        ).toBe(false);
    });

    it("−6 puts Dack's emblem in its controller's command zone (CR 114.1)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [dackOnBattlefield(6)] }),
                makePlayer("p2"),
            ],
        });

        activate(state, MINUS6);

        expect(state.emblems).toHaveLength(1);
        expect(state.emblems![0].emblemId).toBe(DACK_FAYDEN_EMBLEM_ID);
        expect(state.emblems![0].ownerId).toBe("p1");
    });
});

describe("Dack Fayden emblem — cast-target steal (CR 601.2c / 603.2c / 613.1b)", () => {
    it("a spell you cast targeting ONE permanent steals it", () => {
        const state = emblemBoard();
        const spell = pushSpell(state, ONE_TARGET_SPELL, "p1", [
            { type: "permanent", id: "victim1" },
        ]);
        emitBecameTargetEvents(state, spell.targets, "p1", spell.id, "spell");
        processPendingActionTriggers(state);

        expect(
            state.stack.filter(
                (s) => s.emblemSourceId === DACK_FAYDEN_EMBLEM_ID
            )
        ).toHaveLength(1);
        resolveTopOfStack(state);
        expect(controllerOf(state, "victim1")).toBe("p1");
    });

    it("a spell targeting TWO permanents steals BOTH (one trigger each, CR 603.2c)", () => {
        const state = emblemBoard({
            p2Battlefield: [
                makeInstance(BEARS, {
                    id: "victim1",
                    controllerId: "p2",
                    ownerId: "p2",
                }),
                makeInstance(BEARS, {
                    id: "victim2",
                    controllerId: "p2",
                    ownerId: "p2",
                }),
            ],
        });
        const spell = pushSpell(state, TWO_TARGET_SPELL, "p1", [
            { type: "permanent", id: "victim1" },
            { type: "permanent", id: "victim2" },
        ]);
        emitBecameTargetEvents(state, spell.targets, "p1", spell.id, "spell");
        processPendingActionTriggers(state);

        // DOCUMENTED DIVERGENCE (see `emblems.ts`): paper Dack makes ONE
        // trigger that gains control of every targeted permanent; the engine's
        // per-target BECAME_TARGET emission makes N. The end state is the same
        // — both permanents change controller — which is what this asserts.
        expect(
            state.stack.filter(
                (s) => s.emblemSourceId === DACK_FAYDEN_EMBLEM_ID
            )
        ).toHaveLength(2);
        resolveTopOfStack(state);
        resolveTopOfStack(state);
        expect(controllerOf(state, "victim1")).toBe("p1");
        expect(controllerOf(state, "victim2")).toBe("p1");
    });

    it("a spell with NO permanent target does not trigger it", () => {
        const state = emblemBoard();
        const spell = pushSpell(state, PLAYER_TARGET_SPELL, "p1", [
            { type: "player", id: "p2" },
        ]);
        emitBecameTargetEvents(state, spell.targets, "p1", spell.id, "spell");
        // The event DID fire — for the PLAYER, which the emblem must ignore.
        expect(queuedBecameTargets(state)).toHaveLength(1);
        processPendingActionTriggers(state);

        expect(
            state.stack.filter(
                (s) => s.emblemSourceId === DACK_FAYDEN_EMBLEM_ID
            )
        ).toHaveLength(0);
    });

    it("an OPPONENT's spell targeting a permanent does not trigger it", () => {
        const state = emblemBoard({
            p1Battlefield: [
                makeInstance(BEARS, {
                    id: "mine1",
                    controllerId: "p1",
                    ownerId: "p1",
                }),
            ],
        });
        const spell = pushSpell(state, ONE_TARGET_SPELL, "p2", [
            { type: "permanent", id: "mine1" },
        ]);
        emitBecameTargetEvents(state, spell.targets, "p2", spell.id, "spell");
        expect(queuedBecameTargets(state)).toHaveLength(1);
        processPendingActionTriggers(state);

        expect(
            state.stack.filter(
                (s) => s.emblemSourceId === DACK_FAYDEN_EMBLEM_ID
            )
        ).toHaveLength(0);
    });

    it("YOUR OWN activated ability targeting a permanent does NOT trigger it", () => {
        // The (a) bug: `sourceControllerId === self.controllerId` alone would
        // steal permanents off the emblem owner's own activated abilities.
        // Driven through the REAL producer — game.ts's `activateAbilityOnState`
        // is what classifies this emission as "activated-ability".
        const state = emblemBoard({
            p1Battlefield: [
                makeInstance(TIM, {
                    id: "tim1",
                    controllerId: "p1",
                    ownerId: "p1",
                }),
            ],
        });
        state.phase = "PRECOMBAT_MAIN";

        // CR 602.2b — targets are chosen first, then the ability hits the
        // stack; `finalizeTargetSelection` is the game.ts site that classifies
        // the emission as "activated-ability".
        activateAbilityOnState(state, {
            playerId: "p1",
            cardInstanceId: "tim1",
            abilityId: "prodigal-sorcerer-zap",
        });
        const pt = state.pendingTarget!;
        expect(pt.abilityId).toBe("prodigal-sorcerer-zap");
        pt.selected = [{ type: "permanent", id: "victim1" }];
        finalizeTargetSelection(state, pt, "p1");

        // The producer really ran: the ability is on the stack with its
        // targets LOCKED, which is the exact call site that emits
        // BECAME_TARGET. Without this the negative assertion below would pass
        // on an activation that never happened. `finalizeTargetSelection`
        // drains the trigger pass itself, so the classification is observable
        // only through what did NOT land on the stack — flip that call site to
        // `"spell"` and this test goes red.
        const abilityItem = state.stack.find(
            (s) => s.abilityId === "prodigal-sorcerer-zap"
        )!;
        expect(abilityItem).toBeDefined();
        expect(abilityItem.targets).toEqual([
            { type: "permanent", id: "victim1" },
        ]);

        expect(
            state.stack.filter(
                (s) => s.emblemSourceId === DACK_FAYDEN_EMBLEM_ID
            )
        ).toHaveLength(0);
        expect(controllerOf(state, "victim1")).toBe("p2");
    });

    // SCOPE — read the name literally. This asserts only that the emblem
    // trigger RESOLVES CLEANLY when its target is gone; the single line it
    // guards is the `gainControl` Op's `if (!target) return;`
    // (`gre/effects/interpreter.ts`), which reds with a TypeError when deleted.
    //
    // It does NOT guard the CR 608.2b battlefield re-check in
    // `resolveObjectRef`'s `$event` branch. That re-check is UNOBSERVABLE from
    // this card: `ctx.gainControl` is inert for an id that is not on the
    // battlefield, so deleting the re-check leaves an identical game state and
    // this test stays green (verified — as does the stronger probe that moves
    // the victim to the graveyard instead of deleting it). Guarding the
    // re-check needs an Op whose off-battlefield resolution is observable, not
    // a stronger assertion here.
    it("the emblem trigger does not throw when its target has left the battlefield", () => {
        const state = emblemBoard();
        const spell = pushSpell(state, ONE_TARGET_SPELL, "p1", [
            { type: "permanent", id: "victim1" },
        ]);
        emitBecameTargetEvents(state, spell.targets, "p1", spell.id, "spell");
        processPendingActionTriggers(state);
        expect(
            state.stack.filter(
                (s) => s.emblemSourceId === DACK_FAYDEN_EMBLEM_ID
            )
        ).toHaveLength(1);

        // The targeted permanent leaves the battlefield before the trigger
        // resolves. CR 608.2b is why nothing is stolen; the assertions below
        // prove only that resolution survives the unresolvable ref.
        state.players[1].battlefield = [];

        expect(() => resolveTopOfStack(state)).not.toThrow();
        expect(state.players[0].battlefield).toHaveLength(0);
    });

    it("the stolen permanent renders under its new controller after projection", () => {
        const state = emblemBoard();
        const spell = pushSpell(state, ONE_TARGET_SPELL, "p1", [
            { type: "permanent", id: "victim1" },
        ]);
        emitBecameTargetEvents(state, spell.targets, "p1", spell.id, "spell");
        processPendingActionTriggers(state);
        resolveTopOfStack(state);

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "victim1"
        );
        expect(slim).toBeDefined();
        expect(slim!.controllerId).toBe("p1");
        expect(slim!.ownerId).toBe("p2");
        expect(
            projected.players[1].battlefield.some((c) => c.id === "victim1")
        ).toBe(false);
    });
});
