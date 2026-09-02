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
import type { CardDefinition } from "../cards/types";
import { applyBestowCharacteristics } from "./bestow";
import { turnFaceDown } from "./faceDown";
import { isMorphCastId, MORPH_CAST_ALT_COST_ID } from "./morph";
import type { CardInstanceState } from "./state";

/** A cast mode: an alternative cost that changes what the spell IS or what
 *  becomes of the permanent, rather than only what it costs. An alt cost that
 *  changes the price alone (Force of Will's, Fireblast's, Gush's) is NOT one —
 *  it leaves no mark on the stack item and belongs in no row here. */
export type CastMode = "bestow" | "morph" | "dash" | "evoke";

type CastModeRow = {
    /** The alt-cost id that selects this mode for `def`, or `undefined` when
     *  the card has no such mode. Matched by ID rather than by the object
     *  identity the real commit sites use (`chosenAltCost === def.evoke`,
     *  `game.ts`) — a search Move carries only the id, never the resolved
     *  `AlternativeCost`. The two agree so long as ids are unique per card,
     *  which `castModeIdsAreUnambiguous` below is what keeps true. */
    idOf: (def: CardDefinition | undefined) => string | undefined;
    /** What the mode stamps on the freshly-built cast stack item. Every stamper
     *  is idempotent, so a re-walked commit path can never double-apply. */
    stamp: (item: CardInstanceState) => void;
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
        stamp: (item) => applyBestowCharacteristics(item),
    },
    // CR 702.37c — a morph cast puts a FACE-DOWN 2/2 on the stack, not the
    // printed card. Its alt-cost id is SYNTHESIZED (the {3} belongs to the
    // rule, not the card), so identification goes through `isMorphCastId`'s own
    // constant rather than a field on the definition.
    morph: {
        idOf: (def) => (def?.morph ? MORPH_CAST_ALT_COST_ID : undefined),
        stamp: (item) => turnFaceDown(item, "morph"),
    },
    // CR 702.109a — the `dashed` marker `dashTrigger`
    // (`convex/cards/abilities/dash.ts`) reads via `conditionOnSelf`. Without
    // it neither the haste grant nor the delayed return to hand can ever fire
    // inside a search, so the tree prices a dashed creature as a permanent one.
    dash: {
        idOf: (def) => def?.dash?.id,
        stamp: (item) => {
            item.dashed = true;
        },
    },
    // CR 702.74a — "When this permanent enters, if its evoke cost was paid, its
    // controller sacrifices it." `evokeTrigger`
    // (`convex/cards/abilities/evoke.ts`) decides on `self.evoked === true`, so
    // an unstamped evoke line models a free fat creature that STAYS — the most
    // over-valued line the bot can see.
    evoke: {
        idOf: (def) => def?.evoke?.id,
        stamp: (item) => {
            item.evoked = true;
        },
    },
};

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
    stackItem: CardInstanceState,
    alternativeCostId: string | undefined
): void {
    const def = tryGetDefinition((stackItem.card as { id?: string }).id ?? "");
    const mode = castModeOf(def ?? undefined, alternativeCostId);
    if (!mode) return;
    CAST_MODE_CENSUS[mode].stamp(stackItem);
}
