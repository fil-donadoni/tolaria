// usg green cards (Urza's Saga, split by colour per ADR 0043). Each
// non-trivial card gets a describe block referencing the CR it validates.

import { describe, it, expect } from "vitest";
import { argothianEnchantress, fertileGround } from "../green";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import {
    resolveTopOfStack,
    emitPermanentTapped,
    processPendingActionTriggers,
    type GameState,
} from "../../../../gre/state";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import { forest } from "../../lea/colorless";
import type { CardType } from "../../../types";

/** Answer the head pending choice with `picks` (an option id for
 *  requestOptionChoice) — drives the staged-resume resolution forward one
 *  round-trip. */
function answer(state: GameState, picks: string[]): void {
    const head = state.pendingChoices![0];
    applyPendingChoiceSubmit(state, {
        playerId: head.playerId,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds: picks,
    });
}

describe("Argothian Enchantress (draw on enchantment cast, CR 603.2 / 601.2i / 121.1)", () => {
    const trig = argothianEnchantress.triggeredAbilities?.[0];

    it("ships the shroud keyword (CR 702.18) on the printed definition", () => {
        expect(argothianEnchantress.staticAbilities).toContain("shroud");
    });

    it("trigger is a DSL Effect Script (mandatory draw), not a resolve closure", () => {
        expect(trig).toBeDefined();
        expect(trig!.effects).toEqual([
            { op: "draw", player: "controller", count: 1 },
        ]);
        expect(trig!.resolve).toBeUndefined();
    });

    it("matches enchantment spells you cast, not creatures or opponents' spells", () => {
        const self = {
            id: "aEn",
            controllerId: "p1",
            ownerId: "p1",
            types: ["Creature"] as CardType[],
            subtypes: [],
            isTapped: false,
            card: {},
        };
        const enchantmentEvent = {
            type: "SPELL_CAST" as const,
            casterId: "p1",
            spellInstanceId: "x",
            spellCardId: "y",
            spellTypes: ["Enchantment"] as CardType[],
            spellSubtypes: [],
            spellColors: [],
        };
        expect(trig!.matches(enchantmentEvent, self)).toBe(true);
        // Opponent cast → no fire (scope "you", CR 109.4).
        expect(
            trig!.matches({ ...enchantmentEvent, casterId: "p2" }, self)
        ).toBe(false);
        // Non-enchantment spell → no fire (SpellFilter).
        expect(
            trig!.matches(
                { ...enchantmentEvent, spellTypes: ["Creature"] as CardType[] },
                self
            )
        ).toBe(false);
    });

    it("resolves to a mandatory draw for the controller (end-to-end)", () => {
        const enchantress = makeInstance(argothianEnchantress.id, {
            id: "aEn",
            controllerId: "p1",
            ownerId: "p1",
        });
        const topCard = makeInstance(argothianEnchantress.id, {
            id: "lib1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [enchantress],
                    library: [topCard],
                }),
                makePlayer("p2"),
            ],
        });
        state.stack.push({
            ...enchantress,
            zone: "stack",
            castById: "p1",
            triggeredAbilityId: "argothian-enchantress-draw",
            triggerSourceId: "aEn",
            triggerEvent: {
                type: "SPELL_CAST",
                casterId: "p1",
                spellInstanceId: "s",
                spellCardId: "c",
                spellTypes: ["Enchantment"] as CardType[],
                spellSubtypes: [],
                spellColors: [],
            },
            targets: [],
        });
        resolveTopOfStack(state);
        expect(state.players[0].hand.map((c) => c.id)).toEqual(["lib1"]);
        expect(state.players[0].library).toHaveLength(0);
    });
});

// resolve() card (twin of Wild Growth, `lea/green.ts` — see the card's own
// justification comment). Full engine integration: attach → tap the
// enchanted land for mana → the `PERMANENT_TAPPED` trigger fires → suspends
// on the runtime colour choice → resumes → adds the chosen colour on top of
// the land's own mana.
describe("Fertile Ground (CR 603.2 tapped-for-mana trigger, additional mana of chosen color)", () => {
    it("matches only the attached host's mana tap (Wild Growth precedent)", () => {
        const trig = fertileGround.triggeredAbilities?.[0];
        expect(trig).toBeDefined();
        const self = {
            id: "fg",
            controllerId: "p1",
            ownerId: "p1",
            types: ["Enchantment"] as const,
            subtypes: ["Aura"],
            isTapped: false,
            attachedTo: "host-forest",
            card: {},
        };
        const host = {
            type: "PERMANENT_TAPPED" as const,
            permanentId: "host-forest",
            controllerId: "p1",
            permanentTypes: ["Land"] as const,
            permanentSubtypes: ["Forest"],
            forMana: true,
            manaProduced: { G: 1 },
        };
        expect(
            trig!.matches(host as never, self as never, undefined as never)
        ).toBe(true);
        expect(
            trig!.matches(
                { ...host, permanentId: "other-forest" } as never,
                self as never,
                undefined as never
            )
        ).toBe(false);
    });

    it("adds one mana of the chosen color on top of the land's own tap", () => {
        const land = makeInstance(forest.id, {
            id: "host-forest",
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(fertileGround.id, {
            id: "fg",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "host-forest",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [land, aura] }),
                makePlayer("p2"),
            ],
        });

        emitPermanentTapped(state, land, true, { G: 1 });
        // CR 605.4 — Fertile Ground's tap trigger is a mana ability: it
        // resolves immediately off the stack. The colour pick is made as it
        // resolves (CR 605.4b), so processing suspends on that choice rather
        // than parking the trigger on the stack for a later priority pass.
        processPendingActionTriggers(state);
        answer(state, ["W"]);

        expect(state.players[0].manaPool.W).toBe(1);
    });
});
