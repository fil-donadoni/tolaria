// CR 702.178a — a compiled "Max speed — This creature gets +1/+2" reads its
// controller's speed (CR 702.179b), so the client's `effectiveToughness` must
// see the same number the server does after `projectPublicState`
// (`toLayerState` forwarding `PlayerState.speed`).

import { describe, expect, it } from "vitest";
import { projectPublicState } from "@convex/gameProjections";
import { withTemporaryDefinition } from "@convex/cards/registry";
import type { CardDefinition } from "@convex/cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup.helper";
import { getEffectiveToughness } from "@convex/gre/layers";
import { compileCard } from "@convex/oracle/compile";
import { effectiveToughness } from "../effective-stats";
import type { CardInstance } from "~/types/game";

const outcome = compileCard({
    oracleId: "791b8ac8-8db8-44b4-8c85-fcc9017c17ef",
    name: "Walking Sarcophagus",
    manaCost: "{2}",
    typeLine: "Artifact Creature — Zombie Cat",
    oracleText:
        "Start your engines! (If you have no speed, it starts at 1. It increases once on each of your turns when an opponent loses life. Max speed is 4.)\nMax speed — This creature gets +1/+2.",
    power: "2",
    toughness: "1",
    layout: "normal",
});
if (outcome.state !== "ready") throw new Error("Walking Sarcophagus compiles");
const definition = {
    ...outcome.definition,
    id: "test-8231-sarcophagus",
} as CardDefinition;

function toughnesses(speed: number): { server: number; client: number } {
    return withTemporaryDefinition(definition, () => {
        const sarcophagus = makeInstance(definition.id, {
            id: "sarcophagus",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [sarcophagus], speed }),
                makePlayer("p2"),
            ],
        });
        const wire = projectPublicState(state, 1, "p1");
        const card = wire.players[0]!.battlefield.find(
            (c) => c.id === "sarcophagus"
        ) as unknown as CardInstance;
        const players = wire.players as unknown as Parameters<
            typeof effectiveToughness
        >[0];
        return {
            server: getEffectiveToughness(state, sarcophagus),
            client: effectiveToughness(
                players,
                card,
                wire.emblems,
                wire.continuousEffects
            ),
        };
    });
}

describe("max speed static on the wire (CR 702.178a)", () => {
    it("shows the buff on the client at max speed", () => {
        expect(toughnesses(4)).toEqual({ server: 3, client: 3 });
    });

    it("shows no buff below max speed", () => {
        expect(toughnesses(3)).toEqual({ server: 1, client: 1 });
    });
});
