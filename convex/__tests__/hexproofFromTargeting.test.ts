// CR 702.11d end-to-end (issue #2604) — "hexproof from monocolored" across the
// GRE → `game.ts` mutation boundary.
//
// The OFFERED set (`getLegalTargets`, what the board lets you click) and the
// ACCEPTED set (the `selectTarget` mutation, what the server lets you commit)
// are separate call sites. This file drives BOTH for the same board, through
// the source derivation production uses (`pendingTargetingSource`), and asserts
// they agree — for the quality row and for every must-NOT row: a multicolored
// source, a colourless source, and the permanent's own controller.
//
// Harness discipline follows `protectionQualityTargeting.test.ts`: a stub
// `MutationCtx` driving the REGISTERED mutation's own `_handler`.

import { describe, it, expect } from "vitest";
import { selectTarget } from "../game";
import { getCardByName } from "../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../cards/__tests__/setup.helper";
import { getLegalTargets, pendingTargetingSource } from "../gre/rules";
import type { GameState } from "../gre/state";
import type { Id } from "../_generated/dataModel";
import {
    makeMutationCtx,
    runMutation,
    gameStateSeed,
    type Handler,
} from "./gameMutationHarness.fixture";

const GAME_ID = "game-1" as Id<"games">;

type SelectTargetArgs = {
    gameId: Id<"games">;
    playerId: string;
    targetType: "permanent" | "player" | "spell" | "graveyard-card";
    targetId: string;
};

const id = (name: string) => getCardByName(name).id;

type Kind = "ability" | "cast";

/** `chooser` controls `sourceName` (on the battlefield for an ability, in hand
 *  for a cast) and is mid-selection for "target creature". p1 controls General
 *  Ferrous Rokiric (hexproof from monocolored) and a plain bear. */
function board(sourceName: string, kind: Kind, chooser: string): GameState {
    const source = makeInstance(id(sourceName), {
        id: "source",
        controllerId: chooser,
        ownerId: chooser,
        zone: kind === "cast" ? "hand" : "battlefield",
    });
    const rokiric = makeInstance(id("General Ferrous Rokiric"), {
        id: "rokiric",
        controllerId: "p1",
        ownerId: "p1",
    });
    const bears = makeInstance(id("Grizzly Bears"), {
        id: "bears",
        controllerId: "p1",
        ownerId: "p1",
    });
    const zones = (who: string) => {
        const mine = chooser === who;
        return {
            hand: mine && kind === "cast" ? [source] : [],
            battlefield: [
                ...(who === "p1" ? [rokiric, bears] : []),
                ...(mine && kind === "ability" ? [source] : []),
            ],
        };
    };
    return makeState({
        players: [makePlayer("p1", zones("p1")), makePlayer("p2", zones("p2"))],
        pendingTarget: {
            playerId: chooser,
            cardInstanceId: "source",
            targetType: "Creature",
            // Open-ended max so a pick does not auto-finalize into the commit
            // path (the sibling harness convention); the gate runs first.
            count: { min: 1, max: 3 },
            kind,
            selected: [],
        },
    });
}

/** The OFFERED set, from the same source derivation the server reads. */
function offered(state: GameState, kind: Kind, chooser: string): string[] {
    return getLegalTargets(
        state,
        { type: "Creature", count: 1 },
        pendingTargetingSource(state, "source", kind),
        chooser,
        undefined,
        [],
        undefined
    ).map((t) => t.id);
}

async function accepted(state: GameState, chooser: string): Promise<boolean> {
    const harness = makeMutationCtx(chooser, [gameStateSeed(state)]);
    try {
        await runMutation<SelectTargetArgs, void>(
            selectTarget as unknown as Handler<SelectTargetArgs, void>,
            harness.ctx,
            {
                gameId: GAME_ID,
                playerId: chooser,
                targetType: "permanent",
                targetId: "rokiric",
            }
        );
    } catch (e) {
        expect(String(e)).toMatch(/can't be the target/);
        expect(harness.state().pendingTarget?.selected ?? []).toHaveLength(0);
        return false;
    }
    expect(
        (harness.state().pendingTarget?.selected ?? []).map((s) => s.id)
    ).toEqual(["rokiric"]);
    return true;
}

/** Both sides, asserted to agree, returning the shared verdict. */
async function targetable(
    sourceName: string,
    kind: Kind,
    chooser: string
): Promise<boolean> {
    const state = board(sourceName, kind, chooser);
    const offer = offered(state, kind, chooser);
    // The bystander is always offered: the gate is specific, not a blanket.
    expect(offer).toContain("bears");
    const accept = await accepted(state, chooser);
    expect(offer.includes("rokiric")).toBe(accept);
    return accept;
}

describe("CR 702.11d — hexproof from monocolored across GRE → game.ts", () => {
    it("an opponent's MONOCOLORED spell: neither offered nor accepted", async () => {
        expect(await targetable("Lightning Bolt", "cast", "p2")).toBe(false);
    });

    it("must-NOT — an opponent's MULTICOLORED spell: offered and accepted", async () => {
        expect(await targetable("Lightning Helix", "cast", "p2")).toBe(true);
    });

    it("an opponent's ability from a MONOCOLORED source: neither offered nor accepted", async () => {
        expect(await targetable("Prodigal Sorcerer", "ability", "p2")).toBe(
            false
        );
    });

    it("must-NOT — an ability from a MULTICOLORED source: the quality is the SOURCE's", async () => {
        expect(await targetable("Watchwolf", "ability", "p2")).toBe(true);
    });

    it("must-NOT — an ability from a COLOURLESS source (CR 105.2c)", async () => {
        expect(await targetable("Rod of Ruin", "ability", "p2")).toBe(true);
    });

    it("must-NOT — the controller's own monocolored spell", async () => {
        expect(await targetable("Lightning Bolt", "cast", "p1")).toBe(true);
    });
});
