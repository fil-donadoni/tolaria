// Shared fixture for the issue #7295 suites (GRE/wire in
// `conditionalExilePlay.test.ts`, Bot seam in `conditionalExilePlay.bot.test.ts`):
// a Flameshape-shaped sorcery — exile the top two face down, then "you may play
// them if you control a Wizard".
import { registerTokenDefinition } from "../../cards";
import type { EffectOp } from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import { resolveTopOfStack } from "../state";
import type { CardInstanceState, GameState } from "../state";

export const HIT_ID = "test-cond-exile-hit";
export const WIZARD_ID = "test-cond-exile-wizard";
const SCRIPT_ID = "test-cond-exile-flameshape";

registerTokenDefinition({
    id: HIT_ID,
    name: HIT_ID,
    rarity: "common",
    manaCost: { X: 1, G: 1 },
    types: ["Creature"],
    subtypes: ["Bear"],
    power: 2,
    toughness: 2,
});
registerTokenDefinition({
    id: WIZARD_ID,
    name: WIZARD_ID,
    rarity: "common",
    manaCost: { U: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Wizard"],
    power: 1,
    toughness: 1,
});
registerTokenDefinition({
    id: SCRIPT_ID,
    name: SCRIPT_ID,
    rarity: "common",
    manaCost: { R: 1 },
    types: ["Sorcery"],
    effects: [
        {
            op: "exileTopOfLibrary",
            player: "controller",
            count: 2,
            faceDown: true,
            linkToSource: true,
        },
        {
            op: "grantCastFromExile",
            card: { exiledWithSource: true },
            player: "controller",
            window: "while-exiled",
            includesLand: true,
            condition: { kind: "control", filter: { subtype: "Wizard" } },
        },
    ] as EffectOp[],
});

export function wizard(): CardInstanceState {
    return makeInstance(WIZARD_ID, {
        id: "wiz",
        controllerId: "p1",
        ownerId: "p1",
    });
}

/** p1 resolves the script over a 3-card library; returns the post-resolution
 *  state with NO Wizard on the board. */
export function resolved(): GameState {
    const lib = ["l1", "l2", "l3"].map((id) =>
        makeInstance(HIT_ID, {
            id,
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        })
    );
    const state = makeState({
        players: [
            makePlayer("p1", {
                library: lib,
                manaPool: { W: 0, U: 0, B: 0, R: 0, G: 4, C: 0 },
            }),
            makePlayer("p2"),
        ],
    });
    pushSpell(state, SCRIPT_ID, "p1");
    resolveTopOfStack(state);
    return state;
}
