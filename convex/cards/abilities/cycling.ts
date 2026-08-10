// `cyclingAbility` / `typecyclingAbility` — declarative templates for Cycling
// (CR 702.29) and its Typecycling variant (CR 702.29e/f), the keyword ability
// that lets a card be discarded from hand for a fresh resource.
//
// CR 702.29a: "Cycling [cost]" means "[cost], Discard this card: Draw a card."
//   This activated ability functions only while this card is in your hand.
// CR 702.29b: A card with cycling may be cycled any time its owner could cast
//   an instant — i.e. any time they have priority (instant speed).
// CR 702.29e: "Typecycling is a variant of the cycling ability. '[Type]cycling
//   [cost]' means '[Cost], Discard this card: Search your library for a [type]
//   card, reveal it, and put it into your hand. Then shuffle your library.'"
// CR 702.29f: "Typecycling abilities ARE cycling abilities, and typecycling
//   costs are cycling costs. […] Any effect that looks for a card with cycling
//   will find a card with typecycling."
//
// 702.29f is the reason `cyclingActivationShell` below exists and is SHARED
// rather than copied: typecycling is a variant of cycling, not a sibling of
// it. Everything that makes an ability "a cycling ability" — the
// discard-this cost, the from-hand permission, the instant-speed stack use,
// and the default ability id — lives in that one function, so a future
// cycling-cost / cycling-detection signal is declared ONCE and both variants
// carry it structurally. The two public factories differ only in their
// printed reminder text and their Effect Script body.
//
// Cycling is engine/cost-system infrastructure, NOT an Effect Script Op: only
// the ability's CAST-from-hand permission and discard-this cost are special;
// both bodies ("Draw a card" / "Search your library…") are plain Ops. The
// special part rides two engine seams added for this keyword:
//   - `ActivatedAbility.activateFromHand` (twin of `activateFromGraveyard`) —
//     `activateAbility` locates the source in the owner's hand and gates on
//     this flag + ownership.
//   - `ActivatedAbility.cost.discardThis` — the source is discarded from hand
//     as the ability goes on the stack, routed through `discardToGraveyard`
//     (CR 701.8) so "whenever you discard" triggers fire (Marauding Mako).
//
// The Mechanics Registry (`convex/cards/mechanicsRegistry.ts`) is the name
// authority: Cycling is row `id: "cycling"`, Typecycling row `id:
// "typecycling"` (CR 702.29e/f).

import type {
    ActivatedAbility,
    EffectOp,
    GameEvent,
    ManaCost,
    SpellContext,
    TargetRequirement,
    TriggeredAbility,
} from "../types";

/** The default ability id shared by BOTH factories. CR 702.29f — a
 *  typecycling ability IS a cycling ability, so anything that ever comes to
 *  identify a cycling ability by its id finds the typecycling one too. A card
 *  never prints two cycling abilities, so the id stays unique per card. */
const CYCLING_ABILITY_ID = "cycling";

/** Renders a generic-only cycling cost as its `{N}` reminder-text label. Every
 *  card in this batch has a purely-generic cycling cost ({1}/{2}/{3}); a
 *  coloured cost would need a fuller mana-symbol renderer, which the callers
 *  don't need yet. */
function cyclingCostLabel(cost: ManaCost): string {
    const generic = cost.generic ?? 0;
    return `{${generic}}`;
}

/** The activation shell every cycling ability shares (CR 702.29a + 702.29f).
 *  The single place the "this is a cycling ability" facts are declared:
 *  the cycling mana cost + discard-this cost, the hand-only permission, and
 *  the stack use. Callers supply only what the printed variant changes — the
 *  reminder text and the Effect Script body. */
function cyclingActivationShell(args: {
    id: string;
    cost: ManaCost;
    oracleText: string;
    effects: EffectOp[];
}): ActivatedAbility {
    return {
        id: args.id,
        oracleText: args.oracleText,
        // CR 702.29a / 702.29f — the cost is the printed cycling mana cost
        // plus discarding this card (a cycling cost, for both variants).
        // `discardThis` moves the source hand → graveyard at commit;
        // `cyclingCost` is the declared signal that the discard pays an
        // activation cost of a CYCLING ability (CR 702.29c), which the discard
        // choke point threads onto the single CARD_DISCARDED event as
        // `cause: "cycling"`. Declared HERE, once, so 702.29f
        // ("typecycling costs are cycling costs") holds structurally: neither
        // public factory can forget it, and nothing downstream has to sniff an
        // ability id or oracle text to recognise a cycling cost.
        cost: { mana: args.cost, discardThis: true, cyclingCost: true },
        // CR 702.29a — the ability functions only while the card is in hand.
        activateFromHand: true,
        // CR 605 — this is NOT a mana ability; it uses the stack (can be
        // responded to) and its effect is a one-shot.
        useStack: true,
        effects: args.effects,
    };
}

/** Builds the Cycling activated ability (CR 702.29a) for a card whose printed
 *  cycling cost is `cost` (a mana cost). Add the returned ability to the card's
 *  `activatedAbilities`. The ability is usable only from hand
 *  (`activateFromHand`), pays `cost` + discards the source (`discardThis`), and
 *  resolves by drawing a card. Instant speed by default (CR 702.29b). */
export function cyclingAbility(
    cost: ManaCost,
    id = CYCLING_ABILITY_ID
): ActivatedAbility {
    const label = cyclingCostLabel(cost);
    return cyclingActivationShell({
        id,
        cost,
        oracleText: `Cycling ${label} (${label}, Discard this card: Draw a card.)`,
        // CR 702.29a — "Draw a card." Authored as a plain Effect Script Op; the
        // cost (mana + discard-this) is the only cycling-specific part.
        effects: [{ op: "draw", player: "controller", count: 1 }],
    });
}

/** Builds a "When you cycle this card, …" triggered ability (CR 702.29c).
 *
 *  CR 702.29c: "Some cards with cycling have abilities that trigger when
 *  they're cycled. 'When you cycle this card' means 'When you discard this card
 *  to pay an activation cost of a cycling ability.' These abilities trigger
 *  from whatever zone the card winds up in after it's cycled."
 *
 *  The template, so no author has to restate it:
 *   - it listens to `CARD_DISCARDED`, the ONE event a cycling discard emits
 *     (CR 702.29d — a "cycles or discards" ability must fire exactly once on a
 *     cycled card, which a second `CARD_CYCLED` event would break);
 *   - `matches` gates on `cause === "cycling"`, the signal
 *     `cyclingActivationShell` declares and the discard choke point threads —
 *     so an ordinary discard of the same card (rummage, CR 514.1 cleanup
 *     hand-size, a non-cycling discard cost) does NOT fire it, while a
 *     TYPEcycling discard does (CR 702.29f);
 *   - it gates on `cardInstanceId === self.id`, because "THIS card" is the
 *     cycled card itself, never another card cycled the same turn;
 *   - it carries `functionsFromOwnDiscard`, which is what makes
 *     `collectTriggers` look for the source in the zone it wound up in
 *     (graveyard, or exile after a CR 614 redirect) instead of on the
 *     battlefield.
 *
 *  Author supplies only the body — an Effect Script (`effects`, the ADR 0045
 *  default) or, for a protocol-like effect that must read the firing event,
 *  `resolve`. */
export function cycledTrigger(args: {
    id: string;
    oracleText: string;
    effects?: EffectOp[];
    resolve?: (ctx: SpellContext, event: GameEvent) => void;
    targetRequirement?: TargetRequirement;
}): TriggeredAbility {
    return {
        id: args.id,
        oracleText: args.oracleText,
        event: "CARD_DISCARDED",
        // CR 702.29c — collected from wherever the cycled card landed.
        functionsFromOwnDiscard: true,
        ...(args.targetRequirement
            ? { targetRequirement: args.targetRequirement }
            : {}),
        matches: (event, self) =>
            event.type === "CARD_DISCARDED" &&
            // CR 702.29c/702.29f — "discarded to pay an activation cost of a
            // cycling ability", typecycling included.
            event.cause === "cycling" &&
            // CR 702.29c — "this card", the cycled one.
            event.cardInstanceId === self.id,
        ...(args.effects ? { effects: args.effects } : {}),
        ...(args.resolve ? { resolve: args.resolve } : {}),
    };
}

/** "a" / "an" for a subtype word, so the printed reminder text reads
 *  "an Island card" but "a Mountain card" (CR 702.29e's template renders the
 *  English article, not a placeholder). */
function indefiniteArticle(word: string): string {
    return /^[aeiou]/i.test(word) ? "an" : "a";
}

/** Builds a Typecycling activated ability (CR 702.29e) — "[Type]cycling
 *  [cost]" — for a card whose printed typecycling cost is `cost` and whose
 *  searched-for type is the SUBTYPE `subtype` ("Mountain", "Island", …).
 *
 *  CR 702.29e: "[Cost], Discard this card: Search your library for a [type]
 *  card, reveal it, and put it into your hand. Then shuffle your library."
 *  The body is exactly that sequence as an Effect Script — the canonical
 *  tutor-to-hand composition (`choice`/search-library → `reveal` → `moveZone`
 *  → `libraryLook` shuffle), with `count: { min: 0, max: 1 }` because a
 *  player may always fail to find (CR 701.19c) and the library is still
 *  looked at and shuffled when nothing matches (CR 401.4 / 701.19a).
 *
 *  SCOPE (CR 702.29e): this factory covers the "usually a subtype" case — a
 *  single subtype word, which is every printed typecycling card in the pool
 *  (basic land types, plus the likes of "slivercycling"). The rule's
 *  card-type / supertype / combination forms ("basic landcycling") are NOT
 *  built: they would need a multi-clause `EffectCardFilter` and a different
 *  reminder-text renderer, and no card in the catalogue prints one. */
export function typecyclingAbility(
    cost: ManaCost,
    subtype: string,
    id = CYCLING_ABILITY_ID
): ActivatedAbility {
    const label = cyclingCostLabel(cost);
    const keyword = `${subtype[0].toUpperCase()}${subtype.slice(1).toLowerCase()}cycling`;
    const article = indefiniteArticle(subtype);
    const reminder = `${label}, Discard this card: Search your library for ${article} ${subtype} card, reveal it, put it into your hand, then shuffle.`;
    return cyclingActivationShell({
        id,
        cost,
        oracleText: `${keyword} ${label} (${reminder})`,
        effects: [
            // CR 701.19a / 401.4 — a genuine library search: the whole library
            // is looked at, so the choice is raised even with no legal hit.
            {
                op: "choice",
                kind: "search-library",
                player: "controller",
                zone: "library",
                filter: { subtype },
                // CR 701.19c — "search" never compels a find.
                count: { min: 0, max: 1 },
                prompt: `Search your library for ${article} ${subtype} card (or none).`,
                bind: "$typecycled",
            },
            // CR 702.29e — "reveal it, and put it into your hand."
            {
                op: "reveal",
                player: "controller",
                cards: { ref: "$typecycled" },
            },
            {
                op: "moveZone",
                cards: { ref: "$typecycled" },
                player: "controller",
                from: "library",
                to: "hand",
            },
            // CR 702.29e — "Then shuffle your library." (CR 701.20)
            { op: "libraryLook", action: "shuffle", player: "controller" },
        ],
    });
}
