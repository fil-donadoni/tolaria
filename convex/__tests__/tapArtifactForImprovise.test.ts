// Integration tests for the Improvise payment path (CR 702.126, issue #1313):
// tapArtifactIntoImprovisePayment / untapArtifactFromImprovisePayment — the
// exact functions the tapArtifactForImprovise / untapArtifactForImprovise
// mutations call (mirrors the tapSourceIntoPayment precedent in
// autoTapForPayment.test.ts) — plus the rollback path through
// abandonPendingPayment and a full commit through tryAutoCommitPendingCast.
//
// Metallic Rebuke ({2}{U} Instant, aer/blue.ts) is the first card to ship the
// "improvise" keyword now that mechanicsRegistry.ts flips it to
// `status: "implemented"`. Millstone (atq/colorless.ts, {2} Artifact, no mana
// ability) stands in for "an untapped artifact the caster controls" — the
// mechanic cares only about the Artifact TYPE, not a mana ability.

import { describe, it, expect } from "vitest";
import {
    tapArtifactIntoImprovisePayment,
    untapArtifactFromImprovisePayment,
    tryAutoCommitPendingCast,
    abandonPendingPayment,
} from "../game";
import { emitPermanentTapped, type PendingCast } from "../gre/state";
import { projectPublicState } from "../gameProjections";
import { makeInstance, makePlayer, makeState } from "../cards/__tests__/setup";

const METALLIC_REBUKE = "f712ac26-dca4-459b-84c1-010597007f60"; // {2}{U} Instant, improvise
const DISRUPT = "c000a02f-6b7e-4925-a938-59e645e980d7"; // {U} Instant, no improvise
const MILLSTONE = "107646bc-2181-49f4-8821-1eaa46291855"; // {2} Artifact, no mana ability
const MOUNTAIN = "eace2c85-976c-425e-9800-5a6ccbd91b56"; // {T}: R (not an artifact)
const ISLAND = "90a57c0e-fa61-45ef-955d-d296403967d5"; // {T}: U

/** Casts `spellId` from `p1`'s hand with `manaCost` as the announced (already
 *  cost-modified) generic/colored requirement. Mirrors what `announceCast`
 *  would have parked on `state.pendingCast`. */
function castState(
    spellId: string,
    manaCost: Record<string, number>,
    battlefield: ReturnType<typeof makeInstance>[]
) {
    const spell = makeInstance(spellId, {
        id: "spell",
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
    });
    const pendingCast: PendingCast = {
        playerId: "p1",
        cardInstanceId: "spell",
        manaCost: { ...manaCost },
        tappedLandIds: [],
    };
    const p1 = makePlayer("p1", { hand: [spell], battlefield });
    const state = makeState({
        players: [p1, makePlayer("p2")],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        pendingCast,
    });
    return { state, player: state.players[0] };
}

describe("tapArtifactIntoImprovisePayment (CR 702.126)", () => {
    it("taps an untapped artifact and reduces the generic cost by {1}", () => {
        const millstone = makeInstance(MILLSTONE, { id: "mill1" });
        const { state, player } = castState(METALLIC_REBUKE, { U: 1, X: 2 }, [
            millstone,
        ]);
        const pc = state.pendingCast!;

        tapArtifactIntoImprovisePayment(state, player, millstone, pc);

        expect(millstone.isTapped).toBe(true);
        expect(pc.manaCost.X).toBe(1);
        expect(pc.manaCost.U).toBe(1); // colored pip untouched (CR 702.126a)
        expect(pc.improviseTappedArtifactIds).toEqual(["mill1"]);
    });

    it("emits a non-mana PERMANENT_TAPPED event (not tapped for mana)", () => {
        const millstone = makeInstance(MILLSTONE, { id: "mill1" });
        const { state, player } = castState(METALLIC_REBUKE, { U: 1, X: 2 }, [
            millstone,
        ]);
        const pc = state.pendingCast!;
        tapArtifactIntoImprovisePayment(state, player, millstone, pc);

        const events = state.pendingEvents ?? [];
        const tapEvent = events.find(
            (e) => e.type === "PERMANENT_TAPPED" && e.permanentId === "mill1"
        );
        expect(tapEvent).toBeDefined();
        expect((tapEvent as { forMana?: boolean }).forMana).toBe(false);
    });

    it("deletes the X key entirely once the whole generic portion is paid off", () => {
        const m1 = makeInstance(MILLSTONE, { id: "mill1" });
        const m2 = makeInstance(MILLSTONE, { id: "mill2" });
        const { state, player } = castState(METALLIC_REBUKE, { U: 1, X: 2 }, [
            m1,
            m2,
        ]);
        const pc = state.pendingCast!;

        tapArtifactIntoImprovisePayment(state, player, m1, pc);
        tapArtifactIntoImprovisePayment(state, player, m2, pc);

        expect(pc.manaCost.X).toBeUndefined();
        expect(pc.manaCost.U).toBe(1);
        expect(pc.improviseTappedArtifactIds).toEqual(["mill1", "mill2"]);
    });

    it("rejects a tap once no generic cost remains", () => {
        const m1 = makeInstance(MILLSTONE, { id: "mill1" });
        const m2 = makeInstance(MILLSTONE, { id: "mill2" });
        const { state, player } = castState(METALLIC_REBUKE, { U: 1, X: 1 }, [
            m1,
            m2,
        ]);
        const pc = state.pendingCast!;
        tapArtifactIntoImprovisePayment(state, player, m1, pc);

        expect(() =>
            tapArtifactIntoImprovisePayment(state, player, m2, pc)
        ).toThrow("No generic cost remains to pay with Improvise");
        expect(m2.isTapped).toBe(false);
    });

    it("rejects a non-artifact permanent", () => {
        const mountain = makeInstance(MOUNTAIN, { id: "mtn1" });
        const { state, player } = castState(METALLIC_REBUKE, { U: 1, X: 2 }, [
            mountain,
        ]);
        const pc = state.pendingCast!;

        expect(() =>
            tapArtifactIntoImprovisePayment(state, player, mountain, pc)
        ).toThrow("Improvise can only tap an artifact");
        expect(mountain.isTapped).toBe(false);
        expect(pc.manaCost.X).toBe(2);
    });

    it("rejects an already-tapped artifact", () => {
        const millstone = makeInstance(MILLSTONE, {
            id: "mill1",
            isTapped: true,
        });
        const { state, player } = castState(METALLIC_REBUKE, { U: 1, X: 2 }, [
            millstone,
        ]);
        const pc = state.pendingCast!;

        expect(() =>
            tapArtifactIntoImprovisePayment(state, player, millstone, pc)
        ).toThrow("Card already tapped");
    });

    it("rejects tapping toward a spell that does not have improvise", () => {
        const millstone = makeInstance(MILLSTONE, { id: "mill1" });
        const { state, player } = castState(DISRUPT, { X: 1 }, [millstone]);
        const pc = state.pendingCast!;

        expect(() =>
            tapArtifactIntoImprovisePayment(state, player, millstone, pc)
        ).toThrow("This spell does not have improvise");
        expect(millstone.isTapped).toBe(false);
    });
});

describe("untapArtifactFromImprovisePayment (undo)", () => {
    it("untaps, restores the generic cost, and drops the queued tap event", () => {
        const millstone = makeInstance(MILLSTONE, { id: "mill1" });
        const { state, player } = castState(METALLIC_REBUKE, { U: 1, X: 2 }, [
            millstone,
        ]);
        const pc = state.pendingCast!;
        tapArtifactIntoImprovisePayment(state, player, millstone, pc);
        expect(pc.manaCost.X).toBe(1);

        untapArtifactFromImprovisePayment(state, millstone, pc);

        expect(millstone.isTapped).toBe(false);
        expect(pc.manaCost.X).toBe(2);
        expect(pc.improviseTappedArtifactIds).toEqual([]);
        const events = state.pendingEvents ?? [];
        expect(
            events.some(
                (e) =>
                    e.type === "PERMANENT_TAPPED" && e.permanentId === "mill1"
            )
        ).toBe(false);
    });

    it("rejects undoing a tap that was never made for Improvise during this cast", () => {
        const millstone = makeInstance(MILLSTONE, {
            id: "mill1",
            isTapped: true,
        });
        const { state } = castState(METALLIC_REBUKE, { U: 1, X: 2 }, [
            millstone,
        ]);
        const pc = state.pendingCast!;

        expect(() =>
            untapArtifactFromImprovisePayment(state, millstone, pc)
        ).toThrow(
            "This artifact was not tapped for Improvise during this cast"
        );
    });

    it("restores the {X} key when reduced to zero and then undone", () => {
        const millstone = makeInstance(MILLSTONE, { id: "mill1" });
        const { state, player } = castState(METALLIC_REBUKE, { U: 1, X: 1 }, [
            millstone,
        ]);
        const pc = state.pendingCast!;
        tapArtifactIntoImprovisePayment(state, player, millstone, pc);
        expect(pc.manaCost.X).toBeUndefined();

        untapArtifactFromImprovisePayment(state, millstone, pc);
        expect(pc.manaCost.X).toBe(1);
    });
});

describe("Improvise + auto-commit (full payment path)", () => {
    it("commits once mana + Improvise taps together cover the whole cost", () => {
        const island = makeInstance(ISLAND, { id: "isl1" });
        const m1 = makeInstance(MILLSTONE, { id: "mill1" });
        const m2 = makeInstance(MILLSTONE, { id: "mill2" });
        const { state, player } = castState(METALLIC_REBUKE, { U: 1, X: 2 }, [
            island,
            m1,
            m2,
        ]);
        const pc = state.pendingCast!;

        // Pay the {2} generic entirely with Improvise taps...
        tapArtifactIntoImprovisePayment(state, player, m1, pc);
        tapArtifactIntoImprovisePayment(state, player, m2, pc);
        expect(pc.manaCost.X).toBeUndefined();

        // ...then float the remaining {U} the ordinary way and commit.
        player.manaPool.U = (player.manaPool.U ?? 0) + 1;
        const result = tryAutoCommitPendingCast(state, "p1");

        expect(result).not.toBeNull();
        expect(state.pendingCast).toBeUndefined();
        expect(state.stack).toHaveLength(1);
        // Both artifacts stay tapped — they paid a real cost, not floating mana.
        expect(m1.isTapped).toBe(true);
        expect(m2.isTapped).toBe(true);
    });

    it("does not auto-commit while Improvise-reduced generic cost is still unpaid", () => {
        const m1 = makeInstance(MILLSTONE, { id: "mill1" });
        const { state, player } = castState(METALLIC_REBUKE, { U: 1, X: 2 }, [
            m1,
        ]);
        const pc = state.pendingCast!;
        tapArtifactIntoImprovisePayment(state, player, m1, pc);
        // {1} generic + {U} still owed, no mana floated.
        const result = tryAutoCommitPendingCast(state, "p1");
        expect(result).toBeNull();
        expect(state.pendingCast).toBeDefined();
    });
});

describe("Improvise rollback on cancel/abandon (CR 601.2i)", () => {
    it("untaps every Improvise-tapped artifact when the payment is abandoned", () => {
        const m1 = makeInstance(MILLSTONE, { id: "mill1" });
        const m2 = makeInstance(MILLSTONE, { id: "mill2" });
        const { state, player } = castState(METALLIC_REBUKE, { U: 1, X: 2 }, [
            m1,
            m2,
        ]);
        const pc = state.pendingCast!;
        tapArtifactIntoImprovisePayment(state, player, m1, pc);
        tapArtifactIntoImprovisePayment(state, player, m2, pc);
        expect(m1.isTapped).toBe(true);
        expect(m2.isTapped).toBe(true);

        abandonPendingPayment(state, "p1");

        expect(state.pendingCast).toBeUndefined();
        expect(m1.isTapped).toBe(false);
        expect(m2.isTapped).toBe(false);
    });

    it("leaves an untouched artifact's tap state alone on rollback", () => {
        // A Millstone tapped for an UNRELATED reason (its own {2},{T} ability,
        // simulated by a raw tap outside the payment) must NOT be untapped by
        // an Improvise rollback — only artifacts this payment itself tapped.
        const preTapped = makeInstance(MILLSTONE, { id: "mill-pre" });
        const forImprovise = makeInstance(MILLSTONE, { id: "mill-imp" });
        const { state, player } = castState(METALLIC_REBUKE, { U: 1, X: 1 }, [
            preTapped,
            forImprovise,
        ]);
        const pc = state.pendingCast!;
        tapArtifactIntoImprovisePayment(state, player, forImprovise, pc);
        // Unrelated tap, e.g. from a mill activation earlier in the turn.
        preTapped.isTapped = true;
        emitPermanentTapped(state, preTapped, false);

        abandonPendingPayment(state, "p1");

        expect(forImprovise.isTapped).toBe(false);
        expect(preTapped.isTapped).toBe(true);
    });
});

describe("Improvise wire format (CR 702.126, gre-development.md § wire format)", () => {
    it("survives projectPublicState — manaCost.X reduction, improviseTappedArtifactIds, and the tapped battlefield card all cross the wire", () => {
        // pendingCast is spread through projectPublicState unchanged (no fat
        // card refs inside it — only ids/counts), so the reduced generic cost
        // and the tracked tap ids reach the client as-is. Regression guard: a
        // future refactor that starts reshaping pendingCast on the wire must
        // keep both fields intact. The tapped Millstone itself must also
        // survive `projectBattlefieldCard`'s slimming (card.card → {id}).
        const m1 = makeInstance(MILLSTONE, { id: "mill1" });
        const { state, player } = castState(METALLIC_REBUKE, { U: 1, X: 2 }, [
            m1,
        ]);
        const pc = state.pendingCast!;
        tapArtifactIntoImprovisePayment(state, player, m1, pc);

        const projected = projectPublicState(state, 1, "p1");

        expect(projected.pendingCast?.manaCost.X).toBe(1);
        expect(projected.pendingCast?.improviseTappedArtifactIds).toEqual([
            "mill1",
        ]);
        const slimMill = projected.players[0].battlefield.find(
            (c) => c.id === "mill1"
        )!;
        expect(slimMill.isTapped).toBe(true);
        expect(slimMill.card).toEqual({ id: MILLSTONE });
    });
});
