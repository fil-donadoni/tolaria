// Per-instance provenance on target selection (ADR 0094, issue #2264). A
// multi-mode announcement flattens every chosen instance's target groups into
// one queue; the prompt must say WHICH instance each group belongs to. Driven
// through the real `announceCast` / `selectTargets` handlers, and read off the
// `pendingTarget` that crossed `projectPublicState` — the same object the
// target banner renders from.

import { describe, expect, it } from "vitest";
import type {
    CardDefinition,
    ModeSelection,
    SpellMode,
} from "@convex/cards/types";
import { withTemporaryDefinitionAsync } from "@convex/cards";
import { hullBreach } from "@convex/cards/sets/pls/multicolor";
import { grizzlyBears } from "@convex/cards/sets/lea/green";
import { hillGiant } from "@convex/cards/sets/lea/red";
import { announceCast, selectTargets } from "@convex/game";
import { projectPublicState } from "@convex/gameProjections";
import type { GameState } from "@convex/gre/state";
import type { Id } from "@convex/_generated/dataModel";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup";
import {
    gameStateSeed,
    makeMutationCtx,
    runMutation,
    type Handler,
} from "@convex/__tests__/gameMutationHarness";
import {
    formatModeTargetProvenance,
    modeTargetProvenance,
} from "../mode-target-provenance";

const PING: SpellMode = {
    id: "ping",
    label: "1 damage to target creature",
    oracleText: "This spell deals 1 damage to target creature.",
    targetRequirement: { type: "Creature", count: 1 },
    effects: [{ op: "dealDamage", amount: 1, to: { target: 0 } }],
};
const SHOCK: SpellMode = {
    id: "shock",
    label: "2 damage to target creature",
    oracleText: "This spell deals 2 damage to target creature.",
    targetRequirement: { type: "Creature", count: 1 },
    effects: [{ op: "dealDamage", amount: 2, to: { target: 0 } }],
};
const DRAW: SpellMode = {
    id: "draw",
    label: "Draw a card",
    oracleText: "Draw a card.",
    effects: [{ op: "draw", player: "controller", count: 1 }],
};

function probe(modeSelection: ModeSelection): CardDefinition {
    return {
        ...hullBreach,
        manaCost: {},
        modes: [PING, SHOCK, DRAW],
        modeSelection,
    };
}

function board(): GameState {
    const battlefield = [grizzlyBears.id, hillGiant.id].map((cardId, i) =>
        makeInstance(cardId, {
            id: `c${i}`,
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        })
    );
    return makeState({
        players: [
            makePlayer("p1", {
                hand: [
                    makeInstance(hullBreach.id, {
                        id: "spell",
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "hand",
                    }),
                ],
            }),
            makePlayer("p2", { battlefield }),
        ],
        phase: "PRECOMBAT_MAIN",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
}

const BASE = { gameId: "game-1" as Id<"games">, playerId: "p1" };

async function run(
    modeSelection: ModeSelection,
    chosenModeIds: string[]
): Promise<string[]> {
    const labels: string[] = [];
    await withTemporaryDefinitionAsync(probe(modeSelection), async () => {
        const harness = makeMutationCtx("p1", [gameStateSeed(board())]);
        await runMutation(
            announceCast as unknown as Handler<Record<string, unknown>, void>,
            harness.ctx,
            { ...BASE, cardInstanceId: "spell", chosenModeIds }
        );
        // One prompt per target group; record what each one says, then
        // answer it and read the next.
        for (const targetId of ["c0", "c1"]) {
            const pt = projectPublicState(
                harness.state(),
                1,
                "p1"
            ).pendingTarget;
            if (!pt) break;
            const p = modeTargetProvenance(pt, probe(modeSelection).modes);
            labels.push(p ? formatModeTargetProvenance(p) : "<none>");
            await runMutation(
                selectTargets as unknown as Handler<
                    Record<string, unknown>,
                    void
                >,
                harness.ctx,
                {
                    ...BASE,
                    targets: [{ targetType: "permanent", targetId }],
                }
            );
        }
    });
    return labels;
}

describe("target prompt provenance (ADR 0094, issue #2264)", () => {
    it("a repeated mode's groups are labelled by instance: (1 of 2), (2 of 2)", async () => {
        expect(
            await run({ min: 3, max: 3, repeats: true }, [
                "draw",
                "ping",
                "ping",
            ])
        ).toEqual([
            "1 damage to target creature (1 of 2)",
            "1 damage to target creature (2 of 2)",
        ]);
    });

    it("distinct modes each name their own mode, in printed order", async () => {
        expect(await run({ min: 2, max: 2 }, ["shock", "ping"])).toEqual([
            "1 damage to target creature",
            "2 damage to target creature",
        ]);
    });

    it("a single-instance announcement carries no provenance", async () => {
        expect(await run({ min: 1, max: 2 }, ["ping"])).toEqual(["<none>"]);
    });
});
