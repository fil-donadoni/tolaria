// TDM — red card behavior tests (ADR 0043 colour split). One describe per
// card with non-trivial behavior; GRE + wire-format coverage per
// `.claude/rules/gre-development.md`.
//
// Cori-Steel Cutter (issue #1202): the Flurry trigger condition
// (`nthSpellThisTurn(2)` + `scope: "you"`) has its own dedicated test suite
// (`cards/abilities/triggers/__tests__/spellCastTrigger.test.ts`); the
// `createToken` `bind` + `mayPay` + `attach` composition has ITS own
// permanent test (`gre/effects/__tests__/interpreter.test.ts`, "createToken
// bind + attach"). This file locks the CARD wiring: the real production
// `coriSteelCutter` definition fires on the controller's own second spell,
// creates the Monk token, offers the optional attach, and the Equip ability
// + static effects apply CR 611/613 correctly end-to-end.

import { describe, it, expect } from "vitest";
import { coriSteelCutter } from "../red";
import { grizzlyBears } from "../../lea/green";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import {
    type CardInstanceState,
    type GameState,
    type StackItem,
    resolveTopOfStack,
} from "../../../../gre/state";
import { applyMayPaySubmit } from "../../../../gre/pendingChoiceSubmit";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { projectPublicState } from "../../../../gameProjections";
import type { CardType } from "../../../types";

function resolveActivated(
    state: GameState,
    source: CardInstanceState,
    abilityId: string,
    targets: StackItem["targets"] = []
): void {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        abilityId,
        targets,
    } as StackItem);
    resolveTopOfStack(state);
}

describe("Cori-Steel Cutter (TDM #103, Flurry + Equipment, issue #1202)", () => {
    const trig = coriSteelCutter.triggeredAbilities?.[0];

    it("definition sanity — mana cost, types, subtypes, equip cost", () => {
        expect(coriSteelCutter.manaCost).toEqual({ generic: 1, R: 1 });
        expect(coriSteelCutter.types).toEqual(["Artifact"]);
        expect(coriSteelCutter.subtypes).toEqual(["Equipment"]);
        expect(coriSteelCutter.activatedAbilities).toHaveLength(1);
        expect(coriSteelCutter.activatedAbilities![0].cost).toEqual({
            mana: { generic: 1, R: 1 },
        });
        expect(trig).toBeDefined();
        expect(trig!.effects).toBeDefined();
        expect(trig!.resolve).toBeUndefined();
    });

    it("declares the +1/+1, trample and haste static grants", () => {
        const buffs = (coriSteelCutter.staticEffects ?? [])
            .filter((e) => e.kind === "pt-buff")
            .map((e) => {
                const b = e as { power: number; toughness: number };
                return { power: b.power, toughness: b.toughness };
            });
        expect(buffs).toEqual([{ power: 1, toughness: 1 }]);
        const keywords = (coriSteelCutter.staticEffects ?? [])
            .filter((e) => e.kind === "keyword-grant")
            .map((e) => (e as { keyword: string }).keyword);
        expect(keywords).toEqual(["trample", "haste"]);
    });

    // CR 601.2i — "you cast" (scope "you"), NOT "a player casts" (unlike
    // Ledger Shredder's connive, scope "any"): only the equipment's OWN
    // controller's second spell fires the trigger.
    it("Flurry fires only on the CONTROLLER's own second spell this turn", () => {
        const self = {
            id: "cutter1",
            controllerId: "p1",
            ownerId: "p1",
            types: ["Artifact"] as CardType[],
            subtypes: ["Equipment"],
            isTapped: false,
            card: {},
        };
        const baseEvent = {
            type: "SPELL_CAST" as const,
            spellInstanceId: "x",
            spellCardId: "y",
            spellTypes: ["Instant"] as CardType[],
            spellSubtypes: [],
            spellColors: [],
        };
        // Controller's 1st spell — no fire.
        expect(
            trig!.matches(
                { ...baseEvent, casterId: "p1", casterSpellCountThisTurn: 0 },
                self
            )
        ).toBe(false);
        // OPPONENT's 2nd spell — no fire (scope "you", not "any").
        expect(
            trig!.matches(
                { ...baseEvent, casterId: "p2", casterSpellCountThisTurn: 1 },
                self
            )
        ).toBe(false);
        // Controller's 2nd spell — fires.
        expect(
            trig!.matches(
                { ...baseEvent, casterId: "p1", casterSpellCountThisTurn: 1 },
                self
            )
        ).toBe(true);
    });

    function pushFlurryTrigger(
        state: GameState,
        cutter: CardInstanceState
    ): void {
        state.stack.push({
            ...cutter,
            zone: "stack",
            castById: "p1",
            triggeredAbilityId: trig!.id,
            triggerSourceId: cutter.id,
            triggerEvent: {
                type: "SPELL_CAST",
                casterId: "p1",
                spellInstanceId: "s",
                spellCardId: "c",
                spellTypes: ["Instant"] as CardType[],
                spellSubtypes: [],
                spellColors: [],
                casterSpellCountThisTurn: 1,
            },
            targets: undefined,
        } as StackItem);
    }

    it("Flurry creates a 1/1 white Monk with prowess and attaches when accepted", () => {
        const cutter = makeInstance(coriSteelCutter.id, {
            id: "cutter2",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [cutter] }),
                makePlayer("p2"),
            ],
        });
        pushFlurryTrigger(state, state.players[0].battlefield[0]);
        expect(resolveTopOfStack(state)).toBeNull(); // suspended on may-pay
        applyMayPaySubmit(state, { playerId: "p1", accept: true });

        const monk = state.players[0].battlefield.find(
            (c) => c.isToken && c.subtypes?.includes("Monk")
        )!;
        expect(monk).toBeDefined();
        expect(monk.power).toBe(1);
        expect(monk.toughness).toBe(1);
        expect(monk.staticAbilities).toContain("prowess");

        const foundCutter = state.players[0].battlefield.find(
            (c) => c.id === "cutter2"
        )!;
        expect(foundCutter.attachedTo).toBe(monk.id);
        // Equipped-creature static grants now apply to the Monk (CR 611/613).
        expect(getEffectivePower(state, monk)).toBe(2); // 1 + 1
        expect(getEffectiveToughness(state, monk)).toBe(2);
        expect(monk.staticAbilities).toContain("trample");
        expect(monk.staticAbilities).toContain("haste");
    });

    it("Flurry still creates the token but does NOT attach when declined", () => {
        const cutter = makeInstance(coriSteelCutter.id, {
            id: "cutter3",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [cutter] }),
                makePlayer("p2"),
            ],
        });
        pushFlurryTrigger(state, state.players[0].battlefield[0]);
        resolveTopOfStack(state);
        applyMayPaySubmit(state, { playerId: "p1", accept: false });

        const monk = state.players[0].battlefield.find(
            (c) => c.isToken && c.subtypes?.includes("Monk")
        )!;
        expect(monk).toBeDefined();
        const foundCutter = state.players[0].battlefield.find(
            (c) => c.id === "cutter3"
        )!;
        expect(foundCutter.attachedTo).toBeUndefined();
    });

    it("Flurry's attach outcome + token survive projection (wire format)", () => {
        const cutter = makeInstance(coriSteelCutter.id, {
            id: "cutter4",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [cutter] }),
                makePlayer("p2"),
            ],
        });
        pushFlurryTrigger(state, state.players[0].battlefield[0]);
        resolveTopOfStack(state);
        applyMayPaySubmit(state, { playerId: "p1", accept: true });

        const monk = state.players[0].battlefield.find(
            (c) => c.isToken && c.subtypes?.includes("Monk")
        )!;
        const projected = projectPublicState(state, 1, "p1");
        const slimCutter = projected.players[0].battlefield.find(
            (c) => c.id === "cutter4"
        )!;
        const slimMonk = projected.players[0].battlefield.find(
            (c) => c.id === monk.id
        )!;
        expect(slimCutter.attachedTo).toBe(monk.id);
        expect(slimMonk.staticAbilities).toContain("prowess");
        expect(getEffectivePower(projected, slimMonk)).toBe(2);
        expect(getEffectiveToughness(projected, slimMonk)).toBe(2);
        expect(slimMonk.staticAbilities).toContain("trample");
        expect(slimMonk.staticAbilities).toContain("haste");
    });

    it("Equip {1}{R} attaches to target creature you control (CR 702.6)", () => {
        const cutter = makeInstance(coriSteelCutter.id, {
            id: "cutter5",
            controllerId: "p1",
            ownerId: "p1",
        });
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear5",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [cutter, bear] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(
            state,
            state.players[0].battlefield[0],
            "cori-steel-cutter-equip",
            [{ type: "permanent", id: "bear5" }]
        );
        const foundCutter = state.players[0].battlefield.find(
            (c) => c.id === "cutter5"
        )!;
        expect(foundCutter.attachedTo).toBe("bear5");
        const foundBear = state.players[0].battlefield.find(
            (c) => c.id === "bear5"
        )!;
        expect(getEffectivePower(state, foundBear)).toBe(3); // 2 + 1
        expect(getEffectiveToughness(state, foundBear)).toBe(3);
        expect(foundBear.staticAbilities).toContain("trample");
        expect(foundBear.staticAbilities).toContain("haste");
    });
});
