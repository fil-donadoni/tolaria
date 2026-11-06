// MSH — multicolor behavior tests (ADR 0043 colour split).
//
// Jennifer Walters // The Sensational She-Hulk (issue #8171): a modal DFC
// (CR 712.3) whose both faces lock opponents out of casting on the owner's
// turn (CR 601.3 / 102.1) and whose back face redirects damage dealt to the
// owner's creatures (CR 603.2 / 120.3), once each turn.

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../__tests__/setup.helper";
import { collectTriggers } from "../../../../gre/triggers";
import { transformPermanent } from "../../../../gre/transform";
import { presentedDefId } from "../../../../gre/copy";
import { withTemporaryDefinition } from "../../../registry";
import { modalBackTwinDefinition } from "../../../modalDfc";
import { resolveTokenStaticEffects } from "../../../tokenStaticEffects";
import type {
    DamageDealtEvent,
    StaticCastRestriction,
    StaticEffect,
    StaticEffectContext,
    StaticEffectStateView,
} from "../../../types";
import type { CardInstanceState } from "../../../../gre/state";
import { grizzlyBears } from "../../lea/index.cards";
import { jenniferWaltersTheSensationalSheHulk } from "../multicolor.cards";

const SHE_HULK_TRIGGER = "the-sensational-she-hulk-redirect";

function castRestrictionOf(
    effects: readonly StaticEffect[] | undefined
): StaticCastRestriction {
    const found = effects?.find((e) => e.kind === "cast-restriction");
    if (found?.kind !== "cast-restriction")
        throw new Error("no cast-restriction static effect");
    return found;
}

/** Does the gate forbid `caster` while `active` has the turn? The source is
 *  controlled by p1. */
function forbids(
    restriction: StaticCastRestriction,
    caster: string,
    active: string | undefined
): boolean {
    const source = makeInstance(grizzlyBears().id, { controllerId: "p1" });
    return restriction.forbids(
        caster,
        source as never,
        source as never,
        { activePlayerId: active } as unknown as StaticEffectStateView,
        {} as StaticEffectContext
    );
}

function damageTo(target: CardInstanceState, amount: number): DamageDealtEvent {
    return {
        type: "DAMAGE_DEALT",
        sourceInstanceId: "src",
        sourceControllerId: "p2",
        target: { type: "permanent", id: target.id },
        amount,
        isCombat: false,
        sourceColors: ["R"],
        sourceTypes: ["Instant"],
        sourceSubtypes: [],
        sourceStaticAbilities: [],
    };
}

describe("Jennifer Walters // The Sensational She-Hulk (issue #8171)", () => {
    const front = jenniferWaltersTheSensationalSheHulk();
    const twin = modalBackTwinDefinition(front)!;

    it("front face: opponents cannot cast on its controller's turn only (CR 601.3 / 102.1)", () => {
        const lock = castRestrictionOf(front.staticEffects);
        expect(forbids(lock, "p2", "p1")).toBe(true);
        expect(forbids(lock, "p2", "p2")).toBe(false);
        expect(forbids(lock, "p1", "p1")).toBe(false);
    });

    it("back face carries the same lock through its static key (CR 712.3)", () => {
        const lock = castRestrictionOf(twin.staticEffects);
        expect(forbids(lock, "p2", "p1")).toBe(true);
        expect(forbids(lock, "p2", "p2")).toBe(false);
        const decoded = castRestrictionOf(
            resolveTokenStaticEffects(["opponents-cant-cast-during-your-turn"])
        );
        expect(forbids(decoded, "p2", "p1")).toBe(true);
    });

    it("transform ability is sorcery-speed and costs {3}{G}{W}{W} (CR 602.5d)", () => {
        const ability = front.activatedAbilities?.[0];
        expect(ability?.sorcerySpeedOnly).toBe(true);
        expect(ability?.cost).toEqual({ mana: { X: 3, G: 1, W: 2 } });
    });

    it("back face: a damaged creature you control triggers once per turn, an opposing one never (CR 603.2)", () => {
        withTemporaryDefinition(front, () => {
            withTemporaryDefinition(twin, () => {
                const hulk = makeInstance(front.id, {
                    id: "hulk",
                    controllerId: "p1",
                });
                const mine = makeInstance(grizzlyBears().id, {
                    id: "mine",
                    controllerId: "p1",
                });
                const theirs = makeInstance(grizzlyBears().id, {
                    id: "theirs",
                    controllerId: "p2",
                });
                const state = makeState({
                    players: [
                        makePlayer("p1", { battlefield: [hulk, mine] }),
                        makePlayer("p2", { battlefield: [theirs] }),
                    ],
                });
                // Front face up: no trigger at all.
                expect(
                    collectTriggers(state, [damageTo(mine, 2)]).map(
                        (t) => t.triggeredAbilityId
                    )
                ).not.toContain(SHE_HULK_TRIGGER);

                transformPermanent(state, hulk);
                expect(presentedDefId(hulk)).toBe(twin.id);

                const fire = (target: CardInstanceState, amount: number) =>
                    collectTriggers(state, [damageTo(target, amount)]).filter(
                        (t) => t.triggeredAbilityId === SHE_HULK_TRIGGER
                    );
                expect(fire(theirs, 3)).toHaveLength(0);
                expect(fire(mine, 2)).toHaveLength(1);
                // Second damage event the same turn: capped.
                expect(fire(mine, 2)).toHaveLength(0);
            });
        });
    });

    it("the redirect script deals the event's amount to the chosen target", () => {
        const ability = twin.triggeredAbilities?.find(
            (t) => t.id === SHE_HULK_TRIGGER
        );
        expect(ability?.maxTriggersPerTurn).toBe(1);
        expect(ability?.targetRequirement).toEqual({ type: "any", count: 1 });
        expect(JSON.stringify(ability?.effects)).toContain("$event.amount");
    });
});
