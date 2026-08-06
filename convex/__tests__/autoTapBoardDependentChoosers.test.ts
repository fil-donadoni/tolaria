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
import { blackManaBattery } from "../cards/sets/leg";
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
    it("emits one option per opponent colour, in the shared MANA_COLORS index space — pins a non-zero index to its colour (no aliasing between the planner and the unified option list)", () => {
        const stone = makeInstance(fellwarStone.id, {
            id: "stone",
            controllerId: "p1",
        });
        // Two DIFFERENTLY-COLOURED opponent basics: with only one, a single-
        // entry option list can't distinguish "index resolved to the right
        // colour" from "index resolved to whatever the only entry happens to
        // be" — any index would alias to the same colour. Swamp (B) sorts
        // before Mountain (R) in MANA_COLORS ("W","U","B","R","G","C"), so the
        // unified list is deterministically [B @ index 0, R @ index 1] and the
        // non-zero index 1 is pinned to R specifically.
        const swamp = makeInstance(SWAMP, { id: "swamp", controllerId: "p2" });
        const mountain = makeInstance(MOUNTAIN, {
            id: "opp-mtn",
            controllerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [stone] }),
                makePlayer("p2", { battlefield: [swamp, mountain] }),
            ],
        });
        const sources = buildAutoTapSources(
            state.players[0].battlefield,
            manaGateBattlefields(state)
        );
        const stoneSource = sources.find((s) => s.cardId === "stone");
        expect(stoneSource).toBeDefined();
        expect(stoneSource!.options).toEqual([
            { manaChoiceIndex: 0, mana: { B: 1 } },
            { manaChoiceIndex: 1, mana: { R: 1 } },
        ]);
    });

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

    it("end to end with TWO opponent colours: pays a {R} cost via Fellwar Stone's non-zero index — proves the mutation resolves the SAME index the planner emitted, not merely index 0", async () => {
        const stone = makeInstance(fellwarStone.id, {
            id: "stone",
            controllerId: "p1",
        });
        const swamp = makeInstance(SWAMP, { id: "swamp", controllerId: "p2" });
        const mountain = makeInstance(MOUNTAIN, {
            id: "opp-mtn",
            controllerId: "p2",
        });
        // {R} is payable ONLY via the SECOND (index 1) Fellwar Stone option —
        // B (index 0) can't cover it. If the planner's index and the payment
        // primitive's index space ever aliased (e.g. a narrower snapshot on
        // one side), this either fails to pay or silently taps for the wrong
        // colour; a single-opponent-colour test can't distinguish either
        // failure from success.
        const state = stateWithPendingCast([stone], { R: 1 }, [
            swamp,
            mountain,
        ]);
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

// Regression for the #2240 review's BLOCKING finding: threading the full
// battlefields snapshot into `buildAutoTapSources` made a Mana Battery /
// storage land's board-derived `getManaChoices` chooser a real auto-tap
// candidate — but every non-zero index in that chooser's list ALSO removes
// stored `charge` counters as part of the option's cost
// (`manaChoiceRemovesCounters`, CR 122.6). `solveSmartAutoTap` minimizes tap
// COUNT, so left unguarded it always prefers ONE counter-burning tap over
// TWO ordinary land taps — silently draining a resource the sacrifice-cost
// exclusion two lines above exists to protect (Black Lotus). The fix drops
// every option whose `getManaChoiceCounterCost(...).count > 0`, keeping only
// the free "remove 0 counters" pick — the battery stays auto-tappable for
// its base mana, never for a scaling tap the player never chose.
describe("buildAutoTapSources — Mana Battery (manaChoiceRemovesCounters, counter-burning options stay manual, issue #2240 review)", () => {
    it("with both a Mana Battery (3 charge counters) and two Swamps that alone cover the cost, auto-tap spends the two Swamps and leaves the battery's counters untouched — measured A/B: unguarded, ONE battery tap at index 3 removed all 3 counters for {B}{B}{B}{B} (2 floating); guarded, two Swamps tapped, battery/counters untouched", async () => {
        const battery = makeInstance(blackManaBattery.id, {
            id: "battery",
            controllerId: "p1",
            counters: { charge: 3 },
        });
        const swamp1 = makeInstance(SWAMP, {
            id: "swamp1",
            controllerId: "p1",
        });
        const swamp2 = makeInstance(SWAMP, {
            id: "swamp2",
            controllerId: "p1",
        });
        const state = stateWithPendingCast([battery, swamp1, swamp2], { B: 2 });
        const stub = makeMutationCtx("p1", [gameStateSeed(state)]);

        await runAutoTapForPayment(stub.ctx);

        const after = stub.state();
        const afterBattery = after.players[0].battlefield.find(
            (c) => c.id === "battery"
        )!;
        // The battery is left untapped and its counters survive intact — the
        // regression this test guards is exactly a counter-burning tap being
        // chosen on the player's behalf.
        expect(afterBattery.isTapped).toBe(false);
        expect(afterBattery.counters?.charge ?? 0).toBe(3);
        // The two Swamps are the taps chosen instead.
        expect(
            after.players[0].battlefield.find((c) => c.id === "swamp1")!
                .isTapped
        ).toBe(true);
        expect(
            after.players[0].battlefield.find((c) => c.id === "swamp2")!
                .isTapped
        ).toBe(true);
        expect(after.pendingCast).toBeUndefined();
        expect(after.stack).toHaveLength(1);
    });

    it("with no other source, the battery still pays via its FREE index-0 option (0 counters removed) — only the counter-burning options are off-limits, not the source itself", async () => {
        const battery = makeInstance(blackManaBattery.id, {
            id: "battery",
            controllerId: "p1",
            counters: { charge: 3 },
        });
        const state = stateWithPendingCast([battery], { B: 1 });
        const stub = makeMutationCtx("p1", [gameStateSeed(state)]);

        await runAutoTapForPayment(stub.ctx);

        const after = stub.state();
        const afterBattery = after.players[0].battlefield.find(
            (c) => c.id === "battery"
        )!;
        expect(afterBattery.isTapped).toBe(true);
        expect(afterBattery.counters?.charge ?? 0).toBe(3);
        expect(after.pendingCast).toBeUndefined();
        expect(after.stack).toHaveLength(1);
    });

    it("with no other source and a cost beyond the free option's output, the battery's counter-burning options stay off-limits — the cost is left partially unpaid rather than auto-spending counters", async () => {
        const battery = makeInstance(blackManaBattery.id, {
            id: "battery",
            controllerId: "p1",
            counters: { charge: 3 },
        });
        // {B}{B}: the free option produces only {B} — covering the rest would
        // require a counter-burning option this fix keeps off the table.
        const state = stateWithPendingCast([battery], { B: 2 });
        const stub = makeMutationCtx("p1", [gameStateSeed(state)]);

        await runAutoTapForPayment(stub.ctx);

        const after = stub.state();
        const afterBattery = after.players[0].battlefield.find(
            (c) => c.id === "battery"
        )!;
        // Issue #321 maximal-useful-partial-plan: the battery still taps for
        // its free {B} — but its counters are never touched.
        expect(afterBattery.isTapped).toBe(true);
        expect(afterBattery.counters?.charge ?? 0).toBe(3);
        expect(after.pendingCast).toBeDefined();
        expect(after.stack).toHaveLength(0);
    });
});
