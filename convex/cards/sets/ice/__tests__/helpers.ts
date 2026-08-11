// Shared test shims for the ICE per-colour test files (ADR 0043 split).
// Stack-push/resolve + pending-choice shims, synthetic trigger-event builders,
// and scenario fixtures reused across the colour modules' describe blocks.
// Fixture builders (makeInstance/makePlayer/makeState/pushSpell) stay in
// convex/cards/__tests__/setup.ts.
import { balduvianBears } from "../../ice";
import { plains, island, swamp, mountain, forest } from "../../lea";
import { resolveTopOfStack } from "../../../../gre/state";
import { collectTriggers } from "../../../../gre/triggers";
import { fireDelayedTriggers } from "../../../../gre/phases";
import {
    applyPendingChoiceSubmit,
    applyMayPaySubmit,
} from "../../../../gre/pendingChoiceSubmit";
import { makeInstance, pushSpell } from "../../../__tests__/setup";
import type { CardInstanceState, GameState } from "../../../../gre/state";
import type { StackItem } from "../../../../gre/state";
import type { CardType, ManaCost } from "../../../types";

/** Push an activated ability onto the stack with its cost assumed already paid,
 *  then resolve it (mirrors post-activateAbility state). */
export function resolveActivated(
    state: GameState,
    source: CardInstanceState,
    abilityId: string,
    targets: StackItem["targets"] = []
): void {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        abilityId,
        targets,
    });
    resolveTopOfStack(state);
}

/** Submit the current head pending choice (zone-pick) with the given ordered
 *  ids, auto-resuming the suspended resolution (mirrors the game.ts mutation). */
export function submitChoice(
    state: GameState,
    cardInstanceIds: string[]
): void {
    const head = state.pendingChoices![0];
    applyPendingChoiceSubmit(state, {
        playerId: head.playerId,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds,
    });
}

/** Push a triggered ability onto the stack with the given trigger event, then
 *  resolve it (mirrors the engine after a trigger is put on the stack). */
export function resolveTrigger(
    state: GameState,
    source: CardInstanceState,
    triggeredAbilityId: string,
    triggerEvent: StackItem["triggerEvent"],
    targets: StackItem["targets"] = []
): void {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        triggeredAbilityId,
        triggerSourceId: source.id,
        triggerEvent,
        targets,
    });
    resolveTopOfStack(state);
}

/** A generic vanilla creature body not backed by a registered definition. */
export function vanilla(
    id: string,
    power: number,
    toughness: number,
    overrides: Partial<CardInstanceState> = {}
): CardInstanceState {
    return {
        id,
        card: { id: `fake-${id}` },
        types: ["Creature"] as CardType[],
        subtypes: [],
        staticAbilities: [],
        power,
        toughness,
        controllerId: "p2",
        ownerId: "p2",
        zone: "battlefield",
        isTapped: false,
        ...overrides,
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// Cumulative upkeep — core template + self-CU cards (CR 702.24, ADR 0042, #638)
// ═══════════════════════════════════════════════════════════════════════════

/** A PHASE_BEGIN UPKEEP trigger event for `playerId`'s upkeep. */
export const CU_UPKEEP = (playerId: string): StackItem["triggerEvent"] =>
    ({
        type: "PHASE_BEGIN" as const,
        phase: "UPKEEP" as const,
        activePlayerId: playerId,
    }) as StackItem["triggerEvent"];

/** Fire a cumulative-upkeep trigger: push the named ability onto the stack with
 *  the source's upkeep event and resolve it. Step 0 adds the age counter and
 *  step 1 suspends at the may-pay (unless the controller can't pay anything —
 *  then it sacrifices outright). */
export function fireCumulativeUpkeep(
    state: GameState,
    source: CardInstanceState,
    abilityId: string
): void {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        triggeredAbilityId: abilityId,
        triggerSourceId: source.id,
        triggerEvent: CU_UPKEEP(source.controllerId),
        targets: [],
    });
    resolveTopOfStack(state);
}

/** Answer the head may-pay choice, auto-resuming the suspended resolution.
 *  When the choice carries a battlefield sacrifice pick (CR 701.21a — more
 *  matching permanents than the leg sacrifices, e.g. Polar Kraken's "sacrifice 2
 *  lands" with 3 in play), an explicit `sacrificeIds` set names the victims; when
 *  omitted the first N candidate ids are auto-picked so the shim stays terse. */
export function answerMayPay(
    state: GameState,
    accept: boolean,
    sacrificeIds?: string[]
): void {
    const head = state.pendingChoices![0];
    let picks = sacrificeIds;
    if (accept && picks === undefined && head.zone === "battlefield") {
        const cost = head.cost;
        // Fixed-count permanent legs auto-pick the first N candidates. The
        // summed-power threshold shape (`{ minTotalPower }`, issue #977) has no
        // fixed cardinal; ice tests never use it, so treat it as 0 here.
        const count =
            cost && "permanent" in cost ? cost.permanent?.count : undefined;
        const required = typeof count === "number" ? count : 0;
        picks = (head.candidateIds ?? []).slice(0, required);
    }
    applyMayPaySubmit(state, {
        playerId: head.playerId,
        accept,
        sacrificeIds: picks,
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Cumulative upkeep — grant statics + restricted-CU mana (#639, ADR 0042).
// CR 702.24 (cumulative upkeep), CR 611 / 613 (continuous ability-grant layer
// 6), CR 106.6 (restricted mana, ADR 0022), CR 614.1c (leave → exile).
// ─────────────────────────────────────────────────────────────────────────────

export const UPKEEP_P2_EVENT = {
    type: "PHASE_BEGIN" as const,
    phase: "UPKEEP" as const,
    activePlayerId: "p2",
};

/** Fire a granted/printed cumulative-upkeep trigger on `host` via the stack,
 *  suspending at the may-pay (the same handshake `submitMayPay` drives). */
export function fireCU(
    state: GameState,
    host: CardInstanceState,
    abilityId: string
) {
    state.stack.push({
        ...host,
        zone: "stack",
        castById: host.controllerId,
        triggeredAbilityId: abilityId,
        triggerSourceId: host.id,
        triggerEvent: {
            type: "PHASE_BEGIN",
            phase: "UPKEEP",
            activePlayerId: host.controllerId,
        } as StackItem["triggerEvent"],
        targets: [],
    });
    resolveTopOfStack(state);
}

// ---------------------------------------------------------------------------
// Black buildable-now completion (#655)
// ---------------------------------------------------------------------------

/** A beginning-of-upkeep PHASE_BEGIN trigger event for the given active player. */
export const BLACK_UPKEEP = (
    activePlayerId: string
): StackItem["triggerEvent"] =>
    ({
        type: "PHASE_BEGIN" as const,
        phase: "UPKEEP" as const,
        activePlayerId,
    }) as StackItem["triggerEvent"];

// ===========================================================================
// Red buildable-now completion (#656). Each non-trivial card gets a dedicated
// describe block citing the CR section it exercises; combat triggers run via
// the real combat path (emitAttackersDeclaredEvents / emitBlockersConfirmedEvents
// + collectTriggers), and visible static/counter effects re-assert after
// projectPublicState (wire format).
// ===========================================================================

/** A PHASE_BEGIN trigger event for `playerId`'s upkeep/end step. */
export const PHASE_EVENT = (
    phase: "UPKEEP" | "END_STEP",
    activePlayerId: string
): StackItem["triggerEvent"] =>
    ({
        type: "PHASE_BEGIN" as const,
        phase,
        activePlayerId,
    }) as StackItem["triggerEvent"];

/** A PHASE_BEGIN trigger event for the END_OF_COMBAT step (CR 511.3). */
export const PHASE_EVENT_EOC = (
    activePlayerId: string
): StackItem["triggerEvent"] =>
    ({
        type: "PHASE_BEGIN" as const,
        phase: "END_OF_COMBAT",
        activePlayerId,
    }) as StackItem["triggerEvent"];

// ===========================================================================
// next-upkeep delayed-trigger cantrips (#660) — CR 502.2 / 603.7d
// ===========================================================================
//
// The ~22 ICE "draw a card at the beginning of the next turn's upkeep" cards
// schedule a `next-upkeep` delayed trigger (the timing union added in #660).
// These tests cover (a) the engine timing — scheduling, firing at the next
// upkeep regardless of whose turn, and firing exactly once — and (b) each
// card's unique body. The visible cantrip draw also gets a wire-format check.

/** Build a library of N distinct vanilla cards owned by `playerId`. */
export function library(playerId: string, ids: string[]): CardInstanceState[] {
    return ids.map((id) =>
        vanilla(id, 1, 1, {
            id,
            controllerId: playerId,
            ownerId: playerId,
            zone: "library",
        })
    );
}

/** Resolve a cantrip spell cast by `castById` with the given targets, leaving
 *  the delayed trigger scheduled (does NOT fire it). */
export function castCantrip(
    state: GameState,
    cardId: string,
    castById: string,
    targets: StackItem["targets"] = []
): void {
    pushSpell(state, cardId, castById, targets);
    resolveTopOfStack(state);
}

/** Enter an UPKEEP step for `activePlayerId` and fire next-upkeep triggers,
 *  mirroring `performPhaseEntry`'s UPKEEP branch. */
export function enterUpkeepAndFire(
    state: GameState,
    activePlayerId: string
): void {
    state.phase = "UPKEEP";
    state.activePlayerId = activePlayerId;
    fireDelayedTriggers(state, "next-upkeep");
}

// ─────────────────────────────────────────────────────────────────────────────
// Snow supertype + snow-matters cluster (#661). Engine: the Snow supertype on
// the five snow-covered basics, snow-land read helpers (CR 205.4a), and
// supertype-mutation statics (Melting / Arcum's Weathervane). Cards: every
// snow-matters card listed in #661.
// ─────────────────────────────────────────────────────────────────────────────

/** A land instance for a given snow-covered basic, controlled by `controllerId`. */
export function snowLand(
    cardId: string,
    id: string,
    controllerId = "p1"
): CardInstanceState {
    return makeInstance(cardId, { id, controllerId, ownerId: controllerId });
}

// ─────────────────────────────────────────────────────────────────────────────
// Divide-as-you-choose cluster (#664) — CR 601.2d / 120.4. Player-chosen
// division of a fixed total among ≥1-each chosen targets, for damage AND
// counters, plus the pay-X-life additional cost (Fire Covenant) and cast-time
// graveyard-derived X (Spoils of War).
// ─────────────────────────────────────────────────────────────────────────────

/** Makes a defending creature of the given toughness on p2's battlefield. */
export function makeTargetCreature(
    id: string,
    toughness = 5
): CardInstanceState {
    return makeInstance(balduvianBears.id, {
        id,
        controllerId: "p2",
        ownerId: "p2",
        power: 2,
        toughness,
    });
}

// --- Land-mana colour substitution (#665) -----------------------------------

/** Make a battlefield instance of a basic land for `controllerId`. */
export function makeLand(
    landId: string,
    controllerId: string
): CardInstanceState {
    return makeInstance(landId, {
        id: `${landId.slice(0, 4)}-${controllerId}`,
        controllerId,
        ownerId: controllerId,
        zone: "battlefield",
    });
}

/** The mana a basic land normally produces (its intrinsic subtype colour). */
export const BASIC_MANA: Record<string, ManaCost> = {
    [plains.id]: { W: 1 },
    [island.id]: { U: 1 },
    [swamp.id]: { B: 1 },
    [mountain.id]: { R: 1 },
    [forest.id]: { G: 1 },
};

// --- Noted-mana battery (#666): Jeweled Amulet / Ice Cauldron --------------
//
// CR 106.10 — "note the type [and amount] of mana spent". The engine captures
// the pool delta at activation commit and writes it onto the resulting stack
// item as `notedManaSpent`; the resolve step reads it via `getNotedManaSpent()`
// and stores it on the artifact with `noteMana`. Ability 2 replays it with
// `addNotedMana`. These helpers mirror the game.ts commit: push the ability with
// a `notedManaSpent` snapshot already attached, then resolve.

/** Resolve an activated ability whose commit captured `notedManaSpent`
 *  (mirrors game.ts: the manaPool delta snapshotted onto the stack item). */
export function resolveActivatedNoting(
    state: GameState,
    source: CardInstanceState,
    abilityId: string,
    notedManaSpent: Record<string, number>
): void {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        abilityId,
        notedManaSpent,
    });
    resolveTopOfStack(state);
}

// ═══════════════════════════════════════════════════════════════════════════
// One-off trigger / replacement event seams (#668)
// ═══════════════════════════════════════════════════════════════════════════

/** Drives a suspended may-pay choice to its accept/decline answer. */
export function answerMayPayHead(state: GameState, accept: boolean): void {
    const head = state.pendingChoices![0];
    applyMayPaySubmit(state, { playerId: head.playerId, accept });
}

/** Collects triggers off the current pendingEvents and returns the first whose
 *  triggeredAbilityId matches; pushes it on the stack so the caller can resolve. */
export function collectAndStack(
    state: GameState,
    triggeredAbilityId: string
): StackItem | undefined {
    const events = state.pendingEvents ?? [];
    state.pendingEvents = undefined;
    const trig = collectTriggers(state, events).find(
        (t) => t.triggeredAbilityId === triggeredAbilityId
    );
    if (trig) state.stack.push(trig);
    return trig;
}

// ---------------------------------------------------------------------------
// One-off seams — resolution & cost mechanics (#670)
// ---------------------------------------------------------------------------

/** Submit the head pending zone-pick choice with the given ids (mirrors the
 *  game.ts mutation), auto-resuming the suspended resolution. */
export function submitPick(state: GameState, cardInstanceIds: string[]): void {
    const head = state.pendingChoices![0];
    applyPendingChoiceSubmit(state, {
        playerId: head.playerId,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds,
    });
}

/** Answer the head may-pay choice (yes/no), auto-resuming resolution. */
export function answerHeadMayPay(state: GameState, accept: boolean): void {
    const head = state.pendingChoices![0];
    applyMayPaySubmit(state, { playerId: head.playerId, accept });
}

// ---------------------------------------------------------------------------
// Exile-and-return bundle synthetic events (ADR 0028) — mirrors the `LEFT` /
// ETB event builders other sets' helpers use (e.g. `nem/__tests__/helpers.ts`)
// so a card combining `exileWithAttachments` on ETB with `returnExiledForSource`
// on leave (Icy Prison) can be driven through `resolveTrigger` without each
// test hand-rolling the event shape.
// ---------------------------------------------------------------------------

/** A PERMANENT_ENTERED event for `instanceId` entering under `controllerId`
 *  (CR 603.6a). */
export const ENTERED = (
    instanceId: string,
    controllerId: string,
    types: ReadonlyArray<CardType> = ["Enchantment"]
): StackItem["triggerEvent"] =>
    ({
        type: "PERMANENT_ENTERED" as const,
        instanceId,
        controllerId,
        types,
    }) as StackItem["triggerEvent"];

/** A PERMANENT_LEFT event for `sourceId` leaving the battlefield to the
 *  graveyard (CR 603.7a). Mirrors `nem/__tests__/helpers.ts`'s `LEFT`. */
export const LEFT = (
    sourceId: string,
    controllerId = "p1"
): StackItem["triggerEvent"] =>
    ({
        type: "PERMANENT_LEFT" as const,
        instanceId: sourceId,
        controllerId,
        ownerId: controllerId,
        types: ["Enchantment"] as const,
        wasAura: false,
        toZone: "graveyard" as const,
    }) as StackItem["triggerEvent"];
