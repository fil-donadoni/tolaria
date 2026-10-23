// Shared fixture: a probe creature whose ETB offers a may-pay GRAVEYARD leg
// (CR 118.3 / 118.12a) — Harvest Wurm's exact Oracle shape, "When this
// creature enters, sacrifice it unless you return a basic land card from your
// graveyard to your hand", with the script the grammar compiles it to (the
// golden fixture in `oracle/grammar/fixtures.ts`). Harvest Wurm itself is a
// compiled card with no hand-written definition, so the GRE, wire, frontend
// and bot layers all drive THIS definition and cannot drift.

import type { CardDefinition, MayPayCost } from "../../../cards/types";
import { registerTokenDefinition } from "../../../cards";
import { enteredTrigger } from "../../../cards/abilities/triggers/enteredTrigger";
import type { CardInstanceState, GameState, StackItem } from "../../state";
import { resolveTopOfStack } from "../../state";
import { makeInstance } from "../../../cards/__tests__/setup.helper";

/** Forest / Island (LEA) — basic land cards, the thing the leg returns. */
export const GRAVEYARD_LEG_FOREST_ID = "6f1c8cb0-38eb-408b-94e8-16db83999b3b";
export const GRAVEYARD_LEG_ISLAND_ID = "90a57c0e-fa61-45ef-955d-d296403967d5";
/** Crosis's Catacombs (PLS) — a NONBASIC land card the filter must refuse. */
export const GRAVEYARD_LEG_NONBASIC_ID = "7caad74f-c0d0-4eca-94be-b89a2c9a3980";

export const GRAVEYARD_LEG_PROBE_ID = "test:may-pay-graveyard-leg-probe";
export const GRAVEYARD_LEG_TRIGGER_ID = "graveyard-leg-probe-etb";

const ORACLE =
    "When this creature enters, sacrifice it unless you return a basic land card from your graveyard to your hand.";

/** The leg under test, exactly as the grammar lowers Harvest Wurm's payment. */
export const RETURN_A_BASIC_LAND_CARD: MayPayCost = {
    graveyard: {
        action: "return",
        filter: { type: "Land", supertype: "Basic" },
        count: 1,
    },
};

export const graveyardLegProbe: CardDefinition = {
    id: GRAVEYARD_LEG_PROBE_ID,
    rarity: "common",
    name: "Graveyard-Leg Probe",
    oracleText: ORACLE,
    types: ["Creature"],
    subtypes: ["Wurm"],
    manaCost: { X: 1, G: 1 },
    power: 3,
    toughness: 2,
    triggeredAbilities: [
        enteredTrigger({
            id: GRAVEYARD_LEG_TRIGGER_ID,
            oracleText: ORACLE,
            scope: "self",
            effects: [
                {
                    op: "mayPay",
                    player: "controller",
                    cost: RETURN_A_BASIC_LAND_CARD,
                    prompt: "Return a card from your graveyard to your hand, or sacrifice Graveyard-Leg Probe?",
                    bind: "$may1",
                },
                {
                    op: "if",
                    // CR 118.12a — the "unless" consequence: decline and the
                    // source is sacrificed.
                    predicate: { not: { binding: "$may1" } },
                    then: [{ op: "sacrifice", target: { ref: "$source" } }],
                },
            ],
        }),
    ],
};
registerTokenDefinition(graveyardLegProbe);

/** A card in `ownerId`'s graveyard. */
export function graveyardCard(
    cardId: string,
    id: string,
    ownerId: string
): CardInstanceState {
    return makeInstance(cardId, {
        id,
        controllerId: ownerId,
        ownerId,
        zone: "graveyard",
    });
}

export function graveyardLegProbeInstance(
    id: string,
    controllerId: string
): CardInstanceState {
    return makeInstance(GRAVEYARD_LEG_PROBE_ID, {
        id,
        controllerId,
        ownerId: controllerId,
    });
}

/** Fires the probe's self-ETB trigger through the stack, suspending at the
 *  `mayPay` offer. Mirrors `fireReturnLegEtb`. */
export function fireGraveyardLegEtb(
    state: GameState,
    probe: CardInstanceState
): void {
    state.stack.push({
        ...probe,
        zone: "stack",
        castById: probe.controllerId,
        triggeredAbilityId: GRAVEYARD_LEG_TRIGGER_ID,
        triggerSourceId: probe.id,
        triggerEvent: {
            type: "PERMANENT_ENTERED",
            instanceId: probe.id,
            controllerId: probe.controllerId,
            types: ["Creature"],
        } as StackItem["triggerEvent"],
        targets: [],
    });
    resolveTopOfStack(state);
}
