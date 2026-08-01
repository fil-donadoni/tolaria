// Integration: a hand-size read survives the CLIENT reducer chain the vs-AI
// Brain runs on — `projectPublicState` → `projectedToGameState` (ADR 0074,
// issue #2006).
//
// A hand's CONTENTS are hidden but its SIZE is public information (CR 402.2),
// which is the whole reason a card may read it. The projection honours that: a
// non-viewer's hand crosses the wire as a `null[]` of the right LENGTH. The
// state adapter used to DROP those nulls, so in a client-side engine run every
// hand-size read returned 0 for any player but the viewer — a whole class of
// cards priced and simulated wrong by the Brain, silently, with the server-side
// tests all green.
//
// Why the proof lives HERE rather than beside each card. `projectedToGameState`
// is a bot-only module (`scripts/__tests__/bot-suite-boundary.test.ts`), so an
// APPLICATION test may not import it. The per-card / per-Op tests
// (`convex/cards/sets/pls/__tests__/black.test.ts`,
// `convex/gre/effects/__tests__/interpreter.test.ts`) own the SERVER leg — the
// effect computes correctly on the fat state and the projection carries the
// result. This file owns the CLIENT leg, which is where the bug actually was.
//
// Two independent reader families, one bug and one fix:
//   * Effect Script `count { zone: "hand" }` + `difference` — Dark Suspicions.
//   * `ctx.getHandSize` inside a `resolve()` closure — Storm Seeker here, and
//     with it The Rack, Storm World and Ivory Tower, all repaired by the same
//     padding because they all read the same rehydrated pile.

import { describe, expect, it } from "vitest";
import { projectPublicState } from "@convex/gameProjections";
import { resolveTopOfStack } from "@convex/gre/state";
import { enumerateMoves, PLACEHOLDER_CARD_ID } from "@convex/gre";
import type { CardInstanceState, GameState, StackItem } from "@convex/gre";
import { contextAwareGroundingForChoice } from "@convex/gre/ai/candidateValue";
import type { EffectValue } from "@convex/cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "@convex/cards/__tests__/setup";
import { grizzlyBears } from "@convex/cards/sets/lea";
import { darkSuspicions } from "@convex/cards/sets/pls/black";
import { stormSeeker } from "@convex/cards/sets/leg/green";
import { projectedToGameState } from "../state-adapter";

/** `n` filler cards in `owner`'s hand. */
function handCards(owner: string, n: number): CardInstanceState[] {
    return Array.from({ length: n }, (_, i) =>
        makeInstance(grizzlyBears.id, {
            id: `${owner}-hand-${i}`,
            controllerId: owner,
            ownerId: owner,
            zone: "hand",
        })
    );
}

/** Dark Suspicions under p1, with the two hands sized as given. */
function board(p1Hand: number, p2Hand: number): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: [
                    makeInstance(darkSuspicions.id, {
                        id: "dark-suspicions",
                        controllerId: "p1",
                        ownerId: "p1",
                    }),
                ],
                hand: handCards("p1", p1Hand),
            }),
            makePlayer("p2", { hand: handCards("p2", p2Hand) }),
        ],
    });
}

/** The full client chain: project from `viewerId`'s seat, then rehydrate the
 *  wire view into the search world the Brain actually runs the engine on. */
function throughClientReducers(state: GameState, viewerId: string): GameState {
    return projectedToGameState(projectPublicState(state, 1, viewerId));
}

/** Push Dark Suspicions' upkeep trigger and resolve it — the per-set shim
 *  `pls/__tests__/black.test.ts` uses, applied to a REHYDRATED world. */
function fireUpkeepTrigger(state: GameState, activePlayerId: string): void {
    const source = state.players
        .flatMap((p) => p.battlefield)
        .find((c) => c.id === "dark-suspicions")!;
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        triggeredAbilityId: "dark-suspicions-upkeep",
        triggerSourceId: source.id,
        triggerEvent: {
            type: "PHASE_BEGIN",
            phase: "UPKEEP",
            activePlayerId,
        },
        targets: [],
    } as unknown as StackItem);
    resolveTopOfStack(state);
}

describe("hand size survives the client reducer chain (CR 402.2, issue #2006)", () => {
    it("projectPublicState → projectedToGameState preserves both hands' cardinality", () => {
        const world = throughClientReducers(board(1, 4), "p1");
        // The viewer's own hand is real; the opponent's is opaque — but BOTH
        // have the size the fat state had.
        expect(world.players[0].hand).toHaveLength(1);
        expect(world.players[1].hand).toHaveLength(4);
        expect(
            world.players[1].hand.every(
                (c) => (c.card as { id: string }).id === PLACEHOLDER_CARD_ID
            )
        ).toBe(true);
        expect(
            world.players[0].hand.every(
                (c) => (c.card as { id: string }).id !== PLACEHOLDER_CARD_ID
            )
        ).toBe(true);
    });

    // ── Effect Script: count { zone: "hand" } + difference ──────────────────

    it("Dark Suspicions resolves to the SAME life loss in the bot's rehydrated world as on the server", () => {
        // Server (fat) result.
        const server = board(1, 4);
        fireUpkeepTrigger(server, "p2");
        expect(server.players[1].life).toBe(17);

        // Client, bot = p1 (the enchantment's controller). The OPPONENT's hand
        // is the nulled one; dropping it made X = 0 − 1 and the card a no-op.
        const asController = throughClientReducers(board(1, 4), "p1");
        fireUpkeepTrigger(asController, "p2");
        expect(asController.players[1].life).toBe(17);
    });

    it("Dark Suspicions does not INFLATE the loss when the bot is on the receiving end", () => {
        // Client, bot = p2. Now the CONTROLLER's hand (the subtrahend) is the
        // nulled one; dropping it made X = 4 − 0 = 4, an over-estimated
        // incoming life loss the bot would defend against too hard.
        const asVictim = throughClientReducers(board(1, 4), "p2");
        fireUpkeepTrigger(asVictim, "p2");
        expect(asVictim.players[1].life).toBe(17);
    });

    it("CR 107.1b — an equal-hands zero stays zero through the reducers", () => {
        const world = throughClientReducers(board(3, 3), "p1");
        fireUpkeepTrigger(world, "p2");
        expect(world.players[1].life).toBe(20);
    });

    // ── resolve() closures: ctx.getHandSize ─────────────────────────────────

    it("a ctx.getHandSize reader (Storm Seeker) reads the opponent's real hand size in the rehydrated world", () => {
        // Same bug class as The Rack / Storm World / Ivory Tower: they all read
        // `ctx.getHandSize` off the pile this adapter rebuilds.
        const world = throughClientReducers(board(1, 4), "p1");
        pushSpell(world, stormSeeker.id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(world);
        expect(world.players[1].life).toBe(16);
    });

    // ── Bot pricing (candidateValue.resolveValueAgainstBoard) ───────────────

    it("the bot PRICES a hand-difference amount off the rehydrated world, not off zero", () => {
        const world = throughClientReducers(board(1, 4), "p1");
        const value: EffectValue = {
            difference: {
                from: { count: { zone: "hand", controller: "opponent" } },
                minus: { count: { zone: "hand", controller: "controller" } },
            },
        };
        // 4 − 1 = 3. Pre-fix this ground out at 0 − 0 = 0 and Dark Suspicions
        // priced as a dead card in the search's prior.
        expect(
            contextAwareGroundingForChoice(world, "p1").value(value).amount
        ).toBe(3);
    });

    // ── The padding must not hand the bot anything to act on ────────────────

    it("padded opponent-hand placeholders never become legal moves", () => {
        const world = throughClientReducers(board(1, 4), "p1");
        // Give p2 priority in a main phase so enumeration would offer every
        // playable card in their hand if the placeholders were actionable.
        world.activePlayerId = "p2";
        world.priorityPlayerId = "p2";
        expect(enumerateMoves(world, "p2")).toEqual([{ kind: "pass" }]);
        // And nothing the bot itself can do names one either.
        const placeholderIds = new Set(world.players[1].hand.map((c) => c.id));
        for (const move of enumerateMoves(world, "p1")) {
            for (const v of Object.values(move as Record<string, unknown>)) {
                expect(placeholderIds.has(v as string)).toBe(false);
            }
        }
    });
});
