// Regression tests for issue #2240 — `buildAutoTapSources` blanket-excluded
// ANY source whose mana ability carries `getManaChoices` (a hook) from auto-
// tap, regardless of whether that specific chooser needed cross-player board
// data at all. A Verge land (DSK/DFT cycle) reads only the CONTROLLER's own
// battlefield to decide whether its second colour is unlocked, so the
// exclusion silently made it manual-only even for its always-on PRIMARY
// colour — the reported bug ("Thornspine verge non viene auto-tappato anche
// se era stato calcolato correttamente per la castability").
//
// The root cause is deeper than "the exclusion is too broad": the payment
// primitive (`tapSourceIntoPayment` / `resolveManaTapChoice`, `game.ts`)
// always resolves a submitted `manaChoiceIndex` against the FULL multi-player
// board snapshot (`manaGateBattlefields(state)`), while `buildAutoTapSources`
// only ever saw the paying player's OWN battlefield. Even a card that reads
// no board state at all (a Mana Battery — its `getManaChoices` reads only its
// own counters) was excluded by the blanket skip. The fix threads the same
// full snapshot into `buildAutoTapSources`, so a board-derived chooser
// (`getManaChoices` OR the declarative `manaColorSource` — Fellwar Stone) is
// enumerated from the SAME data the payment primitive resolves against, and
// is excluded only when no such snapshot is available at all.
//
// These tests drive the REAL `autoTapForPayment` mutation (`gameMutationHarness`
// — this project has no convex-test harness, see `tapForPaymentBatch.test.ts`),
// never a hand-assembled plan: the bug is specifically that the PLANNER and
// the PAYMENT PRIMITIVE could disagree about an option's existence or index,
// and only driving both through the real mutation proves they now agree.

import { describe, it, expect } from "vitest";
import { autoTapForPayment } from "../game";
import { buildAutoTapSources } from "../gre/autoTap";
import { manaGateBattlefields } from "../gre/constants";
import { makeInstance, makePlayer, makeState } from "../cards/__tests__/setup";
import { thornspireVerge } from "../cards/sets/dsk";
import { fellwarStone } from "../cards/sets/drk";
import { grizzlyBears, mountain as leaMountain } from "../cards/sets/lea";
import { getCardByName } from "../cards";
import type { GameState, PendingCast } from "../gre/state";
import type { Id } from "../_generated/dataModel";
import {
    makeMutationCtx,
    runMutation,
    gameStateSeed,
    type Handler,
} from "./gameMutationHarness";

const GAME_ID = "game-1" as Id<"games">;
const MOUNTAIN = leaMountain.id;
const SWAMP = getCardByName("Swamp").id;

type AutoTapArgs = { gameId: Id<"games">; playerId: string };

const runAutoTapForPayment = (ctx: Parameters<typeof runMutation>[1]) =>
    runMutation<AutoTapArgs, void>(
        autoTapForPayment as unknown as Handler<AutoTapArgs, void>,
        ctx,
        { gameId: GAME_ID, playerId: "p1" }
    );

/** A hand card whose OWN printed cost is irrelevant — `pendingCast.manaCost`
 *  overrides it, matching the established pattern in
 *  `tapForPaymentBatch.test.ts`. */
function stateWithPendingCast(
    battlefield: GameState["players"][number]["battlefield"],
    manaCost: PendingCast["manaCost"],
    opponentBattlefield: GameState["players"][number]["battlefield"] = []
): GameState {
    const cast = makeInstance(grizzlyBears.id, {
        id: "spell",
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
    });
    const pendingCast: PendingCast = {
        playerId: "p1",
        cardInstanceId: "spell",
        manaCost,
        tappedLandIds: [],
    };
    return makeState({
        players: [
            makePlayer("p1", { battlefield, hand: [cast] }),
            makePlayer("p2", { battlefield: opponentBattlefield }),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        pendingCast,
    });
}

describe("buildAutoTapSources — Verge land (getManaChoices, own-board chooser, issue #2240)", () => {
    it("unlocked: emits BOTH colour options, indices matching the unified getManaTapOptionsDetailed list", () => {
        const verge = makeInstance(thornspireVerge.id, {
            id: "verge",
            controllerId: "p1",
        });
        const mtn = makeInstance(MOUNTAIN, {
            id: "mtn",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [verge, mtn] }),
                makePlayer("p2"),
            ],
        });
        const sources = buildAutoTapSources(
            state.players[0].battlefield,
            manaGateBattlefields(state)
        );
        const vergeSource = sources.find((s) => s.cardId === "verge");
        expect(vergeSource).toBeDefined();
        expect(vergeSource!.options).toEqual([
            { manaChoiceIndex: 0, mana: { R: 1 } },
            { manaChoiceIndex: 1, mana: { G: 1 } },
        ]);
    });

    it("locked: exposes ONLY the primary colour — the gated option must not appear", () => {
        const verge = makeInstance(thornspireVerge.id, {
            id: "verge",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [verge] }),
                makePlayer("p2"),
            ],
        });
        const sources = buildAutoTapSources(
            state.players[0].battlefield,
            manaGateBattlefields(state)
        );
        const vergeSource = sources.find((s) => s.cardId === "verge");
        expect(vergeSource).toBeDefined();
        expect(vergeSource!.options).toEqual([
            { manaChoiceIndex: 0, mana: { R: 1 } },
        ]);
    });

    it("end to end: a spell payable ONLY through the unlocked gated colour auto-taps and fully pays via the REAL autoTapForPayment mutation", async () => {
        const verge = makeInstance(thornspireVerge.id, {
            id: "verge",
            controllerId: "p1",
        });
        const mtn = makeInstance(MOUNTAIN, {
            id: "mtn",
            controllerId: "p1",
        });
        // The spell needs {G} — the Verge's GATED colour, decisive for
        // castability, and only payable at all because the Mountain unlocked
        // it. This is the reported scenario.
        const state = stateWithPendingCast([verge, mtn], { G: 1 });
        const stub = makeMutationCtx("p1", [gameStateSeed(state)]);

        await runAutoTapForPayment(stub.ctx);

        const after = stub.state();
        expect(
            after.players[0].battlefield.find((c) => c.id === "verge")!.isTapped
        ).toBe(true);
        // Minimal-tap: the Mountain (irrelevant to a {G} need) is left untapped.
        expect(
            after.players[0].battlefield.find((c) => c.id === "mtn")!.isTapped
        ).toBe(false);
        expect(after.pendingCast).toBeUndefined();
        expect(after.stack).toHaveLength(1);
    });

    it("end to end: with the unlock condition NOT met, auto-tap does not plan the gated colour — the spell stays unpaid, the Verge stays untapped", async () => {
        const verge = makeInstance(thornspireVerge.id, {
            id: "verge",
            controllerId: "p1",
        });
        // No Mountain/Forest anywhere — the secondary colour {G} stays locked.
        const state = stateWithPendingCast([verge], { G: 1 });
        const stub = makeMutationCtx("p1", [gameStateSeed(state)]);

        await runAutoTapForPayment(stub.ctx);

        const after = stub.state();
        // Nothing can help pay {G} — the Verge is left untapped, not tapped
        // for a colour it can't currently produce.
        expect(
            after.players[0].battlefield.find((c) => c.id === "verge")!.isTapped
        ).toBe(false);
        expect(after.pendingCast).toBeDefined();
        expect(after.stack).toHaveLength(0);
    });
});

describe("buildAutoTapSources — Fellwar Stone (manaColorSource, opponent-scanning chooser, issue #2240)", () => {
    it("end to end: auto-tap pays a cost only Fellwar Stone can cover (colour read off an OPPONENT's land) via the REAL autoTapForPayment mutation", async () => {
        const stone = makeInstance(fellwarStone.id, {
            id: "stone",
            controllerId: "p1",
        });
        const swamp = makeInstance(SWAMP, { id: "swamp", controllerId: "p2" });
        // p1 has no {B} source of its own — only Fellwar Stone, reading the
        // opponent's Swamp, can produce it. This is exactly the case the old
        // blanket `getManaChoices`/`manaColorSource` skip existed to protect
        // (a board-derived chooser whose enumeration depends on data outside
        // the paying player's own battlefield) — proving planner and payment
        // now agree on both the option AND its index.
        const state = stateWithPendingCast([stone], { B: 1 }, [swamp]);
        const stub = makeMutationCtx("p1", [gameStateSeed(state)]);

        await runAutoTapForPayment(stub.ctx);

        const after = stub.state();
        expect(
            after.players[0].battlefield.find((c) => c.id === "stone")!.isTapped
        ).toBe(true);
        expect(after.pendingCast).toBeUndefined();
        expect(after.stack).toHaveLength(1);
    });

    it("with no opponent colour-producing land, Fellwar Stone offers nothing and a {B} cost stays unpaid", async () => {
        const stone = makeInstance(fellwarStone.id, {
            id: "stone",
            controllerId: "p1",
        });
        const state = stateWithPendingCast([stone], { B: 1 }, []);
        const stub = makeMutationCtx("p1", [gameStateSeed(state)]);

        await runAutoTapForPayment(stub.ctx);

        const after = stub.state();
        expect(
            after.players[0].battlefield.find((c) => c.id === "stone")!.isTapped
        ).toBe(false);
        expect(after.pendingCast).toBeDefined();
        expect(after.stack).toHaveLength(0);
    });
});
