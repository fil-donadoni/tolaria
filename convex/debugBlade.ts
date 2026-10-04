import { v } from "convex/values";
import { assertIsAdmin } from "./auth";
import { mutation, query } from "./_generated/server";
import { bladeLoadBotSeatId } from "./matches";
import { getLatestGameState, saveGameState } from "./gameStateStore";
import { withStatePrintIds } from "./deckStore";
import type { GameState } from "./gre/state";
import { BLADE_SCENARIOS } from "./gre/ai/blade/registry";
import { resolveBladeLoadState } from "./gre/ai/blade/runner";
import { describeExpectation } from "./gre/ai/blade/matcher";

// The blade-scenario debug endpoints (issue #1432, PRD #1423), moved out of
// `game.ts` (issue #4855): `BLADE_SCENARIOS` is the Bot's whole test corpus
// (~1.5 MiB of heap), and every gameplay call paid for it in `game.ts`'s
// module graph though only an admin's debug panel ever reads it.

/**
 * List the code-side blade-scenario registry (issue #1432, PRD #1423):
 * metadata only (`label`/`tier`/`note`), never the `spec` — the browser
 * loader below resolves the `spec` server-side by label, so the registry —
 * not the client — stays the sole source of what gets applied to a board.
 * Admin-gated like every other debug endpoint (issue #768).
 */
export const debugListBladeScenarios = query({
    args: {},
    returns: v.array(
        v.object({
            label: v.string(),
            tier: v.union(v.literal("must"), v.literal("stretch")),
            note: v.optional(v.string()),
            /** The entry's declared ITERATIONS budget (issue #3443). Shown in
             *  the panel so a bot that does not make the play can be told
             *  apart from a browser difficulty preset searching at fewer
             *  iterations than the entry demands — the two look identical on
             *  the board and only one of them is a bug. */
            budget: v.number(),
            /** One-line rendering of `expect` (`describeExpectation`), so the
             *  developer knows what the position is asking before they load
             *  it. */
            expectation: v.string(),
            /** The `beyondBudget` verdict's cause + note, when the entry
             *  carries one: this position is KNOWN not to be solved at its
             *  declared budget, which is the other reason the Bot may sit on
             *  its hands after a load. */
            beyondBudget: v.optional(v.string()),
        })
    ),
    handler: async (ctx) => {
        await assertIsAdmin(ctx);
        return BLADE_SCENARIOS.map((s) => ({
            label: s.label,
            tier: s.tier,
            note: s.note,
            budget: s.budget.iterations,
            expectation: describeExpectation(s.expect),
            beyondBudget: s.beyondBudget
                ? `${s.beyondBudget.cause}: ${s.beyondBudget.note}`
                : undefined,
        }));
    },
});

/**
 * READ-ONLY browser loader for a blade scenario (issue #1432, PRD #1423).
 * Loads one entry's position into the CURRENT solo game so a developer can
 * eyeball it, through `resolveBladeLoadState`
 * (`convex/gre/ai/blade/runner.ts`) — which resolves `label` against the
 * code-side registry, then normalizes the CURRENT game's snapshot onto the
 * same starting position `buildBladeBaseState` produces (active/priority
 * player = the "me" seat, starting life, every turn-/game-scoped field back
 * to its start-of-game value — see that function's doc comment for the full
 * list), then applies the entry's `spec` through the same
 * `buildStateFromScenario` the DB-backed scenario loader
 * (`debugSetupScenario` above) and the blade test harness both use. Without
 * that normalization, a live game's turn/life/counter state would leak into
 * the loaded position, diverging it from the one the blade harness actually
 * built and the entry's `expect` was written against (issue #1432 review,
 * both rounds).
 *
 * Deliberately NOT the `debugScenarios` DB path: `label` only selects an
 * entry from the code-side registry — the client never supplies a `spec` —
 * so there is no DB row to write, edit, or delete. A blade entry is a
 * regression assertion that lives in git with the engine change it guards
 * (PRD #1423), never DB-seeded.
 */
export const debugLoadBladeScenario = mutation({
    args: {
        gameId: v.id("games"),
        label: v.string(),
    },
    returns: v.object({
        /** True when this load turned a plain solo game into a vs-AI one
         *  (issue #3443) — the panel says so, because it is a permanent change
         *  to the developer's game, not a per-load mode. */
        convertedToVsAi: v.boolean(),
        /** The seat the entry's position was oriented onto. */
        botPlayerId: v.string(),
    }),
    handler: async (ctx, args) => {
        // Admin-only debug board setup (CLAUDE.md privileged-mutation
        // convention, issue #768) — same gate as `debugSetupScenario`.
        await assertIsAdmin(ctx);

        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");

        // WHICH GAME can hold a blade position (issue #3443). A blade entry is
        // a question about the BRAIN, so the game it lands in has to have one.
        // The `games` row is the authority for both facts — it is immutable in
        // seat order and seat ids, where `gameState.state.players` is not: this
        // very loader reorders that array to orient the position, so a second
        // load that read the bot seat off the snapshot would read the seat it
        // had just moved.
        const game = await ctx.db.get(args.gameId);
        if (!game) throw new Error("Game not found");
        const botPlayerId = bladeLoadBotSeatId(game);

        // Label lookup + state build both live in `resolveBladeLoadState`
        // (`gre/ai/blade/runner.ts`) — this handler is a thin wrapper around
        // it (ctx / admin gate / fetch / persist only), so the pure-function
        // test suite in `convex/__tests__/debugLoadBladeScenario.test.ts`
        // exercises the exact code this mutation runs (issue #1432 review
        // round 2, finding #1). It throws when the built position owes the
        // bot seat nothing — before this handler has written anything, and in
        // any case a Convex mutation that throws applies none of its writes,
        // so a refusal can never leave a converted game behind.
        const state = resolveBladeLoadState(
            gameState.state as GameState,
            args.label,
            botPlayerId
        );

        // A solo game becomes a vs-AI game, permanently, on both the Game and
        // its Match: with no Brain driving the second seat the entry measures
        // nothing at all, and there is no per-load mode to put it in.
        const convertedToVsAi = game.vsAi !== true;
        if (convertedToVsAi) {
            await ctx.db.patch(args.gameId, {
                vsAi: true,
                updatedAt: Date.now(),
            });
            if (game.matchId) {
                await ctx.db.patch(game.matchId, {
                    vsAi: true,
                    updatedAt: Date.now(),
                });
            }
            // The `gameStates` mode mirror (see `gameStates` in
            // `convex/schema.ts`) is stamped once, at INSERT — and this game
            // already has its row, so `saveGameState` below will PATCH it and
            // never revisit the flags. `getPublicState` reads them off that row
            // and would keep picking the solo viewer, which follows whoever
            // owes input: the human's view would jump to the bot's seat on
            // every beat. Written here, BEFORE the save, so the very first
            // snapshot the client reads after this mutation already carries it.
            // BOTH flags, not just the one that changed: a row written before
            // the mirror existed carries NEITHER, and that pair — not `false` —
            // is the legacy marker `getPublicState` falls back on and
            // `backfillGameStateMode` looks for. Writing `vsAi` alone would
            // leave `solo: undefined` beside a defined `vsAi` forever, a shape
            // neither reader has a case for. `solo` is known true here: the
            // game-kind check above refused anything else.
            await ctx.db.patch(gameState._id, { solo: true, vsAi: true });
        }

        await ctx.db.patch(args.gameId, {
            cardIds: withStatePrintIds(game.cardIds, state),
        });
        await saveGameState(
            ctx,
            args.gameId,
            gameState.seq + 1,
            state,
            gameState
        );
        return { convertedToVsAi, botPlayerId };
    },
});
