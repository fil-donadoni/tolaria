// Engine-level tests for CR 603.4 "intervening if". `resolveTopOfStack`
// re-evaluates `TriggeredAbility.interveningIf` against the current game
// state immediately before invoking `resolve`. If the predicate is false
// the trigger fizzles: it leaves the stack without invoking `resolve`,
// and a `TRIGGER_FIZZLED` event is queued so downstream triggers can
// react. The two required tests cover the false (fizzle) and true
// (resolves normally) branches; a third test covers the downstream
// reaction path via a witness trigger keyed on `TRIGGER_FIZZLED`.

import { describe, it, expect, beforeAll } from "vitest";
import type {
    CardInstanceState,
    GameState,
    PlayerState,
    StackItem,
} from "../state";
import {
    applyControlChange,
    phaseOutPermanent,
    putReanimatedSetOnBattlefield,
    removePermanentTo,
    resolveTopOfStack,
} from "../state";
import { compactState, expandState } from "../serialize";
import { projectPublicState } from "../../gameProjections";
import { registerTokenDefinition } from "../../cards";
import type { CardDefinition, GameEvent } from "../../cards/types";

const SOURCE_CARD_ID = "test-intervening-if-card";
const ABILITY_ID = "test-trigger";
const WITNESS_ID = "test-witness";

// Synthetic card whose trigger fizzles when its source is tapped at
// resolution. Mirrors Howling Mine's pattern but uses the engine-level
// `interveningIf` hook instead of an ad-hoc re-check inside `resolve`.
// The witness ability listens for TRIGGER_FIZZLED so the downstream-
// observability contract is exercised.
const testCard: CardDefinition = {
    id: SOURCE_CARD_ID,
    name: "Test Intervening-If Source",
    rarity: "common",
    types: ["Artifact"],
    triggeredAbilities: [
        {
            id: ABILITY_ID,
            oracleText:
                "At the beginning of the end step, if this is untapped, controller draws a card.",
            event: "PHASE_BEGIN",
            matches: (event) => event.type === "PHASE_BEGIN",
            interveningIf: (_event, self) => !self.isTapped,
            resolve: (ctx) => ctx.drawCards(ctx.controller, 1),
        },
        {
            id: WITNESS_ID,
            oracleText:
                "Whenever a trigger fizzles, this source's controller gains 1 life.",
            event: "TRIGGER_FIZZLED",
            matches: (event) => event.type === "TRIGGER_FIZZLED",
            resolve: (ctx) => ctx.gainLife(ctx.controller, 1),
        },
    ],
};

const WASKICKED_SOURCE_ID = "test-intervening-if-waskicked-card";
const WASKICKED_ABILITY_ID = "test-trigger-waskicked";

// Synthetic card exercising the resolve-time `selfView` allowlist
// (`gre/state.ts`, CR 603.4) for the `wasKicked` field specifically (issue
// #1753 added `wasKicked`/`chosenXOnCast` to that hand-built allowlist
// alongside the pre-existing combat-history fields). No shipped card reads
// `self.wasKicked` from an `interveningIf` today — `pouncingKavu` and its
// siblings read it only from `staticEffects.applies`, a different read path
// — so without this test the allowlist line has zero coverage: it always
// EXECUTES (any interveningIf trigger walks the whole object literal), but
// nothing ever proves the copied VALUE is the real one instead of a silently
// dropped `undefined`.
const wasKickedTestCard: CardDefinition = {
    id: WASKICKED_SOURCE_ID,
    name: "Test Intervening-If wasKicked Source",
    rarity: "common",
    types: ["Artifact"],
    triggeredAbilities: [
        {
            id: WASKICKED_ABILITY_ID,
            oracleText:
                "At the beginning of the end step, if this was kicked, controller draws a card.",
            event: "PHASE_BEGIN",
            matches: (event) => event.type === "PHASE_BEGIN",
            interveningIf: (_event, self) => self.wasKicked === true,
            resolve: (ctx) => ctx.drawCards(ctx.controller, 1),
        },
    ],
};

beforeAll(() => {
    registerTokenDefinition(testCard);
    registerTokenDefinition(wasKickedTestCard);
});

function makeBareCard(
    id: string,
    overrides: Partial<CardInstanceState> = {}
): CardInstanceState {
    return {
        id,
        card: { id: SOURCE_CARD_ID },
        types: ["Artifact"],
        subtypes: [],
        staticAbilities: [],
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
        isTapped: false,
        ...overrides,
    };
}

function makeBarePlayer(id: string, library: CardInstanceState[]): PlayerState {
    return {
        id,
        name: id,
        bgColor: "#000",
        life: 20,
        hand: [],
        library,
        graveyard: [],
        exile: [],
        battlefield: [],
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    };
}

/** Seeds a game with one battlefield source on p1 and a phase-begin trigger
 *  already pushed onto the stack via `triggeredAbilityId` / `triggerSourceId`
 *  / `triggerEvent`. `sourceTapped` controls whether the source is tapped at
 *  resolution time — the only variable the intervening-if predicate reads. */
function setupState(opts: { sourceTapped: boolean }): GameState {
    const source = makeBareCard("src-1", { isTapped: opts.sourceTapped });
    const libraryCard: CardInstanceState = {
        id: "lib-1",
        card: { id: SOURCE_CARD_ID },
        types: ["Artifact"],
        subtypes: [],
        staticAbilities: [],
        controllerId: "p1",
        ownerId: "p1",
        zone: "library",
        isTapped: false,
    };
    const event: GameEvent = {
        type: "PHASE_BEGIN",
        phase: "END_STEP",
        activePlayerId: "p1",
    };
    const stackItem: StackItem = {
        ...source,
        zone: "stack",
        id: "stack-1",
        castById: "p1",
        triggeredAbilityId: ABILITY_ID,
        triggerSourceId: source.id,
        triggerEvent: event,
    };
    const p1 = makeBarePlayer("p1", [libraryCard]);
    p1.battlefield = [source];
    const p2 = makeBarePlayer("p2", []);
    return {
        players: [p1, p2],
        stack: [stackItem],
        turn: 1,
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        passCount: 0,
        phase: "END_STEP",
        rngSeed: 0,
        rngCounter: 0,
    };
}

describe("intervening-if (CR 603.4)", () => {
    it("fizzles the trigger when the predicate is false at resolve time", () => {
        const state = setupState({ sourceTapped: true });
        resolveTopOfStack(state);
        // The fizzling trigger left the stack without invoking `resolve`
        // (no card drawn). The witness trigger fired on TRIGGER_FIZZLED and
        // landed on the stack, restarting priority at the active player.
        expect(state.players[0].hand).toHaveLength(0);
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].triggeredAbilityId).toBe(WITNESS_ID);
        expect(state.stack[0].triggerEvent).toMatchObject({
            type: "TRIGGER_FIZZLED",
            triggerSourceId: "src-1",
            triggeredAbilityId: ABILITY_ID,
            reason: "intervening-if-false",
        });
    });

    it("resolves the trigger normally when the predicate is true at resolve time", () => {
        const state = setupState({ sourceTapped: false });
        resolveTopOfStack(state);
        // Trigger resolved: one card moved library → hand. No fizzle event
        // emitted, so the witness is not on the stack.
        expect(state.players[0].hand).toHaveLength(1);
        expect(state.players[0].library).toHaveLength(0);
        expect(state.stack).toHaveLength(0);
    });

    it("emits TRIGGER_FIZZLED into pendingEvents so witness triggers can react", () => {
        const state = setupState({ sourceTapped: true });
        resolveTopOfStack(state);
        // Resolve the witness trigger that the fizzle emission produced.
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(21);
        expect(state.stack).toHaveLength(0);
    });
});

/** Seeds a game with one battlefield source on p1 and a phase-begin trigger
 *  already pushed onto the stack, exactly like `setupState` above, except the
 *  source's `wasKicked` field (not `isTapped`) is the variable the
 *  intervening-if predicate reads. */
function setupWasKickedState(opts: { wasKicked: boolean }): GameState {
    const source = makeBareCard("wk-src-1", {
        card: { id: WASKICKED_SOURCE_ID },
        wasKicked: opts.wasKicked || undefined,
    });
    const libraryCard: CardInstanceState = {
        id: "wk-lib-1",
        card: { id: WASKICKED_SOURCE_ID },
        types: ["Artifact"],
        subtypes: [],
        staticAbilities: [],
        controllerId: "p1",
        ownerId: "p1",
        zone: "library",
        isTapped: false,
    };
    const event: GameEvent = {
        type: "PHASE_BEGIN",
        phase: "END_STEP",
        activePlayerId: "p1",
    };
    const stackItem: StackItem = {
        ...source,
        zone: "stack",
        id: "wk-stack-1",
        castById: "p1",
        triggeredAbilityId: WASKICKED_ABILITY_ID,
        triggerSourceId: source.id,
        triggerEvent: event,
    };
    const p1 = makeBarePlayer("p1", [libraryCard]);
    p1.battlefield = [source];
    const p2 = makeBarePlayer("p2", []);
    return {
        players: [p1, p2],
        stack: [stackItem],
        turn: 1,
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        passCount: 0,
        phase: "END_STEP",
        rngSeed: 0,
        rngCounter: 0,
    };
}

// Issue #1753 review finding 3 — `wasKicked` (alongside `chosenXOnCast`) was
// added to the resolve-time `selfView` allowlist at `gre/state.ts:4331-4332`,
// a behaviour change to trigger machinery shared by every kicker card, with
// zero coverage: no shipped card reads `self.wasKicked` from an
// `interveningIf` (only from `staticEffects.applies`, a different read path
// entirely). These two prove the allowlist actually threads the real value
// through — dropping the `wasKicked: sourceCard.wasKicked` line from the
// allowlist would make the "kicked" case below fizzle exactly like the
// "not kicked" case, since both would read `undefined`.
describe("intervening-if allowlist — wasKicked (issue #1753, CR 603.4 / 614.1c)", () => {
    it("fizzles when wasKicked is unset at resolve time", () => {
        const state = setupWasKickedState({ wasKicked: false });
        resolveTopOfStack(state);
        expect(state.players[0].hand).toHaveLength(0);
        expect(state.stack).toHaveLength(0);
    });

    it("resolves normally, reading the real wasKicked value through the selfView allowlist", () => {
        const state = setupWasKickedState({ wasKicked: true });
        resolveTopOfStack(state);
        expect(state.players[0].hand).toHaveLength(1);
        expect(state.players[0].library).toHaveLength(0);
        expect(state.stack).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// Departure-time LKI (issue #2042) — CR 603.4 re-check against CR 608.2h
// ---------------------------------------------------------------------------
//
// CR 400.7 makes a permanent that changes zones a NEW object, but the engine
// never reallocates the instance id, so a blink returns a same-id permanent
// whose battlefield-transient fields `resetBattlefieldTransientState` has
// wiped. CR 608.2h says a resolution-time read of "the source of the ability
// itself" must use last known information once that object is no longer in the
// zone it was expected to be in — which the engine could not tell apart from
// "it never moved", because the id matched either way.
//
// `removePermanentTo` now stamps `StackItem.sourceLki` at the single
// battlefield-departure funnel, and `resolveTopOfStackInner` prefers it. These
// tests drive the REAL production paths (`removePermanentTo` /
// `putReanimatedSetOnBattlefield` / `resolveTopOfStack`), both polarities, plus
// the two tiers that must NOT change (live object, never-on-the-battlefield
// source) and the census's must-NOT departures (control change, phasing).

const BLINK_SOURCE_ID = "test-departure-lki-card";
const BLINK_X_ABILITY = "test-trigger-blink-x";
const BLINK_ATTACK_ABILITY = "test-trigger-blink-attack";
const BLINK_COUNTER_ABILITY = "test-trigger-blink-counter";
const BLINK_IDENTITY_ABILITY = "test-trigger-blink-identity";

/** Synthetic source carrying one intervening-if per POLARITY of the bug, each
 *  reading a different field `resetBattlefieldTransientState` deletes on
 *  re-entry — the three shapes the 2026-08-05 catalogue census found across
 *  five shipped cards:
 *   - `chosenXOnCast` (Jacked Rabbit): blink makes it read 0 and the trigger
 *     wrongly FIZZLES;
 *   - `hasAttackedThisTurn` (Erg Raiders, the Clockwork pair): blink makes it
 *     read "didn't attack" and the trigger wrongly RESOLVES;
 *   - `counters` (Living Artifact): both directions, and the field a permanent
 *     that never left must still be read LIVE for. */
const blinkTestCard: CardDefinition = {
    id: BLINK_SOURCE_ID,
    name: "Test Departure-LKI Source",
    rarity: "common",
    types: ["Creature"],
    power: 1,
    toughness: 1,
    triggeredAbilities: [
        {
            id: BLINK_X_ABILITY,
            oracleText:
                "At the beginning of the end step, if X is 5 or more, draw a card.",
            event: "PHASE_BEGIN",
            matches: (event) => event.type === "PHASE_BEGIN",
            interveningIf: (_event, self) => (self.chosenXOnCast ?? 0) >= 5,
            resolve: (ctx) => ctx.drawCards(ctx.controller, 1),
        },
        {
            id: BLINK_ATTACK_ABILITY,
            oracleText:
                "At the beginning of the end step, if this didn't attack this turn, you gain 2 life.",
            event: "PHASE_BEGIN",
            matches: (event) => event.type === "PHASE_BEGIN",
            interveningIf: (_event, self) => self.hasAttackedThisTurn !== true,
            resolve: (ctx) => ctx.gainLife(ctx.controller, 2),
        },
        {
            id: BLINK_IDENTITY_ABILITY,
            oracleText:
                "At the beginning of the end step, if this is the permanent the ability came from, you gain 1 life.",
            event: "PHASE_BEGIN",
            matches: (event) => event.type === "PHASE_BEGIN",
            // The selfView's `id` must be the SOURCE's instance id in every
            // tier, never the stack item's reallocated one — the shape a
            // graveyard-zone trigger reads to find itself in its zone.
            interveningIf: (_event, self) => self.id === "blink-src",
            resolve: (ctx) => ctx.gainLife(ctx.controller, 1),
        },
        {
            id: BLINK_COUNTER_ABILITY,
            oracleText:
                "At the beginning of the end step, if this has a vitality counter on it, you gain 1 life.",
            event: "PHASE_BEGIN",
            matches: (event) => event.type === "PHASE_BEGIN",
            interveningIf: (_event, self) =>
                (self.counters?.["vitality"] ?? 0) > 0,
            resolve: (ctx) => ctx.gainLife(ctx.controller, 1),
        },
    ],
};

beforeAll(() => {
    registerTokenDefinition(blinkTestCard);
});

/** Seeds p1 with the synthetic source on the battlefield and ONE trigger from
 *  it already on the stack, built the way `buildTriggerItem` builds one (a
 *  `...self` spread plus the trigger legs). `stackOverrides` lets a test make
 *  the trigger-time snapshot differ from the live permanent, which is the only
 *  way to tell the three LKI tiers apart. */
function setupDepartureState(opts: {
    abilityId: string;
    source?: Partial<CardInstanceState>;
    stackOverrides?: Partial<StackItem>;
    sourceZone?: "battlefield" | "graveyard";
}): { state: GameState; source: CardInstanceState } {
    const source = makeBareCard("blink-src", {
        card: { id: BLINK_SOURCE_ID },
        types: ["Creature"],
        power: 1,
        toughness: 1,
        zone: opts.sourceZone ?? "battlefield",
        ...opts.source,
    });
    const libraryCard = makeBareCard("blink-lib", {
        card: { id: BLINK_SOURCE_ID },
        zone: "library",
    });
    const event: GameEvent = {
        type: "PHASE_BEGIN",
        phase: "END_STEP",
        activePlayerId: "p1",
    };
    const stackItem: StackItem = {
        ...source,
        zone: "stack",
        id: "blink-stack-1",
        castById: "p1",
        triggeredAbilityId: opts.abilityId,
        triggerSourceId: source.id,
        triggerEvent: event,
        ...opts.stackOverrides,
    };
    const p1 = makeBarePlayer("p1", [libraryCard]);
    if ((opts.sourceZone ?? "battlefield") === "battlefield") {
        p1.battlefield = [source];
    } else {
        p1.graveyard = [source];
    }
    const p2 = makeBarePlayer("p2", []);
    const state: GameState = {
        players: [p1, p2],
        stack: [stackItem],
        turn: 1,
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        passCount: 0,
        phase: "END_STEP",
        rngSeed: 0,
        rngCounter: 0,
    };
    return { state, source };
}

/** CR 400.7 round trip under a REUSED instance id — the shape a blink
 *  (Ephemerate), a bounce-and-replay or a reanimation onto the same row all
 *  produce. Both legs are production entry points: `removePermanentTo` is the
 *  battlefield-departure funnel, `putReanimatedSetOnBattlefield` the entry path
 *  that runs `resetBattlefieldTransientState`. */
function departAndReturn(state: GameState, instanceId: string): void {
    const left = removePermanentTo(state, instanceId, "graveyard");
    expect(left).not.toBeNull();
    const gy = state.players[0].graveyard;
    const idx = gy.findIndex((c) => c.id === instanceId);
    const [card] = gy.splice(idx, 1);
    putReanimatedSetOnBattlefield(state, [{ card, controllerId: "p1" }]);
}

describe("departure-time LKI for intervening-if (CR 603.4 / 608.2h / 400.7, issue #2042)", () => {
    it("blinked mid-trigger: the X snapshot is read from the DEPARTED object, so the trigger still resolves", () => {
        // Jacked Rabbit's polarity: without the departure snapshot the
        // re-check reads the returned object's wiped `chosenXOnCast` (0), and
        // an X=6 trigger fizzles.
        const { state, source } = setupDepartureState({
            abilityId: BLINK_X_ABILITY,
            source: { chosenXOnCast: 6 },
        });
        departAndReturn(state, source.id);
        // Precondition: the returned permanent really has lost the field —
        // otherwise this test would pass for the wrong reason.
        const returned = state.players[0].battlefield.find(
            (c) => c.id === source.id
        )!;
        expect(returned.chosenXOnCast).toBeUndefined();
        expect(state.stack[0].sourceLki?.chosenXOnCast).toBe(6);

        resolveTopOfStack(state);
        expect(state.players[0].hand).toHaveLength(1);
        expect(state.stack).toHaveLength(0);
    });

    it("blinked mid-trigger: the combat history is read from the DEPARTED object, so the trigger fizzles (opposite polarity)", () => {
        // Erg Raiders' polarity, and the dangerous one: the fresh object has
        // no attack record, so the predicate reads TRUE and the ability
        // wrongly RESOLVES — silently wrong AND active, not merely inert.
        const { state, source } = setupDepartureState({
            abilityId: BLINK_ATTACK_ABILITY,
            source: { hasAttackedThisTurn: true },
        });
        departAndReturn(state, source.id);
        const returned = state.players[0].battlefield.find(
            (c) => c.id === source.id
        )!;
        expect(returned.hasAttackedThisTurn).toBeUndefined();

        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(20);
        expect(state.stack).toHaveLength(0);
    });

    it("blinked mid-trigger: counters are read from the DEPARTED object (CR 122.2 — they ceased to exist)", () => {
        const { state, source } = setupDepartureState({
            abilityId: BLINK_COUNTER_ABILITY,
            source: { counters: { vitality: 2 } },
        });
        departAndReturn(state, source.id);
        const returned = state.players[0].battlefield.find(
            (c) => c.id === source.id
        )!;
        expect(returned.counters?.["vitality"] ?? 0).toBe(0);
        // The snapshot holds its OWN copy of the counter map — `creature.counters`
        // is deleted at the funnel, so a shared reference would read as gone.
        expect(state.stack[0].sourceLki?.counters?.["vitality"]).toBe(2);

        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(21);
    });

    it("never left: the re-check still reads the LIVE object, so a counter gained AFTER the trigger was queued is seen", () => {
        // Living Artifact's case, and the regression the naive "always prefer
        // a snapshot" fix breaks: the trigger-time spread has no counters, and
        // the permanent is the SAME object (CR 400.7 never applied), so the
        // live value is the correct one to read.
        const { state, source } = setupDepartureState({
            abilityId: BLINK_COUNTER_ABILITY,
        });
        expect(state.stack[0].counters?.["vitality"] ?? 0).toBe(0);
        source.counters = { vitality: 1 };

        resolveTopOfStack(state);
        expect(state.stack[0]?.sourceLki).toBeUndefined();
        expect(state.players[0].life).toBe(21);
    });

    it("never left: a counter REMOVED after the trigger was queued is likewise seen live, and the trigger fizzles", () => {
        const { state, source } = setupDepartureState({
            abilityId: BLINK_COUNTER_ABILITY,
            source: { counters: { vitality: 1 } },
        });
        delete source.counters;

        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(20);
    });

    it("left and did NOT return: unchanged — the graveyard-zone source (Nether Shadow shape) still resolves off the stack item", () => {
        // Tier 3. The source was never on the battlefield, so no departure
        // ever ran and `sourceLki` is absent; the `?? top` fallback and its
        // `triggerSourceId` id-pinning must keep working.
        const { state } = setupDepartureState({
            abilityId: BLINK_X_ABILITY,
            sourceZone: "graveyard",
            stackOverrides: { chosenXOnCast: 6 },
        });
        expect(state.stack[0].sourceLki).toBeUndefined();
        resolveTopOfStack(state);
        expect(state.players[0].hand).toHaveLength(1);
    });

    it("left and did NOT return: the selfView id stays pinned to triggerSourceId, not the stack item's own id", () => {
        // The id-pinning leg of tier 3, and a live regression vector: the
        // graveyard-zone source is not on any battlefield, so a truthiness
        // slip in the "did we find a real instance?" test hands the predicate
        // the stack item's reallocated id and every Nether Shadow-shaped
        // trigger fizzles.
        const { state } = setupDepartureState({
            abilityId: BLINK_IDENTITY_ABILITY,
            sourceZone: "graveyard",
        });
        expect(state.stack[0].id).not.toBe("blink-src");
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(21);
    });

    it("left and did NOT return: a source that departs while its trigger waits fizzles/resolves off the departure snapshot", () => {
        const { state, source } = setupDepartureState({
            abilityId: BLINK_ATTACK_ABILITY,
            source: { hasAttackedThisTurn: true },
        });
        removePermanentTo(state, source.id, "graveyard");
        expect(state.stack[0].sourceLki?.hasAttackedThisTurn).toBe(true);
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(20);
    });

    it("blinked TWICE: the second departure does not overwrite the first snapshot", () => {
        // The back door the presence-is-the-signal design would otherwise
        // leave open: the LKI of the object the ability was sourced from is
        // fixed the instant that object ceased to exist.
        const { state, source } = setupDepartureState({
            abilityId: BLINK_X_ABILITY,
            source: { chosenXOnCast: 6 },
        });
        departAndReturn(state, source.id);
        expect(state.stack[0].sourceLki?.chosenXOnCast).toBe(6);
        departAndReturn(state, source.id);
        expect(state.stack[0].sourceLki?.chosenXOnCast).toBe(6);

        resolveTopOfStack(state);
        expect(state.players[0].hand).toHaveLength(1);
    });

    it("stamps ONLY the stack items sourced from the departing instance", () => {
        const { state, source } = setupDepartureState({
            abilityId: BLINK_X_ABILITY,
            source: { chosenXOnCast: 6 },
        });
        const other: StackItem = {
            ...state.stack[0],
            id: "other-stack-1",
            triggerSourceId: "some-other-permanent",
        };
        state.stack.unshift(other);
        removePermanentTo(state, source.id, "graveyard");
        expect(
            state.stack.find((i) => i.id === "other-stack-1")!.sourceLki
        ).toBeUndefined();
        expect(
            state.stack.find((i) => i.id === "blink-stack-1")!.sourceLki
        ).toBeDefined();
    });

    // Census must-NOT rows: the three battlefield-array removals that are not
    // CR 400.7 zone changes. None of them may stamp — a stamp there would
    // freeze the re-check against a stale object that never stopped existing.
    it("a control change does NOT stamp (CR 400.7 — the permanent never leaves the battlefield)", () => {
        const { state, source } = setupDepartureState({
            abilityId: BLINK_COUNTER_ABILITY,
            source: { counters: { vitality: 1 } },
        });
        applyControlChange(state, source.id, "p2", "some-source");
        expect(state.stack[0].sourceLki).toBeUndefined();
        // Still the same object, so the live counter is still read and the
        // trigger resolves — for its ORIGINAL controller (CR 603.3a: the
        // ability's controller is fixed when it is put on the stack, and the
        // control change does not follow it there).
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(21);
        expect(state.players[1].life).toBe(20);
    });

    it("phasing out does NOT stamp (CR 702.26d — phasing is not a zone change)", () => {
        const { state, source } = setupDepartureState({
            abilityId: BLINK_COUNTER_ABILITY,
            source: { counters: { vitality: 1 } },
        });
        const bundleId = phaseOutPermanent(state, source.id, {
            returnOn: { kind: "untap-cycle" },
        });
        expect(bundleId).not.toBeNull();
        // It really did leave the battlefield array (otherwise this test would
        // be vacuous)...
        expect(
            state.players.some((p) =>
                p.battlefield.some((c) => c.id === source.id)
            )
        ).toBe(false);
        // ...and still no snapshot: phasing is not a departure.
        expect(state.stack[0].sourceLki).toBeUndefined();
        // With no snapshot and nothing to locate, the re-check falls back to
        // the stack item itself (tier 3), which still carries the counter —
        // the pre-existing behaviour, unchanged by this fix.
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(21);
    });

    it("survives a DB round trip while the trigger waits on the stack", () => {
        // A pending choice between the blink and the trigger's resolution is a
        // stable save point; a dropped snapshot would silently restore the bug
        // on reload.
        const { state, source } = setupDepartureState({
            abilityId: BLINK_X_ABILITY,
            source: { chosenXOnCast: 6 },
        });
        departAndReturn(state, source.id);
        const reloaded = expandState(compactState(state));
        expect(reloaded.stack[0].sourceLki?.chosenXOnCast).toBe(6);
        expect(reloaded.stack[0].sourceLki?.id).toBe(source.id);
        expect(reloaded.stack[0].sourceLki?.ownerId).toBe("p1");
        resolveTopOfStack(reloaded);
        expect(reloaded.players[0].hand).toHaveLength(1);
    });

    it("never crosses the wire (projectPublicState strips it, like stormSnapshot)", () => {
        const { state, source } = setupDepartureState({
            abilityId: BLINK_X_ABILITY,
            source: { chosenXOnCast: 6 },
        });
        departAndReturn(state, source.id);
        expect(state.stack[0].sourceLki).toBeDefined();
        const projected = projectPublicState(state, 1, "p1");
        expect(
            (projected.stack[0] as { sourceLki?: unknown }).sourceLki
        ).toBeUndefined();
    });
});
