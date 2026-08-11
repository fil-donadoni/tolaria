// Full-path integration: "up to X" variable target count (CR 601.2c) —
// issue #2365.
//
// `TargetRequirement.count` can now be `{ min, max: "X" }` — a genuinely
// optional 0..X range ("destroy up to X target artifacts and/or
// enchantments"), resolved against the announced X by the single shared
// `resolveTargetRequirementCount` (`convex/gre/state.ts`). The risk this
// test guards is specifically the one the issue calls out: a count grammar
// that resolves correctly server-side but can't be terminated early in the
// UI is a shipped bug — `describeTargetProgress` (the live "Done" affordance
// hint) has to see a real numeric `max`, not the unresolved `"X"` literal.
//
// No card in the catalogue uses this shape yet (Pest Infestation, the
// motivating consumer, is blocked on two OTHER gaps — #2366/#1357 — and
// lands in its own slice, #2369), so this drives the RAISED "copy-retarget"
// producer (`requestCopyRetargetOn`, CR 707.10c) rather than a full
// spell cast: it is one of the five sites this issue's fix touches, needs no
// catalogue card (just a synthetic `TargetRequirement` and a stack item), and
// exercises the exact same shared resolver a spell cast would.
//
// Three layers, all real (no hand-rolled reimplementation):
//   1. GRE — `resolveTargetRequirementCount` resolves `{min:0, max:"X"}`
//      against the announced X into a live `{min, max}` PendingTarget.count.
//   2. game.ts — the REGISTERED `selectTarget` / `confirmTargets` mutation
//      `_handler`s, driven through the project's stub-MutationCtx harness
//      (`gameMutationHarness.ts` — the established seam; no convex-test
//      harness exists here).
//   3. Frontend — `describeTargetProgress` (`~/lib/target-progress`), the
//      real reducer the target-selection banner calls to decide whether
//      "Done" is offered before the max is reached.

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup";
import { grizzlyBears, hillGiant, savannahLions } from "@convex/cards/sets/lea";
import { preloadDefinitions } from "@convex/cards";
import type { CardDefinition } from "@convex/cards/types";
import { selectTarget, confirmTargets } from "@convex/game";
import {
    requestCopyRetargetOn,
    resolveTargetRequirementCount,
    type GameState,
    type PendingTarget,
    type StackItem,
} from "@convex/gre/state";
import {
    makeMutationCtx,
    runMutation,
    gameStateSeed,
    type Handler,
} from "@convex/__tests__/gameMutationHarness";
import type { Id } from "@convex/_generated/dataModel";
import { describeTargetProgress } from "~/lib/target-progress";

// A synthetic card whose OWN targetRequirement is the "up to X" object form
// (CR 601.2c) — nothing in the shipped catalogue uses this shape yet (see
// the comment below), so `requestCopyRetargetOn` (the real CR 707.10c
// producer, gre/state.ts) needs a real `def.targetRequirement` to read when
// driven for real (review finding on issue #2365, `boardWithRealCopyRetarget`
// below). `min: 1` (not the `min: 0` the OTHER tests in this file use) is
// deliberate: `requestCopyRetargetOn` early-returns without raising a
// PendingTarget whenever `count.min <= 0` (a PRE-EXISTING gate, unrelated to
// and unmodified by issue #2365 — it applies identically to a fixed `{min:0,
// max:N}` "up to N" requirement) — so `min: 0` here would prove the producer
// runs its two count-resolution lines but never reach a live PendingTarget
// to drive `selectTarget`/`confirmTargets` through. `min: 1` clears that gate
// while still exercising the SAME "up to X" `resolveTargetRequirementCount`
// branch the rest of this file covers.
const UP_TO_X_REAL_PRODUCER_CARD: CardDefinition = {
    id: "00000000-0000-4000-8000-0000c0797e70",
    name: "Synthetic Up-To-X Copy-Retarget Test Spell",
    rarity: "common",
    types: ["Instant"],
    manaCost: {},
    targetRequirement: { type: "Creature", count: { min: 1, max: "X" } },
};
preloadDefinitions([UP_TO_X_REAL_PRODUCER_CARD]);

const GAME_ID = "game-1" as Id<"games">;

type SelectTargetArgs = {
    gameId: Id<"games">;
    playerId: string;
    targetType: "permanent" | "player" | "spell" | "graveyard-card";
    targetId: string;
};

const runSelectTarget = (
    ctx: Parameters<typeof runMutation>[1],
    targetId: string
) =>
    runMutation<SelectTargetArgs, void>(
        selectTarget as unknown as Handler<SelectTargetArgs, void>,
        ctx,
        { gameId: GAME_ID, playerId: "p1", targetType: "permanent", targetId }
    );

const runConfirmTargets = (ctx: Parameters<typeof runMutation>[1]) =>
    runMutation<{ gameId: Id<"games">; playerId: string }, void>(
        confirmTargets as unknown as Handler<
            { gameId: Id<"games">; playerId: string },
            void
        >,
        ctx,
        { gameId: GAME_ID, playerId: "p1" }
    );

/** Three vanilla creatures on p2's battlefield (legal "up to X" targets) plus
 *  a spell COPY on the stack whose controller (p1) is offered the
 *  `copy-retarget` prompt — CR 707.10c, `requestCopyRetargetOn`'s
 *  shape. `chosenX` is the copy's announced X (CR 107.3); the `count` on the
 *  PendingTarget is built via the SAME shared resolver `requestCopyRetargetOn`
 *  calls, so this is the real resolution path, not a hand-built shortcut. */
function boardWithCopyRetarget(chosenX: number): {
    state: GameState;
    targetIds: string[];
} {
    const t1 = makeInstance(grizzlyBears.id, {
        id: "t1",
        controllerId: "p2",
        ownerId: "p2",
    });
    const t2 = makeInstance(hillGiant.id, {
        id: "t2",
        controllerId: "p2",
        ownerId: "p2",
    });
    const t3 = makeInstance(savannahLions.id, {
        id: "t3",
        controllerId: "p2",
        ownerId: "p2",
    });
    const copy: StackItem = {
        ...makeInstance(grizzlyBears.id, {
            id: "copy-1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "stack",
        }),
        castById: "p1",
        chosenX,
        targets: [],
    };
    const resolvedCount = resolveTargetRequirementCount(
        { min: 0, max: "X" },
        chosenX
    );
    const pendingTarget: PendingTarget = {
        playerId: "p1",
        cardInstanceId: copy.id,
        kind: "copy-retarget",
        targetType: "Creature",
        count: resolvedCount,
        selected: [],
    };
    const state = makeState({
        players: [
            makePlayer("p1"),
            makePlayer("p2", { battlefield: [t1, t2, t3] }),
        ],
        stack: [copy],
        pendingTarget,
    });
    return { state, targetIds: [t1.id, t2.id, t3.id] };
}

/** Same three-creature board as `boardWithCopyRetarget`, but the
 *  `PendingTarget` is raised by calling the REAL `requestCopyRetargetOn`
 *  producer against a real spell copy on the stack (`UP_TO_X_REAL_PRODUCER_
 *  CARD`), instead of hand-building the `PendingTarget` — the review-finding
 *  fix on issue #2365: the producer's own two count-resolution lines
 *  (`req.count` read + the `minNeeded` gate) are now actually executed. */
function boardWithRealCopyRetarget(chosenX: number): {
    state: GameState;
    targetIds: string[];
} {
    const t1 = makeInstance(grizzlyBears.id, {
        id: "rt1",
        controllerId: "p2",
        ownerId: "p2",
    });
    const t2 = makeInstance(hillGiant.id, {
        id: "rt2",
        controllerId: "p2",
        ownerId: "p2",
    });
    const t3 = makeInstance(savannahLions.id, {
        id: "rt3",
        controllerId: "p2",
        ownerId: "p2",
    });
    const copy: StackItem = {
        ...makeInstance(UP_TO_X_REAL_PRODUCER_CARD.id, {
            id: "real-copy-1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "stack",
        }),
        castById: "p1",
        chosenX,
        targets: [],
    };
    const state = makeState({
        players: [
            makePlayer("p1"),
            makePlayer("p2", { battlefield: [t1, t2, t3] }),
        ],
        stack: [copy],
    });
    // THE call under test: the real producer, not a hand-built PendingTarget.
    requestCopyRetargetOn(state, copy);
    return { state, targetIds: [t1.id, t2.id, t3.id] };
}

describe("requestCopyRetargetOn — the real CR 707.10c producer (review finding, issue #2365)", () => {
    it("raises the SAME { min, max } shape as the shared resolver for an 'up to X' requirement", () => {
        const { state } = boardWithRealCopyRetarget(2);
        expect(state.pendingTarget).toBeDefined();
        const pt = state.pendingTarget!;
        expect(pt.kind).toBe("copy-retarget");
        expect(pt.targetType).toBe("Creature");
        expect(pt.count).toEqual(
            resolveTargetRequirementCount({ min: 1, max: "X" }, 2)
        );
        expect(pt.count).toEqual({ min: 1, max: 2 });
    });

    it("the raised PendingTarget drives the SAME real selectTarget/confirmTargets handlers and describeTargetProgress reducer", async () => {
        const { state, targetIds } = boardWithRealCopyRetarget(2);
        const harness = makeMutationCtx("p1", [gameStateSeed(state)]);
        await runSelectTarget(harness.ctx, targetIds[0]);
        const midway = harness.state();
        expect(midway.pendingTarget).toBeDefined();
        const pt = midway.pendingTarget!;
        expect(pt.selected).toHaveLength(1);
        // min: 1 was already reached by the first pick, max: 2 is not.
        const progress = describeTargetProgress(
            pt.count,
            pt.selected.length,
            "a creature"
        );
        expect(progress.minReached).toBe(true);
        expect(progress.maxReached).toBe(false);

        await runConfirmTargets(harness.ctx);
        const after = harness.state();
        expect(after.pendingTarget).toBeUndefined();
        const copy = after.stack.find((s) => s.id === "real-copy-1");
        expect(copy?.targets).toEqual([
            { type: "permanent", id: targetIds[0] },
        ]);
    });
});

describe('"up to X" variable target count — full path (CR 601.2c, issue #2365)', () => {
    it("GRE: the resolved range spans 0, k < X, and X for a single announced X", () => {
        const { state } = boardWithCopyRetarget(3);
        const pt = state.pendingTarget!;
        expect(pt.count).toEqual({ min: 0, max: 3 });
        if (typeof pt.count === "object") {
            for (const k of [0, 1, 3]) {
                expect(k).toBeGreaterThanOrEqual(pt.count.min);
                expect(k).toBeLessThanOrEqual(pt.count.max!);
            }
        }
    });

    it("declining all targets (0) is a legal confirmTargets — never auto-required", async () => {
        const { state } = boardWithCopyRetarget(3);
        const harness = makeMutationCtx("p1", [gameStateSeed(state)]);
        await runConfirmTargets(harness.ctx);
        const after = harness.state();
        expect(after.pendingTarget).toBeUndefined();
        const copy = after.stack.find((s) => s.id === "copy-1");
        // The compact persisted form drops an empty `targets` array
        // (`serialize.ts`: `item.targets?.length` gates the write), so it
        // round-trips through the harness as `undefined` — the SAME
        // convention `cancelTriggerTarget.test.ts` documents for the
        // in-memory (non-round-tripped) case. Unrelated to this issue's fix;
        // the assertion that matters is "no targets survived the decline".
        expect(copy?.targets ?? []).toEqual([]);
    });

    it("stopping early at k < X: the mid-selection state stays open (not auto-finalized) and the frontend reducer offers Done", async () => {
        const { state, targetIds } = boardWithCopyRetarget(3);
        const harness = makeMutationCtx("p1", [gameStateSeed(state)]);
        await runSelectTarget(harness.ctx, targetIds[0]);
        const midway = harness.state();
        // k=1 < X=3: still awaiting more picks OR an explicit confirm — the
        // count grammar's whole point is that the player can choose to stop
        // HERE without having reached max.
        expect(midway.pendingTarget).toBeDefined();
        const pt = midway.pendingTarget!;
        expect(pt.selected).toHaveLength(1);

        // Layer 3 — the REAL frontend reducer. `minReached` must already be
        // true (min is 0) so the "Done" button is offered; `maxReached` must
        // be false (1 < 3) so more targets are still selectable. Both would
        // silently invert if `count.max` ever arrived as the unresolved "X"
        // string instead of the number 3.
        const progress = describeTargetProgress(
            pt.count,
            pt.selected.length,
            "a creature"
        );
        expect(progress.minReached).toBe(true);
        expect(progress.maxReached).toBe(false);

        // The player exercises that "Done" affordance now, at k=1 < X.
        await runConfirmTargets(harness.ctx);
        const after = harness.state();
        expect(after.pendingTarget).toBeUndefined();
        const copy = after.stack.find((s) => s.id === "copy-1");
        expect(copy?.targets).toEqual([
            { type: "permanent", id: targetIds[0] },
        ]);
    });

    it("selecting all X auto-finalizes on the last pick (no confirmTargets needed) and the reducer reports maxReached", async () => {
        const { state, targetIds } = boardWithCopyRetarget(3);
        const harness = makeMutationCtx("p1", [gameStateSeed(state)]);
        await runSelectTarget(harness.ctx, targetIds[0]);
        await runSelectTarget(harness.ctx, targetIds[1]);
        // Before the last pick: k=2 < X=3, still open.
        const beforeLast = harness.state();
        const ptBeforeLast = beforeLast.pendingTarget!;
        expect(
            describeTargetProgress(ptBeforeLast.count, 2, "a creature")
                .maxReached
        ).toBe(false);

        await runSelectTarget(harness.ctx, targetIds[2]);
        const after = harness.state();
        // The third pick reaches X=3: auto-finalizes, no confirmTargets call.
        expect(after.pendingTarget).toBeUndefined();
        const copy = after.stack.find((s) => s.id === "copy-1");
        expect(copy?.targets?.map((t) => t.id).sort()).toEqual(
            [...targetIds].sort()
        );
    });
});
