/**
 * Cast-MODE characteristics — the one census both search executors stamp from
 * (issue #2796).
 *
 * CR 601.2b: as a spell is announced its caster chooses, among other things,
 * whether an alternative cost is being paid. Four of this engine's alternative
 * costs do not merely change what the caster PAYS — they change what the spell
 * IS, or what happens to the permanent it becomes:
 *
 *   * Bestow (CR 702.103b) — the spell is an AURA spell with enchant creature,
 *     not a creature spell;
 *   * Morph (CR 702.37c) — the spell is a 2/2 face-down creature with no text,
 *     name, subtypes or mana cost, not the printed card;
 *   * Dash (CR 702.109a) — the permanent gains haste and is returned to hand at
 *     the beginning of the next end step (the `dashed` marker its trigger
 *     reads);
 *   * Warp (CR 702.185a) — the permanent is exiled at the beginning of the next
 *     end step and the card becomes castable from exile from the following turn
 *     (the `warped` marker `scheduleWarpExile` and `applyWarpExile` read);
 *   * Evoke (CR 702.74a) — the permanent is sacrificed when it enters (the
 *     `evoked` marker `evokeTrigger`'s `conditionOnSelf` reads).
 *
 * Every one of those is invisible unless the cast's stack item is STAMPED at
 * the site that builds it, and this engine builds one at four sites: the three
 * real commit paths in `game.ts` (which read the answers off `PendingCast`, a
 * different shape — they are not this module's callers) and the TWO search
 * executors, the greedy 1-ply sandbox (`applyMoveForSearch`, `applyMove.ts`)
 * and the ISMCTS in-tree executor (`applyMoveInSearch`, `search.ts`), which
 * both read the answer off `Move.alternativeCostId` and are this module's
 * callers.
 *
 * They had drifted, silently and in the way issue #2473 predicted when it named
 * them "the second wholesale reimplementation of build-a-StackItem-from-a-cast":
 * the sandbox stamped bestow and dash, the tree stamped morph alone, and neither
 * stamped evoke — inert so far only because `enumerateMoves` does not offer an
 * evoke cast yet, which is exactly the kind of gap a census closes BEFORE it
 * becomes a bug report. What the drift costs is not a rounding error — the
 * mode is erased, so every variant of the cast resolves to the SAME board inside
 * the search. A bestow line and a plain creature cast then tie at every depth,
 * at every iteration budget, and the root pick falls to rollout noise: the
 * reported bug (issue #2796) is a bot bestowing a +1/+1 Aura onto the OPPONENT's
 * creature, because the tree could not tell that line from casting the 1/1.
 *
 * Hence one table, `Record<CastMode, …>`, in the shape `CAST_KEY_CENSUS`
 * (`owedPayment.ts`) established: a new cast mode cannot compile until it names
 * both how it is IDENTIFIED and what it STAMPS, and both executors then get it
 * for free. Guarded by
 * `convex/gre/__tests__/castMode.bot.test.ts`, which asserts the two executors
 * produce the same characteristics for every mode.
 */

import { tryGetDefinition } from "../cards";
import type { AlternativeCost, CardDefinition } from "../cards/types";
import { applyBestowCharacteristics } from "./bestow";
import { turnFaceDown } from "./faceDown";
import {
    adventureCastAltCostId,
    adventureCastOptionFor,
    adventureTwin,
    castAsAdventure,
} from "./adventure";
import { castableInsetKind } from "../cards/insetSpell";
import {
    castAsSplitHalf,
    splitCastAltCostId,
    splitCastOptionsFor,
    splitTwin,
} from "./splitCast";
import {
    faceDownCastView,
    isMorphCastId,
    MORPH_CAST_ALT_COST_ID,
} from "./morph";
import type { CardInstanceState } from "./state";
import type { LayerStateView } from "./layers";

/** A cast mode: an alternative cost that changes what the spell IS or what
 *  becomes of the permanent, rather than only what it costs. An alt cost that
 *  changes the price alone (Force of Will's, Fireblast's, Gush's) is NOT one —
 *  it leaves no mark on the stack item and belongs in no row here. */
export type CastMode =
    | "bestow"
    | "morph"
    | "dash"
    | "warp"
    | "evoke"
    | "overload"
    | "adventure"
    | "split-left"
    | "split-right";

type CastModeRow = {
    /** The alt-cost id that selects this mode for `def`, or `undefined` when
     *  the card has no such mode. Matched by ID rather than by the object
     *  identity the real commit sites use (`chosenAltCost === def.evoke`,
     *  `game.ts`) — a search Move carries only the id, never the resolved
     *  `AlternativeCost`. The two agree so long as ids are unique per card,
     *  which `castModeIdsAreUnambiguous` below is what keeps true. */
    idOf: (def: CardDefinition | undefined) => string | undefined;
    /** CR 715.3a (ADR 0120 §3) — the definition whose characteristics decide
     *  whether this cast can HAPPEN: "when casting an adventurer card as an
     *  Adventure, only the alternative characteristics are evaluated to see if
     *  it can be cast."
     *
     *  This is what makes the census PRE-commit rather than post-commit. Every
     *  other member here describes the object AFTER it reaches the stack;
     *  timing, affordability and targeting all run BEFORE one exists, and a
     *  stamp applied to a freshly-built stack item arrives too late to make an
     *  instant-speed Adventure legal. Identity for every mode that changes only
     *  what the object BECOMES — bestow, morph, dash, evoke, overload — and the
     *  twin for adventure.
     *
     *  Morph is identity DESPITE also being evaluated against different
     *  characteristics (CR 702.37c): its subject is not a registered definition
     *  but a synthesized 2/2, which `faceDownCastView` (`morph.ts`) has
     *  expressed as an instance view since before this member existed. Making
     *  it return the face-down SENTINEL here would be a second answer to a
     *  question that already has one. */
    subject: (def: CardDefinition) => CardDefinition;
    /** What the mode stamps on the freshly-built cast stack item. Every stamper
     *  is idempotent, so a re-walked commit path can never double-apply. */
    stamp: (state: LayerStateView, item: CardInstanceState) => void;
};

/** The census. `Record<CastMode, …>` is the guard: a mode added to the union
 *  cannot compile until it appears here, and both search executors then apply
 *  it without either of them being edited. */
const CAST_MODE_CENSUS: Record<CastMode, CastModeRow> = {
    // CR 702.103b — "it's an Aura spell with enchant creature. It's not a
    // creature spell." `applyBestowCharacteristics` owns the whole rewrite
    // (type line, P/T, the enchant restriction) and the `bestowed` marker that
    // rides onto the permanent.
    bestow: {
        idOf: (def) => def?.bestow?.id,
        subject: (def) => def,
        stamp: (_state, item) => applyBestowCharacteristics(item),
    },
    // CR 702.37c — a morph cast puts a FACE-DOWN 2/2 on the stack, not the
    // printed card. Its alt-cost id is SYNTHESIZED (the {3} belongs to the
    // rule, not the card), so identification goes through `isMorphCastId`'s own
    // constant rather than a field on the definition.
    morph: {
        idOf: (def) => (def?.morph ? MORPH_CAST_ALT_COST_ID : undefined),
        subject: (def) => def,
        stamp: (state, item) => turnFaceDown(state, item, "morph"),
    },
    // CR 702.109a — the `dashed` marker `dashTrigger`
    // (`convex/cards/abilities/dash.ts`) reads via `conditionOnSelf`. Without
    // it neither the haste grant nor the delayed return to hand can ever fire
    // inside a search, so the tree prices a dashed creature as a permanent one.
    dash: {
        idOf: (def) => def?.dash?.id,
        subject: (def) => def,
        stamp: (_state, item) => {
            item.dashed = true;
        },
    },
    // CR 702.185a — the `warped` marker the delayed end-step exile reads, both
    // to decide it should exist at all (`finalizeSpellResolution` schedules it
    // only for a warped permanent) and to answer CR 400.7 at fire time. Without
    // it the tree prices a warp cast as a permanent creature bought at a
    // discount — strictly better than the hard cast, which is never true.
    warp: {
        idOf: (def) => def?.warp?.id,
        subject: (def) => def,
        stamp: (_state, item) => {
            item.warped = true;
        },
    },
    // CR 702.74a — "When this permanent enters, if its evoke cost was paid, its
    // controller sacrifices it." `evokeTrigger`
    // (`convex/cards/abilities/evoke.ts`) decides on `self.evoked === true`, so
    // an unstamped evoke line models a free fat creature that STAYS — the most
    // over-valued line the bot can see.
    evoke: {
        idOf: (def) => def?.evoke?.id,
        subject: (def) => def,
        stamp: (_state, item) => {
            item.evoked = true;
        },
    },
    // CR 702.96a — the `overloaded` marker `buildSpellContext` (`state.ts`)
    // reads to swap the script's `forEach { set: "targets" }` member set from
    // the announced targets to every matching object (CR 702.96b). Without it
    // the tree prices an overloaded Damn as a one-creature removal spell — the
    // same erasure issue #2796 documented for bestow, and the reason a mode
    // that changes what the spell DOES belongs in this census rather than
    // being left to the two executors.
    overload: {
        idOf: (def) => def?.overload?.id,
        subject: (def) => def,
        stamp: (_state, item) => {
            item.overloaded = true;
        },
    },
    // CR 715.3b — "while on the stack as an Adventure, the spell has only its
    // ALTERNATIVE characteristics." The one row whose `subject` is not the
    // identity: the twin definition registered at hydration IS the object being
    // announced, so timing (CR 715.3a — an Instant printed on a creature card),
    // affordability and targeting are all judged against it. `stamp` then swaps
    // the stack item's identity to that same twin and retains the front id for
    // the CR 715.4 revert.
    adventure: {
        idOf: (def) =>
            castableInsetKind(def) === "adventure"
                ? adventureCastAltCostId(def!)
                : undefined,
        subject: (def) => adventureTwin(def) ?? def,
        stamp: (_state, item) => castAsAdventure(item),
    },
    // CR 709.3a/709.3b — "only the chosen half is evaluated to see if it can be
    // cast", and "while on the stack, only the characteristics of the half
    // being cast exist". Two rows rather than one parameterised entry because
    // `CastMode` is what the census is a `Record` over: a side without a row
    // could not be announced at all, which is the property that made the
    // `subject` member reach every pre-commit surface for free.
    "split-left": {
        idOf: (def) =>
            def?.splitHalves ? splitCastAltCostId(def, "left") : undefined,
        subject: (def) => splitTwin(def, "left") ?? def,
        stamp: (_state, item) => castAsSplitHalf(item, "left"),
    },
    "split-right": {
        idOf: (def) =>
            def?.splitHalves ? splitCastAltCostId(def, "right") : undefined,
        subject: (def) => splitTwin(def, "right") ?? def,
        stamp: (_state, item) => castAsSplitHalf(item, "right"),
    },
};

/** CR 715.3 / 709.3 — every cast option on `card` that is a DIFFERENT SPELL
 *  rather than a different price for the printed one: the Adventure (one) and
 *  a split card's two halves.
 *
 *  What unites them, and the reason they are one list rather than a
 *  per-mechanic local at each of the four offering surfaces: each is judged
 *  entirely against its OWN subject (`castSubjectDefinition`), so timing,
 *  affordability and targeting are asked of the half and never of the card,
 *  and none of them lends legality to the printed cast or to each other. Every
 *  other cast mode — bestow, morph, dash, evoke, overload — casts the printed
 *  card for a different price and rides the printed conjunction.
 *
 *  Instance-level, because Adventure's own withdrawal is (CR 715.3d — "it
 *  can't be cast as an Adventure this way", carried on the exiled instance).
 *  Callers: the "cast" legality gate (`rules.ts`), `enumerateCastMoves`
 *  (`moves.ts`), `announceCast` (`game.ts`) and the client picker. A surface
 *  that built its own list is how the third such mode would ship reachable at
 *  three sites out of four. */
export function independentCastOptionsFor(
    card: CardInstanceState
): AlternativeCost[] {
    const adventure = adventureCastOptionFor(card);
    return [...(adventure ? [adventure] : []), ...splitCastOptionsFor(card)];
}

/** The cast mode `alternativeCostId` selects for `def`, or `undefined` for a
 *  printed-cost cast and for an alternative cost that is only a price.
 *
 *  Answers ONE mode, so the order of the scan is load-bearing if a card ever
 *  declared two mode fields sharing an id — and this order is not the one
 *  `getAlternativeCost` (`alternativeCost.ts`) scans in, so the two could
 *  disagree about such a card (PR #3056 review finding 2). No shipped card
 *  carries two mode fields at all, and `castModeIdsAreUnambiguous` below is
 *  what keeps that true: it is a catalogue-wide predicate, exercised by
 *  `castMode.bot.test.ts`, so the day one does the guard reds instead of the
 *  two scans silently choosing different modes.
 *
 *  Internal on purpose — `applyCastModeCharacteristics` is the seam callers
 *  use; the guard reaches this through the predicate below. */
function castModeOf(
    def: CardDefinition | undefined,
    alternativeCostId: string | undefined
): CastMode | undefined {
    if (alternativeCostId === undefined) return undefined;
    // Morph's synthesized id is shared by every morph card, so it is matched
    // through the helper that also proves `def` HAS a morph cost.
    if (isMorphCastId(def, alternativeCostId)) return "morph";
    for (const mode of Object.keys(CAST_MODE_CENSUS) as CastMode[]) {
        if (mode === "morph") continue;
        if (CAST_MODE_CENSUS[mode].idOf(def) === alternativeCostId) return mode;
    }
    return undefined;
}

/** Whether `def` declares at most one cast mode per alt-cost id — the property
 *  that makes "which mode is this id?" a question with ONE answer, and so the
 *  property that lets this module's scan order and `getAlternativeCost`'s
 *  opposite order agree (see `castModeOf`). False for a card declaring, say,
 *  `bestow` and `evoke` under the same id, or a morph card whose `dash.id`
 *  collides with morph's synthesized constant. */
export function castModeIdsAreUnambiguous(def: CardDefinition): boolean {
    const ids = (Object.keys(CAST_MODE_CENSUS) as CastMode[])
        .map((mode) =>
            mode === "morph"
                ? def.morph
                    ? MORPH_CAST_ALT_COST_ID
                    : undefined
                : CAST_MODE_CENSUS[mode].idOf(def)
        )
        .filter((id): id is string => id !== undefined);
    return new Set(ids).size === ids.length;
}

/** Stamp onto `stackItem` the characteristics of the cast mode `move` chose
 *  (CR 601.2b). No-op for a printed-cost cast, for a price-only alternative
 *  cost, and for a card whose definition cannot be resolved — every one of
 *  which is an ordinary cast that changes nothing about the object.
 *
 *  Called by BOTH search executors immediately after the stack item is built
 *  and before it is pushed, which is where each of them used to keep its own
 *  partial copy of this logic. */
export function applyCastModeCharacteristics(
    /** PRD #2064 S6b — the morph stamper turns the item FACE DOWN, which
     *  recomposes layer 6 over the new copiable values and therefore needs the
     *  registry the permanent's own grants live in. Every stamper takes it so
     *  the census stays one shape; `_state` marks the ones that do not read it. */
    state: LayerStateView,
    stackItem: CardInstanceState,
    alternativeCostId: string | undefined
): void {
    const def = tryGetDefinition((stackItem.card as { id?: string }).id ?? "");
    const mode = castModeOf(def ?? undefined, alternativeCostId);
    if (!mode) return;
    CAST_MODE_CENSUS[mode].stamp(state, stackItem);
}

/** CR 715.3a / 601.2b (ADR 0120 §3) — THE cast SUBJECT: the definition whose
 *  characteristics decide whether the cast `alternativeCostId` announces can
 *  happen at all.
 *
 *  `def` itself for a printed-cost cast, for a price-only alternative cost and
 *  for every cast mode that changes only what the object BECOMES; the twin for
 *  an Adventure. Call this — never a bare `tryGetDefinition(card.card.id)` —
 *  from any surface that asks "what is being cast": the timing gate
 *  (`castTimingBaseLegal`, `rules.ts`), the cast-option list
 *  (`castOptionAlternativeCosts`), `announceCast` (`game.ts`), the Bot's
 *  `enumerateCastMoves` (`moves.ts`) and the client picker
 *  (`src/lib/card-utils.ts`). The `Record<CastMode, …>` above is what makes a
 *  new mode declare its answer instead of inheriting a wrong one. */
export function castSubjectDefinition(
    def: CardDefinition | undefined,
    alternativeCostId: string | undefined
): CardDefinition | undefined {
    if (!def) return def;
    const mode = castModeOf(def, alternativeCostId);
    return mode ? CAST_MODE_CENSUS[mode].subject(def) : def;
}

/** The INSTANCE-level twin of {@link castSubjectDefinition}: `card` as the
 *  announced cast sees it, for the readers that take a `CardInstanceState`
 *  (`hasInstantSpeed`, the cost solver's characteristic-keyed restrictions,
 *  `handCardMatchesFilter`).
 *
 *  Returns `card` UNCHANGED whenever the subject is the card's own definition,
 *  so every existing cast keeps its exact identity — including morph, whose
 *  own characteristics view (`faceDownCastView`) predates this seam and stays
 *  its authority (see `CastModeRow.subject`).
 *
 *  A throwaway spread, never a mutation: the card is still in its zone and only
 *  the eventual stack item is rewritten (by `stamp`, at commit). */
export function castSubjectView(
    card: CardInstanceState,
    alternativeCostId: string | undefined
): CardInstanceState {
    const cardId = (card.card as { id?: string }).id;
    const def = cardId ? tryGetDefinition(cardId) : null;
    // CR 702.37c — MORPH is the one mode whose subject is not a registered
    // definition but a synthesized 2/2, so the census row keeps `subject` as
    // the identity (ADR 0120 §3) and the VIEW composes in `faceDownCastView`,
    // which has expressed those characteristics since before this seam existed.
    // Answered HERE rather than at each caller: the five surfaces that price a
    // cast used to carry their own `isMorphCast ? faceDownCastView(card) :
    // card` ternary, and the day a SECOND mode needed a view three of them had
    // not been updated (PR #3302 review finding 1) — a gate pricing Petty Theft
    // as an Instant while the payment priced the Creature.
    if (isMorphCastId(def ?? undefined, alternativeCostId)) {
        return faceDownCastView(card);
    }
    const subject = castSubjectDefinition(def ?? undefined, alternativeCostId);
    if (!def || !subject || subject.id === def.id) return card;
    return {
        ...card,
        card: { id: subject.id },
        types: [...subject.types],
        subtypes: [...(subject.subtypes ?? [])],
        staticAbilities: [...(subject.staticAbilities ?? [])],
        power: subject.power,
        toughness: subject.toughness,
    };
}
