// The `check:ui` lane's test-only seam — its server half (issue #9271,
// ADR 0180).
//
// THE ONE MODULE lane shortcuts' queries and mutations live in. A shortcut
// that jumps the lane straight to a state (a declared position, the end of a
// mocked draft, sideboarding between games) adds its function HERE, and
// nowhere else, so it inherits the security model instead of re-deciding it.
//
// THE CONTRACT, enforced by `convex/__tests__/uiSeam.test.ts`:
//   - every export is a public `query` or `mutation` (no action: the gate
//     reads `ctx.db`; no internal function: deploy access needs no seam);
//   - every handler's FIRST statement awaits `assertUiSeamCaller(ctx)` —
//     local deployment AND lane account, before any read or write of its own
//     (`lib/uiSeamGate.ts`).
//
// Client routes and query parameters that call these live under the shared
// namespace (`lib/uiSeamNamespace.ts`), registered only in a DEV bundle.
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { normalizeScenarioSpec } from "./debugScenarioSpec";
import { findActiveGameForUser } from "./gameLifecycle";
import { getLatestGameState } from "./gameStateStore";
import { hydrateSeat } from "./limitedSeatStore";
import { forceBo3Sideboarding } from "./lib/forceBo3Sideboarding";
import { loadScenarioIntoGame } from "./lib/scenarioLoad";
import { UI_SEAM_NO_SOLO_GAME_IN_PLAY } from "./lib/uiSeamNamespace";
import {
    fixtureSeatDeck,
    isLanePositionGame,
    positionStillLoaded,
} from "./lib/uiSeamShortcuts";
import { assertUiSeamCaller } from "./lib/uiSeamGate";
import { runIdOfLaneEmail } from "./lib/uiGateLaneAccount";
import { insertUserDeck } from "./userDecks";

/** The trivial seam function: proves both gates end to end and touches no
 *  state. The echo route (`/__uiseam/echo`) renders its answer. */
export const echo = query({
    args: { value: v.optional(v.string()) },
    returns: v.object({
        runId: v.union(v.string(), v.null()),
        value: v.union(v.string(), v.null()),
    }),
    handler: async (ctx, args) => {
        const user = await assertUiSeamCaller(ctx);
        return {
            runId: user.email ? runIdOfLaneEmail(user.email) : null,
            value: args.value ?? null,
        };
    },
});

/**
 * Load the declared position `label` (a `debugScenarios` row) into the lane's
 * OWN solo game (issue #9272) — the Debug sheet's Scenarios load, minus the
 * five clicks: the same shared build (`lib/scenarioLoad.ts`) with the same
 * refusals, reached in one navigation through `/__uiseam/position`.
 *
 * Only the caller's active SOLO game, and only once it is `playing` (its
 * snapshot exists past the pregame gate). A two-seat game has another account
 * in it — the run's join table belongs to the host account, and the lane only
 * views it — and the seam never writes a game another account plays in.
 *
 * `unlessAt` makes a repeat load free: it is the game and `seq` an earlier
 * load of the SAME label returned, and when that same game still stands at
 * that `seq` nothing has been saved since — the board IS that position, so it
 * is not rebuilt. Any intervening save (a pass, a cast, a priority change)
 * bumps `seq`, and a game dealt afresh is a different id: either way the
 * position is loaded again.
 */
export const loadPosition = mutation({
    args: {
        label: v.string(),
        unlessAt: v.optional(v.object({ gameId: v.string(), seq: v.number() })),
    },
    returns: v.object({
        gameId: v.id("games"),
        seq: v.number(),
        loaded: v.boolean(),
    }),
    handler: async (ctx, args) => {
        const user = await assertUiSeamCaller(ctx);
        const game = await findActiveGameForUser(ctx, user._id);
        if (!game || !isLanePositionGame(game)) {
            throw new Error(
                `ui seam: the lane account has ${UI_SEAM_NO_SOLO_GAME_IN_PLAY} to load "${args.label}" into — the lane deals one through the lobby first`
            );
        }
        const current = await getLatestGameState(ctx, game._id);
        if (!current) {
            throw new Error(
                `ui seam: the lane's solo game has no saved state yet to load "${args.label}" over`
            );
        }
        if (
            positionStillLoaded(args.unlessAt, {
                gameId: game._id,
                seq: current.seq,
            })
        ) {
            return { gameId: game._id, seq: current.seq, loaded: false };
        }
        const row = await ctx.db
            .query("debugScenarios")
            .withIndex("by_label", (q) => q.eq("label", args.label))
            .first();
        if (!row) {
            throw new Error(
                `ui seam: debug scenario "${args.label}" is absent from this deployment — the lane seeds it at bootstrap (debugScenarios:seedScenarioDirect)`
            );
        }
        const seq = await loadScenarioIntoGame(
            ctx,
            game._id,
            normalizeScenarioSpec(row.spec)
        );
        return { gameId: game._id, seq, loaded: true };
    },
});

/**
 * Save the caller's seat of the Limited fixture `label` as a Limited deck
 * (issue #9272) — the deck a builder "Done" would save from that seat's
 * untouched Pool, without driving the builder: every Pool card in the
 * Maindeck (a draft seat with no Pool Arrangement keeps them all there,
 * `continuousWorkingDeck`), colours from the cards, and the SAME insert the
 * builder's `userDecks.create` runs (`insertUserDeck`: seat ownership, Limited
 * Origin, the Deck Pool, the play-phase check). Idempotent: a seat that
 * already has its deck keeps it, so a repeat row is a lookup.
 *
 * Only a fixture the caller is seated at — the lane's own run-scoped labels.
 */
export const saveLimitedFixtureDeck = mutation({
    args: { label: v.string(), name: v.string() },
    returns: v.object({ deckId: v.id("userDecks"), created: v.boolean() }),
    handler: async (ctx, args) => {
        const user = await assertUiSeamCaller(ctx);
        const event = await ctx.db
            .query("limitedEvents")
            .withIndex("by_label", (q) => q.eq("label", args.label))
            .first();
        if (!event) {
            throw new Error(
                `ui seam: Limited fixture "${args.label}" is absent from this deployment — the lane seeds it at bootstrap (limitedFixtures:seedUiGateFixtures)`
            );
        }
        const seat = event.seats.find((s) => s.userId === user._id);
        if (!seat) {
            throw new Error(
                `ui seam: the lane account holds no seat at Limited fixture "${args.label}"`
            );
        }
        const existing = await ctx.db
            .query("userDecks")
            .withIndex("by_limitedEvent", (q) =>
                q.eq("limitedEventId", event._id)
            )
            .collect();
        const mine = existing.find(
            (d) =>
                d.userId === user._id &&
                d.limitedSeatId === String(seat.seatIndex)
        );
        if (mine) return { deckId: mine._id, created: false };

        const [hydrated] = (
            await hydrateSeat(ctx, event, seat.seatIndex)
        ).filter((s) => s.seatIndex === seat.seatIndex);
        const deckId = await insertUserDeck(
            ctx,
            user._id,
            fixtureSeatDeck(
                hydrated?.pool ?? [],
                { eventId: event._id, seatIndex: seat.seatIndex },
                args.name
            )
        );
        return { deckId, created: true };
    },
});

/**
 * The event id of the Limited fixture `label` (issue #9560): where a Limited
 * screen's deep link lands (`/limited/<id>`, `/draft`, `/build`) without the
 * event list's `?label=` filter and View click. Only a fixture the caller is
 * seated at — the lane's own run-scoped labels.
 */
export const limitedFixtureEvent = query({
    args: { label: v.string() },
    returns: v.id("limitedEvents"),
    handler: async (ctx, args) => {
        const user = await assertUiSeamCaller(ctx);
        const event = await ctx.db
            .query("limitedEvents")
            .withIndex("by_label", (q) => q.eq("label", args.label))
            .first();
        if (!event) {
            throw new Error(
                `ui seam: Limited fixture "${args.label}" is absent from this deployment — the lane seeds it at bootstrap (limitedFixtures:seedUiGateFixtures)`
            );
        }
        if (!event.seats.some((s) => s.userId === user._id)) {
            throw new Error(
                `ui seam: the lane account holds no seat at Limited fixture "${args.label}"`
            );
        }
        return event._id;
    },
});

/**
 * Put the lane's OWN solo game's Match at the Bo3 sideboarding gate (issue
 * #9560) — the Debug panel's "Bo3 Sideboard" (`forceBo3Sideboarding`, the
 * shared body): Game 1 recorded for the second seat, score 0–1, the Game
 * ended, so the board opens the Game-Over interstitial one click from the
 * Sideboarding step.
 *
 * Same game rule as `loadPosition`: the caller's active SOLO game past its
 * pregame, never a table another account plays in.
 */
export const forceSideboarding = mutation({
    args: {},
    returns: v.object({ gameId: v.id("games") }),
    handler: async (ctx) => {
        const user = await assertUiSeamCaller(ctx);
        const game = await findActiveGameForUser(ctx, user._id);
        if (!game || !isLanePositionGame(game)) {
            throw new Error(
                `ui seam: the lane account has ${UI_SEAM_NO_SOLO_GAME_IN_PLAY} to put at the sideboarding gate — the lane deals one through the lobby first`
            );
        }
        await forceBo3Sideboarding(ctx, game._id);
        return { gameId: game._id };
    },
});
