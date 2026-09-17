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
import { getAllCards } from "../cards/catalogue";
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
        def.effect === undefined &&
        // CR 702.47c gives the spell "the rules text of EACH of the spliced
        // cards" — all of it. {@link spliceMergedEffects} contributes only
        // `effects`, so a splice card that also prints a triggered, static or
        // activated ability (or a card-level delayed trigger) would be offered,
        // paid for, and then deliver the `effects` half alone. Silence for the
        // rest is the "ships as a dead keyword" failure this predicate exists
        // to make loud, so the whole card has to be one Effect Script.
        (def.triggeredAbilities?.length ?? 0) === 0 &&
        (def.staticAbilities?.length ?? 0) === 0 &&
        (def.activatedAbilities?.length ?? 0) === 0 &&
        (def.staticEffects?.length ?? 0) === 0 &&
        (def.delayedTriggers?.length ?? 0) === 0
    );
}

/** CR 702.47a — every subtype some shipped card's splice ability is gated on
 *  ("Arcane"), computed once and memoized.
 *
 *  It exists to keep {@link spliceAugmentedDefinition} O(1) on a board with no
 *  splice in it. That seam runs once per castable card inside
 *  `enumerateCastMoves`, i.e. at every ISMCTS node, and without a gate each of
 *  those would walk the whole hand looking up a definition per slot — quadratic
 *  in the hand, on every node, for a mechanic almost no board has. A catalogue
 *  scan is safe to memoize: `getAllCards()` is the static card list, and the
 *  only mutation the registry accepts at runtime is `registerTokenDefinition`,
 *  which no splice card can arrive through. */
let SPLICED_ONTO_SUBTYPES: Set<string> | undefined;
export function splicedOntoSubtypes(): ReadonlySet<string> {
    if (!SPLICED_ONTO_SUBTYPES) {
        SPLICED_ONTO_SUBTYPES = new Set(
            getAllCards()
                .map((c) => c.splice?.subtype)
                .filter((t): t is string => t !== undefined)
        );
    }
    return SPLICED_ONTO_SUBTYPES;
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
 *  Ordered by hand position, which is what makes the resulting option list and
 *  the synthesized ids DETERMINISTIC for one board: the Bot's sandbox and the
 *  live mutation enumerate the same options in the same order.
 *
 *  `hand` is typed for the SERVER's hand but is also handed the client's
 *  wire-projected one (`affordableKickersForCard`, `src/lib/card-utils.ts`),
 *  whose slots are `CardInstance | null` — the viewer's own hand nulls a
 *  placeholder slot (`projectPublicState`, issue #3452). A null slot is skipped
 *  rather than dereferenced: a hidden-hand board must not throw the cast dialog
 *  away. */
export function enumerateSpliceOptions(
    hand: readonly (CardInstanceState | null | undefined)[],
    spellSubtypes: readonly string[],
    castInstanceId: string
): SpliceOption[] {
    const options: SpliceOption[] = [];
    for (const card of hand) {
        if (!card || card.id === castInstanceId) continue;
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
    // The subtype gate FIRST, off a catalogue-wide set, so the hand walk below
    // runs only for a spell some shipped splice card could ever be revealed
    // onto. This seam is called once per castable card inside
    // `enumerateCastMoves`, i.e. at every ISMCTS node: without this, every cast
    // of every card would pay a `tryGetDefinition` per hand slot, quadratic in
    // the hand for a mechanic almost no board has.
    if (!(def.subtypes ?? []).some((s) => splicedOntoSubtypes().has(s))) {
        return def;
    }
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
 *  ORDER is ARBITRARY, and deliberately so until an announcement input exists.
 *  CR 702.47b gives the caster the order when several cards are spliced onto one
 *  spell ("reveal them all at once and choose the order in which their effects
 *  will happen"), and the announcement collects no order today. What this sorts
 *  by is the entry id — which is NOT hand position: instance ids are decimal
 *  strings, so `localeCompare` puts `splice:10` before `splice:9`. All the sort
 *  buys is DETERMINISM, which the merge does need (the script is rebuilt on
 *  every resolution attempt and must be the one the resume cursor parked in).
 *  It is not the caster's choice, and it is unobservable only because the single
 *  reachable multi-splice cast in the shipped catalogue is several copies of ONE
 *  card (a card cannot be revealed twice, CR 702.47b) whose texts are identical.
 *  A second splice card makes the order observable and owes that input. */
export function splicedCardIdsOfEntries(
    entries: readonly KickerCost[]
): string[] | undefined {
    const spliced = entries
        .filter((e) => e.splicedCardId !== undefined)
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((e) => e.splicedCardId as string);
    return spliced.length > 0 ? spliced : undefined;
}

/** Every field an Effect Script DECLARES a binding through (`validate.ts`'s
 *  `declared` map is written from exactly these). Read by
 *  {@link spliceSegmentBindings} to find the names one spliced segment owns. */
const BINDING_DECLARATION_FIELDS = [
    "bind",
    "bindOther",
    "bindSource",
    "bindAll",
    "resultBind",
    "chosenBind",
    "otherBind",
] as const;

/** The binding names `node` declares, anywhere in its op tree. */
function spliceSegmentBindings(node: unknown, out: Set<string>): void {
    if (Array.isArray(node)) {
        for (const child of node) spliceSegmentBindings(child, out);
        return;
    }
    if (!node || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node)) {
        if (
            typeof value === "string" &&
            value.startsWith("$") &&
            (BINDING_DECLARATION_FIELDS as readonly string[]).includes(key)
        ) {
            out.add(value);
        }
        spliceSegmentBindings(value, out);
    }
}

/** `node` with every reference to a name in `rename` rewritten, structurally.
 *
 *  A binding is referred to as a plain STRING everywhere it appears — the
 *  declaration (`bind: "$x"`), the whole-object ref (`{ ref: "$x" }`) and the
 *  property ref (`{ ref: "$x.power" }`) — so one deep string rewrite covers
 *  every grammar position, present and future, without this module having to
 *  know the shape of any Op. Only the part before the first `.` is matched, and
 *  only names the segment itself declared: `$source`, `$host`, `$each` and
 *  `$event` are engine-provided, never declared, and so never rewritten.
 *  Object KEYS are left alone — a `delayedTrigger`'s `capture` keys name a
 *  payload local to that trigger instance, not a script binding. */
function spliceRenameBindings<T>(
    node: T,
    rename: ReadonlyMap<string, string>
): T {
    if (Array.isArray(node)) {
        return node.map((child) =>
            spliceRenameBindings(child, rename)
        ) as unknown as T;
    }
    if (typeof node === "string") {
        if (!node.startsWith("$")) return node;
        const dot = node.indexOf(".");
        const base = dot === -1 ? node : node.slice(0, dot);
        const renamed = rename.get(base);
        if (renamed === undefined) return node;
        return (dot === -1
            ? renamed
            : renamed + node.slice(dot)) as unknown as T;
    }
    if (!node || typeof node !== "object") return node;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
        out[key] = spliceRenameBindings(value, rename);
    }
    return out as T;
}

/** The prefix each spliced segment's binding names are rewritten under.
 *
 *  Alphanumeric after the `$`, because that is the whole binding-name grammar
 *  (`isBindingName`, `gre/effects/validate.ts`: `^\$[A-Za-z][A-Za-z0-9]*$`) —
 *  a separator character would make every rewritten name fail validation, which
 *  is exactly what the catalogue guard over the merged script caught. Collision
 *  with a name a card actually declares is possible in principle and caught in
 *  practice by that same guard, which validates the merge of every splice card
 *  onto every spliced-onto spell and reds on a duplicate binding. */
export function spliceSegmentBindingPrefix(segment: number): string {
    return `$splice${segment}`;
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
 *  BINDINGS are RENAMED per spliced segment, and order does not substitute for
 *  it. A binding is not an in-memory variable: `readBinding` goes through
 *  `SpellContext.recallChoice`, which scans the persisted `collectedChoices`
 *  keys (`${pos}:${name}`) and returns the FIRST whose name matches — so the
 *  EARLIEST binding of a name shadows every later one for the rest of the
 *  resolution. Two copies of one splice card, or a splice card sharing a name
 *  with the spell it is revealed onto, would therefore have the second `$picked`
 *  silently read the first's snapshot: the caster is prompted twice, answers
 *  twice, and the second answer does nothing. `validateEffectScript` states the
 *  invariant this merge would otherwise break — "binding names must be unique
 *  within a script … the persisted store keys by name" — so each segment's own
 *  names are rewritten under {@link spliceSegmentBindingPrefix} before it joins
 *  the list, and the catalogue guard proves the merged script still validates.
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
    splicedCardIds.forEach((cardId, segment) => {
        const splicedDef = tryGetDefinition(cardId);
        if (!splicedDef?.effects) return;
        const declared = new Set<string>();
        spliceSegmentBindings(splicedDef.effects, declared);
        if (declared.size === 0) {
            spliced.push(...splicedDef.effects);
            return;
        }
        const prefix = spliceSegmentBindingPrefix(segment);
        const rename = new Map(
            [...declared].map((name) => [name, prefix + name.slice(1)])
        );
        spliced.push(
            ...spliceRenameBindings(splicedDef.effects as EffectOp[], rename)
        );
    });
    if (spliced.length === 0) return undefined;
    return [...(def.effects ?? []), ...spliced];
}
