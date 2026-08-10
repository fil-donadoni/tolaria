// CR 702.29c/d — "When you cycle this card": a triggered ability whose SOURCE
// is the card that was just discarded to pay an activation cost of a cycling
// ability (issue #2442).
//
//   702.29c  Some cards with cycling have abilities that trigger when they're
//            cycled. "When you cycle this card" means "When you discard this
//            card to pay an activation cost of a cycling ability." These
//            abilities trigger from whatever zone the card winds up in after
//            it's cycled.
//   702.29d  Some cards have abilities that trigger whenever a player "cycles
//            or discards" a card. These abilities trigger only once when a card
//            is cycled.
//   702.29f  Typecycling abilities are cycling abilities […] Any cards that
//            trigger when a player cycles a card will trigger when a card is
//            discarded to pay an activation cost of a typecycling ability.
//
// This is the CAPABILITY test for an engine feature with no card exposing it —
// no catalogue card prints "When you cycle this card" today, and shipping one
// is a separate card ticket. Same shape (and the same `preloadDefinitions`
// seam) as `self-cast-trigger.test.ts`, which covers `functionsFromStack`.
//
// The two halves under test are opposites and BOTH matter:
//   1. a cycling / TYPEcycling cost payment DOES fire the trigger, with the
//      source found outside the battlefield;
//   2. every OTHER discard producer in the engine does NOT — one row per
//      producer from the census in the PR for #2442.
//
// Everything runs through the REAL primitives: `buildPendingActivation` +
// `tryAutoCommitPendingActivation` (what the `activateAbility` mutation calls),
// the real `discardToGraveyard` choke point, the real `collectTriggers`, the
// real `resolveTopOfStack`, and `projectPublicState` for the surface assertion.

import { describe, it, expect } from "vitest";
import { getDefinition, preloadDefinitions } from "../../cards";
import type { CardDefinition } from "../../cards/types";
import {
    cyclingAbility,
    typecyclingAbility,
    cycledTrigger,
} from "../../cards/abilities/cycling";
import {
    activateAbilityOnState,
    buildPendingActivation,
    tryAutoCommitPendingActivation,
} from "../../game";
import { compactState, expandState } from "../serialize";
import {
    discardCardsAtRandom,
    discardToGraveyard,
    normalizeManaCost,
    resolveTopOfStack,
    payDiscardLastDrawn,
    getPlayer,
    type GameState,
} from "../state";
import { collectTriggers } from "../triggers";
import { advancePhase } from "../phases";
import { applyPendingChoiceSubmit } from "../pendingChoiceSubmit";
import { projectPublicState } from "../../gameProjections";
import { maraudingMako } from "../../cards/sets/dft/red";
import { grizzlyBears } from "../../cards/sets/lea";
import { forest } from "../../cards/sets/lea";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";

const CYCLER_ID = "00000000-0000-4000-8000-000024420001";
const TYPECYCLER_ID = "00000000-0000-4000-8000-000024420002";
const PLAIN_DISCARD_ID = "00000000-0000-4000-8000-000024420003";
const MADNESS_CYCLER_ID = "00000000-0000-4000-8000-000024420004";

const CYCLED_TRIGGER = "synthetic-cycled";
const MAKO_DISCARD_TRIGGER = "marauding-mako-discard";

/** The 702.29c template under test, with an observable body. */
const cycledLifeGain = () =>
    cycledTrigger({
        id: CYCLED_TRIGGER,
        oracleText: "When you cycle this card, you gain 3 life.",
        effects: [{ op: "gainLife", player: "controller", amount: 3 }],
    });

preloadDefinitions([
    {
        id: CYCLER_ID,
        name: "Synthetic Cycler",
        rarity: "rare",
        manaCost: { generic: 2 },
        types: ["Creature"],
        subtypes: ["Bird"],
        power: 1,
        toughness: 1,
        activatedAbilities: [cyclingAbility({ generic: 1 })],
        triggeredAbilities: [cycledLifeGain()],
    } as CardDefinition,
    {
        // CR 702.29f — a typecycling ability IS a cycling ability, so the SAME
        // trigger must fire off its cost payment.
        id: TYPECYCLER_ID,
        name: "Synthetic Forestcycler",
        rarity: "rare",
        manaCost: { generic: 2 },
        types: ["Creature"],
        subtypes: ["Bird"],
        power: 1,
        toughness: 1,
        activatedAbilities: [typecyclingAbility({ generic: 1 }, "Forest")],
        triggeredAbilities: [cycledLifeGain()],
    } as CardDefinition,
    {
        // The must-NOT twin: a `discardThis` activation cost that is NOT a
        // cycling cost (the Harvester of Misery shape, `sets/big/black.ts`).
        // Identical in every respect except the `cyclingCost` marker.
        id: PLAIN_DISCARD_ID,
        name: "Synthetic Discarder",
        rarity: "rare",
        manaCost: { generic: 2 },
        types: ["Creature"],
        subtypes: ["Bird"],
        power: 1,
        toughness: 1,
        activatedAbilities: [
            {
                id: "plain-discard",
                oracleText: "{1}, Discard this card: Draw a card.",
                cost: { mana: { generic: 1 }, discardThis: true },
                activateFromHand: true,
                useStack: true,
                effects: [{ op: "draw", player: "controller", count: 1 }],
            },
        ],
        triggeredAbilities: [cycledLifeGain()],
    } as CardDefinition,
    {
        // CR 702.29c last sentence — "from whatever zone the card winds up in".
        // Madness (CR 702.35c) replaces the graveyard destination with exile, so
        // this card is cycled straight into exile and the trigger must still be
        // collected there.
        id: MADNESS_CYCLER_ID,
        name: "Synthetic Madness Cycler",
        rarity: "rare",
        manaCost: { generic: 2 },
        types: ["Creature"],
        subtypes: ["Bird"],
        power: 1,
        toughness: 1,
        madness: { generic: 1 },
        activatedAbilities: [cyclingAbility({ generic: 1 })],
        triggeredAbilities: [cycledLifeGain()],
    } as CardDefinition,
]);

/** A one-player-relevant board: `cardId` in hand, a card to draw, mana floating
 *  so an activation auto-commits, and optionally Marauding Mako in play. */
function boardWith(
    cardId: string,
    opts: { instanceId?: string; mako?: boolean; library?: string[] } = {}
): GameState {
    const source = makeInstance(cardId, {
        id: opts.instanceId ?? "src",
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
    });
    const library = (opts.library ?? [grizzlyBears.id]).map((id, i) =>
        makeInstance(id, {
            id: `lib-${i}`,
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        })
    );
    return makeState({
        players: [
            makePlayer("p1", {
                hand: [source],
                library,
                battlefield: opts.mako
                    ? [
                          makeInstance(maraudingMako.id, {
                              id: "mako",
                              controllerId: "p1",
                              ownerId: "p1",
                              zone: "battlefield",
                          }),
                      ]
                    : [],
                manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 3 },
            }),
            makePlayer("p2"),
        ],
    });
}

/** Replicates the `activateAbility` mutation's from-hand activation path over
 *  the real exported cost primitives. */
function activateFromHand(
    state: GameState,
    cardId: string,
    abilityId: string,
    instanceId = "src"
) {
    const ability = makeInstanceAbility(cardId, abilityId);
    state.pendingActivation = buildPendingActivation({
        playerId: "p1",
        cardInstanceId: instanceId,
        abilityId,
        ability,
        manaCost: ability.cost.mana
            ? normalizeManaCost(ability.cost.mana)
            : undefined,
        fromHand: true,
    });
    return tryAutoCommitPendingActivation(state, "p1");
}

/** Reads the ability through the registry seam, exactly as the mutation does. */
function makeInstanceAbility(cardId: string, abilityId: string) {
    const ability = getDefinition(cardId).activatedAbilities?.find(
        (a) => a.id === abilityId
    );
    if (!ability) throw new Error(`no ability ${abilityId} on ${cardId}`);
    return ability;
}

const stackTriggers = (state: GameState, abilityId: string) =>
    state.stack.filter((s) => s.triggeredAbilityId === abilityId);

/** Counts a trigger wherever collection left it: on the stack when it is the
 *  only one, or held off-stack in the batch when CR 603.3b needs an ordering. */
const allTriggers = (state: GameState, abilityId: string) =>
    stackTriggers(state, abilityId).length +
    (state.pendingTriggerBatch ?? []).filter(
        (t) => t.triggeredAbilityId === abilityId
    ).length;

describe('"When you cycle this card" (CR 702.29c)', () => {
    it("fires on a cycling cost payment, with the source in the graveyard", () => {
        const state = boardWith(CYCLER_ID);
        const lifeBefore = getPlayer(state, "p1").life;

        expect(activateFromHand(state, CYCLER_ID, "cycling")).not.toBeNull();

        // CR 702.29c — the trigger was collected with the source already in the
        // zone it wound up in.
        expect(
            getPlayer(state, "p1").graveyard.some((c) => c.id === "src")
        ).toBe(true);
        expect(stackTriggers(state, CYCLED_TRIGGER)).toHaveLength(1);

        // The trigger sits ABOVE the cycling ability it was created by, and its
        // source is the cycled card.
        const trig = stackTriggers(state, CYCLED_TRIGGER)[0];
        expect(trig.triggerSourceId).toBe("src");

        while (state.stack.length > 0) resolveTopOfStack(state);
        expect(getPlayer(state, "p1").life).toBe(lifeBefore + 3);
        // The cycling draw resolved too.
        expect(getPlayer(state, "p1").hand.some((c) => c.id === "lib-0")).toBe(
            true
        );

        // SURFACE — the life gain survives the wire projection (the reducer the
        // client actually reads).
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].life).toBe(lifeBefore + 3);
    });

    it("fires on the INLINE-COMMIT activation path (mana already floating)", () => {
        // `activateAbility` has TWO commit paths and they pay the discard-this
        // cost at two different call sites. The `buildPendingActivation` +
        // `tryAutoCommitPendingActivation` pair above is the deferred one; when
        // the mana cost is already covered by the floating pool
        // (`manaUncovered === false`) `activateAbilityOnState` skips the payment
        // phase entirely and commits INLINE, from its own
        // `discardToGraveyard(..., cyclingCost ? "cycling" : undefined)` call.
        // Both must mark the CARD_DISCARDED event, or cycling triggers are dead
        // for every activation made with mana already in the pool.
        const state = boardWith(CYCLER_ID);
        const lifeBefore = getPlayer(state, "p1").life;

        activateAbilityOnState(state, {
            playerId: "p1",
            cardInstanceId: "src",
            abilityId: "cycling",
        });

        // This only confirms the activation completed with no pending payment
        // left behind — a successful DEFERRED commit also clears
        // `pendingActivation`, so the assertion alone does not discriminate
        // between the two paths. What actually forces the inline branch here
        // is the board setup: {C}{C}{C} floating against this {1} cycling
        // cost makes `manaUncovered === false` at `convex/game.ts:12939`, so
        // `activateAbilityOnState` commits inline instead of deferring. If
        // cycling ever grows a non-mana cost component (sacrifice / exile /
        // tapOther / discardFilter), that setup would stop forcing the
        // inline branch and this test would silently degenerate into a
        // duplicate of the deferred-path test above.
        expect(state.pendingActivation).toBeUndefined();
        expect(
            getPlayer(state, "p1").graveyard.some((c) => c.id === "src")
        ).toBe(true);
        expect(allTriggers(state, CYCLED_TRIGGER)).toBe(1);

        while (state.stack.length > 0) resolveTopOfStack(state);
        expect(getPlayer(state, "p1").life).toBe(lifeBefore + 3);
    });

    it("fires on a TYPEcycling cost payment too (CR 702.29f)", () => {
        const state = boardWith(TYPECYCLER_ID, { library: [forest.id] });
        expect(
            activateFromHand(state, TYPECYCLER_ID, "cycling")
        ).not.toBeNull();

        expect(
            getPlayer(state, "p1").graveyard.some((c) => c.id === "src")
        ).toBe(true);
        expect(stackTriggers(state, CYCLED_TRIGGER)).toHaveLength(1);
    });

    it("is collected from EXILE when the cycled card winds up there (CR 702.29c)", () => {
        // Madness (CR 702.35c) replaces the discard's graveyard destination with
        // exile. "These abilities trigger from whatever zone the card winds up
        // in after it's cycled" — so the trigger must still be found.
        const state = boardWith(MADNESS_CYCLER_ID);
        expect(
            activateFromHand(state, MADNESS_CYCLER_ID, "cycling")
        ).not.toBeNull();

        expect(getPlayer(state, "p1").exile.some((c) => c.id === "src")).toBe(
            true
        );
        expect(
            getPlayer(state, "p1").graveyard.some((c) => c.id === "src")
        ).toBe(false);
        expect(stackTriggers(state, CYCLED_TRIGGER)).toHaveLength(1);
    });
});

describe("CR 702.29d — one event, so a cycled card triggers each ability once", () => {
    it('fires a "cycles or discards" ability EXACTLY once alongside the cycle trigger', () => {
        const state = boardWith(CYCLER_ID, { mako: true });
        const lifeBefore = getPlayer(state, "p1").life;
        expect(activateFromHand(state, CYCLER_ID, "cycling")).not.toBeNull();

        // CR 603.3b — two triggers, one controller: the batch waits off-stack
        // for an ordering. Both are here EXACTLY once, each carrying the SAME
        // single CARD_DISCARDED event — the property that makes 702.29d hold.
        // A second (CARD_CYCLED) event would double Marauding Mako.
        const batch = state.pendingTriggerBatch ?? [];
        expect(
            batch.filter((t) => t.triggeredAbilityId === MAKO_DISCARD_TRIGGER)
        ).toHaveLength(1);
        expect(
            batch.filter((t) => t.triggeredAbilityId === CYCLED_TRIGGER)
        ).toHaveLength(1);
        const firingEvents = new Set(
            batch.map((t) => JSON.stringify(t.triggerEvent))
        );
        expect(firingEvents.size).toBe(1);
        expect([...firingEvents][0]).toContain('"cause":"cycling"');

        // Order them through the REAL submit path and resolve everything.
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("trigger-order");
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: [...(head.candidateIds ?? [])],
        });
        while (state.stack.length > 0) resolveTopOfStack(state);

        // Mako grew by exactly ONE counter (CR 702.29d) and the cycle trigger
        // resolved once.
        const mako = getPlayer(state, "p1").battlefield.find(
            (c) => c.id === "mako"
        )!;
        expect(mako.counters?.["+1/+1"]).toBe(1);
        expect(getPlayer(state, "p1").life).toBe(lifeBefore + 3);
    });

    it("does not fire a battlefield discard-watcher off its OWN discard from the graveyard", () => {
        // Marauding Mako itself discarded: its "whenever you discard" ability
        // functions only on the battlefield (CR 603.6), and the new own-discard
        // pass is fail-closed (no `functionsFromOwnDiscard`), so nothing fires.
        const mako = makeInstance(maraudingMako.id, {
            id: "mako",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [makePlayer("p1", { hand: [mako] }), makePlayer("p2")],
        });
        discardToGraveyard(state, "p1", "mako");
        const triggers = collectTriggers(state, state.pendingEvents ?? []);
        expect(triggers).toHaveLength(0);
    });
});

// One row per production discard producer that must NOT be marked as cycling.
// Census (11 sites) in the PR for #2442; the five sites that reach
// `discardToGraveyard` with no cause argument at all (the Effect Script
// `discard` Op, the alternative-cost hand-discard leg, `payMayPayCost`, the
// `discardFilter` activation cost, and the bot search's simulation of it) share
// the choke-point default exercised by the first case here.
describe("CR 702.29c — an ordinary discard is NOT a cycling discard", () => {
    const cycledFires = (state: GameState) =>
        collectTriggers(state, state.pendingEvents ?? []).some(
            (t) => t.triggeredAbilityId === CYCLED_TRIGGER
        );

    it("choke-point default: an effect-driven discard leaves `cause` unset", () => {
        const state = boardWith(CYCLER_ID);
        discardToGraveyard(state, "p1", "src");
        const [event] = (state.pendingEvents ?? []).filter(
            (e) => e.type === "CARD_DISCARDED"
        );
        expect(event).toBeDefined();
        expect(
            (event as { cause?: string }).cause ?? undefined
        ).toBeUndefined();
        expect(cycledFires(state)).toBe(false);
    });

    it("a random discard does not fire it (CR 701.8a — Rag Man / Coral Helm)", () => {
        const state = boardWith(CYCLER_ID);
        discardCardsAtRandom(state, "p1", 1);
        expect(
            getPlayer(state, "p1").graveyard.some((c) => c.id === "src")
        ).toBe(true);
        expect(cycledFires(state)).toBe(false);
    });

    it("Jandor's Ring's discard-last-drawn COST does not fire it (CR 118.3)", () => {
        const state = boardWith(CYCLER_ID);
        getPlayer(state, "p1").lastDrawnCardId = "src";
        payDiscardLastDrawn(state, getPlayer(state, "p1"));
        expect(
            getPlayer(state, "p1").graveyard.some((c) => c.id === "src")
        ).toBe(true);
        expect(cycledFires(state)).toBe(false);
    });

    it("the CR 514.1 cleanup hand-size discard does not fire it", () => {
        const cycler = makeInstance(CYCLER_ID, {
            id: "src",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const filler = Array.from({ length: 7 }, (_, i) =>
            makeInstance(grizzlyBears.id, {
                id: `f${i}`,
                controllerId: "p1",
                ownerId: "p1",
                zone: "hand",
            })
        );
        const state = makeState({
            phase: "END_STEP",
            turn: 1,
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", { hand: [cycler, ...filler] }),
                makePlayer("p2"),
            ],
        });
        // END_STEP → CLEANUP enqueues the CR 514.1 discard-hand choice; submit
        // the cycler through the REAL commit path.
        advancePhase(state);
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("discard-hand");
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["src"],
        });
        expect(
            getPlayer(state, "p1").graveyard.some((c) => c.id === "src")
        ).toBe(true);
        expect(stackTriggers(state, CYCLED_TRIGGER)).toHaveLength(0);
        expect(cycledFires(state)).toBe(false);
    });

    it("a NON-cycling `discardThis` activation cost does not fire it", () => {
        // The Harvester of Misery shape: same cost leg, no cycling marker.
        const state = boardWith(PLAIN_DISCARD_ID);
        expect(
            activateFromHand(state, PLAIN_DISCARD_ID, "plain-discard")
        ).not.toBeNull();
        expect(
            getPlayer(state, "p1").graveyard.some((c) => c.id === "src")
        ).toBe(true);
        expect(stackTriggers(state, CYCLED_TRIGGER)).toHaveLength(0);
    });
});

describe("serialization round-trip (CR 702.29c signal)", () => {
    it('keeps `cause: "cycling"` on a pending discard event and `cyclingCost` on a parked activation', () => {
        const state = boardWith(CYCLER_ID);
        // Park the activation with no mana available so `cyclingCost` rides on
        // `state.pendingActivation` at a stable save point.
        getPlayer(state, "p1").manaPool = {
            W: 0,
            U: 0,
            B: 0,
            R: 0,
            G: 0,
            C: 0,
        };
        activateFromHand(state, CYCLER_ID, "cycling");
        expect(state.pendingActivation?.cyclingCost).toBe(true);

        // And a discard event carrying the cause.
        const cycled = boardWith(CYCLER_ID);
        discardToGraveyard(cycled, "p1", "src", "cycling");
        state.pendingEvents = cycled.pendingEvents;

        const round: GameState = expandState(compactState(state));
        expect(round.pendingActivation?.cyclingCost).toBe(true);
        const event = (round.pendingEvents ?? []).find(
            (e: { type: string }) => e.type === "CARD_DISCARDED"
        );
        expect(event).toBeDefined();
        expect((event as { cause?: string }).cause).toBe("cycling");
    });
});
