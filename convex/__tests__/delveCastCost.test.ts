// Delve / `payWith` cast-cost framework (CR 702.66, CR 601.2g — issue #1336,
// PRD #702, ADR 0063).
//
// Covers the whole path in one file, as the issue's test regime demands:
//   - GRE unit: the `gre/payWith.ts` primitives + the `genericManaShortfall`
//     probe + the `getLegalActions` castability gate (delve pseudo-sources).
//   - Integration: the exact functions the `announceCast` /
//     `selectCastExileCost` mutations call — `recordCastExileCostPick` and
//     `tryAutoCommitPendingCast` — including the graveyard → exile move at
//     commit (mirrors the tapArtifactForImprovise.test.ts precedent).
//   - Wire format: the picker survives `projectPublicState` un-slimmed, which
//     is what the client dialog reads.
//
// Treasure Cruise ({7}{U} Sorcery, ktk/blue.ts) is the first card to ship the
// "delve" keyword now that mechanicsRegistry.ts flips it to
// `status: "implemented"`.

import { describe, it, expect } from "vitest";
import {
    applyGenericOffset,
    buildDelveExileChoice,
    collapseForcedDelvePick,
    delveEligibleCards,
    genericPortion,
    spellHasDelve,
} from "../gre/payWith";
import { genericManaShortfall, getLegalActions } from "../gre/rules";
import {
    recordCastExileCostPick,
    tryAutoCommitPendingCast,
    finalizeTargetSelection,
} from "../game";
import type { PendingCast, PendingTarget } from "../gre/state";
import { projectPublicState } from "../gameProjections";
import { compactState, expandState } from "../gre/serialize";
import { makeInstance, makePlayer, makeState } from "../cards/__tests__/setup";

const TREASURE_CRUISE = "7a59d4b1-6cf4-44ec-8a96-1bb7094fea21"; // {7}{U} Sorcery, delve
const DISRUPT = "c000a02f-6b7e-4925-a938-59e645e980d7"; // {U} Instant, no delve
const ISLAND = "90a57c0e-fa61-45ef-955d-d296403967d5"; // {T}: U
const MOUNTAIN = "eace2c85-976c-425e-9800-5a6ccbd91b56"; // {T}: R

/** `n` distinct cards sitting in p1's graveyard as delve fuel. */
function fuel(n: number) {
    return Array.from({ length: n }, (_, i) =>
        makeInstance(MOUNTAIN, {
            id: `gy${i}`,
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        })
    );
}

/** A board with Treasure Cruise in hand, `lands` untapped Islands and `gyCount`
 *  graveyard cards. */
function board(lands: number, gyCount: number) {
    const spell = makeInstance(TREASURE_CRUISE, {
        id: "cruise",
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
    });
    const battlefield = Array.from({ length: lands }, (_, i) =>
        makeInstance(ISLAND, { id: `isle${i}`, controllerId: "p1" })
    );
    const p1 = makePlayer("p1", {
        hand: [spell],
        battlefield,
        graveyard: fuel(gyCount),
    });
    const state = makeState({
        players: [p1, makePlayer("p2")],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
    return { state, player: state.players[0], spell };
}

describe("delve keyword recognition (CR 702.66)", () => {
    it("reads delve off the card definition", () => {
        const { spell } = board(0, 0);
        expect(spellHasDelve(spell)).toBe(true);
    });

    it("is false for a spell without the keyword", () => {
        const disrupt = makeInstance(DISRUPT, { id: "d", zone: "hand" });
        expect(spellHasDelve(disrupt)).toBe(false);
    });

    it("never counts the spell itself as its own fuel (CR 702.66a)", () => {
        const { player, spell } = board(0, 3);
        // A graveyard cast would put the card itself in the fuel zone.
        player.graveyard.push(spell);
        const eligible = delveEligibleCards(player, spell.id);
        expect(eligible.map((c) => c.id)).toEqual(["gy0", "gy1", "gy2"]);
    });
});

describe("delve payment arithmetic (CR 702.66b)", () => {
    it("each exiled card pays for {1} of GENERIC mana", () => {
        const cost: Record<string, number> = { X: 7, U: 1 };
        applyGenericOffset(cost, 3);
        expect(cost.X).toBe(4);
        expect(cost.U).toBe(1); // coloured pip untouched (CR 702.66a)
    });

    it("clamps at zero — delve never pays a coloured pip", () => {
        const cost: Record<string, number> = { X: 2, U: 1 };
        applyGenericOffset(cost, 9);
        expect(cost.X).toBe(0);
        expect(cost.U).toBe(1);
        expect(genericPortion(cost)).toBe(0);
    });
});

describe("delve picker construction — Arena prompt policy (ADR 0063)", () => {
    it("bounds max by min(graveyard, generic remaining)", () => {
        const { player, spell } = board(2, 3);
        const choice = buildDelveExileChoice(
            player,
            spell,
            { X: 7, U: 1 },
            spell.id,
            0
        );
        expect(choice?.offsetGeneric).toEqual({ min: 0, max: 3 });
        expect(choice?.excludeInstanceId).toBe("cruise");
    });

    it("bounds max by the generic portion when the graveyard is deeper", () => {
        const { player, spell } = board(2, 9);
        const choice = buildDelveExileChoice(
            player,
            spell,
            { X: 4, U: 1 },
            spell.id,
            0
        );
        expect(choice?.offsetGeneric).toEqual({ min: 0, max: 4 });
    });

    it("pre-seeds the FORCED minimum when mana can't cover the shortfall", () => {
        // eligible (8) > max (6) keeps this on the PROMPTING branch — the
        // auto-resolve short-circuit (issue #1660) only fires when
        // min === max === eligible.length, which this fixture deliberately
        // avoids (there are still 2 spare graveyard cards WHICH is a real
        // choice, even though the COUNT is forced).
        const { player, spell } = board(2, 8);
        const choice = buildDelveExileChoice(
            player,
            spell,
            { X: 6, U: 1 },
            spell.id,
            6
        );
        expect(choice?.offsetGeneric).toEqual({ min: 6, max: 6 });
        expect(choice?.pickedCardIds).toBeUndefined();
    });

    it("a PARTIALLY forced minimum (0 < min < max) still prompts, with the minimum pre-seeded", () => {
        // shortfall (4) forces SOME exiles but max (5, capped by the generic
        // portion) leaves room above it — 0 < min < max is the fourth
        // prompt-policy branch (distinct from min === 0, min === max with
        // eligible > max, and the fully-forced auto-resolve case below) and
        // needs its own coverage now that the auto-resolve short-circuit
        // (issue #1660) pulled the old min === max === eligible.length
        // fixture that used to sit here onto the auto-resolve branch instead.
        const { player, spell } = board(2, 9);
        const choice = buildDelveExileChoice(
            player,
            spell,
            { X: 5, U: 1 },
            spell.id,
            4
        );
        expect(choice?.offsetGeneric).toEqual({ min: 4, max: 5 });
        expect(choice?.pickedCardIds).toBeUndefined();
    });

    it("skips the prompt entirely when the graveyard is empty", () => {
        const { player, spell } = board(8, 0);
        expect(
            buildDelveExileChoice(player, spell, { X: 7, U: 1 }, spell.id, 0)
        ).toBeUndefined();
    });

    it("skips the prompt when nothing generic is left to pay", () => {
        const { player, spell } = board(2, 5);
        expect(
            buildDelveExileChoice(player, spell, { U: 1 }, spell.id, 0)
        ).toBeUndefined();
    });

    it("skips the prompt for a spell without delve", () => {
        const { player } = board(2, 5);
        const disrupt = makeInstance(DISRUPT, { id: "d", zone: "hand" });
        expect(
            buildDelveExileChoice(player, disrupt, { X: 3 }, "d", 0)
        ).toBeUndefined();
    });
});

// issue #1660 — a picker with zero real branch (min === max === every
// eligible graveyard card) must auto-resolve instead of opening a picker the
// player can only Confirm or Cancel (Arena-UX auto-resolve, mirrors
// `buildAlternativeCostHandChoice`'s forced-pick path). Third round: the
// collapse moved OUT of `buildDelveExileChoice` (a pure builder again) and
// into the separate `collapseForcedDelvePick` step, run at the commit seam —
// mirrors `autoResolveFungible` (`gre/sacrificeChoice.ts`). These tests drive
// the two calls back-to-back, the way every real call site now does.
describe("delve auto-resolve — fully forced pick skips the prompt (issue #1660)", () => {
    it("min === max === eligible.length pre-fills pickedCardIds and pays the generic cost down immediately", () => {
        // The issue's exact repro: 6 graveyard cards, {7}{U} Treasure Cruise,
        // 2 Islands — the caster's mana alone is 6 short, and the graveyard
        // holds exactly 6 eligible cards, so every one of them MUST be
        // exiled. No "how many" branch (min === max) and no "which ones"
        // branch (max === eligible.length) — zero real choice.
        const { player, spell } = board(2, 6);
        const cost: Record<string, number> = { X: 7, U: 1 };
        const choice = buildDelveExileChoice(player, spell, cost, spell.id, 6);
        collapseForcedDelvePick(player, spell.id, choice, cost);
        expect(choice?.offsetGeneric).toEqual({ min: 6, max: 6 });
        expect(choice?.pickedCardIds?.slice().sort()).toEqual([
            "gy0",
            "gy1",
            "gy2",
            "gy3",
            "gy4",
            "gy5",
        ]);
        // The offset is paid down on the SAME `manaCost` object the caller
        // holds — no separate `recordCastExileCostPick` round trip needed.
        expect(cost.X).toBe(1);
        expect(cost.U).toBe(1);
    });

    it("min < max still prompts, with the minimum pre-seeded and pickedCardIds unset", () => {
        const { player, spell } = board(2, 9);
        const choice = buildDelveExileChoice(
            player,
            spell,
            { X: 4, U: 1 },
            spell.id,
            0
        );
        expect(choice?.offsetGeneric).toEqual({ min: 0, max: 4 });
        expect(choice?.pickedCardIds).toBeUndefined();
    });

    it("a forced COUNT that still leaves cards over keeps prompting — WHICH cards is a real choice", () => {
        // 9 eligible graveyard cards but only 6 are exiled (the generic
        // remaining caps it): min === max === 6, so the NUMBER is forced —
        // but eligible.length (9) > max (6), so WHICH 6 of the 9 to exile is
        // still a genuinely tactical decision (a cap-style restriction, per
        // the issue's acceptance criteria — NOT the same as the fully-forced
        // case above).
        const { player, spell } = board(2, 9);
        const choice = buildDelveExileChoice(
            player,
            spell,
            { X: 6, U: 1 },
            spell.id,
            6
        );
        expect(choice?.offsetGeneric).toEqual({ min: 6, max: 6 });
        expect(choice?.pickedCardIds).toBeUndefined();
    });

    it("auto-commits in one shot through tryAutoCommitPendingCast — no separate Confirm round trip", () => {
        const { state, player, spell } = board(1, 7);
        const cost: Record<string, number> = { X: 7, U: 1 };
        const choice = buildDelveExileChoice(player, spell, cost, spell.id, 7)!;
        collapseForcedDelvePick(player, spell.id, choice, cost);
        expect(choice.pickedCardIds?.slice().sort()).toEqual([
            "gy0",
            "gy1",
            "gy2",
            "gy3",
            "gy4",
            "gy5",
            "gy6",
        ]);
        expect(cost.X).toBe(0);
        player.manaPool = { W: 0, U: 1, B: 0, R: 0, G: 0, C: 0 };
        state.pendingCast = {
            playerId: "p1",
            cardInstanceId: "cruise",
            manaCost: cost,
            tappedLandIds: [],
            exileFromGraveyardChoice: choice,
        };
        tryAutoCommitPendingCast(state, "p1");
        expect(state.pendingCast).toBeUndefined();
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].card.id).toBe(TREASURE_CRUISE);
        expect(player.graveyard).toHaveLength(0);
        expect(player.exile.map((c) => c.id).sort()).toEqual([
            "gy0",
            "gy1",
            "gy2",
            "gy3",
            "gy4",
            "gy5",
            "gy6",
        ]);
        expect(player.manaPool.U).toBe(0);
    });
});

// issue #1660 — the fix's user-visible payload lives in TWO one-line guards
// in game.ts (`finalizeTargetSelection` and `announceCast`):
//   if (castExileChoice?.pickedCardIds) tryAutoCommitPendingCast(...)
// The test above ("auto-commits in one shot through tryAutoCommitPendingCast")
// hand-builds `state.pendingCast` and calls `tryAutoCommitPendingCast`
// directly — it exercises the PRIMITIVE, not the guard, and stays green even
// if either guard above is deleted. This block drives the guard itself
// through the real park → auto-commit code path, via the exported
// `finalizeTargetSelection` entry point (the documented workaround for the
// missing mutation-testing harness — mirrors `escape.test.ts`'s and
// `flashback.test.ts`'s targeted-cast precedents). Treasure Cruise has no
// target requirement of its own; the "Spell cast branch" this exercises is
// shared by every cast regardless of whether the card is targeted, so `pt`
// carries an empty target set. The sibling guard in `announceCast` (the
// untargeted no-pendingTarget cast path) has no equivalent exported seam —
// `announceCast` is a Convex `mutation(...)` handler, not a plain function,
// so it needs the (absent) mutation-testing harness to drive directly; see
// the PR receipt for the disposition.
describe("finalizeTargetSelection's auto-commit guard (issue #1660)", () => {
    it("a fully-forced delve pick auto-commits inside finalizeTargetSelection — park then auto-commit round trip", () => {
        // No lands (board(0, ...)) — `genericManaShortfall` reads the SAME
        // `player.manaPool` this test pre-seeds below (through
        // `coloredCostLeftover`'s source scan), so an untapped land here would
        // double-count against the pool and leave 1 leftover generic pip
        // uncovered by delve (min < max) instead of the fully-forced pick this
        // test needs. Mana already floating in the pool (e.g. from a mana
        // ability used earlier this turn) covers just the {U} pip once delve
        // zeroes the generic portion — the fully-forced pick (7 graveyard
        // cards pay for the 7 generic pips) leaves nothing else for the player
        // to decide, so the guard should carry this all the way onto the
        // stack in one call.
        const { state, player, spell } = board(0, 7);
        player.manaPool = { W: 0, U: 1, B: 0, R: 0, G: 0, C: 0 };
        const pt: PendingTarget = {
            playerId: "p1",
            cardInstanceId: spell.id,
            targetType: "any",
            count: 0,
            selected: [],
        };
        state.pendingTarget = pt;

        finalizeTargetSelection(state, pt, "p1");

        // The round trip: pendingCast was built (picker parked) and then
        // immediately cleared by the auto-commit guard — never left open for
        // a Confirm the player can't meaningfully act on.
        expect(state.pendingCast).toBeUndefined();
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].card.id).toBe(TREASURE_CRUISE);
        expect(player.graveyard).toHaveLength(0);
        expect(player.exile.map((c) => c.id).sort()).toEqual([
            "gy0",
            "gy1",
            "gy2",
            "gy3",
            "gy4",
            "gy5",
            "gy6",
        ]);
        expect(player.manaPool.U).toBe(0);
    });
});

describe("genericManaShortfall — the forced-minimum probe (CR 601.2g)", () => {
    it("reports the generic pips mana alone cannot cover", () => {
        const { player, spell } = board(2, 6);
        // Two Islands: one covers {U}, one leftover for the {7} generic.
        expect(genericManaShortfall(player, spell, { X: 7, U: 1 })).toBe(6);
    });

    it("EXCLUDES the delve pseudo-sources — otherwise it answers itself", () => {
        const withFuel = board(2, 6);
        const withoutFuel = board(2, 0);
        expect(
            genericManaShortfall(withFuel.player, withFuel.spell, {
                X: 7,
                U: 1,
            })
        ).toBe(
            genericManaShortfall(withoutFuel.player, withoutFuel.spell, {
                X: 7,
                U: 1,
            })
        );
    });

    it("is Infinity when the COLOURED portion itself is uncoverable", () => {
        const { state, player, spell } = board(0, 9);
        player.battlefield.push(
            makeInstance(MOUNTAIN, { id: "mtn", controllerId: "p1" })
        );
        void state;
        expect(genericManaShortfall(player, spell, { X: 1, U: 1 })).toBe(
            Infinity
        );
    });

    it("is zero once mana alone covers the whole cost", () => {
        const { player, spell } = board(8, 3);
        expect(genericManaShortfall(player, spell, { X: 7, U: 1 })).toBe(0);
    });
});

describe("castability gate — delve pseudo-sources (CR 601.2g probe)", () => {
    it("offers 'cast' when delve alone makes the spell payable", () => {
        const { state, player, spell } = board(2, 6);
        expect(getLegalActions(state, player, spell)).toContain("cast");
    });

    it("withholds 'cast' when the graveyard can't close the gap", () => {
        const { state, player, spell } = board(2, 3);
        expect(getLegalActions(state, player, spell)).not.toContain("cast");
    });

    it("withholds 'cast' when the COLOURED pip is uncoverable, however deep the graveyard", () => {
        const { state, player, spell } = board(0, 20);
        player.battlefield.push(
            makeInstance(MOUNTAIN, { id: "mtn", controllerId: "p1" })
        );
        expect(getLegalActions(state, player, spell)).not.toContain("cast");
    });
});

/** A parked delve cast: Treasure Cruise on `pendingCast` with the picker open,
 *  mirroring what `announceCast` builds. */
function parkedCast(gyCount: number, offset: { min: number; max: number }) {
    const { state, player, spell } = board(1, gyCount);
    const pendingCast: PendingCast = {
        playerId: "p1",
        cardInstanceId: "cruise",
        manaCost: { X: 7, U: 1 },
        tappedLandIds: [],
        exileFromGraveyardChoice: {
            count: 0,
            excludeInstanceId: "cruise",
            offsetGeneric: offset,
        },
    };
    state.pendingCast = pendingCast;
    return { state, player, spell, pendingCast };
}

describe("recordCastExileCostPick — variable-offset mode (CR 702.66)", () => {
    it("accepts a pick inside min..max and pays down the generic cost", () => {
        const { state, pendingCast } = parkedCast(7, { min: 0, max: 7 });
        recordCastExileCostPick(state, "p1", ["gy0", "gy1", "gy2"]);
        expect(pendingCast.exileFromGraveyardChoice?.pickedCardIds).toEqual([
            "gy0",
            "gy1",
            "gy2",
        ]);
        expect(pendingCast.manaCost.X).toBe(4);
        expect(pendingCast.manaCost.U).toBe(1);
    });

    it("accepts ZERO exiles when nothing is forced (declining delve)", () => {
        const { state, pendingCast } = parkedCast(7, { min: 0, max: 7 });
        recordCastExileCostPick(state, "p1", []);
        expect(pendingCast.exileFromGraveyardChoice?.pickedCardIds).toEqual([]);
        expect(pendingCast.manaCost.X).toBe(7);
    });

    it("rejects fewer than the forced minimum", () => {
        const { state } = parkedCast(7, { min: 5, max: 7 });
        expect(() =>
            recordCastExileCostPick(state, "p1", ["gy0", "gy1"])
        ).toThrow(/at least 5/);
    });

    it("rejects more than the generic cost can absorb", () => {
        const { state } = parkedCast(7, { min: 0, max: 2 });
        expect(() =>
            recordCastExileCostPick(state, "p1", ["gy0", "gy1", "gy2"])
        ).toThrow(/more than 2/);
    });

    it("rejects a card that is not in the caster's graveyard", () => {
        const { state } = parkedCast(2, { min: 0, max: 2 });
        expect(() => recordCastExileCostPick(state, "p1", ["nope"])).toThrow(
            /not in your graveyard/
        );
    });

    it("rejects a duplicate pick", () => {
        const { state } = parkedCast(2, { min: 0, max: 2 });
        expect(() =>
            recordCastExileCostPick(state, "p1", ["gy0", "gy0"])
        ).toThrow(/Duplicate/);
    });

    it("leaves the graveyard untouched until commit", () => {
        const { state, player } = parkedCast(3, { min: 0, max: 3 });
        recordCastExileCostPick(state, "p1", ["gy0", "gy1"]);
        expect(player.graveyard.map((c) => c.id)).toEqual([
            "gy0",
            "gy1",
            "gy2",
        ]);
        expect(player.exile).toHaveLength(0);
    });
});

describe("delve commit (CR 601.2g — reduce → payWith → mana)", () => {
    it("blocks commit while the picker is unanswered, even with mana in the pool", () => {
        const { state, player } = parkedCast(7, { min: 0, max: 7 });
        player.manaPool = { W: 0, U: 8, B: 0, R: 0, G: 0, C: 0 };
        tryAutoCommitPendingCast(state, "p1");
        expect(state.pendingCast).toBeDefined();
        expect(state.stack).toHaveLength(0);
    });

    it("exiles the picked cards and puts the spell on the stack once paid", () => {
        const { state, player } = parkedCast(7, { min: 7, max: 7 });
        player.manaPool = { W: 0, U: 1, B: 0, R: 0, G: 0, C: 0 };
        recordCastExileCostPick(state, "p1", [
            "gy0",
            "gy1",
            "gy2",
            "gy3",
            "gy4",
            "gy5",
            "gy6",
        ]);
        expect(state.pendingCast!.manaCost.X).toBe(0);

        tryAutoCommitPendingCast(state, "p1");

        expect(state.pendingCast).toBeUndefined();
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].card.id).toBe(TREASURE_CRUISE);
        // CR 702.66b — the fuel left the graveyard for exile.
        expect(player.graveyard).toHaveLength(0);
        expect(player.exile.map((c) => c.id).sort()).toEqual([
            "gy0",
            "gy1",
            "gy2",
            "gy3",
            "gy4",
            "gy5",
            "gy6",
        ]);
        // The single {U} paid the coloured pip; delve paid all seven generic.
        expect(player.manaPool.U).toBe(0);
    });

    it("delving PART of the cost leaves the rest to the mana payment", () => {
        const { state, player } = parkedCast(3, { min: 0, max: 3 });
        player.manaPool = { W: 0, U: 5, B: 0, R: 0, G: 0, C: 0 };
        recordCastExileCostPick(state, "p1", ["gy0", "gy1", "gy2"]);
        expect(state.pendingCast!.manaCost.X).toBe(4);

        tryAutoCommitPendingCast(state, "p1");

        expect(state.stack).toHaveLength(1);
        expect(player.exile).toHaveLength(3);
        expect(player.manaPool.U).toBe(0); // 4 generic + 1 coloured
    });
});

describe("persistence — the delve picker survives a DB round trip", () => {
    // `offsetGeneric` rides INSIDE `pendingCast` (already a
    // `PERSISTED_OPTIONAL_KEYS` entry, copied wholesale), so it needs no
    // serialize key of its own — this smoke test pins that.
    it("round-trips offsetGeneric through compact/expand", () => {
        const { state } = parkedCast(5, { min: 2, max: 5 });
        const restored = expandState(compactState(state));
        expect(
            restored.pendingCast?.exileFromGraveyardChoice?.offsetGeneric
        ).toEqual({ min: 2, max: 5 });
    });

    it("round-trips a recorded pick and the paid-down cost", () => {
        const { state } = parkedCast(5, { min: 0, max: 5 });
        recordCastExileCostPick(state, "p1", ["gy0", "gy1"]);
        const restored = expandState(compactState(state));
        expect(
            restored.pendingCast?.exileFromGraveyardChoice?.pickedCardIds
        ).toEqual(["gy0", "gy1"]);
        expect(restored.pendingCast?.manaCost.X).toBe(5);
    });
});

describe("wire format — the client's Cast affordance (ADR 0026)", () => {
    // The board grays a hand card off the SERVER-computed
    // `SlimHandCard.legalActions` (no client-side delve math, ADR 0063), so the
    // "ungrayed when delve makes it payable" acceptance criterion is asserted
    // here, through the reducer that produces it.
    it("ungrays Treasure Cruise when delve makes it payable", () => {
        const { state } = board(2, 6);
        const projected = projectPublicState(state, 1, "p1");
        const me = projected.players.find((p) => p.id === "p1")!;
        expect(me.hand[0]!.legalActions).toContain("cast");
    });

    it("keeps it grayed when the graveyard can't close the gap", () => {
        const { state } = board(2, 3);
        const projected = projectPublicState(state, 1, "p1");
        const me = projected.players.find((p) => p.id === "p1")!;
        expect(me.hand[0]!.legalActions).not.toContain("cast");
    });
});

describe("wire format — the delve picker crosses the projection", () => {
    it("projectPublicState carries offsetGeneric to the client dialog", () => {
        const { state } = parkedCast(5, { min: 2, max: 5 });
        const projected = projectPublicState(state, 1, "p1");
        const ec = projected.pendingCast?.exileFromGraveyardChoice;
        expect(ec?.offsetGeneric).toEqual({ min: 2, max: 5 });
        expect(ec?.excludeInstanceId).toBe("cruise");
        expect(ec?.pickedCardIds).toBeUndefined();
    });

    it("the caster still sees its own graveyard fuel on the wire", () => {
        const { state } = parkedCast(5, { min: 2, max: 5 });
        const projected = projectPublicState(state, 1, "p1");
        const me = projected.players.find((p) => p.id === "p1")!;
        expect(me.graveyard.map((c) => c!.id)).toEqual([
            "gy0",
            "gy1",
            "gy2",
            "gy3",
            "gy4",
        ]);
    });
});
