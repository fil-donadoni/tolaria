// CR 604.1 / 611.3a / 613.1f — a non-layer `staticEffects[]` entry read off
// a battlefield permanent (an attack restriction, a cast restriction, a
// combat-damage prevention) applies only while the permanent HAS the ability.
// Humility strips every creature's abilities in layer 6, so a creature's own
// restriction or prevention stops applying; it is back the moment Humility
// leaves.
//
// Every board drives the suppression through the layer system
// (`beginApplyingStaticEffects` + `recomputeContinuousEffects`), never a
// hand-set `abilitiesSuppressedBy`.

import { describe, it, expect } from "vitest";
import {
    beginApplyingStaticEffects,
    getPlayer,
    recomputeContinuousEffects,
    removePermanentTo,
    type CardInstanceState,
    type GameState,
} from "../state";
import { validateAttackerEligibility } from "../combat";
import { isCombatDamagePreventedFromSource } from "../combatDamagePrevention";
import { castProhibitionReason } from "../../cards/castRestrictions";
import { getCardByName } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";

const HUMILITY = getCardByName("Humility").id;
const SEA_SERPENT = getCardByName("Sea Serpent").id;
const MEDDLING_MAGE = getCardByName("Meddling Mage").id;
const ENCHANTED_BEING = getCardByName("Enchanted Being").id;
const HOLY_STRENGTH = getCardByName("Holy Strength").id;
const BEARS = getCardByName("Grizzly Bears").id;
const BOLT = getCardByName("Lightning Bolt").id;

function card(
    defId: string,
    controllerId: string,
    id: string,
    over: Partial<CardInstanceState> = {}
): CardInstanceState {
    return makeInstance(defId, {
        id,
        zone: "battlefield",
        controllerId,
        ownerId: controllerId,
        ...over,
    });
}

function board(
    p1Battlefield: CardInstanceState[],
    p2Battlefield: CardInstanceState[] = [],
    p2Hand: CardInstanceState[] = []
): GameState {
    return makeState({
        players: [
            makePlayer("p1", { battlefield: p1Battlefield }),
            makePlayer("p2", { battlefield: p2Battlefield, hand: p2Hand }),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "PRECOMBAT_MAIN",
    });
}

function suppress(state: GameState): void {
    const source = card(HUMILITY, "p1", "suppressor");
    getPlayer(state, "p1").battlefield.push(source);
    beginApplyingStaticEffects(state, source);
    recomputeContinuousEffects(state);
}

function release(state: GameState): void {
    removePermanentTo(state, "suppressor", "graveyard");
    recomputeContinuousEffects(state);
}

function onBattlefield(state: GameState, id: string): CardInstanceState {
    for (const player of state.players) {
        const found = player.battlefield.find((c) => c.id === id);
        if (found) return found;
    }
    throw new Error(`no permanent ${id}`);
}

describe("CR 613.1f — combat restriction ends with ability loss (CR 508.1c)", () => {
    it("Sea Serpent under Humility may attack a defender with no Island", () => {
        const state = board([
            card(SEA_SERPENT, "p1", "serpent", { isSummoningSick: false }),
        ]);
        const serpent = () => onBattlefield(state, "serpent");
        expect(validateAttackerEligibility(serpent(), [], state).eligible).toBe(
            false
        );

        suppress(state);
        expect(serpent().abilitiesSuppressedBy?.length).toBeGreaterThan(0);
        expect(validateAttackerEligibility(serpent(), [], state).eligible).toBe(
            true
        );

        release(state);
        expect(validateAttackerEligibility(serpent(), [], state).eligible).toBe(
            false
        );
    });
});

describe("CR 613.1f — cast restriction ends with ability loss (CR 601.2)", () => {
    it("Meddling Mage under Humility no longer locks its chosen name", () => {
        const bolt = makeInstance(BOLT, {
            id: "bolt",
            zone: "hand",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = board(
            [
                card(MEDDLING_MAGE, "p1", "mage", {
                    chosenName: "Lightning Bolt",
                }),
            ],
            [],
            [bolt]
        );
        expect(castProhibitionReason("p2", bolt, state as never)).toBeDefined();

        suppress(state);
        expect(
            castProhibitionReason("p2", bolt, state as never)
        ).toBeUndefined();

        release(state);
        expect(castProhibitionReason("p2", bolt, state as never)).toBeDefined();
    });
});

describe("CR 613.1f — combat-damage prevention ends with ability loss (CR 615)", () => {
    it("Enchanted Being under Humility takes combat damage from an enchanted creature", () => {
        const state = board(
            [card(ENCHANTED_BEING, "p1", "being")],
            [
                card(BEARS, "p2", "bears"),
                card(HOLY_STRENGTH, "p2", "aura", { attachedTo: "bears" }),
            ]
        );
        const prevented = () =>
            isCombatDamagePreventedFromSource(
                state,
                onBattlefield(state, "being"),
                onBattlefield(state, "bears")
            );
        expect(prevented()).toBe(true);

        suppress(state);
        expect(prevented()).toBe(false);

        release(state);
        expect(prevented()).toBe(true);
    });
});
