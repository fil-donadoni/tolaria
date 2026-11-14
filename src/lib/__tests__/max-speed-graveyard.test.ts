// CR 702.178b — the client affordance for a graveyard ability behind "Max
// speed —" (the Surveyor cycle). Driven through the REAL reducers: the server
// state goes through `projectPublicState`, `buildTriggerStateView` builds the
// viewer's view from it (a dropped `speed` field would read as no speed and
// hide the ability forever), and `getGraveyardStackAbilities` weighs it through
// the engine's shared `activationPreconditionViolation`.
import { describe, expect, it } from "vitest";
import { withTemporaryDefinition } from "@convex/cards/registry";
import type { CardDefinition } from "@convex/cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup.helper";
import { projectPublicState } from "@convex/gameProjections";
import { compileCard } from "@convex/oracle/compile";
import type { CardInstance } from "../../types/game";
import {
    buildTriggerStateView,
    getGraveyardStackAbilities,
} from "../card-utils";

const outcome = compileCard({
    oracleId: "237758f3-84b2-4e5b-a2c7-b28c893e2790",
    name: "Goblin Surveyor",
    manaCost: "{2}{R}",
    typeLine: "Creature — Goblin Scout",
    oracleText:
        "Trample\nStart your engines! (If you have no speed, it starts at 1. It increases once on each of your turns when an opponent loses life. Max speed is 4.)\nMax speed — {3}, Exile this card from your graveyard: Draw a card.",
    power: "3",
    toughness: "2",
    layout: "normal",
});
if (outcome.state !== "ready") throw new Error("Goblin Surveyor compiles");
const SURVEYOR = {
    ...outcome.definition,
    id: "test-9587-client-surveyor",
} as CardDefinition;
const ABILITY = SURVEYOR.activatedAbilities![0]!.id;

function offered(mine: number | undefined, theirs?: number): string[] {
    return withTemporaryDefinition(SURVEYOR, () => {
        const state = makeState({
            turn: 5,
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", mine === undefined ? {} : { speed: mine }),
                makePlayer("p2", theirs === undefined ? {} : { speed: theirs }),
            ],
        });
        state.players[0]!.graveyard = [
            makeInstance(SURVEYOR.id, {
                id: "gy-surveyor",
                zone: "graveyard",
                controllerId: "p1",
                ownerId: "p1",
            }),
        ];
        const wire = projectPublicState(state, 1, "p1");
        const view = buildTriggerStateView(wire.players, wire.activePlayerId);
        const card = wire.players[0]!.graveyard.find(
            (c) => c.id === "gy-surveyor"
        ) as CardInstance;
        return getGraveyardStackAbilities(card, wire.phase, view).map(
            (a) => a.id
        );
    });
}

describe("max speed graveyard ability — client hint (CR 702.178b)", () => {
    it("offers it at the owner's max speed", () => {
        expect(offered(4)).toEqual([ABILITY]);
    });

    it("hides it below max speed", () => {
        expect(offered(3)).toEqual([]);
        expect(offered(undefined)).toEqual([]);
    });

    it("an opponent's max speed does not open it (CR 109.5)", () => {
        expect(offered(1, 4)).toEqual([]);
    });
});
