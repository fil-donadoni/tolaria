// The CLIENT half of the chosen-colour land-mana substitution (CR 614.1a,
// CR 616.1): under Pulse of Llanowar a basic land its controller controls
// opens the tap picker with one row per colour, read off the SAME unified
// option list the server resolves the submitted index against.
//
// Driven through `projectPublicState`: the client only ever sees the projection,
// and the projection strips `card` to `{ id }` — the `Basic` supertype the scope
// reads must survive it.

import { describe, it, expect } from "vitest";
import { getManaChoices } from "../card-utils";
import type { CardInstance } from "~/types/game";
import { projectPublicState } from "@convex/gameProjections";
import { getCardByName } from "@convex/cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup.helper";

function projectedBoard(withPulse: boolean) {
    const perm = (name: string, id: string, controllerId: string) =>
        makeInstance(getCardByName(name).id, {
            id,
            controllerId,
            ownerId: controllerId,
        });
    const state = makeState({
        players: [
            makePlayer("p1", {
                battlefield: [
                    perm("Forest", "frs", "p1"),
                    perm("Taiga", "taiga", "p1"),
                    ...(withPulse
                        ? [perm("Pulse of Llanowar", "pulse", "p1")]
                        : []),
                ],
            }),
            makePlayer("p2", {
                battlefield: [perm("Forest", "opp-frs", "p2")],
            }),
        ],
    });
    const wire = projectPublicState(state, 1, "p1");
    const players = wire.players.map((p) => ({
        id: p.id,
        battlefield: p.battlefield as unknown as CardInstance[],
    }));
    const find = (id: string) =>
        players.flatMap((p) => p.battlefield).find((c) => c.id === id)!;
    return { players, find };
}

describe("chosen-colour basic land on the client picker (CR 614.1a)", () => {
    it("a controlled Forest under Pulse offers the five colours", () => {
        const { players, find } = projectedBoard(true);
        expect(getManaChoices(find("frs"), players)).toEqual([
            { W: 1 },
            { U: 1 },
            { B: 1 },
            { R: 1 },
            { G: 1 },
        ]);
    });

    it("the opponent's Forest and a nonbasic keep their own picker", () => {
        const { players, find } = projectedBoard(true);
        expect(getManaChoices(find("opp-frs"), players)).toBeNull();
        expect(getManaChoices(find("taiga"), players)).toEqual([
            { R: 1 },
            { G: 1 },
        ]);
    });

    it("without Pulse a Forest taps with no picker", () => {
        const { players, find } = projectedBoard(false);
        expect(getManaChoices(find("frs"), players)).toBeNull();
    });
});
