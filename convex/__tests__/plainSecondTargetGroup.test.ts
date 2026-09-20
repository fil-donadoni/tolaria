/**
 * CR 115.3 / CR 601.2c (issue #3875) — a spell whose body prints the word
 * "target" in several sentences ("Target creature gets -3/-0 until end of
 * turn. Target creature gets -0/-3 until end of turn.", Agony Warp), driven
 * through the REAL path: the compiler's own definition, the `announceCast` and
 * `selectTargets` mutation handlers, the wire projection, then
 * `resolveTopOfStack`.
 *
 * CR 601.2c: "The same object or player can be chosen once for each instance
 * of the word 'target' on the spell". Each sentence is its own group, so the
 * SAME creature may fill both — and that is the one thing a widened count
 * ("two target creatures") or an "another target" exclusion would forbid.
 * What separates the two readings is the `excludePriorTargets` directive, so
 * the discriminating pair below runs the plain text beside a printed
 * "Another target …".
 *
 * The definition is compiled, never hand-written: what this file proves is the
 * compiler's announcement surviving every consumer, not a fixture agreeing
 * with itself.
 */

import { describe, expect, it } from "vitest";
import { makeInstance, makePlayer, makeState } from "../cards/__tests__/setup";
import { grizzlyBears } from "../cards/sets/lea/green";
import { withTemporaryDefinitionAsync } from "../cards";
import type { CardDefinition } from "../cards/types";
import { announceCast, selectTargets } from "../game";
import {
    gameStateSeed,
    makeMutationCtx,
    runMutation,
    type Handler,
} from "./gameMutationHarness";
import type { Id } from "../_generated/dataModel";
import { resolveTopOfStack, type GameState } from "../gre/state";
import { getEffectivePower, getEffectiveToughness } from "../gre/layers";
import { projectPublicState } from "../gameProjections";
import { compileCard } from "../oracle/compile";
import { oracleCard } from "../oracle/__tests__/fixtures";

const SPELL = "warp-1";
const BASE = { gameId: "game-1" as Id<"games">, playerId: "p1" };

function compiledSpell(name: string, oracleText: string): CardDefinition {
    const card = oracleCard({
        name,
        manaCost: "{U}{B}",
        typeLine: "Instant",
        oracleText,
        power: undefined,
        toughness: undefined,
    });
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(`${name} unparsed: ${JSON.stringify(outcome.gaps)}`);
    return {
        ...(outcome.definition as CardDefinition),
        id: card.oracleId,
        rarity: "common",
    };
}

const AGONY_WARP = () =>
    compiledSpell(
        "Test Agony Warp",
        "Target creature gets -3/-0 until end of turn.\nTarget creature gets -0/-3 until end of turn."
    );

const ANOTHER_WARP = () =>
    compiledSpell(
        "Test Another Warp",
        "Target creature gets -3/-0 until end of turn. Another target creature gets -0/-3 until end of turn."
    );

function bear(id: string): ReturnType<typeof makeInstance> {
    return makeInstance(grizzlyBears.id, {
        id,
        controllerId: "p2",
        ownerId: "p2",
        zone: "battlefield",
    });
}

/** p1 holds the spell and the two colours it costs; p2 has two 2/2s. */
function board(def: CardDefinition): GameState {
    const spell = makeInstance(def.id, {
        id: SPELL,
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
    });
    return makeState({
        players: [
            makePlayer("p1", {
                hand: [spell],
                manaPool: { W: 0, U: 1, B: 1, R: 0, G: 0, C: 0 },
            }),
            makePlayer("p2", { battlefield: [bear("bear-a"), bear("bear-b")] }),
        ],
        phase: "PRECOMBAT_MAIN",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
}

async function announce(
    harness: ReturnType<typeof makeMutationCtx>
): Promise<void> {
    await runMutation(
        announceCast as unknown as Handler<Record<string, unknown>, void>,
        harness.ctx,
        { ...BASE, cardInstanceId: SPELL }
    );
}

async function pick(
    harness: ReturnType<typeof makeMutationCtx>,
    targetId: string
): Promise<void> {
    await runMutation(
        selectTargets as unknown as Handler<Record<string, unknown>, void>,
        harness.ctx,
        { ...BASE, targets: [{ targetType: "permanent", targetId }] }
    );
}

/** A permanent's power/toughness after the layer pipeline (CR 613.4) — the
 *  pumps are registered effects, not edits to the printed 2/2. */
function effectivePT(state: GameState, id: string): [number, number] {
    const bear = state.players
        .flatMap((p) => p.battlefield)
        .find((c) => c.id === id)!;
    return [getEffectivePower(state, bear), getEffectiveToughness(state, bear)];
}

describe("a plain second 'target' is its own group (CR 115.3, issue #3875)", () => {
    it("asks for two picks, one prompt at a time, each over the creature requirement", async () => {
        const def = AGONY_WARP();
        await withTemporaryDefinitionAsync(def, async () => {
            const harness = makeMutationCtx("p1", [gameStateSeed(board(def))]);
            await announce(harness);
            const first = harness.state().pendingTarget;
            expect(first?.targetType).toBe("Creature");
            expect(first?.count).toBe(1);
            // CR 601.2c — QUEUED as a second group, never widened into the
            // first group's count.
            expect(first?.remainingRequirements).toEqual([
                { type: "Creature", count: 1 },
            ]);

            await pick(harness, "bear-a");
            const second = harness.state().pendingTarget;
            expect(second?.targetType).toBe("Creature");
            expect(second?.count).toBe(1);
            expect(second?.selected).toEqual([]);
        });
    });

    it("offers the FIRST pick again to the second group — CR 601.2c lets one creature fill both", async () => {
        const def = AGONY_WARP();
        await withTemporaryDefinitionAsync(def, async () => {
            const harness = makeMutationCtx("p1", [gameStateSeed(board(def))]);
            await announce(harness);
            await pick(harness, "bear-a");
            // SURFACE assertion through the real reducer: an exclusion that
            // reached the wire would grey the creature out on the client while
            // the server would have accepted it.
            const view = projectPublicState(harness.state(), 1, "p1");
            expect(view.pendingTarget?.excludeInstanceIds ?? []).not.toContain(
                "bear-a"
            );

            await pick(harness, "bear-a");
            const state = harness.state();
            expect(state.pendingTarget).toBeUndefined();
            expect(state.stack[0]!.targets).toEqual([
                { type: "permanent", id: "bear-a" },
                { type: "permanent", id: "bear-a" },
            ]);
            resolveTopOfStack(state);
            // -3/-0 then -0/-3 on ONE 2/2 — both halves land on it — while the
            // bystander is untouched.
            expect(effectivePT(state, "bear-a")).toEqual([-1, -1]);
            expect(effectivePT(state, "bear-b")).toEqual([2, 2]);
        });
    });

    it("reads the two picks POSITIONALLY: slot 0 gets -3/-0, slot 1 gets -0/-3", async () => {
        const def = AGONY_WARP();
        await withTemporaryDefinitionAsync(def, async () => {
            const harness = makeMutationCtx("p1", [gameStateSeed(board(def))]);
            await announce(harness);
            await pick(harness, "bear-a");
            await pick(harness, "bear-b");
            const state = harness.state();
            resolveTopOfStack(state);
            // Each Op reads its OWN slot: a shifted or collapsed reference
            // would put both pumps on one creature and leave the other 2/2.
            expect(effectivePT(state, "bear-a")).toEqual([-1, 2]);
            expect(effectivePT(state, "bear-b")).toEqual([2, -1]);
        });
    });

    it("the printed 'Another target' pair EXCLUDES the first pick — the discriminator", async () => {
        const def = ANOTHER_WARP();
        expect(def.additionalTargetRequirements).toEqual([
            { type: "Creature", count: 1, excludePriorTargets: true },
        ]);
        await withTemporaryDefinitionAsync(def, async () => {
            const harness = makeMutationCtx("p1", [gameStateSeed(board(def))]);
            await announce(harness);
            await pick(harness, "bear-a");
            const view = projectPublicState(harness.state(), 1, "p1");
            expect(view.pendingTarget?.excludeInstanceIds).toContain("bear-a");
        });
    });
});
