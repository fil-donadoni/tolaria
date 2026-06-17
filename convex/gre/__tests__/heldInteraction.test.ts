// Interaction-aware combat prediction seam tests (ADR 0021, issue #229).
//
// These exercise the predictor in ISOLATION — the held-interaction reader, the
// affordability gate, the attacker-pump fold into `predictCombatOutcome`, and
// the cautious multi-block discount in `declaredBlockDelta` — without running a
// full ISMCTS search. Pump present vs absent, removal present vs absent, and the
// affordability (open-mana) gate are each asserted directly.

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import {
    availableManaFor,
    castableHeldInteraction,
    hasCastableInstantHint,
} from "../heldInteraction";
import { predictCombatOutcome } from "../dangerClock";
import { declaredBlockDelta } from "../evaluate";

const GRIZZLY = getCardByName("Grizzly Bears").id; // 2/2
const HILL_GIANT = getCardByName("Hill Giant").id; // 3/3
const FOREST = getCardByName("Forest").id;
const MOUNTAIN = getCardByName("Mountain").id;
const GIANT_GROWTH = getCardByName("Giant Growth").id; // {G}: +3/+3, aiCombatHint.pump
const LIGHTNING_BOLT = getCardByName("Lightning Bolt").id; // {R}: 3 dmg, aiCombatHint.removal

const inHand = (cardId: string, owner: string, id: string) =>
    makeInstance(cardId, {
        id,
        controllerId: owner,
        ownerId: owner,
        zone: "hand",
    });
const land = (cardId: string, owner: string, id: string, tapped = false) =>
    makeInstance(cardId, {
        id,
        controllerId: owner,
        ownerId: owner,
        isTapped: tapped,
    });

describe("held-interaction reader (ADR 0021, issue #229)", () => {
    it("reads a castable pump from a held Giant Growth backed by mana", () => {
        const player = makePlayer("p1", {
            hand: [inHand(GIANT_GROWTH, "p1", "gg")],
            battlefield: [land(FOREST, "p1", "f1")],
        });
        expect(availableManaFor(player)).toBe(1);
        const held = castableHeldInteraction(player);
        expect(held.pump).toEqual({ power: 3, toughness: 3 });
        expect(held.removal).toBe(false);
        expect(hasCastableInstantHint(player)).toBe(true);
    });

    it("reads castable removal from a held Lightning Bolt backed by mana", () => {
        const player = makePlayer("p1", {
            hand: [inHand(LIGHTNING_BOLT, "p1", "lb")],
            battlefield: [land(MOUNTAIN, "p1", "m1")],
        });
        const held = castableHeldInteraction(player);
        expect(held.removal).toBe(true);
        expect(held.pump).toBeUndefined();
    });

    it("affordability gate: no open mana = no castable interaction", () => {
        const tappedOut = makePlayer("p1", {
            hand: [inHand(GIANT_GROWTH, "p1", "gg")],
            battlefield: [land(FOREST, "p1", "f1", true)], // tapped
        });
        expect(availableManaFor(tappedOut)).toBe(0);
        expect(castableHeldInteraction(tappedOut).pump).toBeUndefined();
        expect(hasCastableInstantHint(tappedOut)).toBe(false);
    });

    it("empty hand / no hinted instant = no interaction", () => {
        const empty = makePlayer("p1", {
            battlefield: [land(FOREST, "p1", "f1")],
        });
        expect(castableHeldInteraction(empty)).toEqual({ removal: false });
        // A creature (not instant timing) with no hint is ignored.
        const justBear = makePlayer("p1", {
            hand: [inHand(GRIZZLY, "p1", "bear")],
            battlefield: [land(FOREST, "p1", "f1")],
        });
        expect(hasCastableInstantHint(justBear)).toBe(false);
    });
});

describe("attacker pump in predictCombatOutcome (ADR 0021 §B)", () => {
    // Canonical ambush: a 2/2 attacks into a 3/3 blocker.
    const ambushState = () => {
        const bear = makeInstance(GRIZZLY, {
            id: "bait",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const giant = makeInstance(HILL_GIANT, {
            id: "wall",
            controllerId: "p2",
            ownerId: "p2",
        });
        return makeState({
            phase: "DECLARE_ATTACKERS",
            activePlayerId: "p1",
            combat: {
                attackerIds: ["bait"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2", { battlefield: [giant] }),
            ],
        });
    };

    it("WITHOUT a held pump: the bait 2/2 is pre-judged dead into the 3/3", () => {
        const out = predictCombatOutcome(ambushState(), "p1", "p2");
        // The 3/3 survives blocking the 2/2; the 2/2 dies (trade not taken — it
        // can't kill the 3/3 — so it is simply blocked and killed).
        expect(out.deadAttackerIds).toContain("bait");
        expect(out.deadBlockerIds).not.toContain("wall");
    });

    it("WITH a held +3/+3 pump: the bait 5/5 is no longer pre-judged dead", () => {
        const out = predictCombatOutcome(ambushState(), "p1", "p2", {
            power: 3,
            toughness: 3,
        });
        // Modelling the pump, a sensible defender cannot profitably block the
        // 5/5 with a 3/3, so the attacker is NOT pre-judged dead — the core fix
        // that stops the ambush line scoring as a walk into the block. The 3/3
        // (which would die if it traded) is kept home, so the 5/5 connects.
        expect(out.deadAttackerIds).not.toContain("bait");
        expect(out.deadBlockerIds).not.toContain("wall");
        expect(out.faceDamage).toBe(5);
    });
});

describe("cautious multi-block in declaredBlockDelta (ADR 0021 §C)", () => {
    // p2 attacks with one 3/3; the bot (p1, defender) double-blocks with two 2/2s
    // (combined 4 power kills the 3/3 with no trick). p2 holds a +3/+3 pump.
    const multiBlockState = (attackerLoaded: boolean) => {
        const atk = makeInstance(HILL_GIANT, {
            id: "atk",
            controllerId: "p2",
            ownerId: "p2",
            isAttacking: true,
        });
        const b1 = makeInstance(GRIZZLY, {
            id: "b1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const b2 = makeInstance(GRIZZLY, {
            id: "b2",
            controllerId: "p1",
            ownerId: "p1",
        });
        const attackerHand = attackerLoaded
            ? [inHand(GIANT_GROWTH, "p2", "gg")]
            : [];
        const attackerLands = attackerLoaded ? [land(FOREST, "p2", "f2")] : [];
        return makeState({
            phase: "DECLARE_BLOCKERS",
            activePlayerId: "p2", // p2 attacks (CR 508.1)
            combat: {
                attackerIds: ["atk"],
                confirmed: true,
                blockerAssignments: { b1: ["atk"], b2: ["atk"] },
                blockersConfirmed: true,
            },
            players: [
                makePlayer("p1", { battlefield: [b1, b2] }),
                makePlayer("p2", {
                    hand: attackerHand,
                    battlefield: [atk, ...attackerLands],
                }),
            ],
        });
    };

    it("attacker EMPTY-handed: the double-block scores as a clean win", () => {
        const safe = declaredBlockDelta(multiBlockState(false), "p1");
        // No trick to fear — defender's view of the block is strictly positive
        // (kills the 3/3, loses no blocker to a 3-power attacker split two ways).
        expect(safe).toBeGreaterThan(0);
    });

    it("attacker holds a castable pump: the over-committed block is discounted", () => {
        const loaded = declaredBlockDelta(multiBlockState(true), "p1");
        const safe = declaredBlockDelta(multiBlockState(false), "p1");
        // Same physical block, but a loaded attacker makes it riskier: the
        // hedged value is strictly lower than against an empty-handed attacker.
        expect(loaded).toBeLessThan(safe);
    });
});
