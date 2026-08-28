// Integration: a VARIABLE-COUNT target selection (CR 601.2c's "up to X" /
// `{ min, max }`) is finalized through `confirmTargets` at every fill level,
// across the GRE → game.ts → executor boundary (issue #2870).
//
// The reported freeze: the Bot cast Pest Infestation ("Destroy up to X target
// artifacts and/or enchantments") for X = 1 on a board holding no artifact and
// no enchantment, so the only possible answer to its `{ min: 0, max: 1 }`
// selection was ZERO targets. `selectTargets` rejects an empty array, so that
// answer is a confirm-ONLY submission — but both the Move producer and the
// executor gated the confirm on a NON-EMPTY target list, so no mutation at all
// was sent. The `PendingTarget` stayed live, the following `tapForPayment` threw
// against an expected input of `"target"`, and the announcement stranded at an
// owed target of ANNOUNCED origin — which the owed-target gate is fail-closed
// against by design, so the Bot answered `no-move` and the liveness ladder span
// cast → `cancel-target` → re-cast forever (~10s per cycle, seq 103 → 124 of
// game `jh7c2symenzqjz5tyjmx90eby98d8n7k`).
//
// The SAME predicate was wrong at the other end of the range: a selection filled
// to its `max` auto-finalizes on the last pick
// (`applyOneTargetSelection` → `advanceTargetGroupOrFinalize`), so a confirm
// afterwards throws "No target selection in progress". Both shapes are asserted
// here.
//
// WHY THIS TEST AND NOT A GRE-ONLY ONE: the mutation-level "declining all
// targets (0) is a legal confirm" case already passed before the fix
// (`convex/__tests__/upToXTargetCastLegality.test.ts`). The defect lived
// entirely in the mutation SEQUENCE the Bot sent, so nothing short of the real
// enumerator + the real executor + the real registered mutation handlers can
// see it. Same harness discipline as the other `game.ts` integration coverage:
// a stub `MutationCtx` driving the REGISTERED mutations' own `_handler`s
// (`gameMutationHarness.ts`), never a reimplementation of their bodies.

import { describe, expect, it } from "vitest";
import {
    announceCast,
    activateAbility,
    confirmTargets,
    selectTargets,
    tapForPayment,
} from "@convex/game";
import { getCardByName } from "@convex/cards";
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
    type MutationStub,
} from "@convex/__tests__/gameMutationHarness";
import { enumerateMoves } from "@convex/gre/moves";
import type { GameState } from "@convex/gre/state";
import { resolveTopOfStack } from "@convex/gre/state";
import type { Id } from "@convex/_generated/dataModel";
import { executeMove, type MoveMutations } from "../executor";

const GAME_ID = "game-1" as Id<"games">;
const BOT = "p1";
const HUMAN = "p2";

const PEST_INFESTATION = getCardByName("Pest Infestation").id;
const TEFERI = getCardByName("Teferi, Time Raveler").id;
const FOREST = getCardByName("Forest").id;
const MOUNTAIN = getCardByName("Mountain").id;
const BOLT = getCardByName("Lightning Bolt").id;
const ANKH = getCardByName("Ankh of Mishra").id;
const BEARS = getCardByName("Grizzly Bears").id;
const SPOILS_OF_WAR = getCardByName("Spoils of War").id;
const SWAMP = getCardByName("Swamp").id;

/** The BOT's seat holds `hand`, plus `landCount` untapped lands of `landId`;
 *  the HUMAN's battlefield is whatever the scenario needs. */
function board(options: {
    hand?: ReturnType<typeof makeInstance>[];
    botBattlefield?: ReturnType<typeof makeInstance>[];
    humanBattlefield?: ReturnType<typeof makeInstance>[];
    landId?: string;
    landCount?: number;
}): GameState {
    const { landId = FOREST, landCount = 0 } = options;
    const lands = Array.from({ length: landCount }, (_, i) =>
        makeInstance(landId, {
            id: `land-${i}`,
            controllerId: BOT,
            ownerId: BOT,
            zone: "battlefield",
        })
    );
    return makeState({
        players: [
            makePlayer(BOT, {
                hand: options.hand ?? [],
                battlefield: [...(options.botBattlefield ?? []), ...lands],
            }),
            makePlayer(HUMAN, { battlefield: options.humanBattlefield ?? [] }),
        ],
        activePlayerId: BOT,
        priorityPlayerId: BOT,
    });
}

/** A `MoveMutations` surface routing every call the cast / activate flows make
 *  through the REGISTERED mutation's own `_handler` against `harness`'s store,
 *  recording the call ORDER — which is the whole assertion here. Anything else
 *  the executor reaches for throws: a bot needing another mutation for these
 *  flows would be a real regression, not a detail. */
function realMutations(harness: MutationStub, calls: string[]): MoveMutations {
    const drive =
        <A>(fn: unknown, name: string) =>
        async (args: A) => {
            calls.push(name);
            return runMutation<A, void>(
                fn as Handler<A, void>,
                harness.ctx,
                args
            );
        };
    const reject = (name: string) => async () => {
        throw new Error(`unexpected mutation ${name} in this flow`);
    };
    const surface: Record<string, unknown> = {
        announceCast: drive(announceCast, "announceCast"),
        selectTargets: drive(selectTargets, "selectTargets"),
        confirmTargets: drive(confirmTargets, "confirmTargets"),
        tapForPayment: drive(tapForPayment, "tapForPayment"),
        activateAbility: drive(activateAbility, "activateAbility"),
    };
    for (const name of [
        "playCard",
        "summonCompanion",
        "turnPermanentFaceUp",
        "selectTarget",
        "activateManaAbility",
        "tapForActivationPayment",
        "selectSacrifice",
        "selectActivationCost",
        "selectActivationExileCost",
        "selectActivationDiscardCost",
        "toggleAttacker",
        "confirmAttackers",
        "selectBlocker",
        "assignBlockerTarget",
        "confirmBlockers",
        "confirmDamage",
        "declareMulligan",
        "submitResolutionChoice",
        "submitMayPay",
        "passPriority",
    ]) {
        surface[name] = reject(name);
    }
    return surface as unknown as MoveMutations;
}

/** The one enumerated move matching `pick`, asserting there is exactly one —
 *  a silently-ambiguous pick would test a different line than the one named. */
function onlyMove(
    state: GameState,
    pick: (m: ReturnType<typeof enumerateMoves>[number]) => boolean
) {
    const matches = enumerateMoves(state, BOT).filter(pick);
    expect(matches).toHaveLength(1);
    return matches[0];
}

describe("an 'up to X' cast declined at ZERO targets completes (CR 601.2c, issue #2870)", () => {
    it("REGRESSION: announce → confirm-only → pay puts the spell on the stack, with no selectTargets and no server error", async () => {
        const state = board({
            hand: [
                makeInstance(PEST_INFESTATION, {
                    id: "pest",
                    controllerId: BOT,
                    ownerId: BOT,
                    zone: "hand",
                }),
            ],
            landCount: 3,
        });
        const move = onlyMove(
            state,
            (m) =>
                m.kind === "cast-spell" &&
                m.cardInstanceId === "pest" &&
                m.chosenX === 1
        );
        // The enumerator half of the fix: a variable-count requirement whose
        // resolved max (1) is NOT reached by the chosen tuple (0) rests for an
        // explicit confirm. Before the fix the non-empty-tuple term made this
        // `false` and the executor sent nothing at all.
        expect(move.kind).toBe("cast-spell");
        if (move.kind !== "cast-spell") throw new Error("unreachable");
        expect(move.targets).toEqual([]);
        expect(move.confirmTargets).toBe(true);

        const harness = makeMutationCtx(BOT, [gameStateSeed(state)]);
        const calls: string[] = [];
        await executeMove(move, {
            gameId: GAME_ID,
            botId: BOT,
            mutations: realMutations(harness, calls),
        });

        // `selectTargets` is absent by rule, not by accident: it rejects an
        // empty array, which is exactly why the confirm must carry the answer.
        expect(calls).toEqual([
            "announceCast",
            "confirmTargets",
            "tapForPayment",
        ]);
        const after = harness.state();
        expect(after.pendingTarget).toBeUndefined();
        expect(after.pendingCast).toBeUndefined();
        expect(after.stack.map((s) => s.card.id)).toEqual([PEST_INFESTATION]);
        expect(after.stack[0].targets ?? []).toEqual([]);
        expect(after.stack[0].chosenX).toBe(1);
    });

    it("the resolved spell still creates twice-X Pest tokens", async () => {
        const state = board({
            hand: [
                makeInstance(PEST_INFESTATION, {
                    id: "pest",
                    controllerId: BOT,
                    ownerId: BOT,
                    zone: "hand",
                }),
            ],
            landCount: 3,
        });
        const move = onlyMove(
            state,
            (m) =>
                m.kind === "cast-spell" &&
                m.cardInstanceId === "pest" &&
                m.chosenX === 1
        );
        const harness = makeMutationCtx(BOT, [gameStateSeed(state)]);
        await executeMove(move, {
            gameId: GAME_ID,
            botId: BOT,
            mutations: realMutations(harness, []),
        });

        const after = harness.state();
        resolveTopOfStack(after);
        // "Create twice X 1/1 ... Pest creature tokens" — X = 1 ⇒ two tokens.
        const tokens = after.players[0].battlefield.filter((c) => c.isToken);
        expect(tokens).toHaveLength(2);
        expect(
            tokens.every(
                (t) =>
                    t.types.includes("Creature") &&
                    t.subtypes?.includes("Pest") &&
                    t.power === 1 &&
                    t.toughness === 1
            )
        ).toBe(true);
    });

    it("an 'up to X' cast FILLED to its max sends no confirm (the last pick already finalized it)", async () => {
        const state = board({
            hand: [
                makeInstance(PEST_INFESTATION, {
                    id: "pest",
                    controllerId: BOT,
                    ownerId: BOT,
                    zone: "hand",
                }),
            ],
            humanBattlefield: [
                makeInstance(ANKH, {
                    id: "ankh",
                    controllerId: HUMAN,
                    ownerId: HUMAN,
                    zone: "battlefield",
                }),
            ],
            landCount: 3,
        });
        // X = 1 with exactly one legal artifact: the tuple reaching max (1) is
        // auto-finalized by `selectTargets`, so a trailing confirm would throw
        // "No target selection in progress". The old predicate declared
        // `confirmTargets: true` here for the same reason it declared `false`
        // above — it never read the resolved count at all.
        const move = onlyMove(
            state,
            (m) =>
                m.kind === "cast-spell" &&
                m.cardInstanceId === "pest" &&
                m.chosenX === 1 &&
                m.targets.length === 1
        );
        if (move.kind !== "cast-spell") throw new Error("unreachable");
        expect(move.confirmTargets).toBe(false);

        const harness = makeMutationCtx(BOT, [gameStateSeed(state)]);
        const calls: string[] = [];
        await executeMove(move, {
            gameId: GAME_ID,
            botId: BOT,
            mutations: realMutations(harness, calls),
        });
        expect(calls).toEqual([
            "announceCast",
            "selectTargets",
            "tapForPayment",
        ]);
        const after = harness.state();
        expect(after.pendingTarget).toBeUndefined();
        expect(after.stack.map((s) => s.card.id)).toEqual([PEST_INFESTATION]);
        expect(after.stack[0].targets?.map((t) => t.id)).toEqual(["ankh"]);
    });

    it("a FIXED-count requirement still auto-finalizes on the last pick, with no confirm", async () => {
        const state = board({
            hand: [
                makeInstance(BOLT, {
                    id: "bolt",
                    controllerId: BOT,
                    ownerId: BOT,
                    zone: "hand",
                }),
            ],
            humanBattlefield: [
                makeInstance(BEARS, {
                    id: "bears",
                    controllerId: HUMAN,
                    ownerId: HUMAN,
                    zone: "battlefield",
                }),
            ],
            landId: MOUNTAIN,
            landCount: 1,
        });
        const move = onlyMove(
            state,
            (m) =>
                m.kind === "cast-spell" &&
                m.cardInstanceId === "bolt" &&
                m.targets.length === 1 &&
                m.targets[0].id === "bears"
        );
        if (move.kind !== "cast-spell") throw new Error("unreachable");
        expect(move.confirmTargets).toBe(false);

        const harness = makeMutationCtx(BOT, [gameStateSeed(state)]);
        const calls: string[] = [];
        await executeMove(move, {
            gameId: GAME_ID,
            botId: BOT,
            mutations: realMutations(harness, calls),
        });
        expect(calls).toEqual([
            "announceCast",
            "selectTargets",
            "tapForPayment",
        ]);
        expect(harness.state().stack.map((s) => s.card.id)).toEqual([BOLT]);
    });
});

describe("an 'up to N' ACTIVATED ability declined at zero targets completes (CR 602.2b, issue #2870)", () => {
    it("REGRESSION: Teferi's -3 with no artifact, creature or enchantment in play confirms zero targets", async () => {
        const state = board({
            botBattlefield: [
                makeInstance(TEFERI, {
                    id: "teferi",
                    controllerId: BOT,
                    ownerId: BOT,
                    zone: "battlefield",
                    counters: { loyalty: 4 },
                }),
            ],
        });
        const move = onlyMove(
            state,
            (m) =>
                m.kind === "activate-ability" &&
                m.abilityId === "teferi-time-raveler-minus3"
        );
        if (move.kind !== "activate-ability") throw new Error("unreachable");
        // A Planeswalker is not an Artifact, Creature or Enchantment, so
        // Teferi himself is no legal target and the board offers nothing else:
        // zero targets is the only answer, and it is confirm-only.
        expect(move.targets).toEqual([]);
        expect(move.confirmTargets).toBe(true);

        const harness = makeMutationCtx(BOT, [gameStateSeed(state)]);
        const calls: string[] = [];
        await executeMove(move, {
            gameId: GAME_ID,
            botId: BOT,
            mutations: realMutations(harness, calls),
        });
        expect(calls).toEqual(["activateAbility", "confirmTargets"]);
        const after = harness.state();
        expect(after.pendingTarget).toBeUndefined();
        expect(after.pendingActivation).toBeUndefined();
        expect(after.stack).toHaveLength(1);
        expect(after.stack[0].targets ?? []).toEqual([]);
    });

    it("the same ability FILLED to its max sends no confirm (#2905 review, item: the cast arm's ability twin)", async () => {
        const state = board({
            botBattlefield: [
                makeInstance(TEFERI, {
                    id: "teferi",
                    controllerId: BOT,
                    ownerId: BOT,
                    zone: "battlefield",
                    counters: { loyalty: 4 },
                }),
            ],
            humanBattlefield: [
                makeInstance(BEARS, {
                    id: "bears",
                    controllerId: HUMAN,
                    ownerId: HUMAN,
                    zone: "battlefield",
                }),
            ],
        });
        // `{ min: 0, max: 1 }` with exactly one legal creature: the single pick
        // reaches max and `selectTargets` auto-finalizes it, so a trailing
        // confirm would throw. This is the arm break #3 of the proof-of-failure
        // table exercises on the CAST path — the ability path deserves its own,
        // since it reads a different `lastReq`.
        const move = onlyMove(
            state,
            (m) =>
                m.kind === "activate-ability" &&
                m.abilityId === "teferi-time-raveler-minus3" &&
                m.targets.length === 1
        );
        if (move.kind !== "activate-ability") throw new Error("unreachable");
        expect(move.confirmTargets).toBe(false);

        const harness = makeMutationCtx(BOT, [gameStateSeed(state)]);
        const calls: string[] = [];
        await executeMove(move, {
            gameId: GAME_ID,
            botId: BOT,
            mutations: realMutations(harness, calls),
        });
        expect(calls).toEqual(["activateAbility", "selectTargets"]);
        const after = harness.state();
        expect(after.pendingTarget).toBeUndefined();
        expect(after.stack).toHaveLength(1);
        expect(after.stack[0].targets?.map((t) => t.id)).toEqual(["bears"]);
    });
});

describe("a divide-as-you-choose spell at a ZERO budget takes no targets (CR 601.2d, #2905 review item 2)", () => {
    it("REGRESSION: Spoils of War at X = 0 enumerates the empty tuple, so no selectTargets fires against an unopened selection", async () => {
        const state = board({
            hand: [
                makeInstance(SPOILS_OF_WAR, {
                    id: "spoils",
                    controllerId: BOT,
                    ownerId: BOT,
                    zone: "hand",
                }),
            ],
            humanBattlefield: [
                makeInstance(BEARS, {
                    id: "bears",
                    controllerId: HUMAN,
                    ownerId: HUMAN,
                    zone: "battlefield",
                }),
            ],
            landId: SWAMP,
            landCount: 3,
        });
        // "Distribute X +1/+1 counters among any number of target creatures":
        // `count: { min: 1 }` with the budget as the real cap. Both graveyards
        // are empty, so X = 0 — CR 601.2d leaves nothing to divide and
        // `announceCast` opens NO selection. The count alone cannot see that,
        // so the enumerator used to emit a 1-target tuple; the executor's
        // `selectTargets` is gated on the tuple being non-empty rather than on
        // `confirmTargets`, so it fired against no selection and threw.
        // The whole enumerated table, since each row exercises a different arm
        // of the SAME predicate against the divide budget (CR 601.2d):
        //   X = 0 → budget 0 ⇒ no selection at all, so no targets, no confirm;
        //   X = 1 → count capped to { min: 1, max: 1 } ⇒ the pick auto-finalizes;
        //   X = 2 → count capped to { min: 1, max: 2 } ⇒ one pick rests.
        // Before the fix the X = 0 row read `targets: ["bears"], confirm: true`.
        const rows = enumerateMoves(state, BOT)
            .filter((m) => m.kind === "cast-spell")
            .map((m) =>
                m.kind === "cast-spell"
                    ? {
                          x: m.chosenX ?? 0,
                          targets: m.targets.map((t) => t.id),
                          confirm: m.confirmTargets,
                      }
                    : null
            );
        expect(rows).toEqual([
            { x: 0, targets: [], confirm: false },
            { x: 1, targets: ["bears"], confirm: false },
            { x: 2, targets: ["bears"], confirm: true },
        ]);

        const move = onlyMove(
            state,
            (m) =>
                m.kind === "cast-spell" &&
                m.cardInstanceId === "spoils" &&
                (m.chosenX ?? 0) === 0
        );
        if (move.kind !== "cast-spell") throw new Error("unreachable");

        const harness = makeMutationCtx(BOT, [gameStateSeed(state)]);
        const calls: string[] = [];
        await executeMove(move, {
            gameId: GAME_ID,
            botId: BOT,
            mutations: realMutations(harness, calls),
        });
        expect(calls).toEqual(["announceCast", "tapForPayment"]);
        const after = harness.state();
        expect(after.pendingTarget).toBeUndefined();
        expect(after.stack.map((s) => s.card.id)).toEqual([SPOILS_OF_WAR]);
    });
});
