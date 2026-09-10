// CR 712.3 / 712.8a / 712.12 — the MODAL double-faced card, as its FRONT face
// plus a registered back TWIN (ADR 0122).
//
// CR 712.8a is what makes this the cheapest of the four multi-faced layouts,
// not the dearest: "while a double-faced card is outside the game or in a zone
// other than the battlefield or stack, it has only the characteristics of its
// front face." Nothing is combined (unlike CR 709.4's split card) and nothing
// is derived — so the flat `CardDefinition` IS the front face and it is right
// in every zone by construction. Deck legality, the Limited pool,
// `check:index`, the card-index lockfile, tutors, mill/discard and the Bot's
// valuation are untouched, not by a conditional at each reader (the shape that
// fails OPEN when forgotten — `.claude/rules/gre-development.md` § Frontend
// wiring analysis) but because the object those readers hold never has a
// second face to miss.
//
// What DOES need an object is the back face while it is face up on the
// battlefield (CR 712.8f — "while a modal double-faced permanent is on the
// battlefield, it has only the characteristics of the face that's up"). A
// modal back face is a whole card face — Soporific Springs carries an entry
// replacement AND a mana ability — so it is built into a real
// `CardDefinition` under `${parentId}#back` and registered in the
// id-resolvable registry (`registry.ts`), NOT in `catalogue.ts`'s enumerable
// `allCards`. Resolvable everywhere; invisible to every enumerator. That is
// ADR 0120 §2's twin mechanism, reused verbatim.
//
// It is deliberately NOT transform's `registerBackFaceDefinition`
// (`gre/transform.ts`), whose `tokenDefinitionId` ENCODES the face's spec into
// the id it returns: that codec carries a `TokenSpec`'s fields and nothing
// else, so an entry replacement (`entersTappedUnlessPay`, a `MayPayCost`)
// would be silently lost the first time a client rebuilt the face from its id.
// The twin needs no codec at all — client and server import THIS module.

import type {
    CardBackFace,
    CardBackFaceKind,
    CardDefinition,
    CardType,
} from "./types";
import { PERMANENT_TYPES } from "./types";
import { twinDefinitionId } from "./twinId";

/** The twin-id suffix a modal back face is registered under. One word, in the
 *  shared twin namespace (`cards/twinId.ts`) that an inset spell's
 *  `#adventure` and a split half's `#left` already live in — the vocabulary is
 *  shared because its CONSUMERS are (`tryGetPlaceableCardByName`, the scenario
 *  builder), and neither has any business asking which rule minted an id. */
export const MODAL_BACK_FACE_SUFFIX = "back";

/** Per-kind facts about a {@link CardBackFace}, keyed by the door CR 712.1
 *  says the face is reached through.
 *
 *  A `Record<CardBackFaceKind, …>` rather than a pair of predicates, for
 *  ADR 0120 §1's reason and ADR 0122 §1's restatement of it: a third kind
 *  cannot be added to the union without answering, here, how the face is
 *  REGISTERED — and a `kind === "modal"` literal scattered across the
 *  registration sites is exactly the drift this table exists to prevent. */
export const CARD_BACK_FACE_KINDS: Record<
    CardBackFaceKind,
    {
        /** How the face becomes a resolvable `CardDefinition`.
         *
         *  `"token-codec"` — CR 712.2's transform face, synthesized on demand
         *  by `registerBackFaceDefinition` (`gre/transform.ts`) under a
         *  content-derived `tokenDefinitionId`, so a client decodes it from
         *  the id alone with no registration call. Bounded by what a
         *  `TokenSpec` can carry.
         *
         *  `"twin"` — CR 712.3's modal face, a module-registered twin under
         *  `${parentId}#back` (ADR 0120 §2). Unbounded by the codec, and the
         *  only registration that can carry a face's entry replacement. */
        registration: "token-codec" | "twin";
        /** CR 712.19 — whether the face's name joins the card's name-choice
         *  domain. True for both kinds: "the player may choose the name of
         *  either face of a double-faced card but not both", which 712.2's
         *  transform face satisfies as squarely as 712.3's modal one. Named
         *  rather than assumed so a kind added later has to answer it. */
        contributesChooseableName: boolean;
    }
> = {
    nonmodal: { registration: "token-codec", contributesChooseableName: true },
    modal: { registration: "twin", contributesChooseableName: true },
};

/** CR 712.1 — the kind of `backFace`, with the documented default: absent
 *  means `"nonmodal"`, which is what every card carrying the field meant
 *  before the modal kind existed. */
export function backFaceKind(backFace: CardBackFace): CardBackFaceKind {
    return backFace.kind ?? "nonmodal";
}

/** CR 712.3 — `true` when `def` is a MODAL double-faced card.
 *
 *  THE predicate every surface asks, rather than each site testing
 *  `def.backFace?.kind === "modal"`: the question has consequences at the land
 *  play (712.12), at the put-onto-battlefield chokepoint (712.14b), at the
 *  name-choice seam (712.19) and in the compiler, and one named predicate is
 *  what keeps those four agreeing. */
export function isModalDoubleFaced(def: CardDefinition | undefined): boolean {
    return (
        def?.backFace !== undefined && backFaceKind(def.backFace) === "modal"
    );
}

/** The registry id of `parentId`'s modal back face. Derived, stable, and the
 *  ONLY shape this engine mints — `parentIdOfTwin` (`cards/twinId.ts`) is its
 *  inverse. */
export function modalBackFaceDefinitionId(parentId: string): string {
    return twinDefinitionId(parentId, MODAL_BACK_FACE_SUFFIX);
}

/** CR 712.8f — the twin `CardDefinition` for `parent`'s modal back face, or
 *  `undefined` when the card has no modal back face.
 *
 *  Pure and cheap: `preloadDefinitions` calls it once per catalogue card at
 *  hydration, and nothing calls it on a hot path — every later reader resolves
 *  the twin through `tryGetDefinition` like any other card.
 *
 *  What the twin does NOT inherit is as load-bearing as what it does. "While a
 *  modal double-faced permanent is on the battlefield, it has only the
 *  characteristics of the face that's up", so the parent's cost, types,
 *  keywords, statics, triggers, P/T and effects are all absent by
 *  construction: the twin is built from the back-face record alone. A modal
 *  back face has no mana cost of its own (CR 712.8f leaves the front's cost
 *  behind with the front's other characteristics, and no printed modal back
 *  face carries one), so none is derived.
 *
 *  It carries the parent's `rarity` because rarity is a property of the
 *  PRINTING (CR 206.1), and one modal double-faced card is one printing. Art
 *  is that same printing's BACK face: a real double-faced Scryfall print
 *  serves both faces under one id, each on its own `front/`/`back/` CDN path,
 *  which is what `imagePrintFace: "back"` selects (issue #1595). The
 *  `?? parent.id` fallback is load-bearing for the same reason it is on the
 *  inset and split twins: a hand-written card's `id` IS its home printing's
 *  Scryfall id and almost none declare `imagePrintId`, so without it the
 *  twin's own `#`-bearing id would reach the Scryfall URL builder and truncate
 *  at the fragment delimiter into a 404 (issue #3321). */
export function modalBackTwinDefinition(
    parent: CardDefinition
): CardDefinition | undefined {
    const back = parent.backFace;
    if (!back || backFaceKind(back) !== "modal") return undefined;
    return {
        id: modalBackFaceDefinitionId(parent.id),
        name: back.name,
        rarity: parent.rarity,
        types: [...back.types],
        ...(back.subtypes ? { subtypes: [...back.subtypes] } : {}),
        ...(back.supertypes ? { supertypes: [...back.supertypes] } : {}),
        ...(back.power !== undefined ? { power: back.power } : {}),
        ...(back.toughness !== undefined ? { toughness: back.toughness } : {}),
        ...(back.loyalty !== undefined ? { loyalty: back.loyalty } : {}),
        ...(back.colors ? { colors: [...back.colors] } : {}),
        ...(back.staticAbilities
            ? { staticAbilities: [...back.staticAbilities] }
            : {}),
        ...(back.activatedAbilities
            ? { activatedAbilities: back.activatedAbilities }
            : {}),
        ...(back.entersTappedUnlessPay
            ? { entersTappedUnlessPay: back.entersTappedUnlessPay }
            : {}),
        ...(back.oracleText ? { oracleText: back.oracleText } : {}),
        imagePrintId: back.imagePrintId ?? parent.imagePrintId ?? parent.id,
        imagePrintFace: "back",
    };
}

/** CR 712.19 — the modal back face's contribution to the name-choice domain
 *  ("the player may choose the name of either face of a double-faced card but
 *  not both"), or `undefined` for a card with no such face.
 *
 *  The card's OWN name is its front face's (CR 712.8a), which is `def.name`
 *  and needs nothing here — this adds the second entry, and the caller
 *  (`chooseableNamesOf`, `cards/cardNames.ts`) is the single seam every
 *  name-choice consumer reads. */
export function chooseableModalBackName(
    def: CardDefinition
): string | undefined {
    const back = def.backFace;
    if (!back) return undefined;
    return CARD_BACK_FACE_KINDS[backFaceKind(back)].contributesChooseableName &&
        isModalDoubleFaced(def)
        ? back.name
        : undefined;
}

/** CR 712.12 — the faces of a modal double-faced card, in the order a face
 *  picker should show them: front first, as printed. */
export const PLAY_LAND_FACES = ["front", "back"] as const;

/** Which FACE of a card a `play-land` action puts onto the battlefield
 *  (CR 712.12 — "chooses one of its faces that's a land before putting it onto
 *  the battlefield. It enters the battlefield with that face up").
 *
 *  Absent on a Move / mutation argument means `"front"`, which is what every
 *  land play meant before modal cards existed — an ordinary Forest is played
 *  as its only face and carries no marker. */
export type PlayLandFace = (typeof PLAY_LAND_FACES)[number];

/** CR 712.14b — `true` when `def`'s FRONT face is a permanent card.
 *
 *  "If a player is instructed to put a modal double-faced card onto the
 *  battlefield and its front face isn't a permanent card, the card stays in
 *  its current zone." Read at the shared put-onto-battlefield chokepoint
 *  (`stageReanimatedOnBattlefield`, `gre/state.ts`); Sink into Stupor's front
 *  face is an instant, so the clause has a live subject on day one.
 *
 *  Asked of the DEFINITION, never of the instance's `types`: 712.8a means a
 *  modal card outside the battlefield and the stack has only its front face's
 *  characteristics, so the instance in a graveyard or a library already
 *  reports them — but a continuous effect that added a type to the card there
 *  (Song of the Dryads on a card is not a thing; a type-adding effect on a
 *  nonpermanent card in a graveyard is) must not turn "its front face isn't a
 *  permanent card" into "it is now". The rule speaks about the printed face. */
export function modalFrontFaceIsPermanentCard(def: CardDefinition): boolean {
    return def.types.some((t: CardType) =>
        (PERMANENT_TYPES as readonly CardType[]).includes(t)
    );
}
