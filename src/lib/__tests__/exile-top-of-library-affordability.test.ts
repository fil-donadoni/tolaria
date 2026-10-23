// Frontend wiring (SURFACE) test for the `cost.exileTopOfLibrary` activation
// cost — "Exile the top card of your library" (CR 118.1 / 118.3). The ability
// menu (`getStackAbilities`, src/lib/card-utils.ts) hides it while the payer's
// library is empty, through the engine's own `canPayExileTopOfLibrary`, fed the
// count the wire carries (`PublicLibrary.count`, read by `libraryCount`).
//
// Driven THROUGH the reducer (gre-development.md § Frontend wiring analysis
// item 4): the GRE state is projected with `projectPublicState` and the gate
// reads the projected library, exactly as `useBattlefieldInteraction` does. A
// hand-built count would mask a projection that dropped or renamed it.

import { describe, it, expect } from "vitest";
import { getCardByName, withTemporaryDefinition } from "@convex/cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup.helper";
import { projectPublicState } from "@convex/gameProjections";
import type { CardDefinition } from "@convex/cards/types";
import { getStackAbilities } from "../card-utils";
import { libraryCount } from "../library-knowledge";
import type { CardInstance } from "~/types/game";

const SOURCE_ID = "00000000-0000-4000-8000-000064890021";
const GRIZZLY_BEARS = getCardByName("Grizzly Bears").id;

const BURNER: CardDefinition = {
    id: SOURCE_ID,
    name: "Client Library Burner Probe",
    rarity: "rare",
    manaCost: { X: 1 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "burn-top",
            oracleText: "Exile the top card of your library: You gain 1 life.",
            cost: { exileTopOfLibrary: true },
            useStack: true,
            effects: [{ op: "gainLife", player: "controller", amount: 1 }],
        },
    ],
} as CardDefinition;

/** The ability ids the viewer's menu offers for the burner, read off the
 *  WIRE-PROJECTED state. */
function offered(librarySize: number): string[] {
    const state = makeState({
        players: [
            makePlayer("p1", {
                battlefield: [
                    makeInstance(SOURCE_ID, {
                        id: "src",
                        controllerId: "p1",
                        ownerId: "p1",
                    }),
                ],
                library: Array.from({ length: librarySize }, (_, i) =>
                    makeInstance(GRIZZLY_BEARS, {
                        id: `lib${i}`,
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "library",
                    })
                ),
            }),
            makePlayer("p2"),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "PRECOMBAT_MAIN",
    });
    const viewer = projectPublicState(state, 1, "p1").players.find(
        (p) => p.id === "p1"
    )!;
    const card = viewer.battlefield.find(
        (c) => c.id === "src"
    ) as unknown as CardInstance;
    return getStackAbilities(
        card,
        "PRECOMBAT_MAIN",
        true,
        undefined,
        undefined,
        undefined,
        "p1",
        libraryCount(viewer.library)
    ).map((a) => a.id);
}

describe("exileTopOfLibrary cost — client affordability (CR 118.3)", () => {
    it("offers the ability while the projected library holds a card", () => {
        withTemporaryDefinition(BURNER, () => {
            expect(offered(1)).toEqual(["burn-top"]);
        });
    });

    it("hides it once the projected library is empty", () => {
        withTemporaryDefinition(BURNER, () => {
            expect(offered(0)).toEqual([]);
        });
    });
});
