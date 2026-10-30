// Shared board for the two "Planeswalkers you control …" statics (issue #7199):
// a granted LOYALTY ability and the CR 704.5i zero-loyalty exemption, declared
// together exactly as Sanctum Lurker prints them. The definition is
// hand-written (its Hand Tail is issue #7247) and served only inside
// `withTemporaryDefinition`, so the catalogue stays frozen; every shape in it
// is one the engine authors — `activated-grant` + `grantTemplates`, and a
// `permanent-guard` with `survivesZeroLoyalty`.

import { getCardByName } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import type { CardDefinition, PermanentView } from "../../cards/types";
import { lilianaOfTheVeil } from "../../cards/sets/isd/black.cards";
import type { CardInstanceState, GameState } from "../state";

export const WALKER_STATICS_ID = "fixture-walker-statics";
export const GRANTED_PLUS2 = "fixture-walker-statics-plus2";
export const GRANTED_MINUS10 = "fixture-walker-statics-minus10";
export const LILIANA = lilianaOfTheVeil();

const walkerYouControl = (target: PermanentView, source: PermanentView) =>
    target.types.includes("Planeswalker") &&
    target.controllerId === source.controllerId;

export const WALKER_STATICS: CardDefinition = {
    ...getCardByName("Grizzly Bears"),
    id: WALKER_STATICS_ID,
    name: "Walker Statics Fixture",
    oracleText:
        "Planeswalkers you control aren't put into their owners' graveyards for having 0 loyalty.\nPlaneswalkers you control have \"[+2]: This planeswalker deals 1 damage to each opponent and you gain 1 life.\"",
    staticEffects: [
        {
            kind: "permanent-guard",
            id: "fixture-walker-statics-zero-loyalty",
            applies: walkerYouControl,
            survivesZeroLoyalty: true,
        },
        {
            kind: "activated-grant",
            applies: walkerYouControl,
            abilityId: GRANTED_PLUS2,
        },
        {
            kind: "activated-grant",
            applies: walkerYouControl,
            abilityId: GRANTED_MINUS10,
        },
    ],
    grantTemplates: [
        {
            id: GRANTED_PLUS2,
            oracleText:
                "[+2]: This planeswalker deals 1 damage to each opponent and you gain 1 life.",
            cost: { loyalty: 2 },
            useStack: true,
            effects: [
                { op: "dealDamage", amount: 1, to: { player: "opponent" } },
                { op: "gainLife", player: "controller", amount: 1 },
            ],
        },
        {
            id: GRANTED_MINUS10,
            oracleText:
                "[−10]: Put a +1/+1 counter on target creature for each land you control.",
            cost: { loyalty: -10 },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            effects: [
                {
                    op: "counters",
                    action: "add",
                    target: { target: 0 },
                    counter: "+1/+1",
                    count: {
                        count: {
                            zone: "battlefield",
                            controller: "controller",
                            filter: { type: "Land" },
                        },
                    },
                },
            ],
        },
    ],
};

export function walkerStaticsSource(controllerId = "p1"): CardInstanceState {
    const source = makeInstance(getCardByName("Grizzly Bears").id, {
        id: "statics",
        controllerId,
        ownerId: controllerId,
        staticSeq: 1,
    });
    source.card = { id: WALKER_STATICS_ID };
    return source;
}

export function liliana(
    id: string,
    controllerId: string,
    loyalty: number
): CardInstanceState {
    return makeInstance(LILIANA.id, {
        id,
        controllerId,
        ownerId: controllerId,
        counters: { loyalty },
    });
}

export function bear(id: string): CardInstanceState {
    return makeInstance(getCardByName("Grizzly Bears").id, {
        id,
        controllerId: "p1",
        ownerId: "p1",
    });
}

/** p1's main phase, empty stack, p1 holding priority: the CR 606.3 window. */
export function walkerBoard(opts: {
    mine: CardInstanceState[];
    theirs?: CardInstanceState[];
}): GameState {
    return makeState({
        players: [
            makePlayer("p1", { battlefield: opts.mine }),
            makePlayer("p2", { battlefield: opts.theirs ?? [] }),
        ],
        phase: "PRECOMBAT_MAIN",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        stack: [],
    });
}
