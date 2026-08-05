// Engine-side coverage for the ENGINE-RAISED pending-target answer
// (issue #2283) — the container that froze the vs-AI bot forever whenever it
// controlled a triggered ability owing a real target choice (CR 603.3d).
//
// The tests are derived from the PRODUCER CENSUS, one describe per row, and
// deliberately include the must-NOT rows: the whole bug is that a
// `PendingTarget` the bot ANNOUNCED and one the engine RAISED at it look
// identical to a `kind ===` check, and classifying wrong in the permissive
// direction breaks every existing bot cast/activation.
//
//   | producer                                    | kind             | owed by             | bot answers? |
//   | ------------------------------------------- | ---------------- | ------------------- | ------------ |
//   | `announceCast` (game.ts)                    | absent → "cast"  | args.playerId       | NO           |
//   | `activateAbility` (game.ts)                 | "ability"        | args.playerId       | NO           |
//   | `raiseTriggerTargetSelection` (rules.ts)    | "trigger"        | item.controllerId   | YES          |
//   | `requestRetarget` (state.ts)                | "retarget"       | item.castById       | YES          |
//   | `requestCopyRetargetOn` (state.ts)          | "copy-retarget"  | copy.controllerId   | YES          |

import { describe, it, expect } from "vitest";
import {
    PENDING_TARGET_ORIGIN,
    pendingTargetOrigin,
    raisedPendingTargetOwedBy,
} from "../pendingTargetOrigin";
import { enumerateMoves, enumerateRaisedTargetMoves } from "../moves";
import { applyMoveInSearch, decidingPlayer } from "../search";
import {
    applyOneTargetSelection,
    advanceTargetGroupOrFinalize,
} from "../../game";
import { refreshExpectedInput } from "../expectedInput";
import type { GameState, PendingTarget, StackItem } from "../state";
import { makeInstance, makeState } from "../../cards/__tests__/setup";

// Grizzly Bears / Hill Giant — plain vanilla bodies, no abilities to perturb
// targeting. Ids come from the registry via `makeInstance`'s card name lookup.
const BEARS = "ce2d603a-3231-4a8c-bf39-1617586ea870"; // Grizzly Bears

/** A board with three vanilla creatures (two the bot controls, one the
 *  opponent does) and a `trigger`-kind pending target owed to `p1`, pointed at
 *  a triggered-ability stack item. Mirrors the shape
 *  `raiseTriggerTargetSelection` produces. */
function stateWithRaisedTrigger(ptOverrides: Partial<PendingTarget> = {}): {
    state: GameState;
    trigger: StackItem;
    ids: { mineA: string; mineB: string; theirs: string };
} {
    const mineA = makeInstance(BEARS, { id: "mine-a", controllerId: "p1" });
    const mineB = makeInstance(BEARS, { id: "mine-b", controllerId: "p1" });
    const theirs = makeInstance(BEARS, {
        id: "theirs",
        controllerId: "p2",
        ownerId: "p2",
    });
    // The trigger's SOURCE is deliberately not a Creature, so the three
    // creatures above are exactly the legal target set (a fourth would make
    // every count assertion below stop saying what it means).
    const source = makeInstance(BEARS, {
        id: "source",
        controllerId: "p1",
        types: ["Enchantment"],
    });
    const state = makeState();
    state.players[0].battlefield = [mineA, mineB, source];
    state.players[1].battlefield = [theirs];

    const trigger: StackItem = {
        ...makeInstance(BEARS, { id: "trig", controllerId: "p1" }),
        castById: "p1",
        targets: [],
        isTriggeredAbility: true,
        sourceInstanceId: source.id,
    } as StackItem;
    state.stack.push(trigger);

    state.pendingTarget = {
        playerId: "p1",
        cardInstanceId: trigger.id,
        kind: "trigger",
        targetType: "Creature",
        count: 1,
        selected: [],
        ...ptOverrides,
    };
    state.priorityPlayerId = "p1";
    refreshExpectedInput(state);
    return {
        state,
        trigger,
        ids: { mineA: mineA.id, mineB: mineB.id, theirs: theirs.id },
    };
}

/** Drive a `submit-target` move through the REAL server path — the same
 *  `applyOneTargetSelection` / `advanceTargetGroupOrFinalize` the
 *  `selectTargets` / `confirmTargets` mutations call. Throws exactly where the
 *  server would, which is the point: an illegal or over-picked submission
 *  freezes the bot just as hard as no submission. */
function submitThroughServer(
    state: GameState,
    playerId: string,
    move: { targets: { type: string; id: string }[]; confirmTargets: boolean }
): void {
    for (const t of move.targets) {
        applyOneTargetSelection(state, playerId, {
            targetType: t.type as "permanent",
            targetId: t.id,
        });
        if (!state.pendingTarget) break;
    }
    if (move.confirmTargets && state.pendingTarget) {
        advanceTargetGroupOrFinalize(state, state.pendingTarget, playerId);
    }
}

describe("pending-target ORIGIN census (issue #2283)", () => {
    it("classifies every PendingTarget kind, and an absent kind as cast", () => {
        // The runtime mirror of the compile-time witness
        // (`MissingPendingTargetOriginKind`): a sixth kind added to the union
        // without a row here fails `tsc`, and this asserts the ROWS we shipped.
        expect(PENDING_TARGET_ORIGIN).toEqual({
            cast: "announced",
            ability: "announced",
            trigger: "raised",
            retarget: "raised",
            "copy-retarget": "raised",
        });
        // CR 601.2c — `pt.kind ?? "cast"` is the engine-wide default.
        expect(pendingTargetOrigin(undefined)).toBe("announced");
    });

    it("is COMPILE-TIME exhaustive: an unclassified kind fails tsc", () => {
        // The acceptance criterion is a BUILD error, not a runtime one — the
        // recurring "bot freezes on a new choice mechanic" class is precisely a
        // kind nobody classified, and a runtime check on a kind that never
        // occurs in the test suite is silent. `pendingTargetOrigin.ts` carries
        // the witness (`MissingPendingTargetOriginKind`); it is re-stated here
        // so THIS file also stops compiling if a sixth kind is added to
        // `PendingTarget["kind"]` without a row — the same structural guard
        // `botActionRealisation` gives `BotAction["kind"]`.
        type Missing = Exclude<
            NonNullable<PendingTarget["kind"]>,
            keyof typeof PENDING_TARGET_ORIGIN
        >;
        const witness: [Missing] extends [never] ? true : never = true;
        expect(witness).toBe(true);
    });

    it("MUST-NOT rows: a cast/ability selection is never the bot's to answer", () => {
        for (const kind of ["cast", "ability", undefined] as const) {
            const { state } = stateWithRaisedTrigger();
            state.pendingTarget!.kind = kind;
            expect(raisedPendingTargetOwedBy(state, "p1")).toBeUndefined();
            expect(enumerateRaisedTargetMoves(state, "p1")).toEqual([]);
            // …and the enumerator's blanket gate still surfaces nothing, so the
            // executor keeps driving the announcement atomically.
            expect(enumerateMoves(state, "p1")).toEqual([]);
            expect(decidingPlayer(state)).toBeNull();
        }
    });

    it("MUST rows: trigger / retarget / copy-retarget are the bot's to answer", () => {
        for (const kind of ["trigger", "retarget", "copy-retarget"] as const) {
            const { state } = stateWithRaisedTrigger();
            state.pendingTarget!.kind = kind;
            expect(raisedPendingTargetOwedBy(state, "p1")?.kind).toBe(kind);
            expect(enumerateRaisedTargetMoves(state, "p1").length).toBe(3);
            expect(decidingPlayer(state)).toBe("p1");
        }
    });

    it("a selection owed to the OPPONENT does not make the bot act", () => {
        const { state } = stateWithRaisedTrigger({ playerId: "p2" });
        expect(raisedPendingTargetOwedBy(state, "p1")).toBeUndefined();
        expect(enumerateRaisedTargetMoves(state, "p1")).toEqual([]);
        expect(enumerateMoves(state, "p1")).toEqual([]);
        // The owner still decides — the window is not a dead end for them.
        expect(decidingPlayer(state)).toBe("p2");
    });
});

describe("raised target submissions are legal server-side (CR 601.2c/601.2d)", () => {
    it("a fixed-N selection submits without confirmTargets and commits", () => {
        const { state, trigger, ids } = stateWithRaisedTrigger();
        const moves = enumerateRaisedTargetMoves(state, "p1");
        expect(moves.map((m) => m.kind)).toEqual([
            "submit-target",
            "submit-target",
            "submit-target",
        ]);
        const move = moves[0];
        if (move.kind !== "submit-target") throw new Error("kind");
        // CR 601.2c — fixed N auto-finalizes on the last pick; confirming
        // afterwards throws "No target selection in progress".
        expect(move.confirmTargets).toBe(false);
        expect([ids.mineA, ids.mineB, ids.theirs]).toContain(
            move.targets[0].id
        );

        submitThroughServer(state, "p1", move);
        expect(state.pendingTarget).toBeUndefined();
        expect(trigger.targets).toEqual(move.targets);
    });

    it("a RANGE count submits every size in [min, max] and confirms", () => {
        const { state } = stateWithRaisedTrigger({
            count: { min: 1, max: 2 },
        });
        const moves = enumerateRaisedTargetMoves(state, "p1");
        // 3 singles + 3 pairs.
        expect(moves.length).toBe(6);
        for (const move of moves) {
            if (move.kind !== "submit-target") throw new Error("kind");
            // Only a submission that fills the max auto-finalizes.
            expect(move.confirmTargets).toBe(move.targets.length < 2);
            const probe = stateWithRaisedTrigger({ count: { min: 1, max: 2 } });
            expect(() =>
                submitThroughServer(probe.state, "p1", move)
            ).not.toThrow();
            expect(probe.state.pendingTarget).toBeUndefined();
            expect(probe.trigger.targets?.length).toBe(move.targets.length);
        }
    });

    it("an 'up to N' selection may legally decline (empty submission)", () => {
        const { state, trigger } = stateWithRaisedTrigger({
            count: { min: 0, max: 1 },
        });
        const moves = enumerateRaisedTargetMoves(state, "p1");
        const decline = moves.find(
            (m) => m.kind === "submit-target" && m.targets.length === 0
        );
        expect(decline).toBeDefined();
        if (!decline || decline.kind !== "submit-target") throw new Error("x");
        // `selectTargets` rejects an empty array, so the decline is
        // confirm-only — the executor must not call it with zero targets.
        expect(decline.confirmTargets).toBe(true);
        submitThroughServer(state, "p1", decline);
        expect(state.pendingTarget).toBeUndefined();
        expect(trigger.targets).toEqual([]);
    });

    it("a DIVIDE-as-you-choose total caps the target count and the split is accepted", () => {
        // CR 601.2d / 120.4 — 2 points to divide among "up to 3" targets: a
        // legal submission can name at most 2 (each target gets ≥ 1).
        const { state, trigger } = stateWithRaisedTrigger({
            count: { min: 1, max: 3 },
            divideTotal: 2,
        });
        const moves = enumerateRaisedTargetMoves(state, "p1");
        for (const move of moves) {
            if (move.kind !== "submit-target") throw new Error("kind");
            expect(move.targets.length).toBeLessThanOrEqual(2);
        }
        const two = moves.find(
            (m) => m.kind === "submit-target" && m.targets.length === 2
        );
        expect(two).toBeDefined();
        if (!two || two.kind !== "submit-target") throw new Error("x");
        submitThroughServer(state, "p1", two);
        expect(state.pendingTarget).toBeUndefined();
        // The engine auto-divided ≥1-each, summing to the total (the bot
        // deliberately submits no explicit `amount`, which is always legal).
        const amounts = Object.values(trigger.targetAmounts ?? {});
        expect(amounts.length).toBe(2);
        expect(amounts.reduce((a, b) => a + b, 0)).toBe(2);
        expect(amounts.every((a) => a >= 1)).toBe(true);
    });

    it("respects the requirement filters — a 'you control' selection never offers the opponent's permanents", () => {
        const { state, ids } = stateWithRaisedTrigger({
            controller: "you",
        });
        const offered = enumerateRaisedTargetMoves(state, "p1").flatMap((m) =>
            m.kind === "submit-target" ? m.targets.map((t) => t.id) : []
        );
        expect(offered.sort()).toEqual([ids.mineA, ids.mineB].sort());
        expect(offered).not.toContain(ids.theirs);
    });
});

describe("the search commits a raised submission through the shared authority", () => {
    it("applyMoveInSearch clears the selection and writes the targets", () => {
        const { state, trigger } = stateWithRaisedTrigger();
        const move = enumerateRaisedTargetMoves(state, "p1")[0];
        applyMoveInSearch(state, "p1", move);
        expect(state.pendingTarget).toBeUndefined();
        if (move.kind !== "submit-target") throw new Error("kind");
        expect(trigger.targets).toEqual(move.targets);
        // CR 117.3d — a fresh priority round begins with the active player.
        expect(state.priorityPlayerId).toBe(state.activePlayerId);
    });

    it("ignores a submission whose selection is no longer raised (stale world)", () => {
        const { state, trigger } = stateWithRaisedTrigger();
        const move = enumerateRaisedTargetMoves(state, "p1")[0];
        // A determinized world can have advanced past the selection the move
        // was enumerated against; writing targets into an ANNOUNCED selection
        // would corrupt a half-built announcement.
        state.pendingTarget!.kind = "cast";
        applyMoveInSearch(state, "p1", move);
        expect(state.pendingTarget).toBeDefined();
        expect(trigger.targets).toEqual([]);
    });
});
