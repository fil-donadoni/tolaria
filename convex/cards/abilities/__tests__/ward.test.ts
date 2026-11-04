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
import { expandWard, parseWard, wardAbility } from "../ward";
import { getAllCards, getDefinition, registerTokenDefinition } from "../..";
import { MECHANICS_REGISTRY } from "../../mechanicsRegistry";
import { backFaceAsTokenSpec } from "../../backFaceSpec";
import { expandDefinition, tokenDefinitionId } from "../../registry";
import type { CardDefinition } from "../../types";
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
} from "../../__tests__/setup.helper";
import type { GameEvent, PermanentView, TargetRequirement } from "../../types";

// A synthetic 1/1 with Ward {2} (a plain generic cost — the common printed
// shape), declaring ONLY the keyword string: its trigger comes from the
// `getDefinition` seam (ADR 0054), the path a printed or compiled ward takes.
// Registered once via the test-injection seam so `pushSpell` /
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
});

// The dashed form (CR 702.21a's "[cost]" need not be mana).
const LIFE_WARDED_ID = "test-life-ward-creature";
registerTokenDefinition({
    id: LIFE_WARDED_ID,
    name: LIFE_WARDED_ID,
    rarity: "common",
    manaCost: { X: 1, U: 1 },
    types: ["Creature"],
    subtypes: ["Illusion"],
    power: 1,
    toughness: 1,
    staticAbilities: ["ward—pay 3 life"],
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
            sourceKind: "spell",
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
            sourceKind: "spell",
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
            sourceKind: "spell",
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
            sourceKind: "spell",
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
        emitBecameTargetEvents(state, spell.targets, "p1", spell.id, "spell");
        processPendingActionTriggers(state);
        expect(state.stack).toHaveLength(2);
        const top = state.stack[state.stack.length - 1];
        expect(top.triggeredAbilityId).toBe("ward");
        // `stackSourceId` (issue #1562 fixup) equals the announced id here —
        // a real SPELL (not an ability) has no `triggerSourceId`, so it
        // falls back to the stack item's own id.
        expect(top.targets).toEqual([
            { type: "spell", id: spell.id, stackSourceId: spell.id },
        ]);
    });

    it("your OWN spell targeting your OWN warded permanent never places a ward trigger", () => {
        const { state, wardedInstId } = wardedState("p1");
        const spell = pushSpell(state, REMOVAL_ID, "p1", [
            { type: "permanent", id: wardedInstId },
        ]);
        emitBecameTargetEvents(state, spell.targets, "p1", spell.id, "spell");
        processPendingActionTriggers(state);
        // No ward trigger fired — the removal spell is still alone on top.
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].id).toBe(spell.id);
    });
});

describe("raiseTriggerTargetSelection: two simultaneous targeters pin the EXACT triggering object (CR 702.21a, issue #1361)", () => {
    it("each ward trigger instance counters the SPECIFIC spell that caused it — no player choice, even with 2 legal 'targets this permanent' candidates", () => {
        const { state, wardedInstId } = wardedState();
        // Two DISTINCT opponent-controlled removal spells target the SAME
        // warded permanent before either resolves — the CR 702.21a edge: a
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
        emitBecameTargetEvents(state, spellA.targets, "p1", spellA.id, "spell");
        emitBecameTargetEvents(state, spellB.targets, "p1", spellB.id, "spell");
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
        // never the other simultaneous targeter — CR 702.21a's "counter THAT
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
            { type: "spell", id: spellA.id, stackSourceId: spellA.id },
        ]);
        expect(targetBySourceInstance.get(spellB.id)).toEqual([
            { type: "spell", id: spellB.id, stackSourceId: spellB.id },
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
        emitBecameTargetEvents(state, spell.targets, "p1", spell.id, "spell");
        processPendingActionTriggers(state);
        expect(resolveTopOfStack(state)).toBeNull(); // suspended on may-pay
        expect(state.pendingChoices?.[0]?.kind).toBe("may-pay");
        // CR 117.3a — "unless THAT PLAYER pays": the countered object's own
        // controller (the caster of the removal spell), not the ward's
        // controller.
        expect(state.pendingChoices?.[0]?.playerId).toBe("p1");
        applyMayPaySubmit(state, { playerId: "p1", accept: false });
        // The removal spell is gone from the stack — countered (CR 701.6a counter) —
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
        emitBecameTargetEvents(state, spell.targets, "p1", spell.id, "spell");
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
        emitBecameTargetEvents(state, spell.targets, "p1", spell.id, "spell");
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

describe("parseWard — the printed cost forms (CR 702.21a)", () => {
    it.each([
        ["ward {1}", { mana: { X: 1 } }, "{1}"],
        ["ward {4}", { mana: { X: 4 } }, "{4}"],
        ["ward—pay 2 life", { life: 2 }, "2 life"],
    ])("reads %s", (keyword, cost, costLabel) => {
        expect(parseWard(keyword)).toMatchObject({ cost, costLabel });
    });

    it.each([
        "ward",
        "ward {0}",
        "ward {x}",
        "ward {w}",
        "ward {2}{b}",
        "ward 2",
        "ward—pay 0 life",
        "ward—pay x life",
        "ward—discard a card",
        "ward—{2}, pay 2 life",
    ])("reads no cost from %s", (keyword) => {
        expect(parseWard(keyword)).toBeNull();
    });

    it("the registry row's bindingPattern admits exactly what parseWard reads, so a string the expander cannot enforce reds Guard A", () => {
        const row = MECHANICS_REGISTRY.find((r) => r.id === "ward")!;
        for (const keyword of ["ward {1}", "ward {12}", "ward—pay 7 life"]) {
            expect(row.bindingPattern!.test(keyword), keyword).toBe(true);
            expect(parseWard(keyword), keyword).not.toBeNull();
        }
        for (const keyword of ["ward {w}", "ward—discard a card", "ward 2"]) {
            expect(row.bindingPattern!.test(keyword), keyword).toBe(false);
            expect(parseWard(keyword), keyword).toBeNull();
        }
    });
});

describe("expandWard — the keyword string is the declaration (ADR 0054)", () => {
    const creature: CardDefinition = {
        id: "ward-expansion-probe",
        name: "ward-expansion-probe",
        rarity: "common",
        manaCost: { X: 1 },
        types: ["Creature"],
        power: 1,
        toughness: 1,
    };

    it("injects the factory's trigger at the getDefinition seam", () => {
        const def = getDefinition(WARDED_ID);
        expect(def.triggeredAbilities).toEqual([
            expect.objectContaining({ id: "ward", event: "BECAME_TARGET" }),
        ]);
    });

    it("a back face's ward reaches the trigger through its token decode (CR 712.8e)", () => {
        const spec = backFaceAsTokenSpec({
            name: "Warded Back Face",
            types: ["Creature"],
            power: 2,
            toughness: 2,
            staticAbilities: ["ward {2}"],
        });
        const def = getDefinition(tokenDefinitionId(spec));
        expect(def.triggeredAbilities?.map((t) => t.id)).toEqual(["ward"]);
    });

    it("is a no-op on a definition without the string — the granted path stays by hand", () => {
        expect(expandWard(creature)).toBe(creature);
        const granted = { ...creature, staticAbilities: ["flying"] };
        expect(expandWard(granted)).toBe(granted);
    });

    it("does not ward twice when a definition is spread from an expanded one", () => {
        const once = expandWard({
            ...creature,
            staticAbilities: ["ward {2}"],
        });
        expect(once.triggeredAbilities).toHaveLength(1);
        expect(expandWard({ ...once }).triggeredAbilities).toHaveLength(1);
    });

    it("each declared ward triggers on its own", () => {
        const def = expandWard({
            ...creature,
            staticAbilities: ["ward {2}", "ward—pay 2 life"],
        });
        expect(def.triggeredAbilities?.map((t) => t.id)).toEqual([
            "ward",
            "ward-2",
        ]);
    });

    it("the dashed form's reminder prints its own cost, never a mana-shaped one", () => {
        const def = expandWard({
            ...creature,
            staticAbilities: ["ward—pay 2 life"],
        });
        expect(def.triggeredAbilities?.[0]?.oracleText).toBe(
            "Ward—Pay 2 life (Whenever this permanent becomes the target of a spell or ability an opponent controls, counter it unless that player pays 2 life.)"
        );
    });

    it("no catalogue card wards twice: one trigger per ward string", () => {
        const offenders: string[] = [];
        for (const card of getAllCards()) {
            const declared = (card.staticAbilities ?? []).filter((s) =>
                /^ward[ —]/.test(s)
            ).length;
            const triggers = (
                expandDefinition(card).triggeredAbilities ?? []
            ).filter((t) => t.targetRequirement?.spellTargetsSelfSource).length;
            if (declared !== triggers) offenders.push(card.name);
        }
        expect(offenders).toEqual([]);
    });
});

describe("Ward—Pay N life e2e (CR 702.21a, CR 119.4)", () => {
    function lifeWardedBoard(p1Life: number) {
        const warded = makeInstance(LIFE_WARDED_ID, {
            id: "warded1",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { life: p1Life }),
                makePlayer("p2", { battlefield: [warded] }),
            ],
        });
        const spell = pushSpell(state, REMOVAL_ID, "p1", [
            { type: "permanent", id: "warded1" },
        ]);
        emitBecameTargetEvents(state, spell.targets, "p1", spell.id, "spell");
        processPendingActionTriggers(state);
        return { state, spell };
    }

    it("paying loses the life and lets the spell resolve", () => {
        const { state, spell } = lifeWardedBoard(20);
        expect(resolveTopOfStack(state)).toBeNull();
        expect(state.pendingChoices?.[0]?.playerId).toBe("p1");
        applyMayPaySubmit(state, { playerId: "p1", accept: true });
        expect(state.players[0].life).toBe(17);
        expect(state.stack.map((s) => s.id)).toEqual([spell.id]);
    });

    it("declining counters the spell and costs no life", () => {
        const { state, spell } = lifeWardedBoard(20);
        resolveTopOfStack(state);
        applyMayPaySubmit(state, { playerId: "p1", accept: false });
        expect(state.players[0].life).toBe(20);
        expect(state.stack).toHaveLength(0);
        expect(state.players[0].graveyard.some((c) => c.id === spell.id)).toBe(
            true
        );
    });

    it("a player with less life than the cost cannot pay: the spell is countered (CR 119.4)", () => {
        const { state, spell } = lifeWardedBoard(2);
        resolveTopOfStack(state);
        if ((state.pendingChoices ?? []).length > 0)
            applyMayPaySubmit(state, { playerId: "p1", accept: true });
        expect(state.players[0].life).toBe(2);
        expect(state.stack).toHaveLength(0);
        expect(state.players[0].graveyard.some((c) => c.id === spell.id)).toBe(
            true
        );
    });
});
