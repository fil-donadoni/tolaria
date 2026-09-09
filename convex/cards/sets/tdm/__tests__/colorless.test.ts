// tdm (Tarkir: Dragonstorm) — colorless behavior tests (ADR 0043 colour split).
//
// Ugin, Eye of the Storms (issue #3229). The card is the FIRST consumer of a
// TARGETED "when you cast this spell" trigger, so this file is also the
// capability test for the two engine pieces it needed:
//   * `SpellCastTriggerArgs.targetRequirement` — forwarded onto the built
//     ability, the same way the entered / attacks / phase factories forward
//     theirs;
//   * the CR 603.3d target sweep in `collectSelfCastTriggers` (`gre/state.ts`)
//     — a cast trigger is pushed straight above its own spell and never reaches
//     `placeTriggersOnStack`, where every other producer's sweep lives.
// Both are asserted through a REAL `emitSpellCastEvent` cast, never a
// hand-built trigger item: the whole defect class this closes is "the ability
// was built, validated, shipped — and silently never filled its target slot".
//
// The two cast lines are also asserted AGAINST each other (CR 113.6): Ugin is
// himself a colorless spell, and the battlefield-scoped watcher must NOT fire on
// his own casting, or every Ugin would exile two permanents instead of one.

import { describe, it, expect } from "vitest";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import type { GameState } from "../../../../gre/state";
import {
    emitSpellCastEvent,
    processPendingActionTriggers,
    resolveTopOfStack,
} from "../../../../gre/state";
import {
    collectTriggers,
    placeTriggersOnStack,
} from "../../../../gre/triggers";
import { finalizeTargetSelection } from "../../../../game";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import { projectPublicState } from "../../../../gameProjections";
import { getDefinition } from "../../../index";
import type { GameEvent } from "../../../types";

const ugin = getDefinition("64a5d494-efa1-446b-bebe-2ad36e154376");
const elvishArchers = getDefinition("1cb9d405-f2b5-4e10-a405-feafd2a87d90");
const solRing = getDefinition("c4300d24-1cae-4dd5-be7e-38cc677cf5bd");
const juggernaut = getDefinition("dcd6a291-5282-4f49-8203-d9b416083c48");

const CAST_SELF = "ugin-eye-of-the-storms-cast-self";
const CAST_COLORLESS = "ugin-eye-of-the-storms-cast-colorless";
const PLUS2 = "ugin-eye-of-the-storms-plus2";
const ZERO = "ugin-eye-of-the-storms-zero";
const MINUS11 = "ugin-eye-of-the-storms-minus11";

/** Announces Ugin's spell through the SAME choke point the mutation uses
 *  (`emitSpellCastEvent` → `collectCastTriggers`), then drains the battlefield
 *  trigger pass exactly as `commitPendingCast` does. */
function castUgin(state: GameState): void {
    const item = {
        ...makeInstance(ugin.id, {
            id: "uginSpell",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        }),
        zone: "stack" as const,
        castById: "p1",
        targets: undefined,
    };
    state.stack.push(item);
    emitSpellCastEvent(state, item);
    processPendingActionTriggers(state);
}

function uginOnBattlefield(loyalty = 7) {
    return makeInstance(ugin.id, {
        id: "ugin1",
        controllerId: "p1",
        ownerId: "p1",
        counters: { loyalty },
    });
}

/** Pushes one of Ugin's loyalty abilities on the stack and resolves it through
 *  the real path (the loyalty COST is exercised in game.ts; the card test
 *  asserts the EFFECT — the Chandra / Sorin harness). */
function activate(state: GameState, abilityId: string): void {
    const source = state.players[0].battlefield.find((c) => c.id === "ugin1")!;
    state.stack.push({
        ...source,
        zone: "stack",
        castById: "p1",
        abilityId,
    });
    resolveTopOfStack(state);
}

/** Submits a `search-library` pending choice, the shared idiom every tutor test
 *  uses (Skyship Weatherlight, `sets/pls/__tests__/colorless.test.ts`). */
function submitLibraryPick(state: GameState, cardInstanceIds: string[]): void {
    const head = state.pendingChoices![0];
    applyPendingChoiceSubmit(state, {
        playerId: head.playerId,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds,
    });
}

describe("Ugin, Eye of the Storms — targeted cast trigger (CR 113.6k / 603.3d, issue #3229)", () => {
    it("announces the trigger above its own spell and RAISES its target, then exiles the coloured permanent", () => {
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    battlefield: [
                        makeInstance(elvishArchers.id, {
                            id: "archers",
                            controllerId: "p2",
                            ownerId: "p2",
                        }),
                    ],
                }),
            ],
        });
        castUgin(state);

        // CR 601.2i — the trigger sits ABOVE the spell, so it resolves first.
        expect(state.stack).toHaveLength(2);
        expect(state.stack[1].triggeredAbilityId).toBe(CAST_SELF);
        expect(state.stack[1].triggerSourceId).toBe("uginSpell");

        // The sweep this card needed: a real choice is owed (CR 603.3d, "up to
        // one" is min 0 / max 1, so nothing auto-selects).
        expect(state.pendingTarget).toBeDefined();
        expect(state.pendingTarget!.kind).toBe("trigger");
        expect(state.pendingTarget!.cardInstanceId).toBe(state.stack[1].id);

        state.pendingTarget!.selected = [{ type: "permanent", id: "archers" }];
        finalizeTargetSelection(
            state,
            state.pendingTarget!,
            state.pendingTarget!.playerId
        );
        resolveTopOfStack(state);

        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.players[1].exile.map((c) => c.id)).toEqual(["archers"]);
        // Ugin's own spell is untouched, still under the resolved trigger.
        expect(state.stack.map((s) => s.id)).toEqual(["uginSpell"]);
    });

    it("a COLOURLESS permanent is never a legal target — the slot locks empty and nothing is exiled", () => {
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    battlefield: [
                        makeInstance(solRing.id, {
                            id: "solring",
                            controllerId: "p2",
                            ownerId: "p2",
                        }),
                    ],
                }),
            ],
        });
        castUgin(state);

        // CR 105.2c — colourless has no colour to match `colorFilterAny`, so
        // there is no legal target; "up to one" keeps the trigger on the stack
        // with an EMPTY slot (CR 603.3d) instead of removing it.
        expect(state.pendingTarget).toBeUndefined();
        expect(state.stack[1].triggeredAbilityId).toBe(CAST_SELF);
        expect(state.stack[1].targets).toEqual([]);
        resolveTopOfStack(state);
        expect(state.players[1].battlefield.map((c) => c.id)).toEqual([
            "solring",
        ]);
    });

    it("FAIL-CLOSED: Ugin's own cast fires the self trigger ONLY, never the colorless-spell watcher (CR 113.6)", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        castUgin(state);
        const triggerIds = state.stack
            .filter((s) => s.triggeredAbilityId)
            .map((s) => s.triggeredAbilityId);
        expect(triggerIds).toEqual([CAST_SELF]);
    });

    it("the battlefield watcher fires on a COLOURLESS spell and not on a coloured one (CR 105.2c)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [uginOnBattlefield()] }),
                makePlayer("p2", {
                    battlefield: [
                        makeInstance(elvishArchers.id, {
                            id: "archers",
                            controllerId: "p2",
                            ownerId: "p2",
                        }),
                    ],
                }),
            ],
        });
        const colorless: GameEvent = {
            type: "SPELL_CAST",
            casterId: "p1",
            spellInstanceId: "s1",
            spellCardId: juggernaut.id,
            spellTypes: ["Artifact", "Creature"],
            spellSubtypes: ["Juggernaut"],
            spellColors: [],
            priorSpellCount: 0,
        } as GameEvent;
        const fired = collectTriggers(state, [colorless]);
        expect(fired.map((t) => t.triggeredAbilityId)).toEqual([
            CAST_COLORLESS,
        ]);
        placeTriggersOnStack(state, fired);
        expect(state.pendingTarget!.kind).toBe("trigger");
        state.pendingTarget!.selected = [{ type: "permanent", id: "archers" }];
        finalizeTargetSelection(
            state,
            state.pendingTarget!,
            state.pendingTarget!.playerId
        );
        resolveTopOfStack(state);
        expect(state.players[1].exile.map((c) => c.id)).toEqual(["archers"]);

        // A GREEN spell is not colorless — the watcher stays silent.
        const green: GameEvent = {
            ...colorless,
            spellColors: ["G"],
            spellCardId: elvishArchers.id,
        } as GameEvent;
        expect(collectTriggers(state, [green])).toHaveLength(0);
    });
});

describe("Ugin, Eye of the Storms — loyalty abilities (CR 606, ADR 0058)", () => {
    it("+2 gains 3 life and draws a card", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [uginOnBattlefield()],
                    library: [
                        makeInstance(solRing.id, {
                            id: "top",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "library",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        activate(state, PLUS2);
        expect(state.players[0].life).toBe(23);
        expect(state.players[0].hand.map((c) => c.id)).toEqual(["top"]);
    });

    it("0 adds {C}{C}{C} to its controller's pool (CR 106.1 — unrestricted)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [uginOnBattlefield()] }),
                makePlayer("p2"),
            ],
        });
        activate(state, ZERO);
        expect(state.players[0].manaPool.C).toBe(3);
        expect(state.players[0].manaPool.G).toBe(0);
    });

    it("−11 exiles EVERY colorless nonland card found and grants a free cast for each (CR 607 link)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [uginOnBattlefield(11)],
                    library: [
                        makeInstance(solRing.id, {
                            id: "libSolRing",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "library",
                        }),
                        makeInstance(juggernaut.id, {
                            id: "libJuggernaut",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "library",
                        }),
                        // Coloured — must not be findable.
                        makeInstance(elvishArchers.id, {
                            id: "libArchers",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "library",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        activate(state, MINUS11);

        const choice = state.pendingChoices![0];
        expect(choice.kind).toBe("search-library");
        // CR 105.2c / 305.1 — only the two colorless nonland cards are offered.
        expect([...(choice.candidateIds ?? [])].sort()).toEqual([
            "libJuggernaut",
            "libSolRing",
        ]);

        submitLibraryPick(state, ["libSolRing", "libJuggernaut"]);
        expect(state.pendingChoices ?? []).toHaveLength(0);

        // CR 607 — every exiled card is LINKED to Ugin…
        const exiled = state.players[0].exile;
        expect(exiled.map((c) => c.id).sort()).toEqual([
            "libJuggernaut",
            "libSolRing",
        ]);
        for (const card of exiled) {
            expect(card.exiledBySourceId).toBe("ugin1");
            // …and EVERY one of them is castable for free this turn. This is
            // the assertion that separates the linked route from the bare-picks
            // branch, which grants only the FIRST pick.
            expect(card.castableFromExileBy).toBe("p1");
            expect(card.castFromExileWithoutPayingManaCost).toBe(true);
        }
        // The coloured card was never findable, so it stayed in the library.
        expect(state.players[0].library.map((c) => c.id)).toEqual([
            "libArchers",
        ]);
    });
});

describe("Ugin, Eye of the Storms — wire format (loyalty abilities reach the client)", () => {
    it("projectPublicState carries the loyalty counters and every activated ability", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [uginOnBattlefield()] }),
                makePlayer("p2"),
            ],
        });
        const view = projectPublicState(state, 1, "p1");
        const wire = view.players[0].battlefield.find((c) => c.id === "ugin1")!;
        expect(wire.counters?.loyalty).toBe(7);
        expect(wire.types).toContain("Planeswalker");
        const abilityIds = (ugin.activatedAbilities ?? []).map((a) => a.id);
        expect(abilityIds).toEqual([PLUS2, ZERO, MINUS11]);
    });
});
