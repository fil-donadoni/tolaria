// Interchangeable-candidate collapse (issue #3593).
//
// Two copies of the same card in the same state produce two candidate moves
// that differ only by `cardInstanceId`, and nothing downstream can tell them
// apart because there is nothing to tell apart. A hand with two Brushlands
// offers two `play-land` candidates; three Treetop Villages offer three
// identical animations. The cost is paid three times over:
//
//  1. the search opens a branch per copy, so three Treetops spend the
//     iteration budget on three subtrees exploring the same position;
//  2. the verdict quiz asks the tester which of three identical activations
//     is right, and there is no right one;
//  3. the Verdict corpus then stores a judgement naming ONE copy, and
//     `evalPairsOf` emits "this copy beats that copy" — a constraint no
//     evaluation could or should satisfy. Measured in issue #3588: 12 of the
//     47 blind pairs were exactly this shape
//     (`docs/research/verdict-corpus-coverage.md`, finding 4).
//
// This sits beside the dominance prune (`ai/dominance.ts`, issue #1887), which
// removes moves dominated by doing NOTHING. This one removes moves dominated
// by EACH OTHER. Same seam, same shape, different relation — and, like
// dominance, it is a BOT-path filter and never a legality one: `legalActions`
// (the human affordance surface) and scripted setup realisation keep seeing
// the complete legal set, because a collapsed-away copy is still perfectly
// legal to play, just never worth searching twice.
//
// WHY THE DESCRIPTOR IS TOTAL. Interchangeability is a claim about what NO
// rule can read, so the descriptor is the WHOLE `CardInstanceState` — every
// field distinguishes, with exactly two named exceptions below. An allowlist
// of "the fields that matter" is the shape of this that fails OPEN: the day
// someone adds a field to `CardInstanceState` that a rule reads, an allowlist
// silently collapses two candidates that differ and the bot loses an option,
// with no test going red. A total descriptor's failure mode is the harmless
// one — two copies that are in fact interchangeable stay separate, and the
// search is merely as wide as it is today.

import type { ManaTap, Move } from "../moves";

/** A set-valued reference group: the key renders its members SORTED rather
 *  than positionally, so two plans that are permutations of each other are one
 *  option. `tap` is the mana payment plan, whose order is the planner's, not a
 *  decision — the same sources are tapped and the same cost is paid either way.
 *
 *  It is the one deliberate weakening here, and it was measured rather than
 *  assumed: over 1138 decision nodes of the blade corpus it collapsed 210
 *  candidates in 101 groups with ZERO cases where the two moves reached
 *  different boards (PR #3599 review). Note that `ManaTap`'s own doc treats the
 *  order of a `mana-cost` leg as meaningful; what protects that here is
 *  `moveShape`, which still compares each entry's `manaChoiceIndex`,
 *  `abilityId` and `tapOtherIds` SHAPE positionally, so only the card
 *  references inside a plan are order-free. */
type RefGroup = "tap";
import type { CardInstanceState, GameState } from "../state";
import { assertNever } from "../assertNever";

/** The two fields the descriptor does NOT compare verbatim.
 *
 *  - `id` IS the identity the collapse exists to erase.
 *  - `enteredOnTurn` is rule-readable (`PermanentFilter.enteredThisTurn` reads
 *    `enteredOnTurn === state.turn`, CR 302.6 / 400.7) but only through that
 *    comparison, so it is PROJECTED to the boolean the rule asks for rather
 *    than dropped: two Treetop Villages that entered on turns 3 and 5 of a
 *    turn-9 board are interchangeable, and two where one entered this turn
 *    are not. */
const DESCRIPTOR_PROJECTED_KEYS = new Set(["id", "enteredOnTurn"]);

/** JSON with object keys in sorted order, so two structurally equal values
 *  stringify identically no matter what order their fields were written in.
 *  `JSON.stringify` alone preserves insertion order, which would make the
 *  comparison depend on which code path built each card. */
function stableStringify(value: unknown): string {
    if (value === null || typeof value !== "object") {
        return JSON.stringify(value) ?? "null";
    }
    if (Array.isArray(value))
        return `[${value.map(stableStringify).join(",")}]`;
    const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries
        .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`)
        .join(",")}}`;
}

/** Everything about `card` that a rule could read, with its identity erased.
 *  Two cards with equal descriptors are interchangeable BY CONSTRUCTION:
 *  definition, zone, controller, owner, tapped state, damage marked, counters,
 *  attachments, summoning sickness and every other field are all in here. */
export function cardInterchangeabilityDescriptor(
    state: GameState,
    card: CardInstanceState
): string {
    const projected: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(card)) {
        if (DESCRIPTOR_PROJECTED_KEYS.has(key)) continue;
        projected[key] = value;
    }
    projected.enteredThisTurn = card.enteredOnTurn === state.turn;
    return stableStringify(projected);
}

/** Every slot of `move` that holds a CARD INSTANCE id, rewritten by `fn` in a
 *  fixed order. Typed and exhaustive on `Move["kind"]` rather than a walk over
 *  the object: instance ids are bare counter strings (`allocInstanceId`), so a
 *  structural "does this string resolve to a card" walk would sooner or later
 *  mistake an ability id, a stack item id or a player id for a card and
 *  collapse two moves that differ — the one failure direction this must not
 *  have. A new Move kind reds `tsc` here instead of failing open. */
export function mapMoveCardRefs(
    move: Move,
    fn: (id: string, index: number, group?: RefGroup) => string
): Move {
    let next = 0;
    const one = (id: string, group?: RefGroup): string => fn(id, next++, group);
    const many = (ids: string[], group?: RefGroup): string[] =>
        ids.map((id) => one(id, group));
    const taps = (plan: ManaTap[]): ManaTap[] =>
        plan.map((tap) => ({
            ...tap,
            cardInstanceId: one(tap.cardInstanceId, "tap"),
            ...(tap.tapOtherIds
                ? { tapOtherIds: many(tap.tapOtherIds, "tap") }
                : {}),
        }));
    // `TargetSelection.id` is a three-way union discriminated by `type`
    // (`cards/types.ts`): a card instance for a permanent / graveyard card /
    // hand card, a PLAYER id for "player", a stack item id for "spell". Only
    // the first is a card.
    const targets = <T extends { type: string; id: string }>(list: T[]): T[] =>
        list.map((t) =>
            t.type === "permanent" ||
            t.type === "graveyard-card" ||
            t.type === "hand-card"
                ? { ...t, id: one(t.id) }
                : t
        );

    switch (move.kind) {
        case "pass":
        case "mulligan":
        case "land-entry":
        case "draw-replacement":
        case "madness-decline":
        case "rebound-decline":
        case "name-card":
        case "summon-companion":
        case "random-reveal-ack":
            return move;
        // `grantedAbilityInstanceId` is a grant id off
        // `PlayerState.grantedAbilities` and `sourceCardId` a DEFINITION id —
        // neither is a card instance, so a granted activation carries none.
        case "activate-granted-ability":
            return move;
        case "number-choice":
            return move.tapPlan
                ? { ...move, tapPlan: taps(move.tapPlan) }
                : move;
        case "mulligan-bottom":
            return { ...move, cardInstanceIds: many(move.cardInstanceIds) };
        case "resolution-choice":
            return {
                ...move,
                cardInstanceIds: many(move.cardInstanceIds),
                ...(move.secondZoneIds
                    ? { secondZoneIds: many(move.secondZoneIds) }
                    : {}),
            };
        case "may-pay":
            return {
                ...move,
                ...(move.sacrificeIds
                    ? { sacrificeIds: many(move.sacrificeIds) }
                    : {}),
                ...(move.discardIds
                    ? { discardIds: many(move.discardIds) }
                    : {}),
            };
        case "play-land":
        case "turn-face-up":
            return { ...move, cardInstanceId: one(move.cardInstanceId) };
        case "cast-spell": {
            const picks = move.castCostPicks;
            return {
                ...move,
                cardInstanceId: one(move.cardInstanceId),
                targets: targets(move.targets),
                tapPlan: taps(move.tapPlan),
                ...(picks
                    ? {
                          castCostPicks: {
                              ...picks,
                              ...(picks.sacrificeIds
                                  ? { sacrificeIds: many(picks.sacrificeIds) }
                                  : {}),
                              ...(picks.additionalCostCardId
                                  ? {
                                        additionalCostCardId: one(
                                            picks.additionalCostCardId
                                        ),
                                    }
                                  : {}),
                              ...(picks.exileCostCardIds
                                  ? {
                                        exileCostCardIds: many(
                                            picks.exileCostCardIds
                                        ),
                                    }
                                  : {}),
                          },
                      }
                    : {}),
            };
        }
        case "activate-ability": {
            const picks = move.costPicks;
            return {
                ...move,
                cardInstanceId: one(move.cardInstanceId),
                targets: targets(move.targets),
                tapPlan: taps(move.tapPlan),
                ...(picks
                    ? {
                          costPicks: {
                              ...picks,
                              ...(picks.discardIds
                                  ? { discardIds: many(picks.discardIds) }
                                  : {}),
                              ...(picks.exileFromGraveyard
                                  ? {
                                        exileFromGraveyard: {
                                            ...picks.exileFromGraveyard,
                                            cardInstanceIds: many(
                                                picks.exileFromGraveyard
                                                    .cardInstanceIds
                                            ),
                                        },
                                    }
                                  : {}),
                              ...(picks.tapOtherIds
                                  ? { tapOtherIds: many(picks.tapOtherIds) }
                                  : {}),
                              ...(picks.sacrificeIds
                                  ? { sacrificeIds: many(picks.sacrificeIds) }
                                  : {}),
                          },
                      }
                    : {}),
            };
        }
        case "submit-target":
            return { ...move, targets: targets(move.targets) };
        case "declare-attackers":
            return {
                ...move,
                attackerIds: many(move.attackerIds),
                ...(move.exertIds ? { exertIds: many(move.exertIds) } : {}),
                // `attackTargets` maps an attacker id to the planeswalker /
                // battle / player it attacks. The KEY is a card; the value's
                // half of the union is not always one, so only the key is
                // rewritten.
                ...(move.attackTargets
                    ? {
                          attackTargets: Object.fromEntries(
                              Object.entries(move.attackTargets).map(
                                  ([attacker, target]) => [
                                      one(attacker),
                                      target,
                                  ]
                              )
                          ),
                      }
                    : {}),
            };
        case "declare-blockers":
            return {
                ...move,
                assignments: move.assignments.map((a) => ({
                    ...a,
                    blockerId: one(a.blockerId),
                    attackerId: one(a.attackerId),
                })),
            };
        default:
            return assertNever(move, "Move kind in mapMoveCardRefs");
    }
}

/** The card instance ids `move` names, in `mapMoveCardRefs`' fixed order. */
export function moveCardRefs(move: Move): string[] {
    return moveCardRefSlots(move).map((slot) => slot.id);
}

/** The same references, each carrying the group it belongs to. */
function moveCardRefSlots(move: Move): { id: string; group?: RefGroup }[] {
    const slots: { id: string; group?: RefGroup }[] = [];
    mapMoveCardRefs(move, (id, _index, group) => {
        slots.push(group ? { id, group } : { id });
        return id;
    });
    return slots;
}

/** The move with every card reference replaced by its POSITION — what is left
 *  is the part of the move that must match verbatim (kind, ability id, stack
 *  item, player, mode, amounts). */
function moveShape(move: Move): string {
    return stableStringify(mapMoveCardRefs(move, (_id, i) => `#${i}`));
}

/** How many times each card instance id occurs ANYWHERE in `state`, counting
 *  the card's own `id` field. Cached per state object: one walk, reused by
 *  every move of that enumeration.
 *
 *  This is the other half of "the descriptor is total", and it is the half a
 *  per-card comparison cannot see. A card's own fields do not record what
 *  points AT it: an Aura's `attachedTo` lives on the Aura, and P/T is computed
 *  at read time through the layer pipeline (`layers.ts`) rather than stored, so
 *  two Shivan Dragons — one enchanted with Holy Strength, one not — carry
 *  byte-identical instance state. Anything else in the state naming a card is
 *  therefore a reason it might be distinguishable, and a count above one makes
 *  it interchangeable with nothing.
 *
 *  Over-approximate on purpose: a string that merely LOOKS like an instance id
 *  (a mode id, an ability id) counts as a reference, which costs a collapse
 *  that was available and never makes an unavailable one legal.
 *
 *  DELIBERATELY NOT MEMOISED on the state object. `GameState` is mutated IN
 *  PLACE — `applyMoveInSearch` does it, and `runHeadlessGame` plays a whole
 *  game on ONE object — so an identity-keyed cache would answer every later
 *  decision with the OPENING position's references: a reference written after
 *  the first walk (a draw filling `drawnThisTurn`, an Aura attaching, a
 *  creature entering combat) would be invisible and the collapse would merge
 *  candidates this check exists to keep apart. Measured over 150 blade
 *  scenarios × 3 seeds × 30 plies, a cached count diverged from a fresh one at
 *  24 of 1813 nodes, every one of them over-collapsing (PR #3599 review
 *  finding 1). One walk per collapse call, and a call is once per decision. */
function cardReferenceCounts(state: GameState): Map<string, number> {
    const counts = new Map<string, number>();
    for (const player of state.players) {
        for (const zone of [
            player.battlefield,
            player.hand,
            player.graveyard,
            player.exile,
            player.library,
        ]) {
            for (const card of zone) counts.set(card.id, 0);
        }
    }
    const seen = new Set<unknown>();
    const walk = (value: unknown): void => {
        if (typeof value === "string") {
            const count = counts.get(value);
            if (count !== undefined) counts.set(value, count + 1);
            return;
        }
        if (value === null || typeof value !== "object") return;
        // A GameState is a tree in practice, but a cycle here would hang the
        // enumerator, so the walk is guarded.
        if (seen.has(value)) return;
        seen.add(value);
        if (Array.isArray(value)) {
            for (const entry of value) walk(entry);
            return;
        }
        // KEYS as well as values: a card id can name a `Record` entry and
        // appear nowhere in value position — `state.lastKnownCopiable`,
        // `combat.blockerAssignments`, `combat.damageAssignments` are all keyed
        // by card id (PR #3599 review finding 3).
        for (const [key, entry] of Object.entries(
            value as Record<string, unknown>
        )) {
            walk(key);
            walk(entry);
        }
    };
    walk(state);
    return counts;
}

function findCardAnywhere(
    state: GameState,
    id: string
): CardInstanceState | undefined {
    for (const player of state.players) {
        for (const zone of [
            player.battlefield,
            player.hand,
            player.graveyard,
            player.exile,
            player.library,
        ]) {
            const card = zone.find((c) => c.id === id);
            if (card) return card;
        }
    }
    return undefined;
}

/** Instance ids are counter strings (`allocInstanceId`), so "lowest" is
 *  numeric where both sides are numeric and lexicographic otherwise — either
 *  way a total order, which is all determinism needs. */
function compareIds(a: string, b: string): number {
    const na = Number(a);
    const nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
    return a < b ? -1 : a > b ? 1 : 0;
}

function compareRefVectors(a: string[], b: string[]): number {
    for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
        const c = compareIds(a[i], b[i]);
        if (c !== 0) return c;
    }
    return a.length - b.length;
}

/**
 * A keyer over one state: two moves share a key exactly when they are
 * interchangeable. The key is the move's shape plus one LABEL per card
 * reference — the referenced card's descriptor and an ordinal distinguishing
 * distinct cards that share it, assigned in reference order, which is what
 * preserves aliasing (a move naming one card twice never keys the same as one
 * naming two distinct cards, even when those two are themselves
 * interchangeable).
 *
 * Returned as a factory because the descriptor cache is what makes it cheap:
 * one stable stringify per referenced card, not per reference.
 */
export function makeInterchangeableKeyer(
    state: GameState
): (move: Move) => string {
    const counts = cardReferenceCounts(state);
    const descriptors = new Map<string, string>();
    const descriptorOf = (id: string): string => {
        const cached = descriptors.get(id);
        if (cached !== undefined) return cached;
        const card = findCardAnywhere(state, id);
        // Two fail-closed answers, both of them "this id equals only itself":
        // a reference the state does not hold at all, and one something else
        // in the state also names. A card nothing points at occurs exactly
        // once — its own `id` field.
        const referencedElsewhere = (counts.get(id) ?? 0) > 1;
        const descriptor =
            card && !referencedElsewhere
                ? cardInterchangeabilityDescriptor(state, card)
                : `distinct:${id}`;
        descriptors.set(id, descriptor);
        return descriptor;
    };
    return (move: Move): string => {
        const slots = moveCardRefSlots(move);
        const ordinals = new Map<string, number>();
        const labels = new Map<string, string>();
        const label = (id: string): string => {
            const existing = labels.get(id);
            if (existing !== undefined) return existing;
            const descriptor = descriptorOf(id);
            const ordinal = ordinals.get(descriptor) ?? 0;
            ordinals.set(descriptor, ordinal + 1);
            const minted = `${descriptor}@${ordinal}`;
            labels.set(id, minted);
            return minted;
        };
        // ORDERED slots first, in reference order: they are what the move
        // positionally IS, so they anchor the ordinals. The `tap` group is a
        // SET of mana sources — the planner's order within it is an artifact,
        // and two plans that are permutations of each other pay the same cost
        // off the same permanents. Labelling it after the anchors and
        // rendering it SORTED is what makes "animate this Village, tapping it
        // and that one" and "animate that Village, tapping it and this one"
        // the single option they are.
        for (const slot of slots) if (!slot.group) label(slot.id);
        const grouped = slots.filter((slot) => slot.group);
        for (const id of [...new Set(grouped.map((slot) => slot.id))].sort(
            compareIds
        )) {
            label(id);
        }
        const ordered = slots
            .filter((slot) => !slot.group)
            .map((slot) => labels.get(slot.id));
        const tapped = grouped.map((slot) => labels.get(slot.id)).sort();
        return `${moveShape(move)} ${ordered.join(" ")} | ${tapped.join(" ")}`;
    };
}

/**
 * `moves` with interchangeable candidates collapsed to one representative
 * each, in enumeration order (the representative takes the position of the
 * first member of its group).
 *
 * Two moves are interchangeable when their shapes match and their card
 * references are pairwise interchangeable UNDER THE SAME ALIASING: a move
 * naming one card twice never collapses onto one naming two distinct cards,
 * even when those two are themselves interchangeable.
 *
 * The representative is the group member with the smallest reference vector by
 * instance id, so a rebuild of the same position picks the same one twice —
 * which is what lets a stored Verdict key naming a collapsed-away copy still
 * resolve (`verdicts/evalPairs.ts`).
 */
export function collapseInterchangeableMoves(
    state: GameState,
    moves: readonly Move[],
    onCollapsed?: (move: Move, representative: Move) => void
): Move[] {
    if (moves.length < 2) return [...moves];

    // Pass 1 — bucket by shape. Two moves with different shapes can never
    // collapse, and a shape with one member needs no descriptor at all: this
    // is what keeps the common case (a hand of singletons) off the expensive
    // path entirely.
    const shapes = moves.map(moveShape);
    const byShape = new Map<string, number[]>();
    shapes.forEach((shape, i) => {
        const bucket = byShape.get(shape);
        if (bucket) bucket.push(i);
        else byShape.set(shape, [i]);
    });

    const keyOf = makeInterchangeableKeyer(state);
    const representativeOf = new Map<number, number>();
    for (const bucket of byShape.values()) {
        if (bucket.length < 2) continue;
        const byGroup = new Map<string, number[]>();
        for (const index of bucket) {
            const key = keyOf(moves[index]);
            const group = byGroup.get(key);
            if (group) group.push(index);
            else byGroup.set(key, [index]);
        }
        for (const group of byGroup.values()) {
            if (group.length < 2) continue;
            const refsOf = new Map(
                group.map((i) => [i, moveCardRefs(moves[i])] as const)
            );
            const winner = group.reduce((a, b) =>
                compareRefVectors(refsOf.get(b) ?? [], refsOf.get(a) ?? []) < 0
                    ? b
                    : a
            );
            for (const index of group) representativeOf.set(index, winner);
        }
    }
    if (representativeOf.size === 0) return [...moves];

    const emitted = new Set<number>();
    const out: Move[] = [];
    for (let i = 0; i < moves.length; i += 1) {
        const winner = representativeOf.get(i);
        if (winner === undefined) {
            out.push(moves[i]);
            continue;
        }
        if (!emitted.has(winner)) {
            emitted.add(winner);
            out.push(moves[winner]);
        }
        // Every group member except the representative itself is a dropped
        // candidate, whichever position the representative was emitted at.
        if (i !== winner) onCollapsed?.(moves[i], moves[winner]);
    }
    return out;
}
