// IKO — multicolor: Lutri, the Spellchaser (issue #1391, ADR 0064's Companion
// framework tracer). Flash + a targeted ETB copy trigger gated on "if you
// cast it" (CR 603.4, `PermanentEnteredEvent.wasCast`) + the Companion
// keyword (its Singleton deck-construction condition is exercised end-to-end
// in convex/gre/__tests__/companion.test.ts via the real `lutri` definition;
// this file owns the card's own resolve() behavior).

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import {
    resolveTopOfStack,
    processPendingActionTriggers,
    getCostModifiers,
    applyCostModifiers,
    normalizeManaCost,
    type CardInstanceState,
} from "../../../../gre/state";
import { projectPublicState } from "../../../../gameProjections";
import type { GameState } from "../../../../gre/state";
import {
    canCastFromGraveyardByPermission,
    getLegalActions,
} from "../../../../gre/rules";
import { getDefinition } from "../../../index";

const lutri = getDefinition("fb1189c9-7842-466e-8238-1e02677d8494");
const lurrus = getDefinition("5ad36fb2-c44e-4085-ba0d-54277841ad3a");
const lightningBolt = getDefinition("d573ef03-4730-45aa-93dd-e45ac1dbaf4a");
const savannahLions = getDefinition("d05b92bd-797e-413f-a8b0-32e0937a1ee0");
const stoneRain = getDefinition("57ff74cb-a2ed-4123-ac42-f72f9820049e");
const zirda = getDefinition("1bd8e61c-2ee8-4243-a848-7008810db8a0");
// Dragon Engine (atq/colorless.ts) — Artifact Creature, "{2}: +1/+0" (non-mana,
// useStack: true). Cross-set fixture, same pattern as Power Artifact's own
// test (atq/__tests__/blue.test.ts).
const dragonEngine = getDefinition("07793a71-1106-4303-b620-e403bd378020");
// Celestial Prism (lea/colorless.ts) — Artifact, "{2}, {T}: Add one mana of
// any color" — a MANA ability (useStack: false) WITH mana in its own cost,
// the one shape that proves Zirda's "aren't mana abilities" exclusion (a
// mana-less mana ability, like a basic land's, would pass vacuously).
const celestialPrism = getDefinition("a47417cb-1ea7-4f65-ba06-e27a99373114");
// Armageddon Clock (atq/colorless.ts) — "{4}: Remove a doom counter... Any
// player may activate this ability" (`activatableByAnyPlayer: true`, CR
// 113.3c). The one shipped ability where the ACTIVATOR can differ from the
// source's controller — exactly the axis Zirda's "abilities YOU ACTIVATE"
// must key off instead of the source's `controllerId`.
const armageddonClock = getDefinition("44a31889-6a8d-450c-a73d-381a7ff28bf9");

describe("Lutri, the Spellchaser (Companion, Flash, CR 603.6a copy-on-cast ETB)", () => {
    it("when CAST, copies a target instant/sorcery spell it controls (CR 707.10)", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        // p1 already has an instant on the stack under their own control.
        const bolt = pushSpell(state, lightningBolt.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        // p1 casts Lutri above it.
        pushSpell(state, lutri.id, "p1");
        // Resolve Lutri's cast — CR 601.2i: `wasCast: true` on the resulting
        // PERMANENT_ENTERED event, so the ETB trigger's `condition` (CR 603.4)
        // fires and CR 603.3d locks its target as it's placed on the stack.
        // With exactly one legal target (the Bolt), the sole mandatory target
        // auto-selects — no real choice, no `pendingTarget` (CR 603.3d).
        resolveTopOfStack(state);
        expect(state.pendingTarget).toBeUndefined();
        const trigger = state.stack.find(
            (s) => s.triggeredAbilityId === "lutri-etb"
        );
        expect(trigger?.targets).toEqual([
            { type: "spell", id: bolt.id, stackSourceId: bolt.id },
        ]);

        // Resolve the trigger — copies the Bolt onto the stack above it.
        resolveTopOfStack(state);
        expect(state.stack).toHaveLength(2);
        expect(state.stack[0].id).toBe(bolt.id);
        const copy = state.stack[state.stack.length - 1];
        expect(copy.isCopy).toBe(true);
        expect((copy.card as { id: string }).id).toBe(lightningBolt.id);
        expect(copy.id).not.toBe(bolt.id);
        // Lutri itself resolved onto the battlefield.
        expect(
            state.players[0].battlefield.some(
                (c) => c.id !== copy.id && c.id !== bolt.id
            )
        ).toBe(true);
    });

    it("does NOT copy when Lutri enters WITHOUT being cast (CR 603.4 'if you cast it')", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        pushSpell(state, lightningBolt.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        // A reanimation-shaped entry: Lutri lands on the battlefield via a
        // direct zone move, never resolving as a cast spell — no `wasCast`.
        const entered = makeInstance(lutri.id, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(entered);
        state.pendingEvents = [
            ...(state.pendingEvents ?? []),
            {
                type: "PERMANENT_ENTERED",
                instanceId: entered.id,
                controllerId: "p1",
                cardId: lutri.id,
                types: ["Creature"],
                // wasCast omitted — this is the point of the test.
            },
        ];
        // Manually drain events the way `resolveTopOfStack` would.
        const before = state.stack.length;
        processPendingActionTriggers(state);
        // No trigger landed — the stack is unchanged and there's no pending
        // target for a copy.
        expect(state.stack.length).toBe(before);
        expect(state.pendingTarget).toBeUndefined();
    });

    it("cannot target an opponent's spell (CR 109.3 / 114.1 — controller: you)", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        // p2 controls the only instant/sorcery on the stack; p1 casts Lutri.
        pushSpell(state, stoneRain.id, "p2");
        pushSpell(state, lutri.id, "p1");
        resolveTopOfStack(state);

        // CR 603.3c — with no legal target (the only instant/sorcery is the
        // opponent's), the trigger never goes on the stack at all.
        expect(state.pendingTarget).toBeUndefined();
        expect(
            state.stack.some((s) => s.triggeredAbilityId === "lutri-etb")
        ).toBe(false);
    });

    it("the copy is visible through the wire projection to both players", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        pushSpell(state, lightningBolt.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        pushSpell(state, lutri.id, "p1");
        resolveTopOfStack(state);
        resolveTopOfStack(state);

        const copy = state.stack[state.stack.length - 1];
        for (const viewerId of ["p1", "p2"]) {
            const projected = projectPublicState(
                state as GameState,
                1,
                viewerId
            );
            expect(
                projected.stack.some((s) => s.id === copy.id && s.isCopy)
            ).toBe(true);
        }
    });
});

describe("Lurrus of the Dream-Den (Companion, Lifelink, static graveyard-permanent-cast permission, issue #1392)", () => {
    it("while on the battlefield, grants the once-per-turn graveyard-permanent-cast permission (CR 702.139) — full GRE + wire coverage lives in gre/__tests__/graveyardPermanentCastPermission.test.ts", () => {
        const lurrusOnBattlefield = makeInstance(lurrus.id, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        // Savannah Lions is MV 1, at or under Lurrus's cap of 2.
        const gyLions = makeInstance(savannahLions.id, {
            id: "gy-lions",
            zone: "graveyard",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [lurrusOnBattlefield],
                    graveyard: [gyLions],
                    manaPool: { W: 1 },
                }),
                makePlayer("p2"),
            ],
        });
        const p1 = state.players[0];
        expect(canCastFromGraveyardByPermission(state, p1, gyLions)).toBe(true);
        expect(getLegalActions(state, p1, gyLions)).toContain("cast");
    });
});

describe("Zirda, the Dawnwaker (Companion, activated-ability cost reduction excluding mana abilities, CR 601.2f / 118.7 / 605.1a, issue #1339)", () => {
    /** Mirror game.ts's `activateAbility` cost calculation: normalize the
     *  ability's printed mana cost, then fold in the battlefield cost
     *  modifiers (same helper shape as Power Artifact's own test,
     *  atq/__tests__/blue.test.ts). `activatorId` mirrors the real
     *  `activateAbility` mutation's `player.id` argument — omitted, it
     *  defaults to the host's own controller (the ordinary case; every
     *  ability below except Armageddon Clock's can only ever be activated by
     *  its own controller). */
    function effectiveAbilityCost(
        state: GameState,
        host: CardInstanceState,
        abilityId: string,
        activatorId?: string
    ): Record<string, number> {
        const def = getDefinition((host.card as { id: string }).id);
        const ability = def.activatedAbilities!.find(
            (a) => a.id === abilityId
        )!;
        const cost = ability.cost.mana
            ? normalizeManaCost(ability.cost.mana)
            : {};
        applyCostModifiers(
            cost,
            getCostModifiers(state, host, "ability", ability, activatorId)
        );
        return cost;
    }

    /** Dragon Engine + Celestial Prism on one board, controlled by
     *  `hostController`; Zirda always controlled by p1. */
    function boardWithZirda(hostController: "p1" | "p2") {
        const engine = makeInstance("07793a71-1106-4303-b620-e403bd378020", {
            id: "engine",
            controllerId: hostController,
            ownerId: hostController,
        });
        const prism = makeInstance(celestialPrism.id, {
            id: "prism",
            controllerId: hostController,
            ownerId: hostController,
        });
        const z = makeInstance(zirda.id, {
            id: "zirda",
            controllerId: "p1",
            ownerId: "p1",
        });
        const p1Battlefield =
            hostController === "p1" ? [engine, prism, z] : [z];
        const p2Battlefield = hostController === "p2" ? [engine, prism] : [];
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: p1Battlefield }),
                makePlayer("p2", { battlefield: p2Battlefield }),
            ],
        });
        return { state, engine, prism, z };
    }

    it("reduces its controller's non-mana ability by {2}, floored at one mana (CR 118.7)", () => {
        const { state, engine } = boardWithZirda("p1");
        // Dragon Engine's {2} pump ability: {2} - {2} = {0}, floored to {1}.
        expect(
            effectiveAbilityCost(state, engine, "dragon-engine-ability")
        ).toEqual({ X: 1 });
    });

    it("does NOT reduce an ability its controller doesn't control ('abilities YOU activate')", () => {
        const { state, engine } = boardWithZirda("p2");
        expect(
            effectiveAbilityCost(state, engine, "dragon-engine-ability")
        ).toEqual({ X: 2 });
    });

    it("does NOT reduce a mana ability, even with mana in its own cost (CR 605.1a, 'aren't mana abilities')", () => {
        const { state, prism } = boardWithZirda("p1");
        expect(
            effectiveAbilityCost(state, prism, "celestial-prism-mana")
        ).toEqual({ X: 2 });
    });

    describe("scoped to the ACTIVATOR, not the source's controller (CR 602.1a, activatableByAnyPlayer)", () => {
        /** p1 controls Zirda + `clockController`'s Armageddon Clock; the
         *  ability is activated by `activator`. */
        function boardWithClock(
            clockController: "p1" | "p2",
            activator: "p1" | "p2"
        ) {
            const clock = makeInstance(armageddonClock.id, {
                id: "clock",
                controllerId: clockController,
                ownerId: clockController,
            });
            const z = makeInstance(zirda.id, {
                id: "zirda",
                controllerId: "p1",
                ownerId: "p1",
            });
            const p1Battlefield = clockController === "p1" ? [clock, z] : [z];
            const p2Battlefield = clockController === "p2" ? [clock] : [];
            const state = makeState({
                players: [
                    makePlayer("p1", { battlefield: p1Battlefield }),
                    makePlayer("p2", { battlefield: p2Battlefield }),
                ],
            });
            return {
                state,
                clock,
                cost: () =>
                    effectiveAbilityCost(
                        state,
                        clock,
                        "armageddon-clock-remove-doom",
                        activator
                    ),
            };
        }

        it("reduces it when Zirda's controller is the one activating, even a Clock they don't control", () => {
            // p2 controls the Clock; p1 (Zirda's controller) activates it
            // under `activatableByAnyPlayer` — CR 602.1a makes p1 the "you".
            const { cost } = boardWithClock("p2", "p1");
            expect(cost()).toEqual({ X: 2 });
        });

        it("does NOT reduce it when someone else activates a Clock Zirda's controller DOES control", () => {
            // p1 controls both the Clock and Zirda, but p2 is the activator —
            // p2 is not p1's Zirda's "you", so the Clock's controller owning
            // it is irrelevant.
            const { cost } = boardWithClock("p1", "p2");
            expect(cost()).toEqual({ X: 4 });
        });

        it("reduces the ordinary same-player case (activator === controller === Zirda's controller)", () => {
            const { cost } = boardWithClock("p1", "p1");
            expect(cost()).toEqual({ X: 2 });
        });
    });

    it("wire format: the reduction survives projectPublicState", () => {
        const { state } = boardWithZirda("p1");
        const projected = projectPublicState(state as GameState, 1, "p1");
        const slimEngine = projected.players[0].battlefield.find(
            (c) => c.id === "engine"
        )!;
        expect(
            effectiveAbilityCost(
                projected as unknown as GameState,
                slimEngine as unknown as CardInstanceState,
                "dragon-engine-ability"
            )
        ).toEqual({ X: 1 });
    });
});
