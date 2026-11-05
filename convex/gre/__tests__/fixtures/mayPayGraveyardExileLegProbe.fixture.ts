// Shared fixture: a probe creature whose ETB offers a may-pay GRAVEYARD EXILE
// leg (CR 118.12 / 118.3) — "When this creature enters, you may exile two
// cards from your graveyard. If you do, draw a card.", with the script the
// grammar compiles that sentence to (the golden fixtures in
// `oracle/grammar/fixtures.ts`). The GRE, wire, frontend and bot layers all
// drive THIS definition and cannot drift.

import type { CardDefinition, CostLegs } from "../../../cards/types";
import { registerTokenDefinition } from "../../../cards";
import { enteredTrigger } from "../../../cards/abilities/triggers/enteredTrigger";
import type { CardInstanceState, GameState, StackItem } from "../../state";
import { resolveTopOfStack } from "../../state";
import { makeInstance } from "../../../cards/__tests__/setup.helper";

const PROBE_ID = "test:may-pay-graveyard-exile-leg-probe";
const TRIGGER_ID = "graveyard-exile-leg-probe-etb";

const ORACLE =
    "When this creature enters, you may exile two cards from your graveyard. If you do, draw a card.";

/** The leg under test, exactly as the grammar lowers the optional exile. */
export const EXILE_TWO_CARDS: CostLegs = {
    graveyard: { action: "exile-chosen", filter: {}, count: 2 },
};

const probeDefinition: CardDefinition = {
    id: PROBE_ID,
    rarity: "common",
    name: "Graveyard-Exile-Leg Probe",
    oracleText: ORACLE,
    types: ["Creature"],
    subtypes: ["Wizard"],
    manaCost: { X: 1, U: 1 },
    power: 2,
    toughness: 2,
    triggeredAbilities: [
        enteredTrigger({
            id: TRIGGER_ID,
            oracleText: ORACLE,
            scope: "self",
            effects: [
                {
                    op: "mayPay",
                    player: "controller",
                    cost: EXILE_TWO_CARDS,
                    prompt: "Exile two cards from your graveyard?",
                    bind: "$paid1",
                },
                {
                    op: "if",
                    predicate: { binding: "$paid1" },
                    then: [{ op: "draw", player: "controller", count: 1 }],
                },
            ],
        }),
    ],
};
registerTokenDefinition(probeDefinition);

export function graveyardExileLegProbeInstance(
    id: string,
    controllerId: string
): CardInstanceState {
    return makeInstance(PROBE_ID, {
        id,
        controllerId,
        ownerId: controllerId,
    });
}

/** Fires the probe's self-ETB trigger through the stack, suspending at the
 *  `mayPay` offer. */
export function fireGraveyardExileLegEtb(
    state: GameState,
    probe: CardInstanceState
): void {
    state.stack.push({
        ...probe,
        zone: "stack",
        castById: probe.controllerId,
        triggeredAbilityId: TRIGGER_ID,
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
