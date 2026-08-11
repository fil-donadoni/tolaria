import { describe, it, expect } from "vitest";
import {
    getLegalActions,
    assertLegalAction,
    raiseTriggerTargetSelection,
} from "../rules";
import type {
    CardInstanceState,
    GameState,
    PendingTarget,
    PlayerState,
    StackItem,
} from "../state";
import { makeInstance } from "../../cards/__tests__/setup";
import {
    ancestralRecall,
    armageddon,
    birdsOfParadise,
    crusade,
    fireball,
    giantGrowth,
    grizzlyBears,
    lightningBolt,
    mountain,
    plains,
    savannahLions,
} from "../../cards/sets/lea";
import { naturalOrder } from "../../cards/sets/vis";
import { soulExchange } from "../../cards/sets/fem";
import { subtlety } from "../../cards/sets/mh2/blue";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function card(
    cardId: string,
    overrides: Partial<CardInstanceState> = {}
): CardInstanceState {
    return makeInstance(cardId, overrides);
}

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
    return {
        id: "p1",
        name: "Player 1",
        bgColor: "#000",
        life: 20,
        hand: [],
        library: [],
        graveyard: [],
        exile: [],
        battlefield: [],
        // Default to ample mana so timing-focused tests aren't gated by the
        // canCast mana check (CR 601.2f). Tests that exercise the mana check
        // explicitly override manaPool / battlefield.
        manaPool: { W: 5, U: 5, B: 5, R: 5, G: 5, C: 5 },
        ...overrides,
    };
}

function makeGameState(overrides: Partial<GameState> = {}): GameState {
    return {
        players: [makePlayer({ id: "p1" }), makePlayer({ id: "p2" })],
        stack: [],
        turn: 1,
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        passCount: 0,
        phase: "PRECOMBAT_MAIN",
        rngSeed: 0,
        rngCounter: 0,
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// getLegalActions — CR 601.2 (casting), CR 305.2 (playing lands)
// ---------------------------------------------------------------------------

describe("getLegalActions", () => {
    describe("lands (CR 305.2)", () => {
        it('land cards in HAND have "play" action', () => {
            const state = makeGameState();
            const land = card(plains.id);
            const player = makePlayer({ hand: [land] });

            const actions = getLegalActions(state, player, land);
            expect(actions).toContain("play");
        });

        it('land cards do NOT have "cast" action (CR 305.1 — lands are not spells)', () => {
            const state = makeGameState();
            const land = card(plains.id);
            const player = makePlayer({ hand: [land] });

            const actions = getLegalActions(state, player, land);
            expect(actions).not.toContain("cast");
        });

        it('blocks "play" once the per-turn land drop is spent (CR 305.2)', () => {
            const land = card(plains.id);
            const state = makeGameState();
            const player = makePlayer({
                hand: [land],
                landsPlayedThisTurn: 1,
            });

            const actions = getLegalActions(state, player, land);
            expect(actions).not.toContain("play");
        });

        it("treats undefined landsPlayedThisTurn as 0 (CR 305.2)", () => {
            const land = card(plains.id);
            const state = makeGameState();
            const player = makePlayer({
                hand: [land],
                landsPlayedThisTurn: undefined,
            });

            const actions = getLegalActions(state, player, land);
            expect(actions).toContain("play");
        });

        // CR 305.9 (issue #1689) — a land can be played ONLY from hand
        // unless an effect explicitly grants otherwise. A land sitting in
        // ANY other zone with no such permission must expose no "play"
        // action, even when timing/lock/drop-count would otherwise allow it.
        it('a land NOT in any zone (no hand/graveyard-permission/exile-grant) has NO "play" action', () => {
            const state = makeGameState();
            const player = makePlayer();
            const land = card(plains.id);

            const actions = getLegalActions(state, player, land);
            expect(actions).not.toContain("play");
        });

        it('a land in the GRAVEYARD with no play-from-graveyard permission has NO "play" action', () => {
            const land = card(plains.id, { zone: "graveyard" });
            const state = makeGameState();
            const player = makePlayer({ graveyard: [land] });

            const actions = getLegalActions(state, player, land);
            expect(actions).not.toContain("play");
        });

        it('a land in the EXILE zone with no cast-from-exile grant has NO "play" action', () => {
            const land = card(plains.id, { zone: "exile" });
            const state = makeGameState();
            const player = makePlayer({ exile: [land] });

            const actions = getLegalActions(state, player, land);
            expect(actions).not.toContain("play");
        });

        it('a land in the EXILE zone under a CAST-ONLY grant (no castableFromExileIncludesLand) has NO "play" action', () => {
            const land = card(plains.id, {
                zone: "exile",
                castableFromExileBy: "p1",
            });
            const state = makeGameState();
            const player = makePlayer({ exile: [land] });

            const actions = getLegalActions(state, player, land);
            expect(actions).not.toContain("play");
            expect(actions).not.toContain("cast");
        });

        it('a land in an OPPONENT\'s hand has NO "play" action for the viewing player', () => {
            const land = card(plains.id, { zone: "hand" });
            const state = makeGameState();
            // `land` lives in p2's hand; `player` (p1) has no zone containing it.
            const player = makePlayer({ id: "p1" });

            const actions = getLegalActions(state, player, land);
            expect(actions).not.toContain("play");
        });
    });

    describe("creatures (sorcery speed — CR 307.1 by analogy)", () => {
        it("creature can be cast when stack is empty", () => {
            const state = makeGameState();
            const player = makePlayer();
            const lion = card(savannahLions.id);

            const actions = getLegalActions(state, player, lion);
            expect(actions).toContain("cast");
        });

        it("creature cannot be cast when stack is non-empty (sorcery timing)", () => {
            const state = makeGameState({
                stack: [
                    {
                        ...card(lightningBolt.id, { zone: "stack" }),
                        castById: "p2",
                    },
                ],
            });
            const player = makePlayer();
            const lion = card(savannahLions.id);

            const actions = getLegalActions(state, player, lion);
            expect(actions).not.toContain("cast");
        });

        it('creature does NOT have "play" action', () => {
            const state = makeGameState();
            const player = makePlayer();
            const lion = card(savannahLions.id);

            const actions = getLegalActions(state, player, lion);
            expect(actions).not.toContain("play");
        });
    });

    describe("flash creatures (CR 702.8 — instant timing)", () => {
        it("flash creature CAN be cast responding to an opponent's spell on the stack", () => {
            // Regression: getLegalActions' local instant-timing helper carried a
            // `// TODO: check for Flash keyword` and ignored the keyword, so flash
            // permanents (Subtlety, MH2 #1205) were gated to sorcery timing and
            // could never be flashed in on an opponent's spell. Now delegates to
            // the canonical `hasInstantSpeed` (constants.ts).
            const state = makeGameState({
                stack: [
                    {
                        ...card(savannahLions.id, { zone: "stack" }),
                        castById: "p2",
                    },
                ],
            });
            const player = makePlayer();
            const flasher = card(subtlety.id);
            expect(flasher.staticAbilities).toContain("flash");

            const actions = getLegalActions(state, player, flasher);
            expect(actions).toContain("cast");
        });
    });

    describe("instants (CR 304.1 — can be cast any time priority is held)", () => {
        it("instant can be cast with empty stack", () => {
            const state = makeGameState();
            const player = makePlayer();
            const bolt = card(lightningBolt.id);

            const actions = getLegalActions(state, player, bolt);
            expect(actions).toContain("cast");
        });

        it("instant can be cast with non-empty stack (responding)", () => {
            const state = makeGameState({
                stack: [
                    {
                        ...card(savannahLions.id, { zone: "stack" }),
                        castById: "p1",
                    },
                ],
            });
            const player = makePlayer();
            const bolt = card(lightningBolt.id);

            const actions = getLegalActions(state, player, bolt);
            expect(actions).toContain("cast");
        });

        it("instant does NOT have play action", () => {
            const state = makeGameState();
            const player = makePlayer();
            const bolt = card(lightningBolt.id);

            const actions = getLegalActions(state, player, bolt);
            expect(actions).not.toContain("play");
        });
    });

    describe("sorceries (CR 307.1 — sorcery timing only)", () => {
        it("sorcery can be cast with empty stack", () => {
            const state = makeGameState();
            const player = makePlayer();
            const sorcery = card(armageddon.id);

            const actions = getLegalActions(state, player, sorcery);
            expect(actions).toContain("cast");
        });

        it("sorcery cannot be cast with non-empty stack", () => {
            const state = makeGameState({
                stack: [
                    {
                        ...card(lightningBolt.id, { zone: "stack" }),
                        castById: "p2",
                    },
                ],
            });
            const player = makePlayer();
            const sorcery = card(armageddon.id);

            const actions = getLegalActions(state, player, sorcery);
            expect(actions).not.toContain("cast");
        });
    });

    describe("enchantments (sorcery timing — CR 303.1 by analogy)", () => {
        it("enchantment can be cast with empty stack", () => {
            const state = makeGameState();
            const player = makePlayer();
            const aura = card(crusade.id);

            const actions = getLegalActions(state, player, aura);
            expect(actions).toContain("cast");
        });

        it("enchantment cannot be cast with non-empty stack", () => {
            const state = makeGameState({
                stack: [
                    {
                        ...card(giantGrowth.id, { zone: "stack" }),
                        castById: "p1",
                    },
                ],
            });
            const player = makePlayer();
            const aura = card(crusade.id);

            const actions = getLegalActions(state, player, aura);
            expect(actions).not.toContain("cast");
        });
    });

    describe("priority (CR 117.1)", () => {
        it("returns no actions when player does not have priority", () => {
            const state = makeGameState({ priorityPlayerId: "p2" });
            const player = makePlayer({ id: "p1" });
            const land = card(plains.id);
            const instant = card(lightningBolt.id);
            const creature = card(savannahLions.id);

            expect(getLegalActions(state, player, land)).toEqual([]);
            expect(getLegalActions(state, player, instant)).toEqual([]);
            expect(getLegalActions(state, player, creature)).toEqual([]);
        });

        it("returns actions when player has priority", () => {
            const state = makeGameState({ priorityPlayerId: "p1" });
            const player = makePlayer({ id: "p1" });
            const bolt = card(lightningBolt.id);

            expect(getLegalActions(state, player, bolt)).toContain("cast");
        });
    });

    // The mobile double-swipe bug: the payer KEEPS priority while a cast /
    // activation payment is parked, so the priority gate above passes and the
    // projection kept advertising `cast` on every hand card. The client arms
    // its commit gesture off exactly that list, so a second swipe fired an
    // `announceCast` the server was guaranteed to reject with "Another spell is
    // already being cast" — surfaced in production as a bare "Server Error".
    describe("pending interaction (ADR 0047)", () => {
        const pendingCast = {
            playerId: "p1",
            cardInstanceId: "some-spell",
            manaCost: { R: 1 },
            tappedLandIds: [],
        };

        it("returns no actions while this player's cast payment is parked", () => {
            const state = makeGameState({ pendingCast });
            const player = makePlayer({ id: "p1" });

            expect(getLegalActions(state, player, card(plains.id))).toEqual([]);
            expect(
                getLegalActions(state, player, card(lightningBolt.id))
            ).toEqual([]);
        });

        it("returns no actions while an activation payment is parked", () => {
            const state = makeGameState({
                pendingActivation: {
                    playerId: "p1",
                    cardInstanceId: "some-permanent",
                    abilityId: "some-ability",
                    manaCost: { R: 1 },
                    tappedLandIds: [],
                    tapSource: false,
                    sacrificeSource: false,
                },
            });
            const player = makePlayer({ id: "p1" });

            expect(
                getLegalActions(state, player, card(lightningBolt.id))
            ).toEqual([]);
        });

        it("returns no actions while target selection is open", () => {
            const state = makeGameState({
                pendingTarget: {
                    playerId: "p1",
                    cardInstanceId: "some-spell",
                    targetType: "Creature",
                    count: 1,
                    selected: [],
                },
            });
            const player = makePlayer({ id: "p1" });

            expect(
                getLegalActions(state, player, card(lightningBolt.id))
            ).toEqual([]);
        });

        it("returns no actions while a mid-resolution choice is open (CR 608.2)", () => {
            const state = makeGameState({
                pendingChoices: [
                    {
                        stackItemId: "si-1",
                        step: 0,
                        choiceId: "c-1",
                        count: 1,
                        playerId: "p1",
                        kind: "may-pay",
                        prompt: "Pay {1}?",
                    },
                ],
            });
            const player = makePlayer({ id: "p1" });

            expect(
                getLegalActions(state, player, card(lightningBolt.id))
            ).toEqual([]);
        });

        it("restores actions once the pending interaction clears", () => {
            const state = makeGameState();
            const player = makePlayer({ id: "p1" });

            expect(
                getLegalActions(state, player, card(lightningBolt.id))
            ).toContain("cast");
        });
    });

    describe("mana availability (CR 601.2f — payment check)", () => {
        it('blocks "cast" when pool and battlefield cannot cover cost', () => {
            const state = makeGameState();
            const player = makePlayer({
                manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
                battlefield: [],
            });
            const bolt = card(lightningBolt.id);
            expect(getLegalActions(state, player, bolt)).not.toContain("cast");
        });

        it('allows "cast" when pool exactly covers a colored cost', () => {
            const state = makeGameState();
            const player = makePlayer({
                manaPool: { W: 0, U: 0, B: 0, R: 1, G: 0, C: 0 },
                battlefield: [],
            });
            const bolt = card(lightningBolt.id);
            expect(getLegalActions(state, player, bolt)).toContain("cast");
        });

        it('allows "cast" when an untapped basic land covers the cost', () => {
            const land = card(mountain.id, {
                zone: "battlefield",
                isTapped: false,
            });
            const player = makePlayer({
                manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
                battlefield: [land],
            });
            const state = makeGameState({
                players: [player, makePlayer({ id: "p2" })],
            });
            const bolt = card(lightningBolt.id);
            expect(getLegalActions(state, player, bolt)).toContain("cast");
        });

        it('blocks "cast" when the only land is tapped', () => {
            const land = card(mountain.id, {
                zone: "battlefield",
                isTapped: true,
            });
            const player = makePlayer({
                manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
                battlefield: [land],
            });
            const state = makeGameState({
                players: [player, makePlayer({ id: "p2" })],
            });
            const bolt = card(lightningBolt.id);
            expect(getLegalActions(state, player, bolt)).not.toContain("cast");
        });

        it('blocks "cast" when only off-color sources are available', () => {
            const land = card(plains.id, {
                zone: "battlefield",
                isTapped: false,
            });
            const player = makePlayer({
                manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
                battlefield: [land],
            });
            const state = makeGameState({
                players: [player, makePlayer({ id: "p2" })],
            });
            const bolt = card(lightningBolt.id);
            expect(getLegalActions(state, player, bolt)).not.toContain("cast");
        });

        it("ignores a summoning-sick creature mana source (CR 302.1)", () => {
            // Birds of Paradise just ETB'd: mana ability requires {T} but
            // the creature can't tap on the turn it entered — so it cannot
            // satisfy a {G} cost on a Giant Growth in hand. The bird itself
            // is a legal target for the Growth (creature on the battlefield),
            // so the cast is gated purely on mana availability.
            const birds = card(birdsOfParadise.id, {
                zone: "battlefield",
                isSummoningSick: true,
            });
            const player = makePlayer({
                manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
                battlefield: [birds],
            });
            const state = makeGameState({
                players: [player, makePlayer({ id: "p2" })],
            });
            const growth = card(giantGrowth.id);
            expect(getLegalActions(state, player, growth)).not.toContain(
                "cast"
            );
        });

        it("counts a creature mana source once summoning sickness has worn off", () => {
            const birds = card(birdsOfParadise.id, {
                zone: "battlefield",
                isSummoningSick: false,
            });
            const player = makePlayer({
                manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
                battlefield: [birds],
            });
            const state = makeGameState({
                players: [player, makePlayer({ id: "p2" })],
            });
            const growth = card(giantGrowth.id);
            expect(getLegalActions(state, player, growth)).toContain("cast");
        });

        it('allows "cast" for an X-cost spell when only the fixed portion is payable', () => {
            const land = card(mountain.id, {
                zone: "battlefield",
                isTapped: false,
            });
            const player = makePlayer({
                manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
                battlefield: [land],
            });
            const state = makeGameState({
                players: [player, makePlayer({ id: "p2" })],
            });
            // Fireball: { X: "X", R: 1 } — minimum announce cost is {R}.
            const spell = card(fireball.id);
            expect(getLegalActions(state, player, spell)).toContain("cast");
        });
    });

    describe("debugAllActions mode", () => {
        it("returns all actions regardless of card type", () => {
            const state = makeGameState();
            const player = makePlayer();
            const land = card(plains.id);

            const actions = getLegalActions(state, player, land, true);
            expect(actions).toContain("play");
            expect(actions).toContain("cast");
            expect(actions).toContain("discard");
            expect(actions).toContain("putToGraveyard");
            expect(actions).toContain("putToExile");
            expect(actions).toContain("putToLibrary");
        });
    });

    // -------------------------------------------------------------------
    // additional-cost (sacrifice/exile) payability (CR 118.8 / 601.2f) —
    // issue #944: a spell whose additional cost is unpayable (no legal
    // permanent to sacrifice/exile) must not be offered as castable.
    // Class-wide: covers a `sacrificeFilter` card (Natural Order) AND an
    // `exileFilter` card (Soul Exchange).
    // -------------------------------------------------------------------
    describe("additional-cost payability (CR 118.8 / 601.2f)", () => {
        it('blocks "cast" for a sacrificeFilter spell with no legal permanent to sacrifice', () => {
            const player = makePlayer({ battlefield: [] });
            const state = makeGameState({
                players: [player, makePlayer({ id: "p2" })],
            });
            const spell = card(naturalOrder.id);
            // No green creature on the battlefield — Natural Order's
            // "sacrifice a green creature" additional cost is unpayable.
            expect(getLegalActions(state, player, spell)).not.toContain("cast");
        });

        it('allows "cast" for a sacrificeFilter spell once a legal permanent exists', () => {
            const bears = card(grizzlyBears.id, { zone: "battlefield" });
            const player = makePlayer({ battlefield: [bears] });
            const state = makeGameState({
                players: [player, makePlayer({ id: "p2" })],
            });
            const spell = card(naturalOrder.id);
            expect(getLegalActions(state, player, spell)).toContain("cast");
        });

        it('does not block "cast" for a sacrificeFilter spell on an off-color permanent', () => {
            // Savannah Lions is white, not green — doesn't satisfy Natural
            // Order's "sacrifice a green creature" filter.
            const lions = card(savannahLions.id, { zone: "battlefield" });
            const player = makePlayer({ battlefield: [lions] });
            const state = makeGameState({
                players: [player, makePlayer({ id: "p2" })],
            });
            const spell = card(naturalOrder.id);
            expect(getLegalActions(state, player, spell)).not.toContain("cast");
        });

        it('blocks "cast" for an exileFilter spell with no legal permanent to exile', () => {
            const grave = card(grizzlyBears.id, { zone: "graveyard" });
            const player = makePlayer({ battlefield: [], graveyard: [grave] });
            const state = makeGameState({
                players: [player, makePlayer({ id: "p2" })],
            });
            const spell = card(soulExchange.id);
            // No creature on the battlefield to exile — Soul Exchange's
            // additional cost is unpayable even though a legal
            // (graveyard) target exists for the return-to-battlefield
            // effect.
            expect(getLegalActions(state, player, spell)).not.toContain("cast");
        });

        it('allows "cast" for an exileFilter spell once a legal permanent exists', () => {
            const bears = card(grizzlyBears.id, { zone: "battlefield" });
            const grave = card(grizzlyBears.id, { zone: "graveyard" });
            const player = makePlayer({
                battlefield: [bears],
                graveyard: [grave],
            });
            const state = makeGameState({
                players: [player, makePlayer({ id: "p2" })],
            });
            const spell = card(soulExchange.id);
            expect(getLegalActions(state, player, spell)).toContain("cast");
        });
    });
});

// ---------------------------------------------------------------------------
// assertLegalAction
// ---------------------------------------------------------------------------

describe("assertLegalAction", () => {
    it("does not throw for a legal action", () => {
        const state = makeGameState();
        const land = card(plains.id);
        const player = makePlayer({ hand: [land] });

        expect(() =>
            assertLegalAction(state, player, land, "play")
        ).not.toThrow();
    });

    it("throws for an illegal action with descriptive message", () => {
        const state = makeGameState();
        const player = makePlayer();
        const land = card(plains.id);

        expect(() => assertLegalAction(state, player, land, "cast")).toThrow(
            'Illegal action "cast" on "Plains"'
        );
    });

    it("throws when casting creature with non-empty stack", () => {
        const state = makeGameState({
            stack: [
                {
                    ...card(lightningBolt.id, { zone: "stack" }),
                    castById: "p2",
                },
            ],
        });
        const player = makePlayer();
        const lion = card(savannahLions.id);

        expect(() => assertLegalAction(state, player, lion, "cast")).toThrow(
            'Illegal action "cast" on "Savannah Lions"'
        );
    });

    it("does NOT throw when casting instant with non-empty stack", () => {
        const state = makeGameState({
            stack: [
                {
                    ...card(savannahLions.id, { zone: "stack" }),
                    castById: "p1",
                },
            ],
        });
        const player = makePlayer();
        // Ancestral Recall targets a player (always available) — keeps the
        // test focused on timing rather than target availability.
        const instant = card(ancestralRecall.id);

        expect(() =>
            assertLegalAction(state, player, instant, "cast")
        ).not.toThrow();
    });
});

// ---------------------------------------------------------------------------
// raiseTriggerTargetSelection — "up to X" count collapse for triggers
// (CR 601.2c / 603.3d, issue #2365)
//
// Triggers never carry an announced X (CR 603.3d has no announcement step),
// so a trigger requirement whose count is `{ min, max: "X" }` cannot resolve
// against a live X the way a spell cast does. The pre-existing convention for
// a literal `"X"` count on a trigger is to collapse it to 0 — this extends
// the SAME convention to the object form's `max: "X"`. The regression this
// guards: `raiseTriggerTargetSelection` used to re-derive its raised
// `PendingTarget.count` a SECOND time, independently of the `{min, max}` the
// function had already resolved via `triggerTargetMinMax` a few lines above
// — that second, independent derivation fell through `req.count.max ?? max`
// for the object form, which would have let an unresolved `"X"` STRING reach
// `PendingTarget.count.max` (a number-typed field everywhere downstream:
// `pendingTargetCountMaxReached`, the frontend's `describeTargetProgress`).
// ---------------------------------------------------------------------------
describe('raiseTriggerTargetSelection — "up to X" count collapse (CR 601.2c / 603.3d, issue #2365)', () => {
    function stateWithInlineTrigger(
        count: NonNullable<StackItem["inlineTargetRequirement"]>["count"]
    ): { state: GameState; trigger: StackItem } {
        const target = card(savannahLions.id, {
            id: "target-1",
            controllerId: "p1",
        });
        const player = makePlayer({ battlefield: [target] });
        const trigger: StackItem = {
            ...card(ancestralRecall.id, { zone: "stack" }),
            id: "trig-1",
            castById: "p1",
            targets: undefined,
            inlineTargetRequirement: {
                type: "Creature",
                count,
            },
        };
        const state = makeGameState({
            players: [player, makePlayer({ id: "p2" })],
            stack: [trigger],
        });
        return { state, trigger };
    }

    it("{ min: 0, max: 'X' } raises a PendingTarget with a numeric { min: 0, max: 0 } — never the literal string", () => {
        const { state } = stateWithInlineTrigger({
            min: 0,
            max: "X",
        });
        const suspended = raiseTriggerTargetSelection(state);
        expect(suspended).toBe(true);
        const pt = state.pendingTarget as PendingTarget;
        expect(pt).toBeDefined();
        expect(pt.count).toEqual({ min: 0, max: 0 });
        // The must-NOT assertion: no branch of the resolution can leave the
        // literal "X" string on a numeric-typed field.
        expect(typeof pt.count).not.toBe("string");
        if (typeof pt.count === "object") {
            expect(typeof pt.count.max).toBe("number");
            expect(Number.isNaN(pt.count.max)).toBe(false);
        }
    });

    it("{ min: 1, max: 'X' } collapses to a single mandatory target and auto-selects (no PendingTarget raised)", () => {
        const { state, trigger } = stateWithInlineTrigger({
            min: 1,
            max: "X",
        });
        const suspended = raiseTriggerTargetSelection(state);
        // min===1 && max===1 (collapsed) with exactly one legal target is the
        // "no real choice" auto-select branch — never reaches PendingTarget.
        expect(suspended).toBe(false);
        expect(state.pendingTarget).toBeUndefined();
        expect(trigger.targets).toEqual([
            { type: "permanent", id: "target-1" },
        ]);
    });
});
