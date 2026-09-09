// Multi-colour FIXED **tap** mana abilities — CR 605.1a / 106.4 / 106.6,
// issue #3263.
//
// "{T}: Add {W}{B}." (and "{T}, Sacrifice this land: Add {W}{B}." on a source
// with no other mana ability) is a fixed-output mana ability like any other,
// but every tap site resolved its output through `getActivatedManaColor`, which
// returns a SINGLE `Color` and therefore null for a two-colour output. The
// source was offered by `getManaTapOptionsDetailed` and then:
//   • rejected by `tapSourceIntoPayment` with "Card does not produce mana"
//     (the auto-tap / click-to-pay path), or
//   • tapped by `tapUntap` at priority for ZERO mana (the `if (manaColor)`
//     block was simply skipped).
// Only the SACRIFICE-only shape (no {T} leg, issue #2021) had a branch that
// deposits a whole `ManaCost`.
//
// No catalogue card is this shape today: the five Invasion "Vent" lands carry a
// single-colour `{T}: Add {U}` alongside their `{T}, Sacrifice: Add {W}{B}`, so
// `getActivatedManaColor` answers for them and they keep the old path (asserted
// below as a regression). The shape IS reachable in production through a
// GRANTED mana ability, so the subject is exercised through test-only
// definitions preloaded into the registry — the catalogue is frozen.
//
// Driven through the REAL entry points (`tapSourceIntoPayment`, the exported
// primitive the tap mutations share, and the `tapUntap` / `untapForPayment` /
// `autoTapForPayment` mutations via the stub `MutationCtx`), never a
// hand-rolled reimplementation of the tap/untap loop body.

import { describe, it, expect, beforeAll } from "vitest";
import {
    tapSourceIntoPayment,
    tapUntap,
    untapForPayment,
    autoTapForPayment,
} from "../game";
import { makeInstance, makePlayer, makeState } from "../cards/__tests__/setup";
import { getCardByName } from "../cards";
import { preloadDefinitions } from "../cards/registry";
import { getFixedMultiColorTapManaAbility } from "../gre/constants";
import type { CardDefinition } from "../cards/types";
import type { GameState, PendingCast, PlayerState } from "../gre/state";
import type { Id } from "../_generated/dataModel";
import {
    makeMutationCtx,
    runMutation,
    gameStateSeed,
    type Handler,
} from "./gameMutationHarness";

const GAME_ID = "game-1" as Id<"games">;

/** "{T}: Add {W}{B}." — the plain shape, with no single-colour ability to fall
 *  back on. A Land so the summoning-sickness gate is out of the picture. */
const PRISM_VENT: CardDefinition = {
    id: "test-3263-prism-vent",
    name: "Test Prism Vent",
    rarity: "common",
    oracleText: "{T}: Add {W}{B}.",
    manaCost: {},
    types: ["Land"],
    activatedAbilities: [
        {
            id: "test-3263-prism-vent-tap",
            oracleText: "{T}: Add {W}{B}.",
            cost: { tap: true },
            useStack: false,
            manaProduced: { W: 1, B: 1 },
        },
    ],
};

/** The same output under a CR 106.6 spend restriction, so the deposit lands in
 *  the parallel `restrictedMana` pool and the refund must reverse it there. */
const RESTRICTED_VENT: CardDefinition = {
    ...PRISM_VENT,
    id: "test-3263-restricted-vent",
    name: "Test Restricted Vent",
    oracleText:
        "{T}: Add {W}{B}. Spend this mana only to cast artifact spells.",
    activatedAbilities: [
        {
            ...PRISM_VENT.activatedAbilities![0],
            id: "test-3263-restricted-vent-tap",
            manaRestriction: "artifact-spell",
        },
    ],
};

/** The five Invasion "Vent" lands with their abilities printed in the OTHER
 *  order: the multi-colour sacrifice leg FIRST, the single-colour "{T}: Add
 *  {U}" second. `getActivatedManaColor` reads the FIRST matching ability, so it
 *  answers null here even though the source has a perfectly good single-colour
 *  option — which is what would let the probe hand the fixed branch a
 *  `cost.sacrifice` ability and sacrifice the land for the player (issue #3263
 *  review, finding 3). No catalogue card is printed this way. */
const REVERSED_VENT: CardDefinition = {
    ...PRISM_VENT,
    id: "test-3263-reversed-vent",
    name: "Test Reversed Vent",
    oracleText: "{T}, Sacrifice this land: Add {W}{B}.\n{T}: Add {U}.",
    activatedAbilities: [
        {
            ...PRISM_VENT.activatedAbilities![0],
            id: "test-3263-reversed-vent-sacrifice",
            cost: { tap: true, sacrifice: true },
        },
        {
            id: "test-3263-reversed-vent-tap",
            oracleText: "{T}: Add {U}.",
            cost: { tap: true },
            useStack: false,
            manaProduced: { U: 1 },
        },
    ],
};

/** "{T}, Sacrifice this land: Add {W}{B}." with NO other mana ability — the
 *  {T}+sacrifice half of the shape, which `getFixedSacrificeManaAbility`
 *  deliberately does not claim (it requires `cost.tap !== true`). */
const SACRIFICE_VENT: CardDefinition = {
    ...PRISM_VENT,
    id: "test-3263-sacrifice-vent",
    name: "Test Sacrifice Vent",
    oracleText: "{T}, Sacrifice this land: Add {W}{B}.",
    activatedAbilities: [
        {
            ...PRISM_VENT.activatedAbilities![0],
            id: "test-3263-sacrifice-vent-tap",
            cost: { tap: true, sacrifice: true },
        },
    ],
};

// `withTemporaryDefinition`'s window is `fn`'s SYNCHRONOUS extent (its own doc
// comment says so), and half of this file drives Convex mutations through
// `await` — the entry would be gone before the handler ever read it. These ids
// are test-only and shadow no catalogue card, so preloading them for the file
// overwrites nothing and leaks nothing a later file in the worker looks up.
beforeAll(() => {
    preloadDefinitions([
        PRISM_VENT,
        RESTRICTED_VENT,
        SACRIFICE_VENT,
        REVERSED_VENT,
    ]);
});

/** One permanent of `defId` on p1's battlefield, p1 active and with priority. */
function boardWith(
    defId: string,
    pendingCast?: PendingCast
): { state: GameState; player: PlayerState } {
    const card = makeInstance(defId, {
        id: "source",
        controllerId: "p1",
        ownerId: "p1",
        isSummoningSick: false,
    });
    const state = makeState({
        players: [makePlayer("p1", { battlefield: [card] }), makePlayer("p2")],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        ...(pendingCast ? { pendingCast } : {}),
    });
    return { state, player: state.players[0] };
}

const castOf = (manaCost: PendingCast["manaCost"]): PendingCast => ({
    playerId: "p1",
    cardInstanceId: "spell",
    manaCost,
    tappedLandIds: [],
});

type TapUntapArgs = {
    gameId: Id<"games">;
    playerId: string;
    cardInstanceId: string;
    manaChoiceIndex?: number;
};

const runTapUntap = (
    ctx: Parameters<typeof runMutation>[1],
    cardInstanceId: string
) =>
    runMutation<TapUntapArgs, void>(
        tapUntap as unknown as Handler<TapUntapArgs, void>,
        ctx,
        { gameId: GAME_ID, playerId: "p1", cardInstanceId }
    );

type UntapForPaymentArgs = {
    gameId: Id<"games">;
    playerId: string;
    cardInstanceId: string;
};

const runUntapForPayment = (
    ctx: Parameters<typeof runMutation>[1],
    cardInstanceId: string
) =>
    runMutation<UntapForPaymentArgs, void>(
        untapForPayment as unknown as Handler<UntapForPaymentArgs, void>,
        ctx,
        { gameId: GAME_ID, playerId: "p1", cardInstanceId }
    );

type AutoTapArgs = { gameId: Id<"games">; playerId: string };

const runAutoTap = (ctx: Parameters<typeof runMutation>[1]) =>
    runMutation<AutoTapArgs, void>(
        autoTapForPayment as unknown as Handler<AutoTapArgs, void>,
        ctx,
        { gameId: GAME_ID, playerId: "p1" }
    );

describe("getFixedMultiColorTapManaAbility (CR 605.1a, issue #3263)", () => {
    it("claims a fixed {T} ability whose output spans 2+ distinct colours", () => {
        const { player } = boardWith(PRISM_VENT.id);
        const ability = getFixedMultiColorTapManaAbility(player.battlefield[0]);
        expect(ability?.manaProduced).toEqual({ W: 1, B: 1 });
    });

    it("claims the {T} + Sacrifice variant too (the sacrifice-only probe cannot)", () => {
        const { player } = boardWith(SACRIFICE_VENT.id);
        expect(
            getFixedMultiColorTapManaAbility(player.battlefield[0])
        ).not.toBeNull();
    });

    it("does not claim a single-colour or same-colour-multiple ability", () => {
        // Llanowar Elves "{T}: Add {G}."; Sol Ring "{T}: Add {C}{C}." — one
        // distinct colour each, so both keep the `getActivatedManaColor` path.
        for (const name of ["Llanowar Elves", "Sol Ring"]) {
            const { player } = boardWith(getCardByName(name).id);
            expect(
                getFixedMultiColorTapManaAbility(player.battlefield[0])
            ).toBeNull();
        }
    });

    it("prefers the NON-destructive ability, so print order cannot make it sacrifice", () => {
        // The probe mirrors `getManaTapOptionsDetailed`'s
        // `nonSacrifice.length > 0 ? nonSacrifice : sacrifice` preference: with
        // a plain "{T}: Add {U}" also on the card, the multi-colour SACRIFICE
        // leg is not this source's tap output.
        const { player } = boardWith(REVERSED_VENT.id);
        expect(
            getFixedMultiColorTapManaAbility(player.battlefield[0])
        ).toBeNull();
    });

    it("does not claim a CHOICE ability or a tap-less sacrifice one", () => {
        // Birds of Paradise chooses ("Add one mana of any color"); Morgue Toad
        // is the sacrifice-ONLY multi-colour shape issue #2021 already owns.
        for (const name of ["Birds of Paradise", "Morgue Toad"]) {
            const { player } = boardWith(getCardByName(name).id);
            expect(
                getFixedMultiColorTapManaAbility(player.battlefield[0])
            ).toBeNull();
        }
    });
});

describe("tapSourceIntoPayment — multi-colour fixed tap (CR 605.1a, issue #3263)", () => {
    it("deposits the FULL output instead of throwing 'Card does not produce mana'", () => {
        const { state, player } = boardWith(PRISM_VENT.id);
        const tappedLandIds: string[] = [];

        tapSourceIntoPayment(
            state,
            player,
            player.battlefield[0],
            undefined,
            tappedLandIds
        );

        expect(player.manaPool.W).toBe(1);
        expect(player.manaPool.B).toBe(1);
        expect(player.battlefield[0].isTapped).toBe(true);
        expect(tappedLandIds).toEqual(["source"]);
        // CR 106.4 — the whole output is snapshotted, because the
        // single-`Color` refund arithmetic cannot express it.
        expect(player.battlefield[0].chosenMana).toEqual({ W: 1, B: 1 });
    });

    it("the {T} + Sacrifice variant adds both colours and goes to the graveyard", () => {
        const { state, player } = boardWith(SACRIFICE_VENT.id);
        const tappedLandIds: string[] = [];

        tapSourceIntoPayment(
            state,
            player,
            player.battlefield[0],
            undefined,
            tappedLandIds
        );

        expect(player.manaPool.W).toBe(1);
        expect(player.manaPool.B).toBe(1);
        // One-way (CR 603.6 / 700.4): nothing to untap, nothing recorded.
        expect(player.battlefield.find((c) => c.id === "source")).toBe(
            undefined
        );
        expect(player.graveyard.find((c) => c.id === "source")).toBeDefined();
        expect(tappedLandIds).toEqual([]);
    });

    it("a restricted output floats in the parallel restrictedMana pool (CR 106.6)", () => {
        const { state, player } = boardWith(RESTRICTED_VENT.id);

        tapSourceIntoPayment(
            state,
            player,
            player.battlefield[0],
            undefined,
            []
        );

        expect(player.manaPool.W ?? 0).toBe(0);
        expect(player.manaPool.B ?? 0).toBe(0);
        expect(player.restrictedMana).toEqual([
            { color: "W", amount: 1, restriction: "artifact-spell" },
            { color: "B", amount: 1, restriction: "artifact-spell" },
        ]);
    });
});

describe("payment undo refunds exactly what was added (CR 106.4/106.6, issue #3263)", () => {
    it("untapForPayment empties the pool and untaps the source", async () => {
        const { state, player } = boardWith(
            PRISM_VENT.id,
            castOf({ W: 1, B: 1, generic: 4 })
        );
        tapSourceIntoPayment(
            state,
            player,
            player.battlefield[0],
            undefined,
            state.pendingCast!.tappedLandIds
        );
        const stub = makeMutationCtx("p1", [gameStateSeed(state)]);

        await runUntapForPayment(stub.ctx, "source");

        const after = stub.state();
        const card = after.players[0].battlefield[0];
        expect(after.players[0].manaPool.W ?? 0).toBe(0);
        expect(after.players[0].manaPool.B ?? 0).toBe(0);
        expect(card.isTapped).toBe(false);
        expect(card.chosenMana).toBeUndefined();
        expect(after.pendingCast!.tappedLandIds).toEqual([]);
    });

    it("the refund is restriction-aware — it reverses restrictedMana, not the fungible pool", async () => {
        const { state, player } = boardWith(
            RESTRICTED_VENT.id,
            castOf({ W: 1, B: 1, generic: 4 })
        );
        tapSourceIntoPayment(
            state,
            player,
            player.battlefield[0],
            undefined,
            state.pendingCast!.tappedLandIds
        );
        const stub = makeMutationCtx("p1", [gameStateSeed(state)]);

        await runUntapForPayment(stub.ctx, "source");

        const after = stub.state().players[0];
        expect(after.restrictedMana ?? []).toEqual([]);
        // The bug this guards: decrementing a fungible pool that was never
        // credited, leaving the restricted deposit floating forever.
        expect(after.manaPool.W ?? 0).toBe(0);
        expect(after.manaPool.B ?? 0).toBe(0);
    });
});

describe("tapUntap at priority — multi-colour fixed tap (CR 605.1a, issue #3263)", () => {
    it("tapping adds the full output (it used to tap the source for ZERO mana)", async () => {
        const { state } = boardWith(PRISM_VENT.id);
        const stub = makeMutationCtx("p1", [gameStateSeed(state)]);

        await runTapUntap(stub.ctx, "source");

        const after = stub.state().players[0];
        expect(after.manaPool.W).toBe(1);
        expect(after.manaPool.B).toBe(1);
        expect(after.battlefield[0].isTapped).toBe(true);
        expect(after.battlefield[0].chosenMana).toEqual({ W: 1, B: 1 });
    });

    it("untapping refunds exactly the mana that was added", async () => {
        const { state } = boardWith(PRISM_VENT.id);
        const stub = makeMutationCtx("p1", [gameStateSeed(state)]);

        await runTapUntap(stub.ctx, "source");
        await runTapUntap(stub.ctx, "source");

        const after = stub.state().players[0];
        expect(after.manaPool.W ?? 0).toBe(0);
        expect(after.manaPool.B ?? 0).toBe(0);
        expect(after.battlefield[0].isTapped).toBe(false);
        expect(after.battlefield[0].chosenMana).toBeUndefined();
    });

    it("a restricted tap/untap round-trip leaves restrictedMana empty (CR 106.6)", async () => {
        const { state } = boardWith(RESTRICTED_VENT.id);
        const stub = makeMutationCtx("p1", [gameStateSeed(state)]);

        await runTapUntap(stub.ctx, "source");
        const tapped = stub.state().players[0];
        expect(tapped.restrictedMana).toEqual([
            { color: "W", amount: 1, restriction: "artifact-spell" },
            { color: "B", amount: 1, restriction: "artifact-spell" },
        ]);

        await runTapUntap(stub.ctx, "source");
        const after = stub.state().players[0];
        expect(after.restrictedMana ?? []).toEqual([]);
        expect(after.manaPool.W ?? 0).toBe(0);
        expect(after.manaPool.B ?? 0).toBe(0);
    });
});

describe("the auto-tapper can use the source (issue #3263)", () => {
    it("autoTapForPayment commits a {W}{B} cost off a single multi-colour source", async () => {
        const spell = makeInstance(getCardByName("Grizzly Bears").id, {
            id: "spell",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const { state } = boardWith(PRISM_VENT.id, castOf({ W: 1, B: 1 }));
        state.players[0].hand = [spell];
        const stub = makeMutationCtx("p1", [gameStateSeed(state)]);

        await runAutoTap(stub.ctx);

        const after = stub.state();
        // The cost was covered, so the cast auto-committed — the source was
        // usable, not rejected with "Card does not produce mana".
        expect(after.pendingCast).toBeUndefined();
        expect(after.players[0].battlefield[0].isTapped).toBe(true);
    });
});

describe("existing shapes are untouched (issue #3263 regression guard)", () => {
    it("a single-colour fixed tap ability still adds its one colour", () => {
        const { state, player } = boardWith(getCardByName("Llanowar Elves").id);
        const tappedLandIds: string[] = [];

        tapSourceIntoPayment(
            state,
            player,
            player.battlefield[0],
            undefined,
            tappedLandIds
        );

        expect(player.manaPool.G).toBe(1);
        // Not snapshotted: the single-`Color` refund path still owns this shape.
        expect(player.battlefield[0].chosenMana).toBeUndefined();
        expect(tappedLandIds).toEqual(["source"]);
    });

    it("a same-colour-MULTIPLE fixed tap ability still adds both (Sol Ring)", () => {
        const { state, player } = boardWith(getCardByName("Sol Ring").id);

        tapSourceIntoPayment(
            state,
            player,
            player.battlefield[0],
            undefined,
            []
        );

        expect(player.manaPool.C).toBe(2);
        expect(player.battlefield[0].chosenMana).toBeUndefined();
    });

    it("Ancient Spring still taps for its single-colour {U}, not the sacrifice ability's {W}{B}", () => {
        // The catalogue shape the new probe must NOT hijack: the {T},Sacrifice
        // "{W}{B}" leg IS multi-colour, but `getActivatedManaColor` answers "U"
        // for the card, so the probe is never consulted (and the sacrifice
        // option is not what `getManaTapOptionsDetailed` offers here anyway).
        const { state, player } = boardWith(getCardByName("Ancient Spring").id);

        tapSourceIntoPayment(
            state,
            player,
            player.battlefield[0],
            undefined,
            []
        );

        expect(player.manaPool.U).toBe(1);
        expect(player.manaPool.W ?? 0).toBe(0);
        expect(player.manaPool.B ?? 0).toBe(0);
        expect(player.battlefield.find((c) => c.id === "source")).toBeDefined();
    });

    it("a reversed-print Vent is refused, not silently sacrificed", () => {
        // `getActivatedManaColor` reads the FIRST matching ability and so has
        // no answer here; the probe declines because a non-sacrifice mana
        // ability exists. The result is the SAFE pre-issue-#3263 rejection —
        // never "sacrifice the land and add {W}{B}" on the player's behalf.
        const { state, player } = boardWith(REVERSED_VENT.id);

        expect(() =>
            tapSourceIntoPayment(
                state,
                player,
                player.battlefield[0],
                undefined,
                []
            )
        ).toThrow("Card does not produce mana");
        expect(player.battlefield.find((c) => c.id === "source")).toBeDefined();
        expect(player.graveyard).toEqual([]);
        expect(player.manaPool.W ?? 0).toBe(0);
        expect(player.manaPool.B ?? 0).toBe(0);
    });

    it("the sacrifice-ONLY multi-colour shape keeps its own branch (Morgue Toad)", () => {
        const { state, player } = boardWith(getCardByName("Morgue Toad").id);

        tapSourceIntoPayment(
            state,
            player,
            player.battlefield[0],
            undefined,
            []
        );

        expect(player.manaPool.U).toBe(1);
        expect(player.manaPool.R).toBe(1);
        expect(player.battlefield.find((c) => c.id === "source")).toBe(
            undefined
        );
    });
});
