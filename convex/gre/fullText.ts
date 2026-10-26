/**
 * Full-text effects (CR 612.6) — a layer-3 text-changing effect that gives a
 * permanent "the full text" of another object: not only its rules text but
 * "the text that represents its name, mana cost, color indicator, power, and
 * toughness" (CR 612.6), and its type line with it (CR 613.1c).
 *
 * MATERIALISED, like a copy effect (`gre/copy.ts`): the permanent's `card.id`
 * and `imagePrintId` are overwritten with the presented card's, and its
 * layer-1 fields are rebuilt by the identity-swap helper every copy, face-down
 * and transform site shares (`rebuildCopiableValuesAndReplayOverlays`). Every
 * ability, colour, mana-cost, name and P/T reader in the engine resolves its
 * definition off `card.id`, so they all see the presented card with no reader
 * of their own. The read-time alternative — a "presented definition" accessor
 * consulted by every reader — would have to reach every one of those
 * definition reads; the swap reaches them all at once.
 *
 * What the materialisation must keep apart from a copy:
 *
 *  - **Not copiable (CR 707.2).** "Other effects (including type-changing and
 *    text-changing effects) … are not copied." `fullTextAnchor` holds the
 *    layer-1 identity underneath; `copiableDefId` / `copiableImagePrintId`
 *    answer for it, and every copy source and the departure LKI store read
 *    them instead of `card.id`.
 *  - **Layer 3, above layer 1.** Every identity swap (`applyCopy`,
 *    `revertCopy`, `turnFaceDown`, `transformPermanent`) withdraws the effect
 *    first, so it always acts on the layer-1 identity; the next sync puts the
 *    full text back over whatever layer 1 became. A face-down permanent has no
 *    text (CR 708.2), so it never presents.
 *  - **Below layers 4–7.** The rebuild re-seats the layer-2-to-6 BASES on the
 *    presented card and replays this permanent's own overlays, so anthems,
 *    counters, grants and "loses all abilities" keep applying on top.
 *  - **No zone change (CR 400.7).** Counters, damage, attachments, tapped
 *    state and summoning sickness are untouched, and no event is emitted, so
 *    changing form fires no "enters" ability (Gatherer ruling, 2004-10-04).
 *
 * **Re-evaluation (CR 611.3a)** — "it applies at any given moment to whatever
 * its text indicates." `syncFullTextEffects` runs at the front of the layer
 * recomputes in `gre/state.ts` (`beginApplyingStaticEffects`,
 * `applyExistingGrantsTo`, `recomputeContinuousEffects` — hence every SBA pass
 * and every save) and at the graveyard funnels that hold a `GameState`
 * (discard, mill, surveil, the general mover, a cast or a cost paid from the
 * graveyard; `refreshFullText`). NOT on the battlefield-departure path: a
 * simultaneous batch leaves one `removePermanentTo` call at a time, and the
 * effect must not see a card the same event put into the graveyard (CR
 * 603.10a) — the SBA loop re-evaluates it once the batch is over. `moveCard`
 * takes no state; a caller that moves a card through it directly is caught by
 * the next recompute, which every SBA pass runs before it reads toughness.
 *
 * **The CR 613.8a self-dependency.** The full text overwrites the very text
 * that holds the effect. The engine reads the effect from the LAYER-1
 * definition (`copiableDefId`), so it keeps functioning while overwritten —
 * the reading under which the card does anything at all, and Forge's ("the
 * gained text includes this static").
 */

import { declaresFullTextEffect, tryGetDefinition } from "../cards";
import type { CardDefinition, FullTextEffect } from "../cards/types";
import {
    rebuildCopiableValuesAndReplayOverlays,
    type CopiableValues,
} from "./identitySwap";
import type { LayerStateView } from "./layers";
import type { CardInstanceState, GameState } from "./state/declarations";

type GrantRow = NonNullable<
    CardInstanceState["grantedActivatedAbilities"]
>[number];

/** The definition id of this object's COPIABLE values (CR 707.2) — what a
 *  copy of it becomes. The presented id, except under a full-text effect,
 *  which is a text-changing effect and therefore not copied. */
export function copiableDefId(
    card: Pick<CardInstanceState, "card" | "fullTextAnchor">
): string {
    return (
        card.fullTextAnchor?.underlyingDefId ??
        (card.card as { id?: string }).id ??
        ""
    );
}

/** The print that goes with {@link copiableDefId}. */
export function copiableImagePrintId(
    card: Pick<CardInstanceState, "imagePrintId" | "fullTextAnchor">
): string | undefined {
    return card.fullTextAnchor
        ? card.fullTextAnchor.underlyingImagePrintId
        : card.imagePrintId;
}

/** CR 613.1a — the layer-1 values of `def` on this permanent: the printed
 *  values, plus the "except" clauses of a copy effect it presents (CR 707.9),
 *  which `applyCopy` keeps on `copyOptions` / `copyExcept`. */
function layer1Values(
    card: CardInstanceState,
    def: CardDefinition
): CopiableValues {
    const opts = card.copyOptions ?? {};
    return {
        types: [...def.types, ...(opts.additionalTypes ?? [])],
        subtypes: [...(def.subtypes ?? []), ...(opts.additionalSubtypes ?? [])],
        power: card.copyExcept?.basePower ?? def.power,
        toughness: card.copyExcept?.baseToughness ?? def.toughness,
        staticAbilities: [
            ...(def.staticAbilities ?? []),
            ...(opts.additionalStaticAbilities ?? []),
        ],
    };
}

/** A retained-text row ("… and has the text '{2}: Discard a card.'"): the
 *  permanent's own layer-1 ability, re-offered through the ability-copy grant
 *  shape (`origin: "card-abilities"`) because `card.id` no longer
 *  names the card that prints it. It carries no `auraId`, no `duration` and no
 *  `seq`, which is what tells it apart from every other grant: a seq-less row
 *  is outranked by any "loses all abilities" (`grantOutrankedByAbilityLoss`),
 *  which is right — the text is layer 3, the ability loss layer 6. */
function isRetainedTextRow(row: GrantRow, underlyingDefId: string): boolean {
    return (
        row.origin === "card-abilities" &&
        row.sourceCardId === underlyingDefId &&
        row.auraId === undefined &&
        row.duration === undefined &&
        row.seq === undefined
    );
}

function setRetainedTextRows(
    card: CardInstanceState,
    underlyingDefId: string,
    abilityIds: readonly string[]
): void {
    const kept = (card.grantedActivatedAbilities ?? []).filter(
        (row) => !isRetainedTextRow(row, underlyingDefId)
    );
    const rows: GrantRow[] = abilityIds.map((abilityId) => ({
        sourceCardId: underlyingDefId,
        abilityId,
        origin: "card-abilities",
    }));
    const next = [...kept, ...rows];
    card.grantedActivatedAbilities = next.length > 0 ? next : undefined;
}

/** Ends a full-text effect on `card`: restores the layer-1 identity the
 *  anchor holds and drops the retained-text rows. A no-op without an anchor.
 *  Called before every identity swap, so the swap acts on layer 1. */
export function withdrawFullText(
    state: LayerStateView,
    card: CardInstanceState
): void {
    const anchor = card.fullTextAnchor;
    if (!anchor) return;
    setRetainedTextRows(card, anchor.underlyingDefId, []);
    delete card.fullTextAnchor;
    card.card = { ...(card.card as object), id: anchor.underlyingDefId };
    if (anchor.underlyingImagePrintId) {
        card.imagePrintId = anchor.underlyingImagePrintId;
    } else {
        delete card.imagePrintId;
    }
    const def = tryGetDefinition(anchor.underlyingDefId);
    if (def) {
        rebuildCopiableValuesAndReplayOverlays(
            state,
            card,
            layer1Values(card, def)
        );
    }
}

/** The object whose full text `card` has right now, or undefined when the
 *  effect's condition is false. CR 404.1 / 404.2: the top of the ordered
 *  pile is the LAST element. "Tokens aren't considered cards" (CR 108.2b), so
 *  a creature token that has just died and not yet ceased to exist
 *  (CR 704.5d) does not qualify. */
function fullTextObject(
    state: GameState,
    controllerId: string,
    effect: FullTextEffect
): CardInstanceState | undefined {
    const graveyard = state.players.find(
        (p) => p.id === controllerId
    )?.graveyard;
    const top = graveyard?.[graveyard.length - 1];
    if (!top || top.isToken === true) return undefined;
    return top.types.includes(effect.requiresType) ? top : undefined;
}

/** Installs `shownDef`'s full text over `card`'s layer-1 identity: the anchor,
 *  the presented id and print, and the rebuilt characteristics. Returns false
 *  (and changes nothing) when the layer-1 definition cannot be resolved. The
 *  one writer of a presentation, shared by the live sync and the
 *  leaves-the-battlefield look-back (`lookBackSelf`, `gre/copy.ts`). */
export function installFullText(
    state: LayerStateView,
    card: CardInstanceState,
    shownDef: CardDefinition,
    shownImagePrintId: string | undefined
): boolean {
    const underlyingDefId = copiableDefId(card);
    const underlyingDef = tryGetDefinition(underlyingDefId);
    if (!underlyingDef) return false;
    const underlyingPrint = copiableImagePrintId(card);
    card.fullTextAnchor = {
        underlyingDefId,
        ...(underlyingPrint ? { underlyingImagePrintId: underlyingPrint } : {}),
    };
    card.card = { ...(card.card as object), id: shownDef.id };
    if (shownImagePrintId) card.imagePrintId = shownImagePrintId;
    else delete card.imagePrintId;
    // Gatherer ruling (2004-10-04): "If the top card in the graveyard has any
    // other undefined characteristics, then those characteristics are not
    // acquired and the shapeshifter uses the characteristic from its own card."
    const own = layer1Values(card, underlyingDef);
    rebuildCopiableValuesAndReplayOverlays(state, card, {
        types: [...shownDef.types],
        subtypes: [...(shownDef.subtypes ?? [])],
        power: shownDef.power ?? own.power,
        toughness: shownDef.toughness ?? own.toughness,
        staticAbilities: [...(shownDef.staticAbilities ?? [])],
    });
    return true;
}

/** What `card`'s full-text effect presents right now under `controllerId`,
 *  or undefined when it presents nothing: no effect on its layer-1 text, face
 *  down (CR 708.2), the condition false, or the top card its own text. */
function presentation(
    state: GameState,
    card: CardInstanceState,
    controllerId: string
):
    | { effect: FullTextEffect; top: CardInstanceState; topDef: CardDefinition }
    | undefined {
    const layer1Id = copiableDefId(card);
    const effect =
        !card.faceDown && declaresFullTextEffect(layer1Id)
            ? tryGetDefinition(layer1Id)?.fullText
            : undefined;
    const top = effect
        ? fullTextObject(state, controllerId, effect)
        : undefined;
    const topId = top ? (top.card as { id?: string }).id : undefined;
    const topDef = topId ? tryGetDefinition(topId) : undefined;
    // Having the full text of a card with this permanent's own text changes
    // nothing, so it is not presented at all.
    if (!effect || !top || !topDef || topDef.id === layer1Id) return undefined;
    return { effect, top, topDef };
}

/** True when `card` already presents exactly `shown`. */
function isShowing(
    card: CardInstanceState,
    shown: NonNullable<ReturnType<typeof presentation>>
): boolean {
    return (
        card.fullTextAnchor !== undefined &&
        (card.card as { id?: string }).id === shown.topDef.id &&
        card.imagePrintId === shown.top.imagePrintId
    );
}

/** The writer of a live presentation: the shown identity plus the
 *  retained-text rows. */
function present(
    state: LayerStateView,
    card: CardInstanceState,
    shown: NonNullable<ReturnType<typeof presentation>>
): boolean {
    if (!installFullText(state, card, shown.topDef, shown.top.imagePrintId)) {
        return false;
    }
    setRetainedTextRows(
        card,
        copiableDefId(card),
        shown.effect.retainedActivatedAbilityIds ?? []
    );
    return true;
}

/** CR 614.12 — "check the characteristics of the permanent as it would exist
 *  on the battlefield, taking into account … continuous effects from the
 *  permanent's own static abilities that would apply to it once it's on the
 *  battlefield". Brings an ENTERING object's full text in line with the board
 *  under `controllerId`, so the CR 614 entry chokepoint
 *  (`enterBattlefieldDestinationFor`), the as-enters prompts it raises and
 *  the entry tail's `entersWith` / `entersTapped` reads all see the presented
 *  card. The graveyard is read with the object already out of its origin
 *  zone — a Shapeshifter reanimated off the top shows the card under it.
 *
 *  The presentation rides a parked as-enters entry, so its answers are
 *  written onto the presented object and survive the resume. It must never
 *  leave with the object: an exile verdict and an aborted staged entry
 *  withdraw it (`withdrawFullText`). Already showing, only the retained-text
 *  rows are written again — the CR 400.7 entry reset drops them with every
 *  other grant while the identity stays. Mints no timestamp: the entry tail's
 *  `beginApplyingStaticEffects` does (CR 613.7a). Returns whether the object
 *  presents a full text. */
export function presentFullTextOnEntry(
    state: GameState,
    card: CardInstanceState,
    controllerId: string
): boolean {
    const shown = presentation(state, card, controllerId);
    if (!shown) {
        withdrawFullText(state, card);
        return false;
    }
    if (!isShowing(card, shown)) return present(state, card, shown);
    setRetainedTextRows(
        card,
        copiableDefId(card),
        shown.effect.retainedActivatedAbilityIds ?? []
    );
    return true;
}

/** CR 612.6 / 611.3a — brings every battlefield permanent's full-text effect
 *  in line with the board as it stands: presents the text the condition names,
 *  or withdraws it when the condition is false. Idempotent; a board with no
 *  full-text card costs one `Set.has` per permanent. Returns whether any
 *  permanent changed form.
 *
 *  `allocTimestamp` is `allocStaticTimestamp` (`gre/state.ts`), injected
 *  because that module imports this one. */
export function syncFullTextEffects(
    state: GameState,
    allocTimestamp: () => number
): boolean {
    let changed = false;
    for (const player of state.players) {
        for (const card of player.battlefield) {
            const shown = presentation(state, card, card.controllerId);
            if (!shown) {
                if (card.fullTextAnchor) {
                    withdrawFullText(state, card);
                    changed = true;
                }
                continue;
            }
            if (isShowing(card, shown) || !present(state, card, shown))
                continue;
            // CR 613.7a — the presented text's static abilities take the
            // timestamp of the object they are on, minted at entry
            // (`beginApplyingStaticEffects`). A permanent placed without an
            // entry (a scenario fixture) has none, and an unstamped source is
            // skipped by the layer-6 walk.
            if (card.staticSeq === undefined) card.staticSeq = allocTimestamp();
            changed = true;
        }
    }
    return changed;
}
