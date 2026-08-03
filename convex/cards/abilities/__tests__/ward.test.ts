// Ward (CR 702.21) — this is the mechanism's permanent test suite: the
// `wardAbility` factory's own matches()/target-requirement/effects shape, the
// two genuinely NEW engine capabilities it rides (`spellStackKind: "any"` in
// `getLegalTargets`, and the reflexive `spellTargetsSelfSource` dynamic pin in
// `raiseTriggerTargetSelection`), and a full end-to-end resolution through a
// synthetic registered warded creature — pay vs. decline, wire format, and the
// "your own spell doesn't trigger your own ward" CR 702.21a opponent scope.
// `mayPay` / `if` / `counter` are already interpreter-suite-exercised Ops
// (per-Op regime, `.claude/rules/gre-development.md`); no new Op is
// introduced here, so this suite focuses on the target-resolution plumbing
// that IS new.

import { describe, it, expect } from "vitest";
import { wardAbility } from "../ward";
import { registerTokenDefinition } from "../..";
import { getLegalTargets, NO_TARGETING_SOURCE } from "../../../gre/rules";
import {
    resolveTopOfStack,
    emitBecameTargetEvents,
    processPendingActionTriggers,
} from "../../../gre/state";
import type { GameState, StackItem } from "../../../gre/state";
import { applyMayPaySubmit } from "../../../gre/pendingChoiceSubmit";
import { projectPublicState } from "../../../gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../__tests__/setup";
import type { GameEvent, PermanentView, TargetRequirement } from "../../types";

// A synthetic 1/1 with Ward {2} (a plain generic cost — the common printed
// shape). Registered once via the test-injection seam so `pushSpell` /
// `resolveTopOfStack` hydrate it exactly like a real card.
const WARDED_ID = "test-ward-creature";
registerTokenDefinition({
    id: WARDED_ID,
    name: WARDED_ID,
    rarity: "common",
    manaCost: { X: 1, U: 1 },
    types: ["Creature"],
    subtypes: ["Illusion"],
    power: 1,
    toughness: 1,
    staticAbilities: ["ward {2}"],
    triggeredAbilities: [wardAbility({ cost: { X: 2 }, costLabel: "{2}" })],
});

// A synthetic targeted-removal instant — the "opponent's spell" side of the
// scenario.
const REMOVAL_ID = "test-ward-removal";
registerTokenDefinition({
    id: REMOVAL_ID,
    name: REMOVAL_ID,
    rarity: "common",
    manaCost: { X: 1, B: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: 1 },
    effects: [{ op: "destroy", target: { target: 0 } }],
});

function wardedState(
    wardedControllerId = "p2",
    opts: { p1ManaPool?: Record<string, number> } = {}
): { state: GameState; wardedInstId: string } {
    const warded = makeInstance(WARDED_ID, {
        id: "warded1",
        controllerId: wardedControllerId,
        ownerId: wardedControllerId,
    });
    const players =
        wardedControllerId === "p2"
            ? [
                  makePlayer("p1", { manaPool: opts.p1ManaPool ?? {} }),
                  makePlayer("p2", { battlefield: [warded] }),
              ]
            : [
                  makePlayer("p1", {
                      battlefield: [warded],
                      manaPool: opts.p1ManaPool ?? {},
                  }),
                  makePlayer("p2"),
              ];
    const state = makeState({ players });
    return { state, wardedInstId: "warded1" };
}

describe("wardAbility factory shape (CR 702.21a)", () => {
    const ward = wardAbility({ cost: { X: 2 }, costLabel: "{2}" });

    it("is a BECAME_TARGET trigger with the reflexive self-pinned target requirement", () => {
        expect(ward.event).toBe("BECAME_TARGET");
        expect(ward.targetRequirement).toEqual({
            type: "spell",
            count: 1,
            spellStackKind: "any",
            spellTargetsSelfSource: true,
        } satisfies TargetRequirement);
    });

    it("is the same counter-unless-pay DSL shape as Miscalculation/Force Spike (mayPay + if(!paid) + counter)", () => {
        expect(ward.effects).toEqual([
            {
                op: "mayPay",
                player: { controllerOf: { target: 0 } },
                cost: { X: 2 },
                prompt: "Pay ward ({2})?",
                bind: "$paid",
            },
            {
                op: "if",
                predicate: { not: { binding: "$paid" } },
                then: [{ op: "counter", target: { target: 0 } }],
            },
        ]);
    });

    const self: PermanentView = {
        id: "warded1",
        controllerId: "p2",
        ownerId: "p2",
        types: ["Creature"],
        subtypes: ["Illusion"],
        isTapped: false,
        card: {},
    };

    it("matches when THIS permanent becomes the target of an opponent's spell/ability", () => {
        const event: GameEvent = {
            type: "BECAME_TARGET",
            target: { type: "permanent", id: "warded1" },
            targetControllerId: "p2",
            sourceControllerId: "p1",
            sourceInstanceId: "spell1",
        };
        expect(ward.matches(event, self)).toBe(true);
    });

    it("does NOT match your OWN spell/ability targeting your warded permanent (CR 702.21a: opponent-only)", () => {
        const event: GameEvent = {
            type: "BECAME_TARGET",
            target: { type: "permanent", id: "warded1" },
            targetControllerId: "p2",
            sourceControllerId: "p2",
            sourceInstanceId: "spell1",
        };
        expect(ward.matches(event, self)).toBe(false);
    });

    it("does NOT match a DIFFERENT permanent being targeted, even one you control (self-pin, tighter than Leovold)", () => {
        const event: GameEvent = {
            type: "BECAME_TARGET",
            target: { type: "permanent", id: "some-other-creature" },
            targetControllerId: "p2",
            sourceControllerId: "p1",
            sourceInstanceId: "spell1",
        };
        expect(ward.matches(event, self)).toBe(false);
    });

    it("does NOT match a PLAYER becoming the target (Ward is permanent-only)", () => {
        const event: GameEvent = {
            type: "BECAME_TARGET",
            target: { type: "player", id: "p2" },
            targetControllerId: "p2",
            sourceControllerId: "p1",
            sourceInstanceId: "spell1",
        };
        expect(ward.matches(event, self)).toBe(false);
    });
});

describe("getLegalTargets: spellStackKind 'any' (CR 702.21a — spell OR ability)", () => {
    it("admits BOTH a spell and an activated/triggered ability on the stack", () => {
        const spell: StackItem = {
            ...makeInstance(REMOVAL_ID, {
                id: "spell1",
                controllerId: "p1",
                ownerId: "p1",
                zone: "stack",
            }),
            castById: "p1",
        };
        const activated: StackItem = {
            ...makeInstance(WARDED_ID, {
                id: "ability1",
                controllerId: "p1",
                ownerId: "p1",
                zone: "stack",
            }),
            castById: "p1",
            abilityId: "src-ability",
            targets: [],
        };
        const triggered: StackItem = {
            ...makeInstance(WARDED_ID, {
                id: "trigger1",
                controllerId: "p1",
                ownerId: "p1",
                zone: "stack",
            }),
            castById: "p1",
            triggeredAbilityId: "src-trigger",
            targets: [],
        };
        const state = makeState({ stack: [spell, activated, triggered] });
        const req: TargetRequirement = {
            type: "spell",
            count: 1,
            spellStackKind: "any",
        };
        const ids = getLegalTargets(state, req, NO_TARGETING_SOURCE)
            .map((t) => t.id)
            .sort();
        expect(ids).toEqual(["ability1", "spell1", "trigger1"]);
    });
});

describe("raiseTriggerTargetSelection: spellTargetsSelfSource dynamic pin (CR 702.21a)", () => {
    it("auto-selects the opponent's targeting SPELL as the ward trigger's own target", () => {
        const { state, wardedInstId } = wardedState();
        const spell = pushSpell(state, REMOVAL_ID, "p1", [
            { type: "permanent", id: wardedInstId },
        ]);
        emitBecameTargetEvents(state, spell.targets, "p1", spell.id);
        processPendingActionTriggers(state);
        expect(state.stack).toHaveLength(2);
        const top = state.stack[state.stack.length - 1];
        expect(top.triggeredAbilityId).toBe("ward");
        expect(top.targets).toEqual([{ type: "spell", id: spell.id }]);
    });

    it("your OWN spell targeting your OWN warded permanent never places a ward trigger", () => {
        const { state, wardedInstId } = wardedState("p1");
        const spell = pushSpell(state, REMOVAL_ID, "p1", [
            { type: "permanent", id: wardedInstId },
        ]);
        emitBecameTargetEvents(state, spell.targets, "p1", spell.id);
        processPendingActionTriggers(state);
        // No ward trigger fired — the removal spell is still alone on top.
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].id).toBe(spell.id);
    });
});

describe("raiseTriggerTargetSelection: two simultaneous targeters pin the EXACT triggering object (CR 702.21e, issue #1361)", () => {
    it("each ward trigger instance counters the SPECIFIC spell that caused it — no player choice, even with 2 legal 'targets this permanent' candidates", () => {
        const { state, wardedInstId } = wardedState();
        // Two DISTINCT opponent-controlled removal spells target the SAME
        // warded permanent before either resolves — the CR 702.21e edge: a
        // "targets this permanent" filter alone can't tell which one caused
        // which ward instance (both are legal under that filter).
        const spellA = pushSpell(state, REMOVAL_ID, "p1", [
            { type: "permanent", id: wardedInstId },
        ]);
        const spellB = pushSpell(state, REMOVAL_ID, "p1", [
            { type: "permanent", id: wardedInstId },
        ]);
        // Both BECAME_TARGET events land in ONE batch — genuinely simultaneous
        // from the engine's point of view (one collectTriggers scan sees both).
        emitBecameTargetEvents(state, spellA.targets, "p1", spellA.id);
        emitBecameTargetEvents(state, spellB.targets, "p1", spellB.id);
        processPendingActionTriggers(state);

        // CR 603.3d single-legal-target auto-select fires for BOTH ward
        // instances — no player choice raised, despite 2 stack objects
        // matching the broad "targets this permanent" filter. Pre-fix, the
        // first-processed ward instance found 2 legal candidates and raised a
        // real `pendingTarget` choice instead (the bug this test pins).
        expect(state.pendingTarget).toBeUndefined();
        expect(state.pendingChoices ?? []).toHaveLength(0);

        expect(state.stack).toHaveLength(4); // spellA, spellB, wardTrigA, wardTrigB
        const wardTriggers = state.stack.filter(
            (s) => s.triggeredAbilityId === "ward"
        );
        expect(wardTriggers).toHaveLength(2);

        // Each ward trigger's own target is EXACTLY the spell whose
        // BECAME_TARGET event fired IT (via `triggerEvent.sourceInstanceId`),
        // never the other simultaneous targeter — CR 702.21e's "counter THAT
        // spell or ability", forced deterministically.
        const targetBySourceInstance = new Map(
            wardTriggers.map((t) => {
                const ev = t.triggerEvent;
                if (ev?.type !== "BECAME_TARGET") {
                    throw new Error("expected a BECAME_TARGET trigger event");
                }
                return [ev.sourceInstanceId, t.targets];
            })
        );
        expect(targetBySourceInstance.get(spellA.id)).toEqual([
            { type: "spell", id: spellA.id },
        ]);
        expect(targetBySourceInstance.get(spellB.id)).toEqual([
            { type: "spell", id: spellB.id },
        ]);
    });
});

describe("Ward e2e — counter-unless-pay resolution (CR 702.21a)", () => {
    it("declining the ward cost counters the opponent's targeting spell; the warded creature survives", () => {
        const { state, wardedInstId } = wardedState("p2", {
            p1ManaPool: {},
        });
        const spell = pushSpell(state, REMOVAL_ID, "p1", [
            { type: "permanent", id: wardedInstId },
        ]);
        emitBecameTargetEvents(state, spell.targets, "p1", spell.id);
        processPendingActionTriggers(state);
        expect(resolveTopOfStack(state)).toBeNull(); // suspended on may-pay
        expect(state.pendingChoices?.[0]?.kind).toBe("may-pay");
        // CR 117.3a — "unless THAT PLAYER pays": the countered object's own
        // controller (the caster of the removal spell), not the ward's
        // controller.
        expect(state.pendingChoices?.[0]?.playerId).toBe("p1");
        applyMayPaySubmit(state, { playerId: "p1", accept: false });
        // The removal spell is gone from the stack — countered (CR 701.5a) —
        // and the ward trigger itself has also resolved off the stack.
        expect(state.stack).toHaveLength(0);
        expect(state.players[0].graveyard.some((c) => c.id === spell.id)).toBe(
            true
        );
        expect(
            state.players[1].battlefield.some((c) => c.id === wardedInstId)
        ).toBe(true);
    });

    it("paying the ward cost lets the opponent's spell resolve normally and destroy the warded creature", () => {
        const { state, wardedInstId } = wardedState("p2", {
            p1ManaPool: { C: 2 },
        });
        const spell = pushSpell(state, REMOVAL_ID, "p1", [
            { type: "permanent", id: wardedInstId },
        ]);
        emitBecameTargetEvents(state, spell.targets, "p1", spell.id);
        processPendingActionTriggers(state);
        resolveTopOfStack(state); // suspends on may-pay
        applyMayPaySubmit(state, { playerId: "p1", accept: true });
        expect(state.players[0].manaPool.C ?? 0).toBe(0); // {2} generic paid
        // Ward trigger resolved without countering — the removal spell is
        // back on top of the stack.
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].id).toBe(spell.id);
        resolveTopOfStack(state); // resolves the removal spell itself
        expect(
            state.players[1].battlefield.some((c) => c.id === wardedInstId)
        ).toBe(false);
        expect(
            state.players[1].graveyard.some((c) => c.id === wardedInstId)
        ).toBe(true);
    });
});

describe("wire format (S5) — the ward may-pay choice survives projectPublicState", () => {
    it("the may-pay pending choice crosses the projection with the correct payer", () => {
        const { state, wardedInstId } = wardedState();
        const spell = pushSpell(state, REMOVAL_ID, "p1", [
            { type: "permanent", id: wardedInstId },
        ]);
        emitBecameTargetEvents(state, spell.targets, "p1", spell.id);
        processPendingActionTriggers(state);
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.pendingChoices?.[0]?.kind).toBe("may-pay");
        expect(projected.pendingChoices?.[0]?.playerId).toBe("p1");
        // The countered-object stack item is still present on the wire (the
        // ward trigger above it hasn't resolved yet).
        expect(
            projected.stack.some((s: { id: string }) => s.id === spell.id)
        ).toBe(true);
    });
});
