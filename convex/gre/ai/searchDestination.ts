// Where does a library search actually PUT the card it finds? (issue #3041)
//
// WHY THIS MODULE EXISTS. Every `search-library` candidate used to be priced by
// one destination-blind worth function: a nonland by what it would do if it were
// CAST, a land by a fetch curve worth ~70 points at a low land count — both
// answering "how good is it to have this card available". Nothing asked where
// the effect puts it, so Entomb ("put that card into your GRAVEYARD") priced a
// dual land above every reanimation target and duly fetched Breeding Pool. The
// destination is not on the `PendingChoice` at all: it lives in the SOURCE's
// Effect Script, in the later `moveZone` Op that consumes the choice's binding.
//
// THE DERIVATION IS GENERIC, and it has to be (ADR 0102 — no card names, no
// per-tutor table). The shape it reads is the one every DSL tutor in the
// catalogue is built from:
//
//     { op: "choice", kind: "search-library", bind: "$picked", … }
//     { op: "moveZone", cards: { ref: "$picked" }, to: "graveyard", … }
//
// Measured over the catalogue (3,481 cards) at the time of writing: 51 DSL
// `search-library` choices, and EVERY one of them is consumed by exactly one
// `moveZone` — 23 to the battlefield (Nature's Lore), 19 to hand (Demonic
// Tutor), 4 to exile (Jester's Cap), 4 to `library-top` (Mystical Tutor), 1 to
// the graveyard (Entomb). No `forEach` indirection, no second consumer. So the
// direct read is not a narrow special case; it is the shape.
//
// IT FAILS CLOSED, NEVER TO A GUESS. An imperative `resolve()` search (Path to
// Exile, the Transmute search), a script the walk cannot follow, or a binding
// two different `moveZone` Ops send to two different zones all return
// `undefined`, and `undefined` means "price it exactly as before this module
// existed". A wrong destination would be strictly worse than no destination.

import type { EffectOp } from "../../cards/types";
import { tryGetDefinition } from "../../cards";
import { findTriggeredAbility } from "../copy";
import type { GameState, PendingChoice, StackItem } from "../state";
import { childOpArrays } from "./effectOpChildren";

/** The zone a find lands in — `EffectMoveZone` plus the `cards`-shape's own
 *  `"library-top"` (Mystical Tutor). Kept as the Op's OWN vocabulary rather
 *  than a normalized one: the caller prices against the zone the engine will
 *  actually move the card to, and collapsing `"library-top"` into `"library"`
 *  would be this module inventing an equivalence no Op declares. */
export type SearchFindDestination =
    | "hand"
    | "library"
    | "graveyard"
    | "exile"
    | "battlefield"
    | "library-top";

/** The membership test for {@link SearchFindDestination}. The Op's `to` is
 *  typed by the DSL but arrives here as a widened `string` off a structural
 *  read, and a bare cast would let an unrecognised zone out of this module
 *  TYPED as one of the six — a lie the next consumer would trust. An unknown
 *  zone is exactly the "cannot derive" case, so it degrades to `undefined`
 *  through the same path an unwalkable script does. */
const SEARCH_FIND_DESTINATIONS: readonly string[] = [
    "hand",
    "library",
    "graveyard",
    "exile",
    "battlefield",
    "library-top",
];

function asDestination(to: unknown): SearchFindDestination | undefined {
    return typeof to === "string" && SEARCH_FIND_DESTINATIONS.includes(to)
        ? (to as SearchFindDestination)
        : undefined;
}

/** The Effect Script the stack item is currently RUNNING — the script whose
 *  `choice` Op raised the pending choice. Mirrors the dispatch in
 *  `resolveTopOfStackInner` (`gre/state.ts`) branch for branch, so this reader
 *  can never look at a script the engine is not running:
 *
 *  1. a DELAYED trigger (CR 603.7a) runs either an ADR 0048 inline body riding
 *     ON the item (`delayedEffects`) or, on the TEMPLATE path, the named
 *     `CardDefinition.delayedTriggers` entry's script — and it must be answered
 *     HERE, not left to fall through. A template instance carries
 *     `delayedTriggerId` plus a bare `card: { id: sourceCardId }` and nothing
 *     else (`buildDelayedTriggerStackItem`, `gre/triggers.ts`), so falling
 *     through reaches branch 4 and returns the source card's SPELL script: a
 *     different script, silently, which is the one outcome this module's header
 *     rules out. Latent today — no shipped card puts a `search-library` inside
 *     a delayed trigger — but "wrong" and "undefined" are not the same failure.
 *  2. a triggered ability reads its template off the source (honouring copy
 *     effects, via `findTriggeredAbility`), then its announced mode;
 *  3. an activated ability reads `grantTemplates` when the ability was granted
 *     by another card (CR 113.1), else the source's own `activatedAbilities`;
 *  4. a spell reads its announced mode's script, else the card's own.
 *
 *  An EMBLEM's triggered ability (the emblem branch of `resolveTopOfStackInner`)
 *  gets no branch of its own on purpose: `findTriggeredAbility` finds nothing on
 *  an emblem's card id, so it already degrades to `undefined` — the safe
 *  direction, and one lookup path fewer to drift.
 *
 *  `aiEffects` is deliberately NOT consulted: a shadow script is what a
 *  `resolve()` card offers a VALUER, and this reader is asking what the engine
 *  will really do with the picks. A `resolve()` search returns `undefined`
 *  here, which is the documented fallback. */
function resolvingEffectScript(
    item: StackItem
): readonly EffectOp[] | undefined {
    const cardId = (item.card as { id?: string }).id;
    const cardDef = cardId
        ? (tryGetDefinition(cardId) ?? undefined)
        : undefined;

    if (item.delayedTriggerId) {
        if (item.delayedEffects) return item.delayedEffects;
        return cardDef?.delayedTriggers?.find(
            (t) => t.id === item.delayedTriggerId
        )?.effects;
    }

    if (item.triggeredAbilityId) {
        const ability = findTriggeredAbility(item, item.triggeredAbilityId);
        if (!ability) return undefined;
        if (item.chosenModeId && ability.modes && ability.modes.length > 0) {
            return ability.modes.find((m) => m.id === item.chosenModeId)
                ?.effects;
        }
        return ability.effects;
    }

    if (item.abilityId) {
        const ability = item.grantedSourceCardId
            ? tryGetDefinition(item.grantedSourceCardId)?.grantTemplates?.find(
                  (a) => a.id === item.abilityId
              )
            : cardDef?.activatedAbilities?.find((a) => a.id === item.abilityId);
        if (!ability) return undefined;
        if (item.chosenModeId && ability.modes && ability.modes.length > 0) {
            return ability.modes.find((m) => m.id === item.chosenModeId)
                ?.effects;
        }
        return ability.effects;
    }

    if (!cardDef) return undefined;
    if (item.chosenModeId && cardDef.modes && cardDef.modes.length > 0) {
        return cardDef.modes.find((m) => m.id === item.chosenModeId)?.effects;
    }
    return cardDef.effects;
}

/** Every Op in `effects`, at any nesting depth, flattened. */
function flattenOps(effects: readonly EffectOp[], out: EffectOp[]): EffectOp[] {
    for (const op of effects) {
        out.push(op);
        for (const child of childOpArrays(op)) flattenOps(child, out);
    }
    return out;
}

/** The `search-library` `choice` Op that raised `choiceId`, if the script has
 *  exactly one. The interpreter keys the pending choice by `op.id ?? op.bind`
 *  (issue #1282's author-supplied stable id, defaulting to the binding name),
 *  so the match is against that pair and never `bind` alone. */
function searchChoiceOpFor(
    ops: readonly EffectOp[],
    choiceId: string
): { bind: string } | undefined {
    let found: { bind: string } | undefined;
    for (const op of ops) {
        if (op.op !== "choice" || op.kind !== "search-library") continue;
        if ((op.id ?? op.bind) !== choiceId) continue;
        // A second match means the script names one choiceId twice — the
        // validator forbids it, so this is unreachable rather than tolerated;
        // fail closed rather than pick the first.
        if (found) return undefined;
        found = { bind: op.bind };
    }
    return found;
}

/** The zone the `moveZone` Ops consuming `bind` send the picks to, when they
 *  all agree on ONE zone. Zero consumers (the picks feed a `reveal` and nothing
 *  else) or two consumers disagreeing both read as "undeterminable": the
 *  fallback is today's destination-blind pricing, never a guess at which branch
 *  will run. */
function moveDestinationFor(
    ops: readonly EffectOp[],
    bind: string
): SearchFindDestination | undefined {
    let destination: SearchFindDestination | undefined;
    for (const op of ops) {
        if (op.op !== "moveZone") continue;
        // Only the `cards`-shape consumes a picks binding; the announced-target
        // and whole-zone shapes carry no `cards` at all.
        const shape = op as { cards?: { ref?: string }; to?: string };
        if (shape.cards?.ref !== bind) continue;
        const to = asDestination(shape.to);
        if (to === undefined) return undefined;
        if (destination !== undefined && destination !== to) return undefined;
        destination = to;
    }
    return destination;
}

/** The zone a `search-library` find will actually be moved to, derived from the
 *  SOURCE's Effect Script, or `undefined` when it cannot be derived. Pure — no
 *  mutation, no `GameState` write; `state` is read only to find the stack item
 *  the choice belongs to. */
export function searchFindDestination(
    state: GameState,
    choice: PendingChoice
): SearchFindDestination | undefined {
    if (choice.kind !== "search-library") return undefined;
    const item = state.stack.find((s) => s.id === choice.stackItemId);
    if (!item) return undefined;
    const script = resolvingEffectScript(item);
    if (!script) return undefined;
    const ops = flattenOps(script, []);
    const choiceOp = searchChoiceOpFor(ops, choice.choiceId);
    if (!choiceOp) return undefined;
    return moveDestinationFor(ops, choiceOp.bind);
}
