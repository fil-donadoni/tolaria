// Bestow (CR 702.103) — the cast mode built in issue #2388, exercised end to
// end on its first (and so far only) card, Springheart Nantuko (MH3).
//
// The project has no convex-test harness for `game.ts` mutations (ADR 0001),
// so — mirroring `buyback.test.ts` / `escape.test.ts` / `flashback.test.ts` —
// the MUTATION layer is driven through the real exported
// `finalizeTargetSelection`, the same function `announceCast` hands a
// completed `pendingTarget` to. Everything downstream of it (the stack item,
// resolution, the SBA sweep, the wire projection, the DB round-trip) is the
// production code path unchanged.
//
// The four rules under test, each in its own describe:
//   702.103b — the spell becomes an Aura enchantment as it is put onto the
//              stack, and the permanent it becomes is a bestowed Aura.
//   702.103e — an illegal target does NOT fizzle it; it keeps resolving as a
//   / 608.3b   creature spell.
//   702.103f — a bestowed Aura that becomes unattached reverts to a creature
//              IN PLACE. Explicitly an exception to CR 704.5m, so the control
//              case (an ordinary Aura) must still be binned.
//   400.7    — a bestowed object that changes zone sheds the Aura type line.

import { describe, it, expect } from "vitest";
import { finalizeTargetSelection } from "../../game";
import {
    getPlayer,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
    type PendingTarget,
} from "../state";
import { checkStateBasedActions } from "../sba";
import { getEffectivePower, getEffectiveToughness } from "../layers";
import { compactState, expandState } from "../serialize";
import { projectPublicState } from "../../gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { springheartNantuko } from "../../cards/sets/mh3/green";
import { grizzlyBears } from "../../cards/sets/lea";
import { unstableMutation } from "../../cards/sets/arn/blue";
import { counterspell } from "../../cards/sets/lea/blue";
import {
    BESTOW_TARGET_REQUIREMENT,
    applyBestowCharacteristics,
    hasLegalBestowHost,
    isBestowAlternativeCost,
    revertBestow,
} from "../bestow";

const NANTUKO = springheartNantuko.id;
const BEARS = grizzlyBears.id;

/** p1 holds Springheart Nantuko in hand with enough floating mana to bestow
 *  it; `hostController` controls a Grizzly Bears to enchant. */
function boardWithHost(hostController: "p1" | "p2" = "p1"): {
    state: GameState;
    host: CardInstanceState;
} {
    const nantuko = makeInstance(NANTUKO, {
        id: "nantuko",
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
    });
    const host = makeInstance(BEARS, {
        id: "host",
        controllerId: hostController,
        ownerId: hostController,
    });
    const state = makeState({
        players: [
            makePlayer("p1", {
                hand: [nantuko],
                battlefield: hostController === "p1" ? [host] : [],
                manaPool: { W: 0, U: 0, B: 0, R: 0, G: 3, C: 3 },
            }),
            makePlayer("p2", {
                battlefield: hostController === "p2" ? [host] : [],
            }),
        ],
    });
    return { state, host };
}

/** The `pendingTarget` `announceCast` builds for a BESTOWED cast: the bestow
 *  alternative cost plus the one creature target its gained "enchant creature"
 *  ability demands (CR 702.103b / 303.4a). */
function bestowPendingTarget(hostId: string): PendingTarget {
    return {
        playerId: "p1",
        cardInstanceId: "nantuko",
        targetType: "Creature",
        count: 1,
        selected: [{ type: "permanent", id: hostId }],
        alternativeCostId: "bestow",
    };
}

/** Casts Nantuko bestowed onto `hostId` and leaves it ON THE STACK. */
function castBestowed(state: GameState, hostId: string) {
    finalizeTargetSelection(state, bestowPendingTarget(hostId), "p1");
    return state.stack.find((s) => s.id === "nantuko")!;
}

describe("Bestow — cast-mode plumbing (CR 702.103a)", () => {
    it("declares its bestow cost as an alternative cost identified by reference", () => {
        expect(springheartNantuko.bestow?.id).toBe("bestow");
        expect(springheartNantuko.bestow?.mana).toEqual({ X: 1, G: 1 });
        expect(
            isBestowAlternativeCost(
                springheartNantuko,
                springheartNantuko.bestow
            )
        ).toBe(true);
        // A DIFFERENT alt cost on the same card is not the bestow one.
        expect(
            isBestowAlternativeCost(springheartNantuko, {
                id: "bestow",
                description: "impostor",
            })
        ).toBe(false);
    });

    it("offers the bestow mode only while some creature could host it (CR 601.2c)", () => {
        const { state } = boardWithHost();
        expect(hasLegalBestowHost(state)).toBe(true);
        // Same board with the creature gone: no legal target, no offer.
        const empty = makeState();
        expect(hasLegalBestowHost(empty)).toBe(false);
    });

    it("takes the 'enchant creature' target requirement, not the card's own", () => {
        // The card is a creature and declares no `targetRequirement` at all —
        // the whole of a bestowed cast's targeting comes from CR 702.103b.
        expect(springheartNantuko.targetRequirement).toBeUndefined();
        expect(BESTOW_TARGET_REQUIREMENT).toEqual({
            type: "Creature",
            count: 1,
        });
    });
});

describe("Bestow — the spell becomes an Aura (CR 702.103b / 205.1a)", () => {
    it("puts an Aura enchantment with no P/T onto the stack, not a creature spell", () => {
        const { state } = boardWithHost();
        const item = castBestowed(state, "host");
        expect(item.bestowed).toBe(true);
        // CR 205.1a — the new card type REPLACES the existing ones, and the
        // new subtypes replace the creature types.
        expect(item.types).toEqual(["Enchantment"]);
        expect(item.subtypes).toEqual(["Aura"]);
        expect(item.power).toBeUndefined();
        expect(item.toughness).toBeUndefined();
        // CR 702.103b — "and gains enchant creature".
        expect(item.grantedEnchantRestriction).toEqual({
            types: ["Creature"],
            players: false,
        });
    });

    it("resolves attached to its target and buffs it +1/+1", () => {
        const { state, host } = boardWithHost();
        castBestowed(state, "host");
        resolveTopOfStack(state);
        checkStateBasedActions(state);

        const p1 = getPlayer(state, "p1");
        const permanent = p1.battlefield.find((c) => c.id === "nantuko")!;
        expect(permanent.zone).toBe("battlefield");
        expect(permanent.attachedTo).toBe("host");
        expect(permanent.bestowed).toBe(true);
        // CR 613 layer 7c — "enchanted creature gets +1/+1".
        expect(getEffectivePower(state, host)).toBe(3);
        expect(getEffectiveToughness(state, host)).toBe(3);
    });

    it("survives the wire projection as an Aura, buff and all", () => {
        const { state, host } = boardWithHost();
        castBestowed(state, "host");
        resolveTopOfStack(state);
        checkStateBasedActions(state);

        const projected = projectPublicState(state, 1, "p1");
        const slimNantuko = projected.players[0].battlefield.find(
            (c) => c.id === "nantuko"
        )!;
        expect(slimNantuko.types).toEqual(["Enchantment"]);
        expect(slimNantuko.subtypes).toEqual(["Aura"]);
        expect(slimNantuko.attachedTo).toBe("host");
        expect(slimNantuko.bestowed).toBe(true);
        const slimHost = projected.players[0].battlefield.find(
            (c) => c.id === host.id
        )!;
        expect(getEffectivePower(projected, slimHost)).toBe(3);
        expect(getEffectiveToughness(projected, slimHost)).toBe(3);
    });

    it("round-trips through the DB compaction with no P/T restored", () => {
        const { state } = boardWithHost();
        castBestowed(state, "host");
        resolveTopOfStack(state);
        checkStateBasedActions(state);

        // Through JSON, not just the in-memory compaction: the DB round-trip
        // is what DROPS an explicit `power: undefined`, and an in-memory
        // `expandState(compactState(...))` keeps the key (so it would pass
        // even with the re-clear in `expandCard` deleted — verified).
        const restored = expandState(
            JSON.parse(JSON.stringify(compactState(state)))
        );
        const permanent = getPlayer(restored, "p1").battlefield.find(
            (c) => c.id === "nantuko"
        )!;
        expect(permanent.bestowed).toBe(true);
        expect(permanent.types).toEqual(["Enchantment"]);
        expect(permanent.subtypes).toEqual(["Aura"]);
        // The definition fallback in `expandCard` would otherwise hand back
        // the printed 1/1: an explicit `undefined` does not survive JSON.
        expect(permanent.power).toBeUndefined();
        expect(permanent.toughness).toBeUndefined();
        expect(permanent.attachedTo).toBe("host");
        // And the SBA sweep on the RESTORED state must not bin it.
        checkStateBasedActions(restored);
        expect(
            getPlayer(restored, "p1").battlefield.some(
                (c) => c.id === "nantuko"
            )
        ).toBe(true);
    });

    it("leaves an ORDINARY (non-bestowed) cast of the same card a 1/1 creature", () => {
        const { state } = boardWithHost();
        finalizeTargetSelection(
            state,
            {
                playerId: "p1",
                cardInstanceId: "nantuko",
                targetType: "any",
                count: 0,
                selected: [],
            },
            "p1"
        );
        const item = state.stack.find((s) => s.id === "nantuko")!;
        expect(item.bestowed).toBeUndefined();
        expect(item.types).toEqual(["Enchantment", "Creature"]);
        expect(item.subtypes).toEqual(["Insect", "Monk"]);
        expect(item.power).toBe(1);
        resolveTopOfStack(state);
        checkStateBasedActions(state);
        const permanent = getPlayer(state, "p1").battlefield.find(
            (c) => c.id === "nantuko"
        )!;
        expect(permanent.attachedTo).toBeUndefined();
        expect(permanent.zone).toBe("battlefield");
    });
});

describe("Bestow — unattached reverts in place (CR 702.103f)", () => {
    it("stays on the battlefield as a creature when its host dies", () => {
        const { state } = boardWithHost();
        castBestowed(state, "host");
        resolveTopOfStack(state);
        checkStateBasedActions(state);

        // The host leaves — the ONLY thing that changes.
        const p1 = getPlayer(state, "p1");
        p1.battlefield = p1.battlefield.filter((c) => c.id !== "host");
        checkStateBasedActions(state);

        const after = getPlayer(state, "p1");
        const permanent = after.battlefield.find((c) => c.id === "nantuko");
        expect(permanent).toBeDefined();
        // CR 702.103f — "it becomes unattached and ceases to be bestowed",
        // and this is an EXCEPTION to CR 704.5m: it is NOT in the graveyard.
        expect(after.graveyard.some((c) => c.id === "nantuko")).toBe(false);
        expect(permanent!.bestowed).toBeUndefined();
        expect(permanent!.attachedTo).toBeUndefined();
        expect(permanent!.grantedEnchantRestriction).toBeUndefined();
        expect(permanent!.types).toEqual(["Enchantment", "Creature"]);
        expect(permanent!.subtypes).toEqual(["Insect", "Monk"]);
        expect(getEffectivePower(state, permanent!)).toBe(1);
        expect(getEffectiveToughness(state, permanent!)).toBe(1);
    });

    it("CONTROL — an ordinary Aura with no host is still put into its owner's graveyard (CR 704.5m)", () => {
        // Unstable Mutation is a printed Aura, not a bestowed one. If the
        // bestow exception ever widened to every Aura, this goes red.
        const aura = makeInstance(unstableMutation.id, {
            id: "aura",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [aura] }),
                makePlayer("p2"),
            ],
        });
        checkStateBasedActions(state);
        const p1 = getPlayer(state, "p1");
        expect(p1.battlefield.some((c) => c.id === "aura")).toBe(false);
        expect(p1.graveyard.some((c) => c.id === "aura")).toBe(true);
    });
});

describe("Bestow — an illegal target resolves as a creature spell (CR 702.103e / 608.3b)", () => {
    it("enters the battlefield unattached instead of fizzling", () => {
        const { state } = boardWithHost();
        castBestowed(state, "host");
        // The host leaves in response — CR 608.2b would counter an ordinary
        // Aura spell here.
        const p1 = getPlayer(state, "p1");
        p1.battlefield = p1.battlefield.filter((c) => c.id !== "host");

        resolveTopOfStack(state);
        checkStateBasedActions(state);

        const after = getPlayer(state, "p1");
        const permanent = after.battlefield.find((c) => c.id === "nantuko");
        expect(permanent).toBeDefined();
        expect(after.graveyard.some((c) => c.id === "nantuko")).toBe(false);
        expect(permanent!.bestowed).toBeUndefined();
        expect(permanent!.attachedTo).toBeUndefined();
        expect(permanent!.types).toEqual(["Enchantment", "Creature"]);
        expect(getEffectivePower(state, permanent!)).toBe(1);
    });

    it("CONTROL — an ordinary Aura spell whose target left IS countered (CR 608.2b)", () => {
        const bear = makeInstance(BEARS, { id: "bear", controllerId: "p1" });
        const aura = makeInstance(unstableMutation.id, {
            id: "aura",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [aura],
                    battlefield: [bear],
                    manaPool: { W: 0, U: 3, B: 0, R: 0, G: 0, C: 0 },
                }),
                makePlayer("p2"),
            ],
        });
        finalizeTargetSelection(
            state,
            {
                playerId: "p1",
                cardInstanceId: "aura",
                targetType: "Creature",
                count: 1,
                selected: [{ type: "permanent", id: "bear" }],
            },
            "p1"
        );
        const p1 = getPlayer(state, "p1");
        p1.battlefield = p1.battlefield.filter((c) => c.id !== "bear");
        resolveTopOfStack(state);
        const after = getPlayer(state, "p1");
        expect(after.battlefield.some((c) => c.id === "aura")).toBe(false);
        expect(after.graveyard.some((c) => c.id === "aura")).toBe(true);
    });
});

describe("Bestow — CR 400.7 zone-change reverts", () => {
    it("a bestowed permanent leaving the battlefield lands as its printed self", () => {
        const { state } = boardWithHost();
        castBestowed(state, "host");
        resolveTopOfStack(state);
        checkStateBasedActions(state);

        const permanent = getPlayer(state, "p1").battlefield.find(
            (c) => c.id === "nantuko"
        )!;
        // Reach the departure chokepoint directly — every destroy / sacrifice
        // / bounce path funnels through it.
        revertBestow(permanent);
        expect(permanent.types).toEqual(["Enchantment", "Creature"]);
        expect(permanent.subtypes).toEqual(["Insect", "Monk"]);
        expect(permanent.power).toBe(1);
        expect(permanent.toughness).toBe(1);
        expect(permanent.bestowed).toBeUndefined();
    });

    it("a COUNTERED bestowed spell lands in the graveyard as its printed self", () => {
        const { state } = boardWithHost();
        castBestowed(state, "host");
        // CR 701.5a — counter it while it is an Aura spell on the stack.
        const bolt = makeInstance(counterspell.id, {
            id: "cs",
            controllerId: "p2",
            ownerId: "p2",
            zone: "stack",
        });
        state.stack.push({
            ...bolt,
            castById: "p2",
            targets: [{ type: "spell", id: "nantuko" }],
        });
        resolveTopOfStack(state);

        const p1 = getPlayer(state, "p1");
        const inYard = p1.graveyard.find((c) => c.id === "nantuko")!;
        expect(inYard).toBeDefined();
        // CR 400.7 — the object in the graveyard is a new one with its
        // printed characteristics; a leaked Aura type line would hide it from
        // every "creature card in your graveyard" effect.
        expect(inYard.bestowed).toBeUndefined();
        expect(inYard.types).toEqual(["Enchantment", "Creature"]);
        expect(inYard.subtypes).toEqual(["Insect", "Monk"]);
        expect(inYard.power).toBe(1);
        expect(inYard.grantedEnchantRestriction).toBeUndefined();
    });

    it("applyBestowCharacteristics is idempotent", () => {
        const card = makeInstance(NANTUKO, { id: "n", controllerId: "p1" });
        applyBestowCharacteristics(card);
        applyBestowCharacteristics(card);
        expect(card.types).toEqual(["Enchantment"]);
        expect(card.subtypes).toEqual(["Aura"]);
    });

    it("revertBestow is a no-op on an object that was never bestowed", () => {
        const card = makeInstance(BEARS, { id: "b", controllerId: "p1" });
        const before = structuredClone(card);
        revertBestow(card);
        expect(card).toEqual(before);
    });
});
