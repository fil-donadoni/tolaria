// Shared helpers consumed by the trigger factories in
// `convex/cards/abilities/triggers/`. Three orthogonal helper groups live
// here:
//
//   1. Phase-anchored scope helpers (`TriggerScope`, `resolvePhaseScope`) for
//      `phaseTrigger` — gates CR 603.6a "at the beginning of [step]" triggers
//      by source-relative scope (your / each / opponents / host-controller).
//   2. Permanent-anchored scope helpers (`PermanentScope`,
//      `matchesPermanentScope`, `ScopedPermanentIdentity`) for
//      `diedTrigger` / `enteredTrigger` / `leftTrigger` / `tappedTrigger` —
//      gates CR 603.2 / 109.2 triggers by the affected permanent's identity
//      relative to the trigger source.
//   3. Damage trigger helpers (`DamageSourceScope`, `DamageTriggerPayload`,
//      `matchesSourceScope`, `passesSourceFilter`, `passesTargetPermanentFilter`,
//      `passesTargetPlayerFilter`, `buildSourceMatchable`, `buildDamagePayload`,
//      `findPermanentInView`, `findPlayerInView`, `isDamageDealtEvent`) for
//      `damageDealtTrigger` / `damageTakenTrigger` — both factories listen to
//      the same `DAMAGE_DEALT` event and differ only in which side of the
//      event they gate on (CR 120.3 / 603.10).
//   4. Check-time gate marking (`withTriggerGate`) — the one place a factory
//      records that its ability is CONDITIONAL (CR 603.4), plus the per-Kicker
//      check-time predicate (`kickerPaidCondition`) that the Battlemage
//      cycle's "if it was kicked with its {A} kicker" triggers are gated on
//      (CR 702.33, ADR 0079, issue #2015).
//
// The scope vocabularies are fixed at ADR 0002 — keep this file as the single
// source of truth so the factories stay in lockstep.

import type {
    CardType,
    Color,
    DamageDealtEvent,
    PermanentView,
    PhaseBeginEvent,
    TargetSelection,
    TriggeredAbility,
    TriggerStateView,
} from "../../types";
import { UNDECIDABLE_TRIGGER_GATE } from "../../types";
import type {
    DamageSourceFilter,
    FilterMatchContext,
    MatchableDamageSource,
    MatchablePermanent,
    MatchablePlayer,
    PermanentFilter,
    PlayerFilter,
} from "../../filters";
import {
    matchesDamageSourceFilter,
    matchesPermanentFilter,
    matchesPlayerFilter,
} from "../../filters";

// ─── Phase scope (phaseTrigger) ──────────────────────────────────────────────

/** Who the trigger cares about — drives both the `matches()` filter and the
 *  `scopedPlayerId` passed to the per-card resolve body. See
 *  `phaseTrigger.ts` for the per-scope contract. */
export type TriggerScope = "your" | "each" | "opponents" | "host-controller";

/** Resolves a `TriggerScope` against the current PHASE_BEGIN event.
 *  Returns the playerId the trigger is "about", or `null` if the scope
 *  predicate fails and the trigger should not fire. */
export function resolvePhaseScope(
    scope: TriggerScope,
    event: PhaseBeginEvent,
    self: PermanentView,
    state?: TriggerStateView
): string | null {
    if (scope === "each") return event.activePlayerId;
    if (scope === "your") {
        return event.activePlayerId === self.controllerId
            ? self.controllerId
            : null;
    }
    if (scope === "opponents") {
        return event.activePlayerId !== self.controllerId
            ? event.activePlayerId
            : null;
    }
    // host-controller (CR 303.4b — Aura trigger keyed on enchanted permanent).
    if (!self.attachedTo) return null;
    for (const p of state?.players ?? []) {
        const host = p.battlefield.find((c) => c.id === self.attachedTo);
        if (host) {
            return host.controllerId === event.activePlayerId
                ? host.controllerId
                : null;
        }
    }
    return null;
}

// ─── Permanent scope (died/entered/left/tapped triggers) ─────────────────────

/** Source-relative scope vocabulary shared by permanent-anchored trigger
 *  factories. Mirrors the ADR 0002 scope axis for died/entered/left/tapped. */
export type PermanentScope =
    | "self"
    | "yours"
    | "opponents"
    | "any"
    | "another-yours"
    | "any-other"
    // CR 303.4b — Aura trigger keyed on the ENCHANTED permanent (the Aura's
    // host). Matches when the affected permanent is `self.attachedTo`
    // (Seizures — "whenever enchanted creature becomes tapped"). On an Aura not
    // attached to anything it matches nothing.
    | "host";

/** Identifying fields lifted from an event payload — instance id of the
 *  affected permanent and its controller at event time (CR 603.10 last
 *  known information). Different events expose these under different field
 *  names (`creatureInstanceId`/`creatureControllerId`,
 *  `permanentId`/`controllerId`, etc.) — the caller normalizes once and
 *  hands this shape to the resolver. */
export interface ScopedPermanentIdentity {
    instanceId: string;
    controllerId: string;
}

/** Returns true if the scoped event's affected permanent satisfies `scope`
 *  relative to the trigger's source `self`. Pure — reads only its inputs.
 *  CR 109.2 (self-exclusion) is enforced for `another-yours` / `any-other`. */
export function matchesPermanentScope(
    scope: PermanentScope,
    event: ScopedPermanentIdentity,
    self: PermanentView
): boolean {
    switch (scope) {
        case "self":
            return event.instanceId === self.id;
        case "yours":
            return event.controllerId === self.controllerId;
        case "opponents":
            return event.controllerId !== self.controllerId;
        case "any":
            return true;
        case "another-yours":
            return (
                event.controllerId === self.controllerId &&
                event.instanceId !== self.id
            );
        case "any-other":
            return event.instanceId !== self.id;
        case "host":
            // CR 303.4b — the affected permanent IS the Aura's host.
            return (
                self.attachedTo !== undefined &&
                event.instanceId === self.attachedTo
            );
    }
}

// ─── Damage triggers (damageDealtTrigger / damageTakenTrigger) ───────────────

/** Source-side scope vocabulary used by `damageDealtTrigger.source` and (as
 *  an optional refinement) by `damageTakenTrigger.source`. Tests the damage
 *  source's controller-relation to the trigger source (CR 109.4, 109.5). */
export type DamageSourceScope = "self" | "yours" | "opponents" | "any";

/** Derived payload exposed to the user-facing `resolve` callback. Spares the
 *  card author from re-narrowing `event.type` and from looking up the source's
 *  characteristics by hand (CR 603.10 last-known information snapshotted at
 *  emit time on the event). */
export interface DamageTriggerPayload {
    source: {
        id: string;
        controllerId: string;
        colors: ReadonlyArray<Color>;
        types: ReadonlyArray<CardType>;
    };
    target: TargetSelection;
    amount: number;
    isCombat: boolean;
}

/** True if the source side of `event` matches `scope` relative to `self`.
 *  CR 109.4 (controller of a permanent), CR 109.5 (controller of a stack
 *  item). Sources are always permanents or stack items — never players. */
export function matchesSourceScope(
    event: DamageDealtEvent,
    self: PermanentView,
    scope: DamageSourceScope
): boolean {
    if (scope === "any") return true;
    if (scope === "self") return event.sourceInstanceId === self.id;
    if (scope === "yours") {
        return event.sourceControllerId === self.controllerId;
    }
    // "opponents"
    return event.sourceControllerId !== self.controllerId;
}

/** Builds a `MatchableDamageSource` from the event's snapshotted source
 *  fields (CR 603.10). The emitter populates `sourceColors / sourceTypes /
 *  sourceSubtypes / sourceStaticAbilities` at damage time; if absent (e.g.
 *  synthetic event in tests), defaults to empty arrays so filters become
 *  no-ops rather than throwing. */
export function buildSourceMatchable(
    event: DamageDealtEvent
): MatchableDamageSource {
    return {
        types: event.sourceTypes ?? [],
        subtypes: event.sourceSubtypes ?? [],
        colors: event.sourceColors ?? [],
        staticAbilities: event.sourceStaticAbilities ?? [],
        controllerId: event.sourceControllerId,
        instanceId: event.sourceInstanceId,
    };
}

/** True if the damage source matches `filter` (CR 120.3 source-side). Returns
 *  `true` when `filter` is undefined (no constraint). */
export function passesSourceFilter(
    event: DamageDealtEvent,
    self: PermanentView,
    filter: DamageSourceFilter | undefined
): boolean {
    if (filter === undefined) return true;
    const ctx: FilterMatchContext = {
        selfInstanceId: self.id,
        selfControllerId: self.controllerId,
    };
    return matchesDamageSourceFilter(buildSourceMatchable(event), filter, ctx);
}

/** Looks up a permanent on the battlefield via the narrow trigger state view.
 *  Returns `null` if not found (target has already left the battlefield —
 *  filter checks treat that as a non-match). */
export function findPermanentInView(
    state: TriggerStateView | undefined,
    instanceId: string
): MatchablePermanent | null {
    if (!state) return null;
    for (const player of state.players) {
        for (const card of player.battlefield) {
            if (card.id === instanceId) {
                return {
                    id: card.id,
                    types: card.types,
                    subtypes: card.subtypes,
                    staticAbilities: card.staticAbilities,
                    controllerId: card.controllerId,
                };
            }
        }
    }
    return null;
}

/** Looks up a player in the narrow trigger state view. */
export function findPlayerInView(
    state: TriggerStateView | undefined,
    playerId: string
): MatchablePlayer | null {
    if (!state) return null;
    for (const player of state.players) {
        if (player.id === playerId) {
            return { id: player.id, life: player.life };
        }
    }
    return null;
}

/** True if the event's target permanent passes `filter` (CR 109.4
 *  controller-relations resolved via the source's `self` view). Returns
 *  `false` if the target isn't a permanent or has left the battlefield —
 *  the trigger doesn't fire (callers can compose with target-kind checks). */
export function passesTargetPermanentFilter(
    event: DamageDealtEvent,
    self: PermanentView,
    state: TriggerStateView | undefined,
    filter: PermanentFilter | undefined
): boolean {
    if (event.target.type !== "permanent") return false;
    const ctx: FilterMatchContext = {
        selfInstanceId: self.id,
        selfControllerId: self.controllerId,
    };
    if (filter === undefined) return true;
    // controllerRelation "self" wants the target permanent's id to equal
    // self.id (CR 109.2). When the target permanent has left the battlefield
    // (e.g. lethal damage already moved it to the graveyard during the same
    // trigger batch), `findPermanentInView` returns null. Synthesise a
    // minimal permanent shape using the event's target id so `self` triggers
    // still fire on the source itself (the source is on the battlefield at
    // trigger-collection time — see Fungusaur).
    const candidate: MatchablePermanent =
        findPermanentInView(state, event.target.id) ??
        ({
            id: event.target.id,
            types: [],
            subtypes: [],
            staticAbilities: [],
            controllerId: undefined,
        } as MatchablePermanent);
    return matchesPermanentFilter(candidate, filter, ctx);
}

/** True if the event's target player passes `filter`. */
export function passesTargetPlayerFilter(
    event: DamageDealtEvent,
    self: PermanentView,
    state: TriggerStateView | undefined,
    filter: PlayerFilter
): boolean {
    if (event.target.type !== "player") return false;
    const candidate =
        findPlayerInView(state, event.target.id) ??
        // Player not visible in the view (shouldn't happen but stay
        // defensive): synthesise an entry; relation checks still resolve
        // off `ctx.selfControllerId`.
        ({ id: event.target.id, life: 0 } as MatchablePlayer);
    const ctx: FilterMatchContext = {
        selfControllerId: self.controllerId,
    };
    return matchesPlayerFilter(candidate, filter, ctx);
}

/** Constructs the derived payload handed to the user's `resolve` callback. */
export function buildDamagePayload(
    event: DamageDealtEvent
): DamageTriggerPayload {
    return {
        source: {
            id: event.sourceInstanceId,
            controllerId: event.sourceControllerId,
            colors: event.sourceColors ?? [],
            types: event.sourceTypes ?? [],
        },
        target: event.target,
        amount: event.amount,
        isCombat: event.isCombat,
    };
}

/** Narrows the broad `GameEvent` union from a `matches`/`interveningIf`
 *  callback down to `DamageDealtEvent`. Caller-side ergonomics. */
export function isDamageDealtEvent(event: {
    type: string;
}): event is DamageDealtEvent {
    return event.type === "DAMAGE_DEALT";
}

// ---------------------------------------------------------------------------
// 4. Check-time gate marking (CR 603.4, issue #1936)
// ---------------------------------------------------------------------------

/** Stamps the built ability with the `TriggerGate` implied by the factory
 *  args — the ONE place the trigger factories record that an ability is gated,
 *  so a non-engine reader (the bot's Effect Script value model) stops valuing
 *  a conditional ability as if it always fires. See {@link TriggerGate}.
 *
 *  `conditionOnSelf` (decidable from the source permanent alone) wins over a
 *  plain `condition` (opaque — it may read the firing event or the wider
 *  board); an ability with neither is left ungated. Every factory that accepts
 *  a `condition` MUST route its return through this helper —
 *  `convex/gre/ai/__tests__/triggerGate.bot.test.ts` fails when one doesn't. */
export function withTriggerGate<T extends TriggeredAbility>(
    ability: T,
    args: {
        condition?: unknown;
        conditionOnSelf?: (self: PermanentView) => boolean;
    }
): T {
    if (args.conditionOnSelf !== undefined) {
        ability.gate = { onSelf: args.conditionOnSelf };
    } else if (args.condition !== undefined) {
        ability.gate = UNDECIDABLE_TRIGGER_GATE;
    }
    return ability;
}

// ---------------------------------------------------------------------------
// 5. Per-Kicker check-time predicates (CR 702.33 / 603.4, issue #2015)
// ---------------------------------------------------------------------------

/** CR 702.33 — how many times the NAMED Kicker was paid to cast this
 *  permanent's spell, read from the per-Kicker payment record snapshotted onto
 *  the permanent as it entered the battlefield
 *  ({@link PermanentView.kickerPayments}, ADR 0079 / issue #1950).
 *
 *  FAIL-CLOSED by construction: an id the permanent has no entry for — a
 *  mistyped kicker id, a permanent that was never cast as a spell (a token, a
 *  reanimated card), a permanent whose payment record a CR 400.7 zone change
 *  already cleared — reads 0, never a truthy default. A gate built on this can
 *  therefore only ever fail to fire, never fire spuriously; a spurious fire is
 *  the strictly worse error, because a trigger that reaches the stack ANNOUNCES
 *  targets and emits `BECAME_TARGET` (issue #2015).
 *
 *  Deliberately a local read of the documented public field rather than an
 *  import of `gre/kicker.ts`'s `kickerPaidCount` (the RESOLUTION-time authority
 *  over the same record): `gre/kicker.ts` pulls in `gre/state.ts`, and this
 *  module is imported — transitively — by every card file in the catalogue, so
 *  that edge would drag the whole engine into every card module's init graph.
 *  The two are pinned to identical behaviour by an agreement test
 *  (`__tests__/kickerPaidCondition.test.ts`). */
function kickerPaidTimes(self: PermanentView, kickerId: string): number {
    const n = self.kickerPayments?.[kickerId];
    return typeof n === "number" && n > 0 ? n : 0;
}

/** CR 603.4 check-time predicate — "if it was kicked with its {A} kicker",
 *  evaluated the instant the triggering event occurs, BEFORE the ability is
 *  put on the stack. A false answer means the ability never triggers at all
 *  (CR 603.4): no stack item, no target announcement, and therefore no
 *  `BECAME_TARGET` event to tax the auto-selected permanent's controller with
 *  a ward / "becomes the target" trigger (issue #2015).
 *
 *  Built for the Planeshift Battlemage cycle — "Kicker {A} and/or {B}" with one
 *  intervening-if ETB trigger per Kicker — where the AGGREGATE `wasKicked`
 *  boolean is not enough: it says "kicked with SOMETHING", so a Battlemage
 *  kicked with only its {G} Kicker would still put its {1}{B}-gated trigger on
 *  the stack. Pass it as `conditionOnSelf` (not `condition`) wherever the
 *  factory offers both: the predicate reads only `self`, so `withTriggerGate`
 *  can stamp a DECIDED gate the bot's value model can evaluate, instead of
 *  `UNDECIDABLE_TRIGGER_GATE` (issue #1936).
 *
 *  Do NOT also declare this predicate as the ability's `interveningIf`.
 *  `resolveTopOfStackInner` (`gre/state.ts`) re-evaluates an `interveningIf`
 *  against the LIVE battlefield permanent found by `triggerSourceId`, and only
 *  falls back to the stack item's own last-known information when the source
 *  is NOT on the battlefield. A CR 400.7 zone change that returns the same
 *  instance object — a blink/flicker (Ephemerate), a bounce-and-replay —
 *  re-finds the permanent by that id AFTER `resetBattlefieldTransientState`
 *  has deleted `kickerPayments`, so the re-check would read a CLEARED record
 *  and fizzle a trigger that CR 608.2h says must resolve off last known
 *  information — the object the ability expects ceased to exist (CR 400.7
 *  makes the returned permanent a NEW object), so 608.2h's "no longer in
 *  that zone" leg applies even though something with the same instance id
 *  is sitting on the battlefield. (Not CR 603.10, which is the unrelated
 *  "look back in time" rule about whether an ability TRIGGERS at all.)
 *  The correct resolution-time answer is the
 *  `if { kickerPaid: "<id>" }` branch inside the ability's own `effects[]`:
 *  it reads the RESOLVING STACK ITEM's payment record (`buildTriggerItem`'s
 *  `...self` spread, `gre/triggers.ts`), which is exactly the LKI snapshot,
 *  and it also still holds for an ability COPY that reaches the stack without
 *  re-running `matches` (CR 707.10).
 *
 *  This is not a Kicker-specific hazard — `interveningIf` is the wrong seam
 *  for ANY one-shot cast fact `resetBattlefieldTransientState` clears
 *  (`chosenXOnCast`/`chosenX` and `wasKicked` alongside `kickerPayments`).
 *  Jacked Rabbit's Ravenous trigger (`sets/blc/white.ts`) still ships the
 *  buggy shape: blinked at X=6 it draws 0 cards, and a 2026-08-05 census
 *  found four more consumers reading a re-entry-cleared field the same way
 *  (Erg Raiders, the Clockwork pair, Living Artifact). The mirror-image bug
 *  — a one-shot fact `resetBattlefieldTransientState` fails to clear, so the
 *  new object INHERITS it (`echoPending`, `startedTurnUntapped`, …) — is a
 *  separate gap, #2223. The engine-level fix for THIS one — a departure-time
 *  LKI snapshot stamped onto the stack item at the
 *  `removePermanentTo` funnel, preferred over the live permanent by
 *  `resolveTopOfStackInner` — is tracked-by: #2042. Until it lands, gate at
 *  check time here and at resolution time inside `effects[]`. Keep this pair
 *  even AFTER it lands: the `if { kickerPaid }` branch is also what survives
 *  an ability COPY reaching the stack without re-running `matches`
 *  (CR 707.10), which the engine fix does not address. */
export function kickerPaidCondition(
    kickerId: string
): (self: PermanentView) => boolean {
    return (self) => kickerPaidTimes(self, kickerId) >= 1;
}
