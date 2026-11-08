/**
 * CR 702.47b / 702.47d (issue #8805) — splicing a TARGETING card, driven
 * through the REAL cast path: the `announceCast` and `selectTargets` mutation
 * handlers, then `resolveTopOfStack`, then the wire projection the client
 * renders the prompt from.
 *
 * CR 702.47d: "Choose targets for the added text normally (see rule 601.2c)."
 * CR 702.47b: "You can't choose to use a splice ability if you can't make the
 * required choices (targets, etc.) for that card's rules text."
 *
 * So the revealed card's target group joins the MAIN spell's announcement,
 * after the spell's own (`splicedTargetGroups`, `gre/splice.ts`), and its
 * `{ target: 0 }` is rebased onto the slot that group occupies
 * (`spliceMergedEffects`). Glacial Ray is not hand-written in the catalogue —
 * it is a compiled card — so the file registers its compiled definition
 * verbatim (`data/oracle-compiled.json`) through the
 * `withTemporaryDefinitionAsync` seam, which keeps the test independent of
 * the packed catalogue the queue regenerates.
 */

import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../cards/__tests__/setup.helper";
import { grizzlyBears } from "../cards/sets/lea/green.cards";
import { lavaSpike } from "../cards/sets/chk/red.cards";
import { withTemporaryDefinitionAsync } from "../cards";
import type { CardDefinition } from "../cards/types";
import { announceCast, selectTargets } from "../game";
import {
    gameStateSeed,
    makeMutationCtx,
    runMutation,
    type Handler,
} from "./gameMutationHarness.fixture";
import type { Id } from "../_generated/dataModel";
import {
    getPlayer,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
} from "../gre/state";
import { projectPublicState } from "../gameProjections";
import { spliceCostId } from "../gre/splice";

/** Glacial Ray's compiled definition, as `oracle:compile` writes it. */
const GLACIAL_RAY: CardDefinition = {
    id: "glacial-ray-splice-probe",
    name: "Glacial Ray",
    rarity: "common",
    types: ["Instant"],
    subtypes: ["Arcane"],
    manaCost: { X: 1, R: 1 },
    oracleText:
        "Glacial Ray deals 2 damage to any target.\nSplice onto Arcane {1}{R}",
    effects: [{ op: "dealDamage", amount: 2, to: { target: 0 } }],
    targetRequirement: { type: "any", count: 1 },
    splice: {
        subtype: "Arcane",
        cost: { mana: { X: 1, R: 1 } },
        description: "Splice onto Arcane {1}{R}",
    },
};

const SPIKE = "spike-1";
const RAY = "ray-1";
const BEARS = "bears-1";
const BASE = { gameId: "game-1" as Id<"games">, playerId: "p1" };

/** p1 holds Lava Spike and Glacial Ray with exactly `{R}` + `{1}{R}` in the
 *  pool; p2 has a 2/2 for the spliced text to burn (when `withBears`). */
function board(
    spliceCardId: string = GLACIAL_RAY.id,
    withBears = true
): GameState {
    const inHand = (cardId: string, id: string): CardInstanceState =>
        makeInstance(cardId, {
            id,
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
    return makeState({
        players: [
            makePlayer("p1", {
                hand: [
                    inHand(lavaSpike().id, SPIKE),
                    inHand(spliceCardId, RAY),
                ],
                manaPool: { W: 0, U: 0, B: 0, R: 2, G: 0, C: 1 },
            }),
            makePlayer("p2", {
                battlefield: withBears
                    ? [
                          makeInstance(grizzlyBears().id, {
                              id: BEARS,
                              controllerId: "p2",
                              ownerId: "p2",
                              zone: "battlefield",
                          }),
                      ]
                    : [],
            }),
        ],
        phase: "PRECOMBAT_MAIN",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
}

async function announceSplicing(
    harness: ReturnType<typeof makeMutationCtx>
): Promise<void> {
    await runMutation(
        announceCast as unknown as Handler<Record<string, unknown>, void>,
        harness.ctx,
        {
            ...BASE,
            cardInstanceId: SPIKE,
            kickerPayments: { [spliceCostId(RAY)]: 1 },
        }
    );
}

async function pick(
    harness: ReturnType<typeof makeMutationCtx>,
    target: { targetType: "player" | "permanent"; targetId: string }
): Promise<void> {
    await runMutation(
        selectTargets as unknown as Handler<Record<string, unknown>, void>,
        harness.ctx,
        { ...BASE, targets: [target] }
    );
}

describe("splicing a targeting card (CR 702.47b/d)", () => {
    it("announces the spliced card's group AFTER the spell's own, and resolves both halves against their own slots", async () => {
        await withTemporaryDefinitionAsync(GLACIAL_RAY, async () => {
            const harness = makeMutationCtx("p1", [gameStateSeed(board())]);
            await announceSplicing(harness);
            // CR 702.47d / 601.2c — the spell's own group opens the
            // selection; the revealed card's waits behind it.
            const opening = harness.state().pendingTarget;
            expect(opening?.targetType).toEqual(["player", "Planeswalker"]);
            expect(opening?.remainingRequirements).toEqual([
                GLACIAL_RAY.targetRequirement,
            ]);

            await pick(harness, { targetType: "player", targetId: "p2" });
            // SURFACE — the second prompt the client renders, read off the
            // PROJECTED view, is the spliced card's own requirement, with the
            // spell's pick carried behind it and the 2/2 on the wire to click
            // (`matchesTargetRequirement` already marks "any" permanents).
            const projected = projectPublicState(harness.state(), 1, "p1");
            const second = projected.pendingTarget;
            expect(second?.targetType).toBe("any");
            expect(second?.count).toBe(1);
            expect(second?.priorSelected).toEqual([
                { type: "player", id: "p2" },
            ]);
            expect(
                projected.players[1]!.battlefield.some((c) => c.id === BEARS)
            ).toBe(true);

            await pick(harness, { targetType: "permanent", targetId: BEARS });
            const state = harness.state();
            expect(state.pendingTarget).toBeUndefined();
            const item = state.stack[0]!;
            expect(item.targets).toEqual([
                { type: "player", id: "p2" },
                { type: "permanent", id: BEARS },
            ]);
            expect(item.splicedCardIds).toEqual([GLACIAL_RAY.id]);

            resolveTopOfStack(state);
            // CR 702.47b — the main spell's effect first: 3 to the player.
            expect(getPlayer(state, "p2")!.life).toBe(17);
            // The spliced `{ target: 0 }` was rebased onto slot 1 — the 2/2,
            // NOT the player a second time (which would read 15).
            expect(
                getPlayer(state, "p2")!.battlefield.find((c) => c.id === BEARS)
                    ?.damageMarked
            ).toBe(2);
        });
    });

    it("CR 608.2b — an illegal spliced target is skipped while the spell's own still resolves", async () => {
        await withTemporaryDefinitionAsync(GLACIAL_RAY, async () => {
            const harness = makeMutationCtx("p1", [gameStateSeed(board())]);
            await announceSplicing(harness);
            await pick(harness, { targetType: "player", targetId: "p2" });
            await pick(harness, { targetType: "permanent", targetId: BEARS });
            const state = harness.state();
            // The 2/2 leaves before the spell resolves.
            const p2 = getPlayer(state, "p2")!;
            p2.battlefield = p2.battlefield.filter((c) => c.id !== BEARS);
            resolveTopOfStack(state);
            expect(getPlayer(state, "p2")!.life).toBe(17);
        });
    });

    it("CR 702.47b — a reveal whose target group nobody can fill refuses the cast", async () => {
        // A creature-only spliced group on a board with no creature.
        const mightProbe: CardDefinition = {
            ...GLACIAL_RAY,
            id: "might-splice-probe",
            name: "Might Probe",
            targetRequirement: { type: "Creature", count: 1 },
        };
        await withTemporaryDefinitionAsync(mightProbe, async () => {
            const harness = makeMutationCtx("p1", [
                gameStateSeed(board(mightProbe.id, false)),
            ]);
            await expect(announceSplicing(harness)).rejects.toThrow(
                /legal targets/
            );
        });
    });
});
