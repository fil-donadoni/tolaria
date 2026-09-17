// Splice onto [subtype] (CR 702.47, issue #2394).
//
// Splice is the only additional cost in the engine that does NOT live on the
// card being cast. CR 702.47a:
//
//   "Splice onto [quality] [cost]" means "You may reveal this card from your
//   hand as you cast a [quality] spell. If you do, that spell gains the text of
//   this card's rules text and you pay [cost] as an additional cost to cast
//   that spell."
//
// So one cast has TWO card definitions in play: the spell's own, and one per
// revealed hand card. Everything downstream of the reveal is, word for word,
// the additional-cost machinery ADR 0079/0085 already built for Kicker — a
// per-id payment record, a mana leg folded into the total, non-mana legs routed
// into the cast's single pickers, a client dialog control, a Bot enumeration
// axis. What is new is only WHERE the cost entry comes from.
//
// This module is therefore a SYNTHESIZER, not a second cost system: it turns
// the caster's hand into `KickerCost` entries with `keyword: "splice"` and ids
// of the form `splice:<handCardInstanceId>`, and {@link spliceAugmentedDefinition}
// is the single seam every cast site calls to get a definition whose
// `kickers[]` includes them. Nine existing sites then work unchanged, and
// `additionalCostPaymentSnapshot`'s keyword partition (ADR 0085) routes a
// splice payment to `unkickedCostPayments` — a spliced spell is NOT kicked
// (CR 702.33d defines "kicked" over kicker costs alone).
//
// ── What is reachable, and what fails CLOSED ──────────────────────────────
//
// A splice option is offered only when BOTH halves of the pairing are shapes
// this module can honour end to end. Each exclusion below is fail-closed (the
// option is never offered) AND catalogue-guarded (`convex/cards/__tests__/
// splice.test.ts`), so the gap can never appear silently as a card that reads
// "Splice onto Arcane" and does nothing:
//
//  1. **The SPELL must be an Effect Script** (`def.effects`, no `modes`).
//     CR 702.47c makes the spell gain the spliced card's text, which this
//     module implements as one merged op list ({@link spliceMergedEffects}) so
//     the interpreter's checkpoint/resume cursor (ADR 0100) spans both halves.
//     An imperative `resolve()` body has no cursor to extend and would re-run
//     from the top on a resume.
//  2. **The SPLICED CARD must be an Effect Script with no targets.**
//     CR 702.47b — "You can't choose to use a splice ability if you can't make
//     the required choices (targets, etc.) for that card's rules text" — and
//     CR 702.47d puts those choices at CR 601.2c, i.e. in the main spell's own
//     announcement. The cast flow announces ONE `targetRequirement`, the
//     spell's; there is no heterogeneous multi-requirement slot list to append
//     the spliced card's to, so a targeting splice card (Glacial Ray) is not
//     offered rather than offered and silently untargeted.
//
// CR 702.47e ("the spell loses any splice changes once it leaves the stack") is
// free: the merge is derived per resolution from `StackItem.splicedCardIds`,
// which leaves the stack with the item.
import type { CardDefinition, EffectOp, KickerCost } from "../cards/types";
import { tryGetDefinition } from "../cards/registry";
import type { CardInstanceState, PlayerState } from "./state";

/** Prefix of the synthesized {@link KickerCost.id} of a splice option. The id
 *  carries the revealed hand card's INSTANCE id, not its printed card id: CR
 *  702.47b ("You can't splice any one card onto the same spell more than
 *  once") is about the physical card, so two copies of the same splice card in
 *  hand are two independently payable options — and `:` cannot collide with a
 *  declared `KickerCost.id`, which is a hand-authored slug. */
export const SPLICE_COST_ID_PREFIX = "splice:";

/** The synthesized cost-entry id for revealing `handCardInstanceId`. */
export function spliceCostId(handCardInstanceId: string): string {
    return `${SPLICE_COST_ID_PREFIX}${handCardInstanceId}`;
}

/** The hand card instance a splice cost-entry id names, or undefined when
 *  `costId` is an ordinary declared cost entry. */
export function splicedInstanceIdOf(costId: string): string | undefined {
    return costId.startsWith(SPLICE_COST_ID_PREFIX)
        ? costId.slice(SPLICE_COST_ID_PREFIX.length)
        : undefined;
}

/** CR 702.47c — is `def` a spell whose text a splice can be ADDED to? See
 *  exclusion 1 in the file header: the merge is one op list, so the main
 *  spell's body must be an Effect Script and not a modal card (whose chosen
 *  mode is dispatched instead of the card-level body). */
export function spliceAcceptsSpell(def: CardDefinition): boolean {
    return (
        def.effects !== undefined &&
        def.effects.length > 0 &&
        (def.modes === undefined || def.modes.length === 0) &&
        def.resolve === undefined &&
        def.resolveSteps === undefined &&
        def.effect === undefined
    );
}

/** CR 702.47a/b — is `def` a card that can be REVEALED to splice its text on?
 *  See exclusion 2 in the file header. A card declaring `splice` that fails
 *  this is a mis-declared card, not an unpayable cost, so the catalogue guard
 *  rejects it outright rather than leaving it silently unofferable. */
export function spliceCardIsSupported(def: CardDefinition): boolean {
    return (
        def.splice !== undefined &&
        def.effects !== undefined &&
        def.effects.length > 0 &&
        def.targetRequirement === undefined &&
        def.modes === undefined &&
        def.resolve === undefined &&
        def.resolveSteps === undefined &&
        def.effect === undefined
    );
}

/** CR 702.47a — one splice option: the hand card that would be revealed and
 *  the cost entry the caster pays to reveal it. */
export type SpliceOption = {
    /** The revealed card's instance id, in the caster's hand. It STAYS there —
     *  CR 702.47c: a spliced card is never cast and never leaves the hand. */
    handCardInstanceId: string;
    /** The synthesized entry, keyword-tagged `"splice"`, that rides the
     *  ordinary additional-cost path. */
    entry: KickerCost;
};

/** CR 702.47a — every splice option `hand` offers for a spell with `subtypes`
 *  being cast from `castInstanceId`.
 *
 *  Subtype-gated: "Splice onto Arcane" reveals only as an ARCANE spell is cast,
 *  so a card whose `splice.subtype` the spell does not have is not an option at
 *  all. The cast card itself is excluded — it is on its way to the stack, not
 *  in hand (CR 601.2a), and a card can never splice onto itself.
 *
 *  Ordered by hand position, which is what makes the resulting option list, the
 *  synthesized ids and therefore the merged script DETERMINISTIC for one board:
 *  the Bot's sandbox and the live mutation enumerate the same options in the
 *  same order. */
export function enumerateSpliceOptions(
    hand: readonly CardInstanceState[],
    spellSubtypes: readonly string[],
    castInstanceId: string
): SpliceOption[] {
    const options: SpliceOption[] = [];
    for (const card of hand) {
        if (card.id === castInstanceId) continue;
        const cardId = (card.card as { id?: string } | undefined)?.id;
        if (!cardId) continue;
        const def = tryGetDefinition(cardId);
        if (!def?.splice) continue;
        if (!spellSubtypes.includes(def.splice.subtype)) continue;
        if (!spliceCardIsSupported(def)) continue;
        options.push({
            handCardInstanceId: card.id,
            entry: {
                ...def.splice.cost,
                id: spliceCostId(card.id),
                splicedCardId: cardId,
                description: `${def.name} — ${def.splice.description}`,
                keyword: "splice",
            },
        });
    }
    return options;
}

/** THE SEAM (see the file header). `def` with every splice option the caster's
 *  hand offers for this cast appended to its `kickers[]`, or `def` itself when
 *  there are none — so the augmentation is free on the 99.9% of casts that have
 *  no splice option, and identity-stable for them (`===`), which is what lets
 *  a cast site call this unconditionally.
 *
 *  Every cast site that validates, prices, pays, offers or enumerates an
 *  additional cost calls this at its `getDefinition` lookup rather than at each
 *  of the nine downstream kicker calls: augmenting the DEFINITION once means a
 *  tenth kicker call added later is spliced-aware by construction, while
 *  augmenting the calls would leave it silently splice-blind (the same
 *  reasoning ADR 0085 § Decision 2 applies to the payment record's write). */
export function spliceAugmentedDefinition<
    T extends CardDefinition | undefined | null,
>(def: T, player: PlayerState, castInstanceId: string): T {
    if (!def || !spliceAcceptsSpell(def)) return def;
    const options = enumerateSpliceOptions(
        player.hand,
        def.subtypes ?? [],
        castInstanceId
    );
    if (options.length === 0) return def;
    return {
        ...def,
        kickers: [...(def.kickers ?? []), ...options.map((o) => o.entry)],
    } as T;
}

/** CR 702.47c — the PRINTED card ids whose rules text a cast's PAID cost
 *  entries added to the spell, in the order that text will run. Snapshotted
 *  onto `StackItem.splicedCardIds` at cast commit by
 *  {@link additionalCostPaymentSnapshot}, which passes it the entries it just
 *  resolved from the payment record.
 *
 *  **Why the printed id, resolved from the ENTRY.** CR 702.47c makes the reveal
 *  a text-changing effect on the SPELL, applied as the spell is cast — it does
 *  not depend on the revealed card afterwards. CR 702.47a's own example is the
 *  proof: "It can even be discarded to pay a 'discard a card' cost of the spell
 *  it's spliced onto." So at cast commit the revealed instance may already be in
 *  a graveyard, and a lookup by hand position would silently drop text the spell
 *  had already gained. The synthesized entry carries the printed id from the
 *  announcement that offered it, so nothing has to be found again.
 *
 *  ORDER. CR 702.47b gives the caster the order when several cards are spliced
 *  onto one spell ("reveal them all at once and choose the order in which their
 *  effects will happen"), and this takes the entry-id sort instead — which is
 *  the hand-position order {@link enumerateSpliceOptions} assigned, since splice
 *  ids differ only by instance id. That stands in for the caster's choice
 *  because the announcement collects no order today: with the shipped catalogue
 *  the only reachable multi-splice cast is several copies of ONE card (a splice
 *  card cannot be revealed twice, CR 702.47b), whose texts are identical and
 *  whose order is therefore unobservable. A second splice card makes the order
 *  observable and owes an announcement input for it. */
export function splicedCardIdsOfEntries(
    entries: readonly KickerCost[]
): string[] | undefined {
    const spliced = entries
        .filter((e) => e.splicedCardId !== undefined)
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((e) => e.splicedCardId as string);
    return spliced.length > 0 ? spliced : undefined;
}

/** CR 702.47b/c — the op list a spliced spell resolves as: the main spell's own
 *  script first ("The effects of the main spell must happen first"), then each
 *  revealed card's script in `StackItem.splicedCardIds` order. Undefined when
 *  nothing was spliced, so the caller keeps the ordinary `getResolveFn(def)`
 *  dispatch.
 *
 *  ONE flat list, not one run per card, because the interpreter's resume cursor
 *  (ADR 0100) is a position into a single op list: a spliced script that parks
 *  on a choice resumes at the right op only if the merged list is the list it
 *  parked in. The merge is recomputed from the persisted record on every
 *  resolution attempt, so it is identical across a suspend/resume pair.
 *
 *  BINDINGS are shared across the halves and that is safe by ORDER, not by
 *  luck: every op of the main spell precedes every spliced op, so a name the
 *  spliced text rebinds (`$picked`) can never be read by a main-spell op that
 *  has already run. Nothing interleaves.
 *
 *  CR 702.47c — the merged ops run with the MAIN spell's `SpellContext`, which
 *  is exactly the rule: "Text gained by the spell that refers to a card by name
 *  refers to the spell on the stack, not the card from which the text was
 *  copied", and the spell keeps its own controller, colour and characteristics.
 *  A revealed card whose definition has since disappeared from the catalogue
 *  contributes nothing rather than throwing. */
export function spliceMergedEffects(
    def: CardDefinition,
    splicedCardIds: readonly string[] | undefined
): EffectOp[] | undefined {
    if (!splicedCardIds || splicedCardIds.length === 0) return undefined;
    const spliced: EffectOp[] = [];
    for (const cardId of splicedCardIds) {
        const splicedDef = tryGetDefinition(cardId);
        if (!splicedDef?.effects) continue;
        spliced.push(...splicedDef.effects);
    }
    if (spliced.length === 0) return undefined;
    return [...(def.effects ?? []), ...spliced];
}
