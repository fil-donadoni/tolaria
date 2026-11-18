// Linked-exile REACH — the cards exiled with a permanent whose own ability
// can put them onto the battlefield (issue #9961).
//
// CR 607.2a links "the cards exiled with this permanent" to the ability that
// exiled them, and a second ability of the same permanent may act on that
// pile: "put a creature card exiled with this creature onto the battlefield
// under your control". Until this module the leaf evaluator read nothing of
// that pile — a card in exile counted only when castable from exile — so the
// Bot priced "the opponent's best creature exiled with my permanent" and "my
// own spent sorcery exiled with it" the same, and the first half of a
// two-step reanimation line (exile now, retrieve later) was a tie broken by
// noise.
//
// A linked card is reach for the player who controls the linking permanent
// when that permanent carries an ability — activated or triggered, real
// `effects` or the `aiEffects` shadow — holding a `moveZone` from the linked
// pile (`target: { exiledWithSource: true }`) to the BATTLEFIELD that lands
// the card under that player's control: "under your control"
// (`controller: "controller"`), or the card is the player's own. The card
// must match the Op's own `filter` ("a CREATURE card exiled with …"),
// fail-closed through `handCardMatchesFilter`. A pile retrieved to a HAND is
// left out (a different payoff, and the hideaway / Sculler shapes already
// price it through their cast permissions or not at all).
//
// Such a card is latent material, priced in the leaf's `hand` term beside the
// exiled cards a player may still play (`playableExileCards`, issue #4217):
// the permanent on the battlefield is the permission, and only the
// activation's mana stands between the card and play. Measured on the issue's
// position, the graveyard-reach pricing (`graveyardReachFraction` of the
// latent worth) was too thin to matter: the reanimation target led the other
// graveyard cards by ~0.03 reward at the trigger's target node, inside the
// `TRIGGER_ANSWER_BEAM`, so the tree kept every answer and the line that
// holds the activation read as their average. The card is valued as LATENT
// material, not as the body the retrieval produces once the search plays it,
// so cashing the retrieval still scores above holding it (the body, its
// enters-the-battlefield ability, its attack).
//
// THE RETRIEVAL MUST STILL BE ABLE TO FIRE. A credit that outlives its
// trigger is worse than none: it pays the line that kills the retrieval (the
// Adapt spent before anything was exiled, CR 701.46a, after which no counter
// is ever placed again) the same credit as the line that cashes it, and the
// cashing line then loses the reanimated body at the end step. So a retrieval
// in a triggered ability on COUNTER_ADDED (CR 122.6) counts only while one of
// the permanent's own activated abilities can still put a counter on it: a
// `counters add` on `$source` whose enclosing `if` guards hold on the
// permanent's CURRENT counters (the Adapt guard, "if this permanent has no
// +1/+1 counters on it"). A guard this module cannot read is assumed to hold.
// Any other trigger event, and an activated retrieval, is live by default.
//
// No card names, no per-card registry (ADR 0102): the walk reads the Op.

import type {
    ActivatedAbility,
    CardDefinition,
    EffectCardFilter,
    EffectComparisonOp,
    EffectOp,
    EffectPredicate,
    TriggeredAbility,
} from "../../cards/types";
import { FACE_DOWN_CARD_ID, tryGetDefinition } from "../../cards";
import type { CardInstanceState, GameState, PlayerState } from "../state";
import { getCardsExiledWith } from "../exileLinks";
import { handCardMatchesFilter } from "../alternativeCost";
import { childOpArrays } from "./effectOpChildren";
import { findTriggeredAbility } from "../copy";

/** One retrieval Op's reading: its card filter (`undefined` = any card) and
 *  whether the retrieved card comes under the RETRIEVING ability's
 *  controller rather than its owner. */
type Retrieval = {
    filter: EffectCardFilter | undefined;
    underController: boolean;
};

function collectRetrievals(
    effects: readonly EffectOp[] | undefined,
    out: Retrieval[]
): void {
    if (!effects) return;
    for (const op of effects) {
        if (op.op === "moveZone") {
            const shape = op as {
                to?: string;
                target?: unknown;
                filter?: EffectCardFilter;
                controller?: string;
            };
            if (
                shape.to === "battlefield" &&
                typeof shape.target === "object" &&
                shape.target !== null &&
                "exiledWithSource" in shape.target
            ) {
                out.push({
                    filter: shape.filter,
                    underController: shape.controller === "controller",
                });
            }
        }
        for (const child of childOpArrays(op)) collectRetrievals(child, out);
    }
}

/** A retrieval reading plus whether it waits on a counter being placed on
 *  its own permanent (a COUNTER_ADDED trigger) — the one trigger whose
 *  liveness this module reads. */
type SourcedRetrieval = Retrieval & { onCounterAdded: boolean };

function firesOnCounterAdded(ability: TriggeredAbility): boolean {
    const events = Array.isArray(ability.event)
        ? ability.event
        : [ability.event];
    return events.includes("COUNTER_ADDED");
}

function definitionRetrievals(def: CardDefinition): SourcedRetrieval[] {
    const out: SourcedRetrieval[] = [];
    const push = (
        effects: readonly EffectOp[] | undefined,
        onCounterAdded: boolean
    ): void => {
        const found: Retrieval[] = [];
        collectRetrievals(effects, found);
        for (const r of found) out.push({ ...r, onCounterAdded });
    };
    for (const a of def.activatedAbilities ?? []) {
        push(a.effects, false);
        push(a.aiEffects, false);
    }
    for (const a of def.triggeredAbilities ?? []) {
        const onCounter = firesOnCounterAdded(a);
        push(a.effects, onCounter);
        push(a.aiEffects, onCounter);
    }
    return out;
}

function compare(left: number, op: EffectComparisonOp, right: number): boolean {
    switch (op) {
        case "eq":
            return left === right;
        case "ne":
            return left !== right;
        case "lt":
            return left < right;
        case "le":
            return left <= right;
        case "gt":
            return left > right;
        case "ge":
            return left >= right;
    }
}

/** A guard read on the permanent's own current counters: `true` / `false`
 *  for the `counters of $source <op> <literal>` comparison, `undefined` for
 *  any other predicate (the caller assumes it holds). */
function selfCounterGuard(
    predicate: EffectPredicate,
    perm: CardInstanceState
): boolean | undefined {
    if (!("left" in predicate && "op" in predicate && "right" in predicate)) {
        return undefined;
    }
    const left = predicate.left as unknown;
    const right = predicate.right as unknown;
    if (
        typeof right !== "number" ||
        typeof left !== "object" ||
        left === null
    ) {
        return undefined;
    }
    const counters = (left as { counters?: { of?: unknown; type?: unknown } })
        .counters;
    const of = counters?.of as { ref?: unknown } | undefined;
    if (of?.ref !== "$source" || typeof counters?.type !== "string") {
        return undefined;
    }
    const held = perm.counters?.[counters.type] ?? 0;
    return compare(held, predicate.op as EffectComparisonOp, right);
}

/** Does `effects` reach a `counters add` on its own `$source`, through the
 *  `if` branches the permanent's current counters still take? */
function scriptPlacesSelfCounter(
    effects: readonly EffectOp[] | undefined,
    perm: CardInstanceState
): boolean {
    if (!effects) return false;
    for (const op of effects) {
        if (op.op === "counters") {
            const shape = op as { action?: string; target?: unknown };
            const target = shape.target as { ref?: unknown } | undefined;
            if (shape.action === "add" && target?.ref === "$source")
                return true;
        }
        if (op.op === "if") {
            const branch = op as {
                predicate: EffectPredicate;
                then: readonly EffectOp[];
                else?: readonly EffectOp[];
            };
            const holds = selfCounterGuard(branch.predicate, perm);
            if (holds !== false && scriptPlacesSelfCounter(branch.then, perm)) {
                return true;
            }
            if (holds !== true && scriptPlacesSelfCounter(branch.else, perm)) {
                return true;
            }
            continue;
        }
        for (const child of childOpArrays(op)) {
            if (scriptPlacesSelfCounter(child, perm)) return true;
        }
    }
    return false;
}

/** CR 122.6 — can one of `perm`'s own activated abilities still put a counter
 *  on it? */
function canPlaceOwnCounter(perm: CardInstanceState): boolean {
    const id = (perm.card as { id?: string }).id;
    const def = id ? tryGetDefinition(id) : undefined;
    if (!def) return false;
    return (def.activatedAbilities ?? []).some(
        (a) =>
            scriptPlacesSelfCounter(a.effects, perm) ||
            scriptPlacesSelfCounter(a.aiEffects, perm)
    );
}

/** Memo keyed by REGISTRY id: the answer is a property of the frozen
 *  definition alone, and the term runs per ISMCTS leaf. */
const RETRIEVALS_BY_ID = new Map<string, readonly SourcedRetrieval[]>();

function retrievalsOf(card: CardInstanceState): readonly SourcedRetrieval[] {
    const id = (card.card as { id?: string }).id;
    if (!id) return [];
    const hit = RETRIEVALS_BY_ID.get(id);
    if (hit) return hit;
    const def = tryGetDefinition(id);
    const answer = def ? definitionRetrievals(def) : [];
    RETRIEVALS_BY_ID.set(id, answer);
    return answer;
}

/** Every card exiled with a permanent `player` controls that one of that
 *  permanent's own abilities can put onto the battlefield under `player`'s
 *  control. Each card at most once, whatever the number of retrievals that
 *  reach it. Empty — exactly — on a board with no such permanent. */
export function retrievableLinkedExile(
    state: GameState,
    player: PlayerState
): CardInstanceState[] {
    const out: CardInstanceState[] = [];
    for (const seat of state.players) {
        for (const perm of seat.battlefield) {
            if (perm.controllerId !== player.id) continue;
            const all = retrievalsOf(perm);
            if (all.length === 0) continue;
            const linked = getCardsExiledWith(state, perm.id);
            if (linked.length === 0) continue;
            // Asked once per permanent, and only with a pile to price.
            let counterLive: boolean | undefined;
            const retrievals = all.filter((r) => {
                if (!r.onCounterAdded) return true;
                counterLive ??= canPlaceOwnCounter(perm);
                return counterLive;
            });
            for (const { card, ownerId } of linked) {
                // CR 406.3 — a face-down sentinel on the client Bot's wire
                // view is not a card whose worth this view can read.
                if ((card.card as { id?: string }).id === FACE_DOWN_CARD_ID) {
                    continue;
                }
                const reached = retrievals.some(
                    (r) =>
                        (r.underController || ownerId === player.id) &&
                        (r.filter === undefined ||
                            handCardMatchesFilter(card, r.filter, "graveyard"))
                );
                if (reached) out.push(card);
            }
        }
    }
    return out;
}

/** Does `effects` exile a card linked to its own source ("exile … with this
 *  permanent", `moveZone … linkToSource`, CR 607.2a)? */
function scriptLinksExile(effects: readonly EffectOp[] | undefined): boolean {
    if (!effects) return false;
    for (const op of effects) {
        if (
            op.op === "moveZone" &&
            (op as { linkToSource?: boolean }).linkToSource === true
        ) {
            return true;
        }
        for (const child of childOpArrays(op)) {
            if (scriptLinksExile(child)) return true;
        }
    }
    return false;
}

/**
 * CR 607.2a / 405.5 — would activating `ability` of `perm` now cash the
 * permanent's linked-exile retrieval BEFORE a stack item `pid` controls, from
 * the same permanent, adds to the pile it retrieves from?
 *
 * The stack resolves top-down, so the activation resolves first: its
 * retrieval (or the counter that fires a COUNTER_ADDED retrieval) finds the
 * pile as it stands, and the card the waiting item exiles arrives after the
 * payoff has fired. An Adapt in response to the same permanent's own
 * "exile target card" trigger spends Adapt on an empty pile, and the Adapt
 * guard (CR 701.46a) then keeps the retrieval from ever firing again. Passing
 * lets the item resolve and leaves the activation for the next window.
 *
 * Read off the definitions alone, no probe: the activation reaches the
 * retrieval directly, or places a counter on its own permanent through a
 * live guard while a retrieval waits on COUNTER_ADDED; the waiting item is a
 * triggered ability of the same permanent whose script links an exile to
 * it. Anything else answers `false`.
 */
export function retrievalPrecedesOwnLink(
    state: GameState,
    pid: string,
    perm: CardInstanceState,
    ability: ActivatedAbility
): boolean {
    const retrievals = retrievalsOf(perm);
    if (retrievals.length === 0) return false;
    const direct: Retrieval[] = [];
    collectRetrievals(ability.effects, direct);
    collectRetrievals(ability.aiEffects, direct);
    const fires =
        direct.length > 0 ||
        (retrievals.some((r) => r.onCounterAdded) &&
            (scriptPlacesSelfCounter(ability.effects, perm) ||
                scriptPlacesSelfCounter(ability.aiEffects, perm)));
    if (!fires) return false;
    return state.stack.some((item) => {
        if (
            item.controllerId !== pid ||
            item.triggerSourceId !== perm.id ||
            !item.triggeredAbilityId
        ) {
            return false;
        }
        const trigger = findTriggeredAbility(perm, item.triggeredAbilityId);
        return (
            !!trigger &&
            (scriptLinksExile(trigger.effects) ||
                scriptLinksExile(trigger.aiEffects))
        );
    });
}
