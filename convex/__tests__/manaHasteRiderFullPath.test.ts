// CR 106.6 / 611.2c (issue #3354) — the mana-provenance haste rider, walked
// end to end: Arena of Glory's "{R}, {T}, Exert this land: Add {R}{R}. If that
// mana is spent on a creature spell, it gains haste until end of turn."
//
// The rider is the second of its class after Delighted Halfling's
// `cantBeCounteredRider` (issue #1559), and the first that rides an
// UNRESTRICTED unit — the mana may pay for anything, and sits in
// `restrictedMana` only because the fungible pool has nowhere to record a tag.
// Where it genuinely differs is the HAND-OFF: `dynamicCantBeCountered` is read
// while its spell is still on the stack and dies with it, whereas haste is
// owed to the PERMANENT the spell becomes.
//
// So this file walks the whole path the rule crosses (`.claude/rules/
// gre-development.md` § End-to-end targeting test): the real `tapForPayment` /
// `untapForPayment` mutation handlers through the stub `MutationCtx`, the GRE
// resolution that turns the spell into a permanent, the combat predicate that
// reads the granted keyword, the wire projection the client is the only
// consumer of, and the phase machinery that ends both the mana (CR 500.5) and
// the grant (CR 611.2c).

import { describe, it, expect } from "vitest";
import { tapForPayment, untapForPayment } from "../game";
import { projectPublicState } from "../gameProjections";
import { makeInstance, makePlayer, makeState } from "../cards/__tests__/setup";
import { arenaOfGlory } from "../cards/sets/mh3/colorless";
import { grizzlyBears } from "../cards/sets/lea/green";
import { lightningBolt } from "../cards/sets/lea/red";
import { resolveTopOfStack } from "../gre/state";
import { advancePhase } from "../gre/phases";
import { validateAttackerEligibility } from "../gre/combat";
import type { GameState, PendingCast, StackItem } from "../gre/state";
import type { Id } from "../_generated/dataModel";
import {
    makeMutationCtx,
    runMutation,
    gameStateSeed,
    type Handler,
} from "./gameMutationHarness";

const GAME_ID = "game-1" as Id<"games">;

/** Index of "{R}, {T}, Exert this land: Add {R}{R}" in the unified mana-tap
 *  option list: Arena of Glory is a plain Land with no basic subtype, so the
 *  list is exactly its two declared abilities in order. */
const EXERT_OPTION_INDEX = 1;

type TapForPaymentArgs = {
    gameId: Id<"games">;
    playerId: string;
    payments: { cardInstanceId: string; manaChoiceIndex?: number }[];
};
type UntapForPaymentArgs = {
    gameId: Id<"games">;
    playerId: string;
    cardInstanceId: string;
};

const runTapForPayment = (
    ctx: Parameters<typeof runMutation>[1],
    payments: TapForPaymentArgs["payments"]
) =>
    runMutation<TapForPaymentArgs, void>(
        tapForPayment as unknown as Handler<TapForPaymentArgs, void>,
        ctx,
        { gameId: GAME_ID, playerId: "p1", payments }
    );

const runUntapForPayment = (
    ctx: Parameters<typeof runMutation>[1],
    cardInstanceId: string
) =>
    runMutation<UntapForPaymentArgs, void>(
        untapForPayment as unknown as Handler<UntapForPaymentArgs, void>,
        ctx,
        { gameId: GAME_ID, playerId: "p1", cardInstanceId }
    );

/** Arena of Glory untapped with the {R} its exert ability charges already
 *  floating, and `castCardId` pending for a generic cost of `generic` (the
 *  printed cost is irrelevant here and overridden, exactly as the issue #1559
 *  payment-path tests do — what is under test is WHICH mana pays). */
function arenaCastState(castCardId: string, generic: number): GameState {
    const arena = makeInstance(arenaOfGlory.id, {
        id: "arena",
        controllerId: "p1",
        ownerId: "p1",
    });
    const cast = makeInstance(castCardId, {
        id: "spell",
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
    });
    const pendingCast: PendingCast = {
        playerId: "p1",
        cardInstanceId: "spell",
        manaCost: { X: generic },
        tappedLandIds: [],
    };
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: [arena],
                hand: [cast],
                manaPool: { W: 0, U: 0, B: 0, R: 1, G: 0, C: 0 },
            }),
            makePlayer("p2"),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "PRECOMBAT_MAIN",
        pendingCast,
    });
}

describe("Arena of Glory's haste rider — payment (CR 106.6, issue #3354)", () => {
    it("a CREATURE spell paid with the exert mana commits the cast and stamps dynamicHasteFromMana", async () => {
        const stub = makeMutationCtx("p1", [
            gameStateSeed(arenaCastState(grizzlyBears.id, 2)),
        ]);
        await runTapForPayment(stub.ctx, [
            { cardInstanceId: "arena", manaChoiceIndex: EXERT_OPTION_INDEX },
        ]);

        const state = stub.state();
        // The mana is UNRESTRICTED — it covered a generic cost with no
        // eligibility question asked — so the cast committed.
        expect(state.pendingCast).toBeUndefined();
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].dynamicHasteFromMana).toBe(true);
        // The OTHER rider is untouched: they are independent flags.
        expect(state.stack[0].dynamicCantBeCountered).toBeUndefined();
        // Both units spent; nothing leaked into the fungible pool.
        expect(state.players[0].manaPool.R ?? 0).toBe(0);
        expect(state.players[0].restrictedMana).toBeUndefined();
    });

    it("a NONCREATURE spell paid with the same mana gains nothing (the oracle's own condition)", async () => {
        const stub = makeMutationCtx("p1", [
            gameStateSeed(arenaCastState(lightningBolt.id, 2)),
        ]);
        await runTapForPayment(stub.ctx, [
            { cardInstanceId: "arena", manaChoiceIndex: EXERT_OPTION_INDEX },
        ]);

        const state = stub.state();
        // Eligibility is NOT what differs — the mana pays for the instant
        // perfectly well (the rider never gates what it may pay for). Only the
        // rider's own "if that mana is spent on a creature spell" clause fails.
        expect(state.pendingCast).toBeUndefined();
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].dynamicHasteFromMana).toBeUndefined();
        expect(state.players[0].restrictedMana).toBeUndefined();
    });

    it("untapForPayment refunds the RIDING unit, not plain mana (CR 106.4, reversal symmetry)", async () => {
        // A cost {R}{R} alone cannot cover, so the cast stays pending and the
        // land is still reversible.
        const stub = makeMutationCtx("p1", [
            gameStateSeed(arenaCastState(grizzlyBears.id, 5)),
        ]);
        await runTapForPayment(stub.ctx, [
            { cardInstanceId: "arena", manaChoiceIndex: EXERT_OPTION_INDEX },
        ]);
        expect(stub.state().pendingCast).toBeDefined();
        expect(stub.state().players[0].restrictedMana).toEqual([
            { color: "R", amount: 2, hasteRider: true },
        ]);

        await runUntapForPayment(stub.ctx, "arena");

        const state = stub.state();
        // Reversed out of the bucket it was banked in. Had the refund gone to
        // the fungible pool, the player would keep two UNTAGGED red mana AND
        // an untapped, un-exerted Arena of Glory.
        expect(state.players[0].restrictedMana).toBeUndefined();
        expect(state.players[0].manaPool.R ?? 0).toBe(1);
        const arena = state.players[0].battlefield.find(
            (c) => c.id === "arena"
        )!;
        expect(arena.isTapped).toBe(false);
        expect(arena.skipNextUntap).toBeUndefined();
    });
});

describe("Arena of Glory's haste rider — the spell to permanent hand-off (CR 611.2c, issue #3354)", () => {
    /** Casts Grizzly Bears off the exert mana and resolves it. */
    async function castAndResolve(): Promise<GameState> {
        const stub = makeMutationCtx("p1", [
            gameStateSeed(arenaCastState(grizzlyBears.id, 2)),
        ]);
        await runTapForPayment(stub.ctx, [
            { cardInstanceId: "arena", manaChoiceIndex: EXERT_OPTION_INDEX },
        ]);
        const state = stub.state();
        resolveTopOfStack(state);
        return state;
    }

    const bearsOn = (state: GameState) =>
        state.players[0].battlefield.find((c) => c.id === "spell")!;

    it("the resolved creature has haste and can attack the turn it entered (CR 302.6 / 702.10b)", async () => {
        const state = await castAndResolve();
        const bears = bearsOn(state);
        expect(bears.zone).toBe("battlefield");
        // Still summoning-sick — haste does not clear the flag, it makes the
        // flag stop mattering (CR 302.6).
        expect(bears.isSummoningSick).toBe(true);
        expect(bears.staticAbilities).toContain("haste");
        // The predicate combat actually asks, not a re-read of the field.
        expect(
            validateAttackerEligibility(
                bears,
                state.players[1].battlefield,
                state
            ).eligible
        ).toBe(true);
        // The flag did NOT ride onto the permanent. The cast is the point:
        // `dynamicHasteFromMana` is declared on `StackItem`, and a stack item
        // IS its `CardInstanceState` — the same object, which is exactly why a
        // leak here would survive onto the battlefield and through a
        // bounce-and-recast without any type ever complaining.
        expect(
            (bears as Partial<StackItem>).dynamicHasteFromMana
        ).toBeUndefined();
    });

    it("the grant is a duration-scoped registry entry, not a materialised keyword (ADR 0082)", async () => {
        const state = await castAndResolve();
        const entry = (state.continuousEffects ?? []).find(
            (e) =>
                e.payload.kind === "keyword-grant" &&
                e.payload.keyword === "haste"
        );
        expect(entry).toBeDefined();
        expect(entry!.layer).toBe(6);
        expect(entry!.expiry).toEqual({
            kind: "duration",
            duration: { phase: "end-of-turn" },
            controllerId: "p1",
        });
    });

    it("haste crosses the WIRE — the client's only view of it (frontend wiring walk)", async () => {
        const state = await castAndResolve();
        const projected = projectPublicState(state, 1, "p1");
        const bears = projected.players
            .find((p) => p.id === "p1")!
            .battlefield.find((c) => c.id === "spell")!;
        expect(bears.staticAbilities).toContain("haste");
    });

    it("the grant ends at end of turn and the mana empties at end of step (CR 611.2c / 500.5)", async () => {
        const state = await castAndResolve();
        expect(bearsOn(state).staticAbilities).toContain("haste");

        // Walk real phase boundaries until the active player changes — the
        // end-of-turn boundary the duration counts is the one `advancePhase`
        // ticks, never a hand-called tick.
        for (let i = 0; i < 40 && state.activePlayerId === "p1"; i++) {
            advancePhase(state);
        }
        expect(state.activePlayerId).toBe("p2");
        expect(bearsOn(state).staticAbilities).not.toContain("haste");
        // CR 500.5 — a rider-tagged unit left floating empties with the rest
        // of the pool exactly like every other `restrictedMana` unit.
        expect(state.players[0].restrictedMana).toBeUndefined();
    });
});
