// kld (Kaladesh) — red behavior tests (ADR 0043 colour split).
//
// Chandra, Torch of Defiance (un-stubbed, issues #1477 / #1478, closes #1252).
// Her +1 impulse drives the cast-during-resolution Op's #1478 extensions
// (exile-top source + paid inline cast + `if not $cast` reflexive branch) end
// to end through the real resolution path; the loyalty-ability snapshot pins
// the four abilities' costs/shapes; the −3 and −7 assert the shipped
// dealDamage / emblem frameworks, the −7 through a TARGETED emblem trigger
// (the first one — validates the `inlineTargetRequirement` wiring in
// `buildEmblemTriggerItem`).

import { describe, it, expect } from "vitest";
import { chandraTorchOfDefiance } from "../red";
import { elvishArchers, ironrootTreefolk } from "../../lea/green";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
import type { GameState } from "../../../../gre/state";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import {
    collectTriggers,
    placeTriggersOnStack,
} from "../../../../gre/triggers";
import { raiseTriggerTargetSelection } from "../../../../gre/rules";
import { finalizeTargetSelection } from "../../../../game";
import { compactState, expandState } from "../../../../gre/serialize";
import { projectPublicState } from "../../../../gameProjections";
import { CHANDRA_TORCH_OF_DEFIANCE_EMBLEM_ID } from "../../../emblems";
import type { GameEvent, TargetSelection } from "../../../types";

const PLUS1_IMPULSE = "chandra-torch-of-defiance-plus1-impulse";
const PLUS1_MANA = "chandra-torch-of-defiance-plus1-mana";
const MINUS3 = "chandra-torch-of-defiance-minus3";
const MINUS7 = "chandra-torch-of-defiance-minus7";

function chandraOnBattlefield(loyalty = 4) {
    return makeInstance(chandraTorchOfDefiance.id, {
        id: "chandra1",
        controllerId: "p1",
        ownerId: "p1",
        counters: { loyalty },
    });
}

/** Pushes one of Chandra's loyalty abilities on the stack and resolves it
 *  through the real path (mirrors the Sorin −6 test harness — the loyalty
 *  framework's cost payment is exercised in game.ts; the card test asserts the
 *  EFFECT). */
function activate(
    state: GameState,
    abilityId: string,
    targets?: TargetSelection[]
): void {
    const chandra = state.players[0].battlefield.find(
        (c) => c.id === "chandra1"
    )!;
    state.stack.push({
        ...chandra,
        zone: "stack",
        castById: "p1",
        abilityId,
        ...(targets ? { targets } : {}),
    });
    resolveTopOfStack(state);
}

describe("Chandra, Torch of Defiance — loyalty ability snapshot (CR 306, ADR 0058)", () => {
    it("is a 4-loyalty legendary Chandra planeswalker with four loyalty abilities", () => {
        expect(chandraTorchOfDefiance.types).toEqual(["Planeswalker"]);
        expect(chandraTorchOfDefiance.supertypes).toEqual(["Legendary"]);
        expect(chandraTorchOfDefiance.subtypes).toEqual(["Chandra"]);
        expect(chandraTorchOfDefiance.loyalty).toBe(4);
        expect(chandraTorchOfDefiance.manaCost).toEqual({ X: 2, R: 2 });
        const abilities = chandraTorchOfDefiance.activatedAbilities!;
        expect(abilities.map((a) => a.id)).toEqual([
            PLUS1_IMPULSE,
            PLUS1_MANA,
            MINUS3,
            MINUS7,
        ]);
        expect(abilities.map((a) => a.cost.loyalty)).toEqual([1, 1, -3, -7]);
    });

    it("the impulse +1 sources the top of library and binds the cast outcome for the reflexive branch (no bespoke resolve())", () => {
        const impulse = chandraTorchOfDefiance.activatedAbilities!.find(
            (a) => a.id === PLUS1_IMPULSE
        )!;
        expect(impulse.resolve).toBeUndefined();
        const cast = impulse.effects![0];
        expect(cast).toMatchObject({
            op: "castDuringResolution",
            fromTopOfLibrary: true,
            resultBind: "$cast",
        });
        expect(impulse.effects![1]).toMatchObject({
            op: "if",
            predicate: { not: { binding: "$cast" } },
        });
    });
});

describe("Chandra, Torch of Defiance — +1 impulse (exile top, paid cast during resolution, CR 608.2f, issue #1478)", () => {
    it("exiles the top card and, on accept, casts it paying its real mana cost — no reflexive damage", () => {
        const top = makeInstance(elvishArchers.id, {
            id: "topArchers",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [chandraOnBattlefield()],
                    library: [top],
                    // {1}{G} floating covers Elvish Archers' cost.
                    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 2, C: 0 },
                }),
                makePlayer("p2"),
            ],
        });
        activate(state, PLUS1_IMPULSE);
        // Top card exiled unconditionally; suspended on the Cast/Decline offer.
        expect(
            state.players[0].library.some((c) => c.id === "topArchers")
        ).toBe(false);
        expect(state.players[0].exile.some((c) => c.id === "topArchers")).toBe(
            true
        );
        const offer = state.pendingChoices![0];
        expect(offer.kind).toBe("option-pick");
        expect(offer.options?.map((o) => o.id)).toEqual(["cast", "decline"]);

        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: offer.stackItemId,
            step: offer.step,
            choiceId: offer.choiceId,
            cardInstanceIds: ["cast"],
        });
        // Cast from exile onto the stack; mana paid; no reflexive damage.
        expect(state.stack.some((s) => s.id === "topArchers")).toBe(true);
        expect(state.players[0].exile.some((c) => c.id === "topArchers")).toBe(
            false
        );
        expect(state.players[0].manaPool.G).toBe(0);
        expect(state.players[1].life).toBe(20);
    });

    it("declining leaves the card exiled and Chandra deals 2 damage to the opponent ('If you don't')", () => {
        const top = makeInstance(elvishArchers.id, {
            id: "declineArchers",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [chandraOnBattlefield()],
                    library: [top],
                }),
                makePlayer("p2"),
            ],
        });
        activate(state, PLUS1_IMPULSE);
        const offer = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: offer.stackItemId,
            step: offer.step,
            choiceId: offer.choiceId,
            cardInstanceIds: ["decline"],
        });
        expect(
            state.players[0].exile.some((c) => c.id === "declineArchers")
        ).toBe(true);
        expect(state.stack.some((s) => s.id === "declineArchers")).toBe(false);
        expect(state.players[1].life).toBe(18);
    });
});

describe("Chandra, Torch of Defiance — −3 (deal 4 to target creature, CR 120)", () => {
    it("deals 4 damage to the targeted creature (wire format)", () => {
        const victim = makeInstance(ironrootTreefolk.id, {
            id: "treefolk",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [chandraOnBattlefield()] }),
                makePlayer("p2", { battlefield: [victim] }),
            ],
        });
        activate(state, MINUS3, [{ type: "permanent", id: "treefolk" }]);
        // Ironroot Treefolk is 3/5 — survives, so the marked damage is
        // observable both on fat state and through the projection.
        const fat = state.players[1].battlefield.find(
            (c) => c.id === "treefolk"
        )!;
        expect(fat.damageMarked).toBe(4);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[1].battlefield.find(
            (c) => c.id === "treefolk"
        )!;
        expect(slim.damageMarked).toBe(4);
    });
});

describe("Chandra, Torch of Defiance — −7 emblem (targeted triggered emblem, CR 114 / 603.3d)", () => {
    it("creates the emblem; a later spell-cast deals 5 damage to any target", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [chandraOnBattlefield(7)] }),
                makePlayer("p2"),
            ],
        });
        activate(state, MINUS7);
        expect(state.emblems).toHaveLength(1);
        expect(state.emblems![0]).toMatchObject({
            ownerId: "p1",
            emblemId: CHANDRA_TORCH_OF_DEFIANCE_EMBLEM_ID,
        });

        // p1 casts a spell → the emblem's owner-scoped trigger fires and must
        // choose "any target" (CR 115.4) as it goes on the stack.
        const spellCast: GameEvent = {
            type: "SPELL_CAST",
            casterId: "p1",
            spellInstanceId: "s1",
            spellCardId: elvishArchers.id,
            spellTypes: ["Creature"],
            spellSubtypes: [],
            spellColors: ["G"],
            priorSpellCount: 0,
        } as GameEvent;
        const triggers = collectTriggers(state, [spellCast]);
        expect(triggers).toHaveLength(1);
        expect(triggers[0].emblemSourceId).toBe(
            CHANDRA_TORCH_OF_DEFIANCE_EMBLEM_ID
        );
        expect(triggers[0].inlineTargetRequirement).toEqual({
            type: "any",
            count: 1,
        });
        placeTriggersOnStack(state, triggers);

        // The targeted trigger raises target selection (the emblem framework
        // fix): aim it at the opponent.
        expect(raiseTriggerTargetSelection(state)).toBe(true);
        expect(state.pendingTarget!.kind).toBe("trigger");
        state.pendingTarget!.selected = [{ type: "player", id: "p2" }];
        finalizeTargetSelection(
            state,
            state.pendingTarget!,
            state.pendingTarget!.playerId
        );
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(15);

        // p2 casting does NOT fire p1's emblem (CR 114.3 owner-scoped "you").
        const p2Cast: GameEvent = { ...spellCast, casterId: "p2" } as GameEvent;
        expect(collectTriggers(state, [p2Cast])).toHaveLength(0);
    });

    // Real-play regression (serialize round-trip): in the browser the target is
    // chosen in the `selectTarget` mutation, the state is SAVED, then RELOADED
    // for resolution. The emblem trigger resolves its effect from the emblem
    // registry keyed by `emblemSourceId` — which was dropped by the DB
    // round-trip, so the reloaded trigger dealt 0 damage ("flusso perfetto ma
    // niente danni") even with a target selected. The in-memory GRE test above
    // never round-trips, so it masked this. Round-trip between target-lock and
    // resolution to pin it.
    it("deals 5 damage after a serialize round-trip (target locked, then save/load)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [chandraOnBattlefield(7)] }),
                makePlayer("p2"),
            ],
        });
        activate(state, MINUS7);
        const spellCast: GameEvent = {
            type: "SPELL_CAST",
            casterId: "p1",
            spellInstanceId: "s1",
            spellCardId: elvishArchers.id,
            spellTypes: ["Creature"],
            spellSubtypes: [],
            spellColors: ["G"],
            priorSpellCount: 0,
        } as GameEvent;
        placeTriggersOnStack(state, collectTriggers(state, [spellCast]));
        expect(raiseTriggerTargetSelection(state)).toBe(true);
        state.pendingTarget!.selected = [{ type: "player", id: "p2" }];
        finalizeTargetSelection(
            state,
            state.pendingTarget!,
            state.pendingTarget!.playerId
        );

        // The emblem trigger is now on the stack with its target LOCKED — save
        // and reload before resolving, exactly as the mutation boundary does.
        const reloaded = expandState(compactState(state));
        const emblemTrigger = reloaded.stack.find(
            (s) => s.emblemSourceId === CHANDRA_TORCH_OF_DEFIANCE_EMBLEM_ID
        );
        expect(emblemTrigger).toBeDefined();
        expect(emblemTrigger!.emblemSourceId).toBe(
            CHANDRA_TORCH_OF_DEFIANCE_EMBLEM_ID
        );

        resolveTopOfStack(reloaded);
        expect(reloaded.players[1].life).toBe(15);
    });
});
