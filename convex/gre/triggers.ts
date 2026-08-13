// Trigger scan and stack push (CR 603).
//
// Flow: the engine applies a game action that emits one or more `GameEvent`s,
// then calls `collectTriggers` which returns one StackItem per (permanent,
// ability, event) match. Caller appends them to the stack and restarts
// priority from the active player.
//
// APNAP ordering of SIMULTANEOUS same-controller triggers (CR 603.3b, ADR 0058)
// is handled by `placeTriggersOnStack` below: `collectTriggers` builds the batch
// in collection order (active player's permanents first, then opponents', in
// battlefield-declaration order), and the placement helper lets each controller
// order their own slice before the batch lands on the stack.

import type {
    EffectOp,
    EmblemInstance,
    GameEvent,
    GameEventType,
    PermanentView,
    StateCheckEvent,
    TargetRequirement,
    TriggeredAbility,
} from "../cards/types";
import { tryGetDefinition } from "../cards";
import { MONARCH_DESIGNATION } from "../cards/designations";
import { tokenPrintIdFor } from "../cards/tokenPrintLookup";
import { INLINE_DELAYED_TRIGGER_ID } from "./effects/interpreter";
import { tryGetEmblemDefinition } from "../cards/emblems";
import type {
    CardInstanceState,
    DelayedTriggerInstance,
    GameState,
    PendingChoice,
    StackItem,
} from "./state";
import { getPlayer, allocInstanceId } from "./state";
import { effectiveTriggeredAbilities, findTriggeredAbility } from "./copy";
import { raiseTriggerTargetSelection } from "./rules";

/** Builds the StackItem a fired delayed triggered ability resolves from (CR
 *  603.7a, ADR 0048). Shared by the phase-boundary fire path
 *  (`fireDelayedTriggers`, phases.ts) and the instance leave-watch fire path
 *  (`collectTriggers`, issue #731): an INLINE-body instance carries its Effect
 *  Script + payload onto the stack item, so resolution needs no card-def
 *  lookup. */
export function buildDelayedTriggerStackItem(
    state: GameState,
    t: DelayedTriggerInstance
): StackItem {
    return {
        id: allocInstanceId(state),
        card: { id: t.sourceCardId },
        controllerId: t.controller,
        ownerId: t.controller,
        zone: "stack",
        types: [],
        subtypes: [],
        staticAbilities: [],
        isTapped: false,
        castById: t.controller,
        delayedTriggerId: t.triggerId,
        delayedPayload: t.payload,
        // ADR 0048 — an inline-body instance carries its Effect Script onto the
        // stack item, so resolution needs no card-def lookup.
        ...(t.effects ? { delayedEffects: t.effects } : {}),
        // ADR 0048 — an inline delayed trigger's oracle text is not on any card
        // def (its id is the constant INLINE_DELAYED_TRIGGER_ID), so carry it
        // onto the stack item for the client to render the ability tile.
        ...(t.oracleText ? { delayedOracleText: t.oracleText } : {}),
    };
}

/** CR 725.2 (issue #1199) — the monarch's inherent end-step draw is a real
 *  TRIGGERED ABILITY that USES THE STACK ("At the beginning of the monarch's
 *  end step, that player draws a card"), NOT an immediate turn-based action:
 *  both players receive priority and may respond before it resolves, and — per
 *  the official ruling — the player who was the monarch when it triggered draws
 *  even if the monarch designation changes hands before it resolves. The
 *  ability has no source and is controlled by that monarch (CR 113.8), captured
 *  here as `controllerId`/`castById` so the draw stays pinned to them.
 *
 *  Built as an inline-body delayed-trigger stack item (ADR 0048): the `draw` Op
 *  rides ON the item (`delayedEffects`, no card-def lookup) and routes through
 *  the unified draw seam (CR 614, ADR 0061) at resolution, so a draw
 *  replacement (Zur's Weirding) still applies. `player: "controller"` resolves
 *  to the pinned monarch via `buildSpellContext`. */
export function buildMonarchDrawStackItem(
    state: GameState,
    monarchId: string
): StackItem {
    const draw: EffectOp = { op: "draw", player: "controller", count: 1 };
    // Cosmetic per-source art (issue #1305): theme the marker to the card that
    // crowned this monarch (Forth Eorlingas → LTR "The Monarch", Palace Jailer
    // → the Conspiracy one), the way a token's art matches its producer. Falls
    // back to the designation's global marker when there is no themed source
    // (a CR 720.3 combat-damage steal) or the lockfile has no entry.
    const themedPrintId = state.monarchSourceCardId
        ? tokenPrintIdFor(state.monarchSourceCardId, MONARCH_DESIGNATION.name)
        : undefined;
    return {
        id: allocInstanceId(state),
        card: { id: "" },
        controllerId: monarchId,
        ownerId: monarchId,
        zone: "stack",
        types: [],
        subtypes: [],
        staticAbilities: [],
        isTapped: false,
        castById: monarchId,
        delayedTriggerId: INLINE_DELAYED_TRIGGER_ID,
        delayedEffects: [draw],
        delayedOracleText:
            "At the beginning of the monarch's end step, that player draws a card.",
        // Cosmetic: keys the Monarch marker art + name for the stack tile
        // (a card-less inline trigger would otherwise render an empty tile).
        designationId: MONARCH_DESIGNATION.id,
        ...(themedPrintId ? { designationImagePrintId: themedPrintId } : {}),
    };
}

/** Builds a StackItem representing a triggered ability on the stack. */
function buildTriggerItem(
    state: GameState,
    self: CardInstanceState,
    triggeredAbilityId: string,
    event: GameEvent
): StackItem {
    return {
        ...self,
        id: allocInstanceId(state),
        zone: "stack",
        castById: self.controllerId,
        triggeredAbilityId,
        triggerSourceId: self.id,
        triggerEvent: event,
        // CR 603.3d — a triggered ability's targets are chosen when it is put
        // on the stack, not inherited from the source permanent. The `...self`
        // spread copies the source's stale `targets` (e.g. an Aura still
        // carries the `graveyard-card` target from when it was cast); drop it
        // so the resolution-time legality gate (CR 608.2b) doesn't fizzle the
        // trigger against a target that was never its own. Targeted triggers
        // set their own `targets` after this builder runs.
        targets: undefined,
        // CR 603.3c / 700.2b (issue #2461) — the SAME stale-spread hazard for
        // the MODE. A battlefield permanent legitimately carries an
        // instance-level `chosenModeId` (its own modal cast:
        // `resetStackTransientState` strips it only on a non-battlefield exit,
        // because `getEffectiveStaticEffects` reads it there), and `...self`
        // would copy that id onto its trigger — which
        // `raiseTriggerModeAnnouncement` reads as "already announced" and skips,
        // so a modal trigger would go to resolution with a mode nobody chose
        // and resolve as nothing. The mode is announced as the ability is put
        // on the stack, never inherited.
        chosenModeId: undefined,
    };
}

/** CR 702.35a — builds the synthetic reflexive triggered ability StackItem a
 *  card discarded via Madness puts on the stack ("When this card is discarded
 *  and exiled this way, its owner may cast it..."). Engine-owned: it carries no
 *  card-def ability, only the `madnessTrigger` marker (the exiled card's id),
 *  which `resolveTopOfStack` reads to open the owner's cast window. Controlled
 *  by the card's owner. */
export function buildMadnessReflexiveTrigger(
    state: GameState,
    card: CardInstanceState,
    ownerId: string
): StackItem {
    return {
        id: allocInstanceId(state),
        card: { id: (card.card as { id?: string }).id ?? "" },
        controllerId: ownerId,
        ownerId,
        zone: "stack",
        types: [],
        subtypes: [],
        staticAbilities: [],
        isTapped: false,
        castById: ownerId,
        madnessTrigger: card.id,
    };
}

/** CR 702.88a — builds the synthetic reflexive triggered ability StackItem a
 *  fired Rebound delayed trigger puts on the stack ("At the beginning of your
 *  next upkeep, you may cast this spell from exile..."). Engine-owned: it
 *  carries no card-def ability, only the `reboundTrigger` marker (the exiled
 *  card's id), which `resolveTopOfStack` reads to open the caster's cast
 *  window. Controlled by the card's caster (its owner in every shipped
 *  case — Rebound has no "control change" variant). Mirrors
 *  `buildMadnessReflexiveTrigger`; called from `fireDelayedTriggers`
 *  (phases.ts) instead of `collectTriggers`, since Rebound's window opens at
 *  a scheduled phase boundary rather than immediately off a discard event. */
export function buildReboundReflexiveTrigger(
    state: GameState,
    card: CardInstanceState,
    casterId: string
): StackItem {
    return {
        id: allocInstanceId(state),
        card: { id: (card.card as { id?: string }).id ?? "" },
        controllerId: casterId,
        ownerId: casterId,
        zone: "stack",
        types: [],
        subtypes: [],
        staticAbilities: [],
        isTapped: false,
        castById: casterId,
        reboundTrigger: card.id,
    };
}

/** CR 114 (issue #1221) — a source-less synthetic `PermanentView` standing in
 *  for a command-zone emblem, passed as `self` to an emblem triggered ability's
 *  `matches` predicate. `controllerId`/`ownerId` are the emblem's owner
 *  (CR 114.3), so a "whenever you cast a spell" predicate (comparing the event's
 *  caster to `self.controllerId`) scopes to the emblem's owner. */
function emblemAsTriggerSelf(emblem: EmblemInstance): PermanentView {
    return {
        id: emblem.id,
        controllerId: emblem.ownerId,
        ownerId: emblem.ownerId,
        types: [],
        subtypes: [],
        isTapped: false,
        // Registry-keyed like a card's `card.id`, for any predicate that reads
        // the source's underlying definition.
        card: { id: emblem.emblemId },
    } as PermanentView;
}

/** CR 114 — builds the source-less StackItem for a triggered ability that fired
 *  from a command-zone emblem. Mirrors `buildMadnessReflexiveTrigger`: no
 *  battlefield permanent is spread in. `emblemSourceId` (the emblem's registry
 *  key) tells `resolveTopOfStack` to resolve the ability from the emblem
 *  registry; `triggerSourceId` pins the emblem instance for LKI. Controlled by
 *  the emblem's owner. Issue #1221.
 *
 *  An emblem has no `CardDefinition`, so `raiseTriggerTargetSelection`'s normal
 *  `findTriggeredAbility` lookup (which reads the CARD registry) can't see a
 *  targeted emblem ability's `targetRequirement`. Ride it on the stack item via
 *  `inlineTargetRequirement` — the same seam a reflexive trigger uses (CR
 *  603.3d) — so a targeting emblem (Chandra's −7: "deals 5 damage to any
 *  target", issue #1478) gets its target chosen exactly like a card-def
 *  trigger. Omitted for a non-targeting emblem. */
function buildEmblemTriggerItem(
    state: GameState,
    emblem: EmblemInstance,
    triggeredAbilityId: string,
    event: GameEvent,
    targetRequirement?: TargetRequirement
): StackItem {
    return {
        id: allocInstanceId(state),
        card: { id: emblem.emblemId },
        controllerId: emblem.ownerId,
        ownerId: emblem.ownerId,
        zone: "stack",
        types: [],
        subtypes: [],
        staticAbilities: [],
        isTapped: false,
        castById: emblem.ownerId,
        triggeredAbilityId,
        triggerSourceId: emblem.id,
        triggerEvent: event,
        emblemSourceId: emblem.emblemId,
        ...(targetRequirement
            ? { inlineTargetRequirement: targetRequirement }
            : {}),
    };
}

/** True if `type` is one of the event kinds `ability` fires on — a scalar
 *  `event` compared directly, an array `event` (a single Oracle line spanning
 *  several engine events, e.g. "put into a graveyard from anywhere") tested for
 *  membership. CR 603.2. */
export function triggerHandlesEventType(
    ability: TriggeredAbility,
    type: GameEventType
): boolean {
    return Array.isArray(ability.event)
        ? ability.event.includes(type)
        : ability.event === type;
}

/** True if `ability` has already triggered its per-turn maximum on this exact
 *  source object (CR 603.2 — "this ability triggers only twice each turn").
 *  Uncapped abilities (the overwhelming majority) always return false. The
 *  tally is per PERMANENT INSTANCE, so a battlefield-wide grant gives each
 *  recipient its own quota. */
function triggerCapReached(
    permanent: CardInstanceState,
    ability: TriggeredAbility
): boolean {
    const max = ability.maxTriggersPerTurn;
    if (max === undefined) return false;
    return (permanent.triggersThisTurn?.[ability.id] ?? 0) >= max;
}

/** Records that `ability` triggered once on `permanent` this turn (CR 603.2).
 *  No-op for an uncapped ability so the common path allocates nothing — the
 *  tally exists only to serve `maxTriggersPerTurn`. Reset at the turn boundary
 *  by `resetPerTurnCounters` (gre/phases.ts). */
function noteTriggerFired(
    permanent: CardInstanceState,
    ability: TriggeredAbility
): void {
    if (ability.maxTriggersPerTurn === undefined) return;
    const tally: Record<string, number> = permanent.triggersThisTurn ?? {};
    tally[ability.id] = (tally[ability.id] ?? 0) + 1;
    permanent.triggersThisTurn = tally;
}

/** Scans all battlefield permanents for triggered abilities matching `events`.
 *  Returns new StackItems in the order they should be placed on the stack.
 *
 *  CR 603.10: a triggered ability fires based on whether the source had the
 *  ability when the trigger condition arose, even if the source has since
 *  left the battlefield (e.g. Fungusaur taking lethal damage — its
 *  "is dealt damage" trigger should still go on the stack). To honor that,
 *  we also scan creatures that died in this same trigger batch (their ids
 *  are carried in CREATURE_DIED events) by looking them up in the relevant
 *  player's graveyard. The trigger lands on the stack and resolves with
 *  last-known information; effect primitives that target a non-battlefield
 *  permanent simply no-op. */
export function collectTriggers(
    state: GameState,
    events: GameEvent[]
): StackItem[] {
    if (events.length === 0) return [];

    const active = getPlayer(state, state.activePlayerId);
    const opponents = state.players.filter(
        (p) => p.id !== state.activePlayerId
    );
    const ordered = [active, ...opponents];

    const recentlyDead = new Set<string>();
    // CR 603.10 — PERMANENT_LEFT triggers on the leaving permanent itself
    // ("when this Aura leaves the battlefield, ...") need to find the source
    // in its destination zone. Track (instanceId → toZone) so we know which
    // zone to scan for each id.
    const recentlyLeft = new Map<
        string,
        "graveyard" | "exile" | "hand" | "library"
    >();
    for (const ev of events) {
        if (ev.type === "CREATURE_DIED") {
            recentlyDead.add(ev.creatureInstanceId);
        } else if (ev.type === "PERMANENT_LEFT") {
            recentlyLeft.set(ev.instanceId, ev.toZone);
        }
    }

    const out: StackItem[] = [];
    for (const player of ordered) {
        const sources: CardInstanceState[] = [...player.battlefield];
        if (recentlyDead.size > 0) {
            for (const c of player.graveyard) {
                if (recentlyDead.has(c.id)) sources.push(c);
            }
        }
        if (recentlyLeft.size > 0) {
            // CR 603.10 last-known-information: the leaving permanent has
            // already been moved to its destination zone. Scan each zone
            // referenced by recentlyLeft.toZone so an aura that just hit
            // the graveyard can still place its LTB-trigger on the stack.
            const visitedIds = new Set<string>();
            for (const [id, zone] of recentlyLeft) {
                if (visitedIds.has(id)) continue;
                const pile =
                    zone === "graveyard"
                        ? player.graveyard
                        : zone === "exile"
                          ? player.exile
                          : zone === "hand"
                            ? player.hand
                            : player.library;
                for (const c of pile) {
                    if (c.id === id && !sources.includes(c)) {
                        sources.push(c);
                        visitedIds.add(id);
                        break;
                    }
                }
            }
        }
        for (const permanent of sources) {
            const cardId = (permanent.card as { id?: string }).id;
            if (!cardId) continue;
            // CR 707.9d — includes abilities retained through a copy effect
            // (Vesuvan Doppelganger's upkeep re-copy).
            const abilities = effectiveTriggeredAbilities(permanent);
            if (abilities.length === 0) continue;
            for (const ability of abilities) {
                // Battlefield-zone abilities only here; graveyard-zone
                // abilities (zone: "graveyard") are scanned separately below.
                if (ability.zone) continue;
                // CR 603.3b — "whenever one or more X" abilities collapse
                // every matching event in this batch into a single trigger
                // (see `TriggeredAbility.oncePerEventBatch`); everything else
                // fires once per matching event, as before.
                let firedThisBatch = false;
                for (const event of events) {
                    if (!triggerHandlesEventType(ability, event.type)) continue;
                    if (ability.oncePerEventBatch && firedThisBatch) continue;
                    // CR 603.2 — "this ability triggers only N times each turn"
                    // (Nadu, Winged Wisdom). The cap is checked BEFORE
                    // `matches`, so an over-quota ability never fires: no stack
                    // item is created, which is the difference between this and
                    // a trigger that goes on the stack and then fizzles.
                    if (triggerCapReached(permanent, ability)) continue;
                    if (!ability.matches(event, permanent, state)) continue;
                    firedThisBatch = true;
                    noteTriggerFired(permanent, ability);
                    out.push(
                        buildTriggerItem(state, permanent, ability.id, event)
                    );
                }
            }
        }
    }

    // CR 603.6e — abilities that function while the source is in the
    // graveyard (Nether Shadow's upkeep self-reanimation). Scanned only for
    // abilities explicitly opted in via `zone: "graveyard"`. The trigger's
    // `matches`/`interveningIf` inspects card position via `TriggerStateView`.
    for (const player of ordered) {
        for (const card of player.graveyard) {
            const cardId = (card.card as { id?: string }).id;
            if (!cardId) continue;
            const abilities = tryGetDefinition(cardId)?.triggeredAbilities;
            if (!abilities || abilities.length === 0) continue;
            for (const ability of abilities) {
                if (ability.zone !== "graveyard") continue;
                for (const event of events) {
                    if (!triggerHandlesEventType(ability, event.type)) continue;
                    if (!ability.matches(event, card, state)) continue;
                    out.push(buildTriggerItem(state, card, ability.id, event));
                }
            }
        }
    }

    // CR 114 (issue #1221) — command-zone emblems' triggered abilities. Emblems
    // have no permanent source, so they are scanned here with a synthetic
    // owner-scoped `self`. APNAP grouping is applied later in
    // `placeTriggersOnStack` (which buckets by `controllerId`), so collection
    // order here need not be APNAP-perfect.
    for (const emblem of state.emblems ?? []) {
        const abilities = tryGetEmblemDefinition(
            emblem.emblemId
        )?.triggeredAbilities;
        if (!abilities || abilities.length === 0) continue;
        const self = emblemAsTriggerSelf(emblem);
        for (const ability of abilities) {
            let firedThisBatch = false;
            for (const event of events) {
                if (!triggerHandlesEventType(ability, event.type)) continue;
                if (ability.oncePerEventBatch && firedThisBatch) continue;
                if (!ability.matches(event, self, state)) continue;
                firedThisBatch = true;
                out.push(
                    buildEmblemTriggerItem(
                        state,
                        emblem,
                        ability.id,
                        event,
                        ability.targetRequirement
                    )
                );
            }
        }
    }

    // CR 603.7a / 603.10 (issues #731 / #1470) — instance leave-watch delayed
    // triggers. A `timing: "leaves-battlefield"` delayed trigger fires when its
    // watched instance leaves the battlefield ("when THAT creature leaves the
    // battlefield this turn, …"); `"leaves-battlefield-indefinite"` is the same
    // firing condition with no turn bound (earthbend N — "when it dies or is
    // exiled, return it to the battlefield tapped"), so it matches HERE
    // identically and diverges only at the CLEANUP purge (phases.ts). Either
    // way the departure is ANY zone change off the battlefield —
    // `PERMANENT_LEFT` is emitted for dies AND exile, including a
    // `graveyardDestinationFor` graveyard → exile redirect, exactly once per
    // departure. Match each pending watch against the
    // PERMANENT_LEFT ids in this same event batch, push the matched triggers
    // onto the stack (as delayed-trigger StackItems, resolved through the
    // inline-body path), and remove the fired instances from the pending list
    // so they can't fire twice. recentlyLeft is the set of ids that just left.
    if (state.delayedTriggers?.length && recentlyLeft.size > 0) {
        const remaining: DelayedTriggerInstance[] = [];
        for (const t of state.delayedTriggers) {
            const fires =
                (t.timing === "leaves-battlefield" ||
                    t.timing === "leaves-battlefield-indefinite") &&
                t.watchInstanceId !== undefined &&
                recentlyLeft.has(t.watchInstanceId);
            if (fires) {
                out.push(buildDelayedTriggerStackItem(state, t));
            } else {
                remaining.push(t);
            }
        }
        state.delayedTriggers = remaining.length > 0 ? remaining : undefined;
    }

    // CR 603.7a / 509.1h — instance UNBLOCKED-ATTACK watch delayed triggers.
    // An `timing: "attacks-unblocked"` instance ("This turn, when target
    // creature you control attacks and isn't blocked, …" — Delif's Cone /
    // Cube) fires when its watched instance is among the attackers that went
    // unblocked, i.e. on that instance's ATTACKER_UNBLOCKED event, emitted
    // once per unblocked attacker when blockers are confirmed. Same shape as
    // the leave-watch above — matched against the ids in THIS event batch,
    // dequeued by firing ("when", not "whenever") so it can't fire twice, and
    // purged at CLEANUP if it never fired (the "this turn" bound, CR 514.2).
    const unblockedAttackerIds = new Set<string>();
    for (const ev of events) {
        if (ev.type === "ATTACKER_UNBLOCKED")
            unblockedAttackerIds.add(ev.attackerId);
    }
    if (state.delayedTriggers?.length && unblockedAttackerIds.size > 0) {
        const remaining: DelayedTriggerInstance[] = [];
        for (const t of state.delayedTriggers) {
            const fires =
                t.timing === "attacks-unblocked" &&
                t.watchInstanceId !== undefined &&
                unblockedAttackerIds.has(t.watchInstanceId);
            if (fires) {
                out.push(buildDelayedTriggerStackItem(state, t));
            } else {
                remaining.push(t);
            }
        }
        state.delayedTriggers = remaining.length > 0 ? remaining : undefined;
    }

    // CR 603.7d / 603.10 (issue #884) — repeating combat-event delayed
    // triggers: a `timing: "this-turn-creature-blocks"` instance (Battle Cry)
    // fires once per BLOCKERS_CONFIRMED event in THIS batch, for the rest of
    // the turn — unlike every other delayed-trigger timing, it is NOT removed
    // from `state.delayedTriggers` after firing (it stays queued, purged only
    // at CLEANUP, phases.ts). The firing event is threaded onto the built
    // StackItem as `triggerEvent`, exactly like a normal triggered ability
    // (`buildTriggerItem` above) — the one delayed-trigger case where the
    // firing event is still live at fire time, so the inline body may read
    // `$event.blockerId` directly (validate.ts allows `$event` only for this
    // timing's body).
    if (state.delayedTriggers?.length) {
        const repeaters = state.delayedTriggers.filter(
            (t) => t.timing === "this-turn-creature-blocks"
        );
        if (repeaters.length > 0) {
            for (const event of events) {
                if (event.type !== "BLOCKERS_CONFIRMED") continue;
                for (const t of repeaters) {
                    out.push({
                        ...buildDelayedTriggerStackItem(state, t),
                        triggerEvent: event,
                    });
                }
            }
        }
    }

    // CR 720.2 (Forth Eorlingas!, issue #1199) — repeating combat-damage-to-
    // player delayed triggers: a `timing:
    // "this-turn-creature-deals-combat-damage-to-player"` instance fires AT
    // MOST ONCE per `collectTriggers` batch (the "one or more creatures … one
    // or more players" wording collapses several simultaneous hits from the
    // same damage step into a single firing, per the official ruling), for
    // each delayed-trigger instance whose scheduling controller matches the
    // damage's source controller. Unlike a one-shot delayed trigger it stays
    // queued after firing (purged only at CLEANUP, phases.ts) so a LATER,
    // separate damage step (an extra combat) fires it again.
    if (state.delayedTriggers?.length) {
        const damageRepeaters = state.delayedTriggers.filter(
            (t) =>
                t.timing === "this-turn-creature-deals-combat-damage-to-player"
        );
        for (const t of damageRepeaters) {
            const matchEvent = events.find(
                (e) =>
                    e.type === "DAMAGE_DEALT" &&
                    e.isCombat &&
                    e.target.type === "player" &&
                    e.sourceControllerId === t.controller
            );
            if (matchEvent) {
                out.push({
                    ...buildDelayedTriggerStackItem(state, t),
                    triggerEvent: matchEvent,
                });
            }
        }
    }

    // CR 702.35a — the reflexive "may cast" triggered ability of a card discarded
    // via Madness. The ability lives on the discarded card itself (now in its
    // owner's exile), not a battlefield permanent, so every scan above misses it.
    // It triggers off the CARD_DISCARDED event the madness replacement emitted;
    // the `madnessTriggerPending` tag (set by `markMadnessExiled`) is consumed
    // here so the trigger is built exactly once. A card is only ever discarded
    // from its owner's hand, so the discarding player IS the owner (CR 702.35a —
    // "its owner may cast it").
    for (const event of events) {
        if (event.type !== "CARD_DISCARDED") continue;
        const owner = getPlayer(state, event.playerId);
        const card = owner.exile.find(
            (c) => c.id === event.cardInstanceId && c.madnessTriggerPending
        );
        if (!card) continue;
        delete card.madnessTriggerPending;
        out.push(buildMadnessReflexiveTrigger(state, card, event.playerId));
    }

    // CR 702.29c — "When you cycle this card" and any other trigger on the
    // DISCARDED CARD ITSELF (`functionsFromOwnDiscard`). Same shape as the
    // Madness block above: the source is not on any battlefield, so every scan
    // above misses it, and it is located off the CARD_DISCARDED event rather
    // than by sweeping a fixed pile — "these abilities trigger from whatever
    // zone the card winds up in after it's cycled", which is the graveyard
    // normally and EXILE when a CR 614 graveyard-bound replacement (Dauthi
    // Voidwalker / Yawgmoth's Will) or Madness redirected it.
    //
    // Abilities are read from the PRINTED definition (CR 603.6 — no continuous
    // effect applies to a card outside the battlefield), and the marker is
    // fail-closed, so an unmarked battlefield trigger on the same card
    // (Marauding Mako's "whenever you discard") is never collected here — which
    // together with the single-event design is CR 702.29d: a "cycles or
    // discards" ability fires exactly once on a cycled card.
    for (const event of events) {
        if (event.type !== "CARD_DISCARDED") continue;
        const owner = getPlayer(state, event.playerId);
        const card =
            owner.graveyard.find((c) => c.id === event.cardInstanceId) ??
            owner.exile.find((c) => c.id === event.cardInstanceId);
        if (!card) continue;
        const cardId = (card.card as { id?: string }).id;
        if (!cardId) continue;
        const abilities = tryGetDefinition(cardId)?.triggeredAbilities;
        if (!abilities || abilities.length === 0) continue;
        for (const ability of abilities) {
            if (!ability.functionsFromOwnDiscard) continue;
            if (!triggerHandlesEventType(ability, event.type)) continue;
            if (!ability.matches(event, card, state)) continue;
            out.push(buildTriggerItem(state, card, ability.id, event));
        }
    }

    return out;
}

/** True if a state trigger from `(sourceInstanceId, abilityId)` is currently
 *  on the stack. CR 603.8 — a state-triggered ability does not trigger again
 *  until it has resolved, been countered, or otherwise left the stack. */
function stateTriggerAlreadyOnStack(
    state: GameState,
    sourceInstanceId: string,
    abilityId: string
): boolean {
    return state.stack.some(
        (item) =>
            item.triggerSourceId === sourceInstanceId &&
            item.triggeredAbilityId === abilityId &&
            item.triggerEvent?.type === "STATE_CHECK"
    );
}

/** Scans all battlefield permanents for state-triggered abilities (CR 603.8)
 *  whose persistent condition is currently met. Skips abilities whose trigger
 *  is already on the stack to satisfy the no-retrigger clause of CR 603.8. */
export function collectStateTriggers(state: GameState): StackItem[] {
    const event: StateCheckEvent = { type: "STATE_CHECK" };
    const active = getPlayer(state, state.activePlayerId);
    const opponents = state.players.filter(
        (p) => p.id !== state.activePlayerId
    );
    const ordered = [active, ...opponents];

    const out: StackItem[] = [];
    for (const player of ordered) {
        for (const permanent of player.battlefield) {
            const cardId = (permanent.card as { id?: string }).id;
            if (!cardId) continue;
            const abilities = effectiveTriggeredAbilities(permanent);
            if (abilities.length === 0) continue;
            for (const ability of abilities) {
                if (ability.event !== "STATE_CHECK") continue;
                if (stateTriggerAlreadyOnStack(state, permanent.id, ability.id))
                    continue;
                if (!ability.matches(event, permanent, state)) continue;
                out.push(buildTriggerItem(state, permanent, ability.id, event));
            }
        }
    }
    return out;
}

/** Pushes any newly-triggered state abilities onto the stack (CR 603.8 — they
 *  "go onto the stack at the next available opportunity") and restarts priority
 *  at the active player, per CR 603.3b's last sentence, "Then the appropriate
 *  player gets priority". Called from the stable checkpoint that follows SBA
 *  evaluation (CR 117.5).
 *
 *  Unlike every other trigger-placement path this one does NOT run
 *  `raiseTriggerTargetSelection`, so a state trigger announces neither targets
 *  (CR 603.3d) nor a mode (CR 603.3c). Unreachable today — no shipped
 *  `STATE_CHECK` ability declares `targetRequirement` or `modes` — and
 *  pre-existing; drafted in `docs/findings/2461-state-triggers-skip-announcement.md`. */
export function applyStateTriggers(state: GameState): boolean {
    const triggers = collectStateTriggers(state);
    if (triggers.length === 0) return false;
    state.stack.push(...triggers);
    state.priorityPlayerId = state.activePlayerId;
    state.passCount = 0;
    return true;
}

/** Sentinel `stackItemId` on a `trigger-order` PendingChoice (CR 603.3b, ADR
 *  0058). The ordering decision happens BEFORE anything is on the stack, so —
 *  like `mulligan-bottom`'s `"mulligan"` sentinel — there is no owning stack
 *  item; this constant keys the choice's identity instead. */
export const TRIGGER_BATCH_STACK_ID = "trigger-batch";

/** True when a StackItem is a PLAIN card triggered ability — the only kind ADR
 *  0058 puts to a user ordering decision. Delayed triggers (Battle Cry
 *  repeaters, leave-watch triggers), Madness reflexive triggers and Storm
 *  cast-trigger snapshots are engine-internal firings the engine places in
 *  scheduling order; they are pushed as collected, never prompted (matching
 *  pre-ADR-0058 behavior). */
function isPlainTrigger(item: StackItem): boolean {
    // CR 603.3c — a REFLEXIVE triggered ability rides the inline-body
    // machinery (`delayedTriggerId` / `delayedEffects`) but is NOT an
    // engine-internal firing: it is an ordinary triggered ability its
    // controller may order against the other triggers that became waiting
    // during the same resolution (typically the dies-trigger of the very
    // sacrifice that produced it). Ordered like a plain trigger.
    if (item.reflexiveTrigger) return true;
    return (
        !item.madnessTrigger &&
        !item.delayedTriggerId &&
        !item.delayedEffects &&
        !item.stormSnapshot &&
        !!item.triggeredAbilityId
    );
}

/** CR 603.3d — the ADR-0058 identity key for one plain trigger StackItem. Two
 *  items share a key iff they are the SAME printed triggered ability of the SAME
 *  card AND make no announcement of their own as they go on the stack. Only
 *  then are they outcome-interchangeable — swapping them has one meaningful
 *  result (ADR 0003) — and only then may the engine auto-order them.
 *
 *  Two announcing shapes break that premise and each gets a per-INSTANCE key:
 *  a reflexive trigger (its own inline `targetRequirement`) and, since issue
 *  #2461, a MODAL trigger (its own `modes` list). ADR 0003's original premise —
 *  that a triggered ability picks everything at RESOLUTION — stopped being true
 *  for targets with #1193 and for modes with #2461. */
function triggerOrderKey(item: StackItem): string {
    const cardId = (item.card as { id?: string }).id ?? "";
    // CR 603.3c/603.3d — a reflexive ability DOES announce its own targets as
    // it goes on the stack, so two reflexive instances are NOT
    // outcome-interchangeable the way two copies of a plain trigger are (ADR
    // 0003's premise). Key each by its own instance id so a pair of them is
    // put to a real ordering decision rather than auto-ordered.
    if (item.reflexiveTrigger) return `${cardId}::reflexive::${item.id}`;
    // CR 603.3c (issue #2461) — a MODAL trigger announces its own mode as it is
    // put on the stack, and each copy announces separately: two copies of one
    // Deceiver Exarch ETB can become untap-then-tap or tap-then-untap, distinct
    // outcomes. Key per instance so the controller gets the real CR 603.3b
    // ordering decision instead of a silent auto-order.
    if (
        item.triggeredAbilityId &&
        (findTriggeredAbility(item, item.triggeredAbilityId)?.modes?.length ??
            0) > 0
    ) {
        return `${cardId}::${item.triggeredAbilityId}::modal::${item.id}`;
    }
    return `${cardId}::${item.triggeredAbilityId}`;
}

/** Whether a controller's ≥2-trigger slice requires a user ordering decision
 *  (CR 603.3b). It does NOT when: any member is a non-plain (delayed / Madness /
 *  Storm) trigger — those never prompt — or every member is the SAME printed
 *  ability (identical copies auto-order in collection order, ADR 0003). */
function sliceNeedsOrdering(slice: StackItem[]): boolean {
    if (slice.length < 2) return false;
    if (!slice.every(isPlainTrigger)) return false;
    const key = triggerOrderKey(slice[0]);
    return !slice.every((t) => triggerOrderKey(t) === key);
}

/** CR 603.3b (ADR 0058) — place a freshly-collected batch of triggered-ability
 *  StackItems on the stack, honoring each controller's right to order their own
 *  simultaneous triggers. `triggers` is the collection-order (bottom-first,
 *  APNAP-grouped) output of `collectTriggers`, already filtered of mana-ability
 *  triggers (those never touch the stack, CR 605.4).
 *
 *  Returns `true` (LANDED) when the whole batch was pushed onto the stack right
 *  now — either it was empty of ordering decisions or every ≥2 slice auto-orders
 *  (ADR 0003). The caller then grants priority as it did before ADR 0058.
 *
 *  Returns `false` (SUSPENDED, or empty) when at least one controller must order
 *  ≥2 distinct triggers: the batch is stashed off-stack on
 *  `state.pendingTriggerBatch`, one `trigger-order` PendingChoice is enqueued per
 *  such controller (APNAP — active player first, so their triggers end up on the
 *  bottom and resolve last), priority is handed to the head chooser, and nothing
 *  is on the stack yet. The batch lands in one shot once the last ordering is
 *  submitted (`applyPendingChoiceSubmit`). A `false` caller must NOT grant
 *  priority — the helper already parked it on the chooser. */
export function placeTriggersOnStack(
    state: GameState,
    triggers: StackItem[]
): boolean {
    if (triggers.length === 0) return false;

    // APNAP controller order: active player first, then the others in seat order.
    const apnap = [
        state.activePlayerId,
        ...state.players
            .map((p) => p.id)
            .filter((id) => id !== state.activePlayerId),
    ];

    const choices: PendingChoice[] = [];
    for (const playerId of apnap) {
        const slice = triggers.filter((t) => t.controllerId === playerId);
        // No ordering owed: a single trigger, identical copies (auto-ordered,
        // ADR 0003), or a slice with any engine-internal (delayed / Madness /
        // Storm) trigger — all pushed in collection order.
        if (!sliceNeedsOrdering(slice)) continue;
        choices.push({
            stackItemId: TRIGGER_BATCH_STACK_ID,
            step: 0,
            choiceId: `trigger-order-${playerId}`,
            playerId,
            kind: "trigger-order",
            // This controller's slice in collection (bottom-first) order. The
            // submission is a permutation of these ids, TOPMOST-first (index 0 =
            // top of stack = resolves first).
            candidateIds: slice.map((t) => t.id),
            count: slice.length,
            prompt: "Order your triggered abilities on the stack — rightmost resolves first (CR 603.3b).",
        });
    }

    if (choices.length === 0) {
        // No ordering owed: push in collection order (auto-ordered slices ride
        // along unchanged), exactly as the pre-ADR-0058 engine did.
        state.stack.push(...triggers);
        // CR 603.3d (issue #1193) — a triggered ability chooses its targets as
        // it is put on the stack. Lock them now; if any controller must make a
        // real choice, we suspend on a `kind:"trigger"` PendingTarget (parked on
        // the chooser), reported to callers as the not-yet-placed / suspended
        // signal (return false), same contract as the ordering-suspend path.
        // Despite its name it also runs the CR 603.3c MODE announcement first
        // (issue #2461) — a modal trigger is announced here, nowhere else.
        if (raiseTriggerTargetSelection(state)) return false;
        return true;
    }

    // Suspend on the ordering choice(s). Hold the whole batch off-stack; the
    // final APNAP push runs when the last `trigger-order` choice clears.
    state.pendingTriggerBatch = triggers;
    state.pendingChoices = [...(state.pendingChoices ?? []), ...choices];
    state.priorityPlayerId = state.pendingChoices[0].playerId;
    state.passCount = 0;
    return false;
}
