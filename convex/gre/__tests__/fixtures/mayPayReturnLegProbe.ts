// Shared fixture: a probe card whose ETB offers a may-pay PERMANENT leg with
// `action: "return"` (CR 701.24 / 118.9, ADR 0079, issue #1933).
//
// The leg ships ahead of its first real consumer — the Planeshift Lair cycle
// ("When this land enters, sacrifice it unless you return a non-Lair land you
// control to its owner's hand") — so the probe carries that exact Oracle shape.
// Lives in a fixture module rather than inline in one suite so the GRE, wire,
// frontend and bot layers all drive the SAME definition and cannot drift.

import type { CardDefinition, MayPayCost } from "../../../cards/types";
import { registerTokenDefinition } from "../../../cards";
import { enteredTrigger } from "../../../cards/abilities/triggers/enteredTrigger";
import type { CardInstanceState, GameState, StackItem } from "../../state";
import { resolveTopOfStack } from "../../state";
import { makeInstance } from "../../../cards/__tests__/setup";

/** Forest (LEA) — a plain basic land body, the thing the leg returns. */
export const RETURN_LEG_LAND_ID = "6f1c8cb0-38eb-408b-94e8-16db83999b3b";

export const RETURN_LEG_PROBE_ID = "test:may-pay-return-leg-probe";
export const RETURN_LEG_TRIGGER_ID = "return-leg-probe-etb";

/** The return leg under test: "return a Forest you control to its owner's
 *  hand" (CR 701.24), a FIXED cardinal of 1 — the Planeshift Lair shape. The
 *  subtype filter stands in for the Lair cycle's "non-Lair land": it excludes
 *  the probe itself, so the payer must give up a DIFFERENT permanent. */
export const RETURN_A_LAND: MayPayCost = {
    permanent: {
        action: "return",
        filter: { subtypes: "Forest" },
        count: 1,
    },
};

export const returnLegProbe: CardDefinition = {
    id: RETURN_LEG_PROBE_ID,
    rarity: "common",
    name: "Return-Leg Probe",
    oracleText:
        "When this land enters, sacrifice it unless you return a Forest you control to its owner's hand.",
    types: ["Land"],
    triggeredAbilities: [
        enteredTrigger({
            id: RETURN_LEG_TRIGGER_ID,
            oracleText:
                "When this land enters, sacrifice it unless you return a Forest you control to its owner's hand.",
            scope: "self",
            effects: [
                {
                    op: "mayPay",
                    player: "controller",
                    cost: RETURN_A_LAND,
                    prompt: "Return a Forest you control to its owner's hand, or sacrifice this land?",
                    bind: "$paid",
                },
                {
                    op: "if",
                    // CR 118 — the "unless" consequence: decline and the source
                    // is sacrificed.
                    predicate: { not: { binding: "$paid" } },
                    then: [{ op: "sacrifice", target: { ref: "$source" } }],
                },
            ],
        }),
    ],
};
registerTokenDefinition(returnLegProbe);

export function returnLegLand(
    id: string,
    controllerId: string
): CardInstanceState {
    return makeInstance(RETURN_LEG_LAND_ID, {
        id,
        controllerId,
        ownerId: controllerId,
        types: ["Land"],
    });
}

export function returnLegProbeInstance(
    id: string,
    controllerId: string
): CardInstanceState {
    return makeInstance(RETURN_LEG_PROBE_ID, {
        id,
        controllerId,
        ownerId: controllerId,
        types: ["Land"],
    });
}

/** Fires the probe's self-ETB trigger through the stack, suspending at the
 *  `mayPay` return offer. Mirrors `fireDreadnoughtEtb`
 *  (mir/__tests__/colorless.test.ts). */
export function fireReturnLegEtb(
    state: GameState,
    probe: CardInstanceState
): void {
    state.stack.push({
        ...probe,
        zone: "stack",
        castById: probe.controllerId,
        triggeredAbilityId: RETURN_LEG_TRIGGER_ID,
        triggerSourceId: probe.id,
        triggerEvent: {
            type: "PERMANENT_ENTERED",
            instanceId: probe.id,
            controllerId: probe.controllerId,
            types: ["Land"],
        } as StackItem["triggerEvent"],
        targets: [],
    });
    resolveTopOfStack(state);
}
