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

import type { GameEvent, StateCheckEvent } from "../cards/types";
import { tryGetDefinition } from "../cards";
import type {
    CardInstanceState,
    DelayedTriggerInstance,
    GameState,
    PendingChoice,
    StackItem,
} from "./state";
import { getPlayer, allocInstanceId } from "./state";
import { effectiveTriggeredAbilities } from "./copy";

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
    };
}

/** CR 702.35d — builds the synthetic reflexive triggered ability StackItem a
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
                    if (event.type !== ability.event) continue;
                    if (ability.oncePerEventBatch && firedThisBatch) continue;
                    if (!ability.matches(event, permanent, state)) continue;
                    firedThisBatch = true;
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
                    if (event.type !== ability.event) continue;
                    if (!ability.matches(event, card, state)) continue;
                    out.push(buildTriggerItem(state, card, ability.id, event));
                }
            }
        }
    }

    // CR 603.7a / 603.10 (issue #731) — instance leave-watch delayed triggers.
    // A `timing: "leaves-battlefield"` delayed trigger fires when its watched
    // instance leaves the battlefield ("when THAT creature leaves the
    // battlefield this turn, …"). Match each pending watch against the
    // PERMANENT_LEFT ids in this same event batch, push the matched triggers
    // onto the stack (as delayed-trigger StackItems, resolved through the
    // inline-body path), and remove the fired instances from the pending list
    // so they can't fire twice. recentlyLeft is the set of ids that just left.
    if (state.delayedTriggers?.length && recentlyLeft.size > 0) {
        const remaining: DelayedTriggerInstance[] = [];
        for (const t of state.delayedTriggers) {
            const fires =
                t.timing === "leaves-battlefield" &&
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

    // CR 702.35d — the reflexive "may cast" triggered ability of a card discarded
    // via Madness. The ability lives on the discarded card itself (now in its
    // owner's exile), not a battlefield permanent, so every scan above misses it.
    // It triggers off the CARD_DISCARDED event the madness replacement emitted;
    // the `madnessTriggerPending` tag (set by `markMadnessExiled`) is consumed
    // here so the trigger is built exactly once. A card is only ever discarded
    // from its owner's hand, so the discarding player IS the owner (CR 702.35d —
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

/** Pushes any newly-triggered state abilities onto the stack and restarts
 *  priority at the active player (CR 117.3c). Called from the stable
 *  checkpoint that follows SBA evaluation (CR 117.5). */
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
 *  card. A triggered ability in this engine chooses its targets/modes at
 *  RESOLUTION (there is no announcement-time `targetRequirement` on
 *  `TriggeredAbility`), so two identical copies are outcome-interchangeable
 *  regardless of targets — swapping them has one meaningful result (ADR 0003). */
function triggerOrderKey(item: StackItem): string {
    const cardId = (item.card as { id?: string }).id ?? "";
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
