/**
 * Issue #2297 — the bot must not pay a sacrifice-cost activation with the
 * ability's OWN SOURCE when the ability's whole effect is delivered to
 * `$source`: the cost is paid, the source is in the graveyard before the
 * ability resolves, and the resolution does nothing (CR 608.2b).
 *
 * The rows below come from a census of every activated ability in
 * `convex/cards/sets/**` whose `cost` carries a `sacrificeFilter` AND which
 * has an `effects[]` script (38 of them). The two columns that decide each
 * row are (1) is the source a legal victim of its own cost filter — no
 * "another", CR 109.2 — and (2) is every Op in the script scoped to
 * `$source`. Only a row that is YES on both may lose its self-victim variant;
 * the must-NOT rows are the point of the suite.
 */

import { describe, it, expect } from "vitest";
import type {
    ActivatedAbility,
    CardDefinition,
    EffectOp,
} from "../../../cards/types";
import { getCardByName } from "../../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../cards/__tests__/setup";
import type { CardInstanceState, GameState, PlayerState } from "../../state";
import {
    activationSacrificeVictims,
    enumerateActivationCostPicks,
} from "../../activationCostPicks";
import { enumerateMoves } from "../../moves";
import { abilityBenefitIsConfinedToSource } from "../sourceConfinedBenefit";

/** The named card's SACRIFICE-COST activated ability — read off the real
 *  catalogue (never a copy) so a row goes red if the card is re-authored, and
 *  found by cost shape rather than by index so inserting an unrelated ability
 *  cannot silently repoint a row at the wrong ability. */
function abilityOf(cardName: string): ActivatedAbility {
    const def: CardDefinition = getCardByName(cardName);
    const ability = def.activatedAbilities?.find(
        (a) => a.cost.sacrificeFilter !== undefined
    );
    if (!ability) {
        throw new Error(`${cardName} has no sacrifice-cost activated ability`);
    }
    return ability;
}

/** A battlefield permanent of `cardName` controlled by `p1`. */
function onBattlefield(cardName: string, id: string): CardInstanceState {
    return makeInstance(getCardByName(cardName).id, {
        id,
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
        isSummoningSick: false,
    });
}

function stateWith(battlefield: CardInstanceState[]): {
    state: GameState;
    player: PlayerState;
} {
    const state = makeState({
        players: [makePlayer("p1", { battlefield }), makePlayer("p2")],
    });
    return { state, player: state.players[0] };
}

/** Every permanent each enumerated pick-variant would actually sacrifice —
 *  the same union `applyMove.ts` removes, so a victim the SERVER auto-resolved
 *  at announcement (and which therefore never appears in `sacrificeIds`) is
 *  counted. Reading `sacrificeIds` alone would miss exactly the only-legal-
 *  victim case this guard exists for. */
function enumeratedVictims(
    state: GameState,
    player: PlayerState,
    source: CardInstanceState,
    ability: ActivatedAbility
): string[][] {
    return enumerateActivationCostPicks(state, player, source, ability).map(
        (picks) =>
            activationSacrificeVictims(state, player, source, ability, picks)
    );
}

describe("source-confined benefit predicate (CR 608.2b, issue #2297)", () => {
    // --- rows that ARE confined to $source -------------------------------
    it('"gets +2/+1 until end of turn" — pump on $source is confined', () => {
        expect(
            abilityBenefitIsConfinedToSource(abilityOf("Fallen Angel"))
        ).toBe(true);
    });

    it('"Regenerate this creature" — regenerate on $source is confined', () => {
        // The SECOND catalogue card carrying this bug, and the reason it is
        // fixed as a class: nothing about it resembles a pump.
        expect(
            abilityBenefitIsConfinedToSource(abilityOf("Devouring Strossus"))
        ).toBe(true);
    });

    it("a $source pump whose cost filter cannot reach the source is still confined (the predicate is about the EFFECT, not the cost)", () => {
        // Thallid Devourer sacrifices a Saproling and pumps itself; it is a
        // Fungus, so the source is never a legal victim. The predicate must
        // still answer true — the cost/victim question is asked separately,
        // by the enumerator.
        expect(
            abilityBenefitIsConfinedToSource(abilityOf("Thallid Devourer"))
        ).toBe(true);
    });

    // --- rows that are NOT confined (must stay searchable) ----------------
    it.each([
        ["Hell's Caretaker", "reanimates a targeted graveyard creature"],
        ["Goblin Chirurgeon", "regenerates a targeted creature"],
        ["Ashnod's Altar", "adds {C}{C} to the pool"],
        ["Goblin Bombardment", "deals damage to a chosen target"],
        ["Gate to Phyrexia", "destroys a targeted artifact"],
        ["Sage of Lat-Nam", "draws a card"],
    ])("%s is source-independent (%s)", (cardName) => {
        expect(abilityBenefitIsConfinedToSource(abilityOf(cardName))).toBe(
            false
        );
    });

    it("Nemata's forEach script is not confined — a structural construct fails closed", () => {
        expect(
            abilityBenefitIsConfinedToSource(
                abilityOf("Nemata, Grove Guardian")
            )
        ).toBe(false);
    });

    // --- fail-closed shapes, built by hand -------------------------------
    const bareCost = { sacrificeFilter: { types: "Creature" } } as const;
    const selfPump: EffectOp = {
        op: "pump",
        target: { ref: "$source" },
        power: 2,
        toughness: 1,
        duration: { phase: "end-of-turn" },
    };

    it("a script mixing a $source buff with an independent Op is NOT confined", () => {
        const mixed: ActivatedAbility = {
            id: "mixed",
            oracleText: "Sacrifice a creature: This gets +2/+1. Draw a card.",
            cost: bareCost,
            useStack: true,
            effects: [selfPump, { op: "draw", player: "controller", count: 1 }],
        };
        expect(abilityBenefitIsConfinedToSource(mixed)).toBe(false);
    });

    it("an Op OUTSIDE the allowlist naming $source is NOT confined (unknown ⇒ searchable)", () => {
        const spendsSelf: ActivatedAbility = {
            id: "spends-self",
            oracleText:
                "Sacrifice a creature: Return this card to its owner's hand.",
            cost: bareCost,
            useStack: true,
            effects: [
                { op: "moveZone", target: { ref: "$source" }, to: "hand" },
            ],
        };
        expect(abilityBenefitIsConfinedToSource(spendsSelf)).toBe(false);
    });

    it("an allowlisted Op naming an ANNOUNCED TARGET is NOT confined", () => {
        const pumpsTarget: ActivatedAbility = {
            id: "pumps-target",
            oracleText: "Sacrifice a creature: Target creature gets +2/+1.",
            cost: bareCost,
            useStack: true,
            effects: [{ ...selfPump, target: { target: 0 } }],
        };
        expect(abilityBenefitIsConfinedToSource(pumpsTarget)).toBe(false);
    });

    it("an imperative resolve() is opaque and NOT confined", () => {
        const protocol: ActivatedAbility = {
            id: "protocol",
            oracleText: "Sacrifice a creature: Do something imperative.",
            cost: bareCost,
            useStack: true,
            resolve: () => {},
        };
        expect(abilityBenefitIsConfinedToSource(protocol)).toBe(false);
    });

    it("an ability with no script at all is NOT confined", () => {
        const bare: ActivatedAbility = {
            id: "bare",
            oracleText: "Sacrifice a creature: Nothing declarative.",
            cost: bareCost,
            useStack: true,
        };
        expect(abilityBenefitIsConfinedToSource(bare)).toBe(false);
    });

    it("a modal ability is NOT confined even when one mode is", () => {
        const modal: ActivatedAbility = {
            id: "modal",
            oracleText: "Sacrifice a creature: Choose one —",
            cost: bareCost,
            useStack: true,
            effects: [selfPump],
            modes: [
                { id: "a", label: "Pump", oracleText: "This gets +2/+1." },
                { id: "b", label: "Draw", oracleText: "Draw a card." },
            ],
        };
        expect(abilityBenefitIsConfinedToSource(modal)).toBe(false);
    });

    it("a mana ability is NOT confined — the pool outlives the source (CR 605.1a)", () => {
        const manaOutlet: ActivatedAbility = {
            id: "mana-outlet",
            oracleText: "Sacrifice a creature: Add {C}{C}.",
            cost: bareCost,
            useStack: false,
            effects: [selfPump],
            manaProduced: { C: 2 },
        };
        expect(abilityBenefitIsConfinedToSource(manaOutlet)).toBe(false);
    });
});

describe("activation victim enumeration spares a self-defeating source (issue #2297)", () => {
    it("a $source-confined outlet with another creature on board: the source is never a named victim", () => {
        const angel = onBattlefield("Fallen Angel", "angel");
        const bears = onBattlefield("Grizzly Bears", "bears");
        const { state, player } = stateWith([angel, bears]);

        const victims = enumeratedVictims(
            state,
            player,
            angel,
            abilityOf("Fallen Angel")
        );
        expect(victims.length).toBeGreaterThan(0);
        expect(victims.flat()).toContain("bears");
        expect(victims.flat()).not.toContain("angel");
    });

    it("a $source-confined outlet that is the ONLY creature yields no pick-plan, so no move", () => {
        const angel = onBattlefield("Fallen Angel", "angel");
        const { state, player } = stateWith([angel]);

        // The server would auto-resolve this selection to the source itself
        // (`autoResolveFungible`: one candidate, one needed), so the victim
        // never appears in `sacrificeIds` — the catch-all filter is what
        // catches it.
        expect(
            enumerateActivationCostPicks(
                state,
                player,
                angel,
                abilityOf("Fallen Angel")
            )
        ).toEqual([]);

        const activations = enumerateMoves(state, player.id).filter(
            (m) => m.kind === "activate-ability" && m.cardInstanceId === "angel"
        );
        expect(activations).toEqual([]);
    });

    it("NEGATIVE CONTROL: a source-independent outlet keeps self-sacrifice enumerable", () => {
        const chirurgeon = onBattlefield("Goblin Chirurgeon", "chirurgeon");
        const raiders = onBattlefield("Mons's Goblin Raiders", "raiders");
        const { state, player } = stateWith([chirurgeon, raiders]);

        const victims = enumeratedVictims(
            state,
            player,
            chirurgeon,
            abilityOf("Goblin Chirurgeon")
        );
        expect(victims.flat()).toContain("chirurgeon");
        expect(victims.flat()).toContain("raiders");
    });

    it("NEGATIVE CONTROL: a source-independent outlet that is its OWN only victim still activates", () => {
        const chirurgeon = onBattlefield("Goblin Chirurgeon", "chirurgeon");
        const bears = onBattlefield("Grizzly Bears", "bears"); // not a Goblin
        const { state, player } = stateWith([chirurgeon, bears]);

        const victims = enumeratedVictims(
            state,
            player,
            chirurgeon,
            abilityOf("Goblin Chirurgeon")
        );
        expect(victims.flat()).toEqual(["chirurgeon"]);
    });

    it("a $source-confined ability whose cost filter cannot reach the source is untouched", () => {
        // Thallid Devourer eats a Saproling, never itself: with no Saproling
        // on board the leg is unpayable and the enumerator returns nothing —
        // the same answer it gave before this guard existed, for the same
        // reason (no legal victim), not because of the guard.
        const devourer = onBattlefield("Thallid Devourer", "devourer");
        const bears = onBattlefield("Grizzly Bears", "bears");
        const { state, player } = stateWith([devourer, bears]);

        expect(
            enumerateActivationCostPicks(
                state,
                player,
                devourer,
                abilityOf("Thallid Devourer")
            )
        ).toEqual([]);
    });
});
