// Protection keyword ability primitives (CR 702.16).
//
// Protection is stored on a card as `staticAbilities[]` entries of the form
// `"protection from <quality>"`. FOUR quality families are modelled here, all
// behind ONE parser (`parseProtectionQuality`) and ONE predicate
// (`isProtectedFrom`) so no consult site can honour a family the others drop:
//
//   1. COLOUR / colourless (CR 702.16a) — "protection from red", plus the
//      colourless variant "protection from colorless" (issue #684/#928 —
//      Giver of Runes; CR 105.2c: a source with no colours at all is
//      colourless). Read through CR 612.6 colour-word text changes (Sleight of
//      Mind).
//   2. PLAYER (CR 702.16k) — "protection from each of your opponents" (issue
//      #1748 — Figure of Fable), whose quality is resolved live against the
//      protected permanent's OWN controller, so a control-change effect moves
//      the protection with the permanent.
//   3. CHARACTERISTIC (CR 702.16a, issue #1120) — a NON-COLOUR quality naming
//      card types and/or supertypes: "protection from legendary creatures"
//      (Tsabo Tavoc), "protection from artifacts", "protection from
//      instants". CR 702.16a: "If the quality is a card type, subtype, or
//      supertype, the ability applies to sources that are permanents with
//      that card type, subtype, or supertype and to any sources not on the
//      battlefield that are of that card type, subtype, or supertype. This is
//      an exception to rule 109.2." — so the match reads the SOURCE OBJECT's
//      own live characteristics wherever it currently is (battlefield
//      permanent, spell on the stack, card in a graveyard), which is exactly
//      what `ProtectionSourceView` carries.
//   4. SPELL-RESTRICTED ANY-COLOUR (CR 702.16a, issue #2296) — "protection
//      from spells that are one or more colors". The ONLY family whose quality
//      is a CONJUNCTION of two independent dimensions: the source must BE a
//      spell (CR 112.1 — a card or copy on the stack; CR 113.3 — an activated
//      or triggered ability is never a spell, even when its source permanent
//      is coloured) AND have at least one colour (CR 105.2 — a colourless
//      spell passes straight through). Honouring only the colour half would
//      silently bar coloured permanents, coloured blockers and the abilities
//      of coloured permanents, which is why `ProtectionSourceView.isSpell` is
//      a REQUIRED boolean rather than an optional one: no consult site may
//      "forget" to say, and no default may answer for it.
//
// The parser is TOTAL and FAILS CLOSED: an ability string that starts with
// "protection from " but whose quality it cannot name returns `null` rather
// than a quality that matches everything (or nothing). A catalogue-wide guard
// (`convex/gre/__tests__/protectionQuality.test.ts`) fails CI when any shipped
// card declares or grants an unparseable protection string, so an
// unimplementable quality is a stop-and-open-an-issue case at authoring time
// instead of a silently inert keyword on the battlefield (the deathtouch /
// hexproof "shipped but dead" shape, issues #957/#958).
//
// NOT parseable today, deliberately: a SUBTYPE quality ("protection from
// Goblins") — this engine has no closed subtype vocabulary to fail closed
// against, and no catalogue card needs one; and permanent-scoped "protection
// from everything" (CR 702.16j) — the PLAYER-scoped variant The One Ring
// grants is separate (`playerHasProtectionFromEverything` below, CR 115.4).
// Both return `null` from the parser, so the catalogue guard turns either one
// into a CI failure the moment a card wants it.
//
// Consult sites — every DEBT clause of CR 702.16, server and client. The
// trailing column is the CR 112.1 `isSpell` each site states (issue #2296);
// EVERY site reaches the predicate, including the ones that can only ever
// answer "no" (a spell never blocks, so 702.16f is vacuous for the
// spell-restricted family — but the path runs and returns false rather than
// being skipped):
//   - can't be Targeted  (702.16b): rules.ts::getLegalTargets (offered set)
//     and game.ts::selectTarget (accepted set) — both via ONE projection,
//     rules.ts::protectionSourceFromTargeting, so they cannot disagree;
//     src/lib/targeting.ts::isUntargetableByPending (client click gate).
//     isSpell = the CR 113.3 cast/retarget-vs-ability/trigger fact.
//   - can't be Enchanted (702.16c): state.ts::isFullyLegalAuraHost — TRUE on
//     the CR 608.2b resolution path (the Aura is still a spell), FALSE on the
//     CR 303.4f put-onto-the-battlefield path; sba.ts::checkAuraAttachmentSBA
//     (CR 704.5m fall-off) — false, an attached Aura is a permanent.
//   - can't be Equipped  (702.16d): sba.ts::checkAttachmentSBA (CR 704.5n
//     unattach) — false, an Equipment is a permanent.
//   - Damage prevented   (702.16e): state.ts::dealDamage —
//     `isSpellStackItem(item)`, the resolving object may be either;
//     state.ts::markDamageFromPermanentSource and phases.ts::
//     applyAllCombatDamage — false, both sources are battlefield permanents.
//   - can't Block        (702.16f): combat.ts::validateBlockerEligibility —
//     false, a blocker is a permanent.

import type { CardInstanceState } from "./state";
import type { CardSupertype, CardType, Color } from "../cards/types";
import { STATIC_EFFECT_CTX } from "./layers";
import { hasSupertypeLive } from "../cards/snowReads";
import { applySubstitution } from "./textChanges";

const PROTECTION_PREFIX = "protection from ";

const PROTECTION_FROM_COLOR_REGEX =
    /^protection from (white|blue|black|red|green|colorless)$/;
const PROTECTION_COLOR_NAME_TO_CODE: Record<string, Color> = {
    white: "W",
    blue: "U",
    black: "B",
    red: "R",
    green: "G",
    colorless: "C",
};

/** CR 702.16k — the PLAYER-quality protection string. The quality is "each of
 *  your opponents", i.e. every player other than the protected permanent's own
 *  controller, re-derived live so a control-change effect moves the protection
 *  with the permanent (CR 109.4 / 702.16). Figure of Fable's final stage. */
export const PROTECTION_FROM_EACH_OPPONENT =
    "protection from each of your opponents";

/** CR 702.16a — the SPELL-RESTRICTED ANY-COLOUR protection string (issue
 *  #2296). Matched EXACTLY (after lowercasing/trimming) rather than by a
 *  loose "spells" + "colors" heuristic: the parser's whole contract is to
 *  fail closed on a phrase it cannot name, and a near-miss phrasing must
 *  reach the catalogue guard as an unparseable string, not be silently
 *  approximated by this one. */
export const PROTECTION_FROM_COLORED_SPELLS =
    "protection from spells that are one or more colors";

/** CR 205.4a — every supertype a protection quality can name. Iterated to read
 *  a source's LIVE supertypes (`hasSupertypeLive`, so a Melting / Arcum's
 *  Weathervane mutation is honoured), and used as the parser's supertype
 *  vocabulary. */
const PROTECTION_SUPERTYPES = [
    "Basic",
    "Legendary",
    "Ongoing",
    "Snow",
    "World",
] as const satisfies readonly CardSupertype[];

/** CR 205.2 — every card type a protection quality can name. */
const PROTECTION_CARD_TYPES = [
    "Artifact",
    "Battle",
    "Creature",
    "Enchantment",
    "Instant",
    "Kindred",
    "Land",
    "Planeswalker",
    "Sorcery",
] as const satisfies readonly CardType[];

/** English plural of a type word, for the "protection from legendary
 *  creatures" / "protection from sorceries" phrasing Oracle text uses. */
function pluralize(word: string): string {
    return word.endsWith("y") ? `${word.slice(0, -1)}ies` : `${word}s`;
}

const QUALITY_WORD_TO_CARD_TYPE = new Map<string, CardType>();
for (const type of PROTECTION_CARD_TYPES) {
    const lower = type.toLowerCase();
    QUALITY_WORD_TO_CARD_TYPE.set(lower, type);
    QUALITY_WORD_TO_CARD_TYPE.set(pluralize(lower), type);
}

const QUALITY_WORD_TO_SUPERTYPE = new Map<string, CardSupertype>();
for (const supertype of PROTECTION_SUPERTYPES) {
    // Supertypes read as adjectives in Oracle text ("legendary creatures"), so
    // only the singular form appears.
    QUALITY_WORD_TO_SUPERTYPE.set(supertype.toLowerCase(), supertype);
}

/** A parsed CR 702.16 quality. The union is the ONE place a quality family is
 *  named — every consult site reads it through `isProtectedFrom`, so a family
 *  can never be honoured at one site and dropped at another. */
export type ProtectionQuality =
    /** CR 702.16a — a colour, or `"C"` for colourless (CR 105.2c). */
    | { kind: "color"; color: Color }
    /** CR 702.16k — "each of your opponents", resolved live against the
     *  protected permanent's own controller. */
    | { kind: "each-opponent" }
    /** CR 702.16a — card types and/or supertypes. A source matches when it has
     *  ALL of them ("legendary creatures" = Legendary AND Creature). Never
     *  empty: an empty characteristic quality would match every source, so the
     *  parser rejects it. */
    | {
          kind: "characteristic";
          types: readonly CardType[];
          supertypes: readonly CardSupertype[];
      }
    /** CR 702.16a — "spells that are one or more colors" (issue #2296). A
     *  CONJUNCTION of two dimensions that no other family combines: the source
     *  is a SPELL (CR 112.1 / 113.3) **and** it has at least one colour
     *  (CR 105.2). Carries no payload — "one or more colors" names every
     *  colour at once, so there is nothing to parametrize. */
    | { kind: "colored-spell" };

/** Everything about a SOURCE that a CR 702.16 quality can be keyed on. Every
 *  field is REQUIRED — an optional field would let a consult site omit it and
 *  silently stop honouring that quality family (protection that fails open is
 *  protection that ships dead), so the type forces each site to say what it
 *  knows. `controllerId` is required-but-nullable: a site that genuinely
 *  cannot identify the source's controller passes `undefined`, which fails
 *  closed for the player quality (CR 702.16k) rather than guessing. */
export interface ProtectionSourceView {
    /** CR 202.2 — the source's live colours (empty = colourless, CR 105.2c). */
    colors: readonly Color[];
    /** CR 205.2 — the source's live card types. */
    types: readonly CardType[];
    /** CR 205.4a — the source's live supertypes. */
    supertypes: readonly CardSupertype[];
    /** CR 109.5 — the source's controller, for the CR 702.16k player quality. */
    controllerId: string | undefined;
    /** CR 112.1 / 113.3 — is this source a SPELL (a card or copy on the
     *  stack), as opposed to a permanent, a blocker, or an activated /
     *  triggered ability of one? Read by the CR 702.16a spell-restricted
     *  quality (issue #2296).
     *
     *  A plain `boolean`, deliberately NOT `boolean | undefined` like
     *  `controllerId` and NOT optional like `GuardActionSource.isSpell`
     *  (`permanentGuard.ts`, whose "undefined ⇒ stay conservative" leniency is
     *  the opposite trade). Nothing on a card object can infer it — a creature
     *  SPELL's `types` include `Creature` exactly like the permanent's — so
     *  the only way a consult site can be right is to state what it knows, and
     *  the only way to make every site state it is to make omitting it a
     *  compile error. Build the view through `protectionSourceView` /
     *  `protectionSourceCharacteristics`, never by hand. */
    isSpell: boolean;
}

/** True if `ability` is a protection keyword string at all (CR 702.16a) —
 *  regardless of whether this module can name its quality. The catalogue guard
 *  uses it to find the strings that MUST parse; `parseProtectionQuality`
 *  returning `null` for one of them is a CI failure, not a silent no-op. */
export function isProtectionAbility(ability: string): boolean {
    return ability.trim().toLowerCase().startsWith(PROTECTION_PREFIX);
}

/** The card's protection ability strings, read through any active color-word
 *  text changes (CR 612.6 — Sleight of Mind). Shared by every quality family
 *  so all of them see the same rewritten text. */
function liveProtectionAbilities(
    card: Pick<CardInstanceState, "staticAbilities"> &
        Partial<Pick<CardInstanceState, "subtypes" | "textChanges">>
): readonly string[] {
    // Fast path: no text changes → the raw abilities (zero-copy). The `?? []`
    // is load-bearing on the CLIENT: `CardInstance` (`src/types/game.ts`)
    // types `staticAbilities` as OPTIONAL, and the wire projection omits it
    // entirely for a permanent that has none — an unguarded read crashes the
    // click gate on every vanilla creature.
    return card.textChanges?.length
        ? applySubstitution({
              subtypes: card.subtypes ?? [],
              staticAbilities: card.staticAbilities ?? [],
              textChanges: card.textChanges,
          }).staticAbilities
        : (card.staticAbilities ?? []);
}

/** True if `card` carries the CR 702.16k player-quality protection ability. */
export function hasProtectionFromEachOpponent(
    card: Pick<CardInstanceState, "staticAbilities"> &
        Partial<Pick<CardInstanceState, "subtypes" | "textChanges">>
): boolean {
    return liveProtectionAbilities(card).includes(
        PROTECTION_FROM_EACH_OPPONENT
    );
}

/** CR 702.16k — true if `target` has protection from each of its controller's
 *  opponents AND the source in question is controlled by one of them.
 *
 *  Fails CLOSED when the source's controller is unknown (`undefined`) or the
 *  target carries no `controllerId`: a protection check that can't identify the
 *  two controllers must not silently bar a legal action. Same-controller
 *  sources are never barred — the protection is from OPPONENTS, so the
 *  controller's own Auras, blockers, damage and targeting all still work. */
export function isProtectedFromController(
    target: Pick<CardInstanceState, "staticAbilities"> &
        Partial<
            Pick<CardInstanceState, "subtypes" | "textChanges" | "controllerId">
        >,
    sourceControllerId: string | undefined
): boolean {
    if (!sourceControllerId || !target.controllerId) return false;
    if (sourceControllerId === target.controllerId) return false;
    return hasProtectionFromEachOpponent(target);
}

/** Parses "protection from [color]" static-ability strings (CR 702.16a).
 *  Returns the color code for recognized color variants (including `"C"` for
 *  colorless — CR 105.2c: an object/source is colorless when it has no
 *  colors at all), null otherwise. */
export function parseProtectionFromColor(ability: string): Color | null {
    const match = PROTECTION_FROM_COLOR_REGEX.exec(ability);
    return match ? PROTECTION_COLOR_NAME_TO_CODE[match[1]] : null;
}

/** CR 702.16a — parses the CHARACTERISTIC quality phrase that follows
 *  "protection from " ("legendary creatures", "artifact creatures",
 *  "instants"). Every word must name a card type (singular or plural) or a
 *  supertype; ANY unrecognized word returns `null` (fail closed) rather than a
 *  partially-understood quality. */
function parseCharacteristicQuality(phrase: string): ProtectionQuality | null {
    const words = phrase.split(/\s+/).filter(Boolean);
    if (words.length === 0) return null;
    const types: CardType[] = [];
    const supertypes: CardSupertype[] = [];
    for (const word of words) {
        const type = QUALITY_WORD_TO_CARD_TYPE.get(word);
        if (type) {
            if (!types.includes(type)) types.push(type);
            continue;
        }
        const supertype = QUALITY_WORD_TO_SUPERTYPE.get(word);
        if (supertype) {
            if (!supertypes.includes(supertype)) supertypes.push(supertype);
            continue;
        }
        return null;
    }
    // An empty quality would match EVERY source — the fail-open shape this
    // parser exists to prevent. Unreachable given the word loop above, kept as
    // the explicit invariant.
    if (types.length === 0 && supertypes.length === 0) return null;
    return { kind: "characteristic", types, supertypes };
}

/** CR 702.16 — the SINGLE parser for every protection quality family. Returns
 *  `null` for a non-protection ability string AND for a protection string this
 *  module cannot name (`isProtectionAbility` distinguishes the two). */
export function parseProtectionQuality(
    ability: string
): ProtectionQuality | null {
    const normalized = ability.trim().toLowerCase();
    if (normalized === PROTECTION_FROM_EACH_OPPONENT) {
        return { kind: "each-opponent" };
    }
    // CR 702.16a (issue #2296) — checked BEFORE the characteristic parser,
    // which would reject the phrase word-by-word ("spells" is not a card type;
    // "one", "more", "colors" name nothing) and return null.
    if (normalized === PROTECTION_FROM_COLORED_SPELLS) {
        return { kind: "colored-spell" };
    }
    const color = parseProtectionFromColor(normalized);
    if (color) return { kind: "color", color };
    if (!normalized.startsWith(PROTECTION_PREFIX)) return null;
    return parseCharacteristicQuality(
        normalized.slice(PROTECTION_PREFIX.length)
    );
}

/** Every protection quality this card has (CR 702.16), parsed from its
 *  `staticAbilities[]` read through any active color-word text changes
 *  (CR 612.6 — Sleight of Mind turns "protection from white" into "protection
 *  from blue"). Unparseable protection strings are dropped here — the
 *  catalogue guard is what stops one ever reaching the battlefield. */
export function getProtectionQualities(
    card: Pick<CardInstanceState, "staticAbilities"> &
        Partial<Pick<CardInstanceState, "subtypes" | "textChanges">>
): ProtectionQuality[] {
    const result: ProtectionQuality[] = [];
    for (const ability of liveProtectionAbilities(card)) {
        const quality = parseProtectionQuality(ability);
        // CR 702.16m — multiple instances of protection from the same quality
        // are redundant.
        if (quality && !result.some((q) => sameQuality(q, quality))) {
            result.push(quality);
        }
    }
    return result;
}

function sameQuality(a: ProtectionQuality, b: ProtectionQuality): boolean {
    if (a.kind !== b.kind) return false;
    if (a.kind === "color" && b.kind === "color") return a.color === b.color;
    if (a.kind === "characteristic" && b.kind === "characteristic") {
        return (
            a.types.length === b.types.length &&
            a.supertypes.length === b.supertypes.length &&
            a.types.every((t) => b.types.includes(t)) &&
            a.supertypes.every((s) => b.supertypes.includes(s))
        );
    }
    // Both "each-opponent", or both "colored-spell" — neither carries a
    // payload, so same kind means same quality (CR 702.16m redundancy).
    return true;
}

/** Colors this card has protection from (CR 702.16a). Kept as the narrow
 *  colour-only read for the text-change machinery and for card tests; the
 *  quality-agnostic predicate every consult site uses is `isProtectedFrom`. */
export function getProtectedColors(
    card: Pick<CardInstanceState, "staticAbilities"> &
        Partial<Pick<CardInstanceState, "subtypes" | "textChanges">>
): Color[] {
    const result: Color[] = [];
    for (const quality of getProtectionQualities(card)) {
        if (quality.kind === "color" && !result.includes(quality.color)) {
            result.push(quality.color);
        }
    }
    return result;
}

/** CR 702.16 — true if `target` has protection from `source`. THE single
 *  predicate every consult site reads (targeting, damage, blocking, Aura and
 *  Equipment attachment), so the offered set and the accepted set can never
 *  diverge on a quality family (the Phelia bug class, ADR 0068).
 *
 *  `source` is a REQUIRED, fully-populated `ProtectionSourceView` — see that
 *  type's doc for why nothing on it is optional. */
export function isProtectedFrom(
    target: Pick<CardInstanceState, "staticAbilities"> &
        Partial<
            Pick<CardInstanceState, "subtypes" | "textChanges" | "controllerId">
        >,
    source: ProtectionSourceView
): boolean {
    for (const quality of getProtectionQualities(target)) {
        switch (quality.kind) {
            case "color":
                // CR 105.2c — a source with no colours at all is colourless,
                // so "protection from colorless" matches an empty colour set
                // and never a coloured one.
                if (
                    quality.color === "C"
                        ? source.colors.length === 0
                        : source.colors.includes(quality.color)
                ) {
                    return true;
                }
                break;
            case "each-opponent":
                if (isProtectedFromController(target, source.controllerId)) {
                    return true;
                }
                break;
            case "characteristic":
                // CR 702.16a — the quality is a conjunction: "legendary
                // creatures" needs BOTH the supertype and the card type.
                if (
                    quality.types.every((t) => source.types.includes(t)) &&
                    quality.supertypes.every((s) =>
                        source.supertypes.includes(s)
                    )
                ) {
                    return true;
                }
                break;
            case "colored-spell":
                // CR 702.16a (issue #2296) — BOTH conjuncts, and the order of
                // the `&&` is irrelevant: dropping either one is a shipped
                // bug. `source.isSpell` (CR 112.1 / 113.3) bars only objects
                // on the stack — never a coloured permanent, never a coloured
                // blocker, never an activated/triggered ability of a coloured
                // permanent. `source.colors.length > 0` (CR 105.2) lets every
                // colourless spell through.
                if (source.isSpell && source.colors.length > 0) {
                    return true;
                }
                break;
        }
    }
    return false;
}

/** CR 205.4a — the source's LIVE supertypes, resolved through any
 *  `supertype-set` static effect / indefinite mutation. */
function liveSupertypes(source: CardInstanceState): CardSupertype[] {
    return PROTECTION_SUPERTYPES.filter((s) => hasSupertypeLive(source, s));
}

/** Projects a card object (battlefield permanent, stack item, or a card in any
 *  other zone) into the characteristics CR 702.16 protection keys on. Colours
 *  come from the layer-aware authority (CR 613.1d layer 5); types and
 *  supertypes are read LIVE (CR 205.2 / 205.4a) so an animated artifact or a
 *  supertype-stripped legend is judged by what it currently is — CR 702.16a's
 *  "sources that are permanents with that card type … and any sources not on
 *  the battlefield that are of that card type". */
export function protectionSourceView(
    source: CardInstanceState,
    /** CR 112.1 / 113.3 — see `ProtectionSourceView.isSpell`. REQUIRED: a card
     *  object cannot tell you this (a creature spell's `types` are the
     *  permanent's), so the caller — which knows the zone/kind it fetched the
     *  object from — must say. */
    isSpell: boolean
): ProtectionSourceView {
    return { ...protectionSourceCharacteristics(source), isSpell };
}

/** The CHARACTERISTICS half of `protectionSourceView` — everything that can be
 *  read off a card object itself (CR 202.2 colours, CR 205.2 types, CR 205.4a
 *  supertypes, CR 109.5 controller), and nothing that cannot.
 *
 *  Exists so a caller that needs only these (`targetingSourceFromCard`,
 *  `getPendingTargetSourceSupertypes` — both projecting into a DIFFERENT
 *  bundle) is not forced to invent a `isSpell` value it will immediately
 *  discard. Any caller building a real `ProtectionSourceView` uses
 *  `protectionSourceView` and states the bit. */
export function protectionSourceCharacteristics(
    source: CardInstanceState
): Omit<ProtectionSourceView, "isSpell"> {
    return {
        colors: STATIC_EFFECT_CTX.getColors(source),
        types: source.types,
        supertypes: liveSupertypes(source),
        controllerId: source.controllerId,
    };
}

/** True if `target` has protection from `source` (CR 702.16), where `source`
 *  is a card object the caller already holds. Works uniformly for battlefield
 *  permanents and for stack items (spells, activated abilities, triggered
 *  abilities) — ability stack items are cloned from their source permanent, so
 *  their characteristics match.
 *
 *  …and that cloning is exactly why `sourceIsSpell` is a REQUIRED parameter
 *  (issue #2296): the clone is indistinguishable from its permanent, so the
 *  CR 112.1 spell bit can only come from the caller's own knowledge of what it
 *  is holding. A blocker, an Equipment, an attached Aura and a fight source
 *  pass `false`; a resolving stack item passes `isSpellStackItem(item)`. */
export function isProtectedFromSource(
    target: CardInstanceState,
    source: CardInstanceState,
    sourceIsSpell: boolean
): boolean {
    return isProtectedFrom(target, protectionSourceView(source, sourceIsSpell));
}

/** True if `playerId` currently has PROTECTION FROM EVERYTHING (CR 702.16j
 *  applied to a player via CR 115.4 — The One Ring, issue #674).
 *
 *  The SINGLE authority for the player-scoped variant: every consumer reads
 *  this one predicate — `getLegalTargets` (the offered set) and the
 *  `selectTarget` mutation (the accepted set) so they can't diverge, plus
 *  `applyPlayerDamagePrevention` (CR 702.16e). Unlike the quality-parameterized
 *  card-scoped helpers above, it takes no source characteristics at all:
 *  protection from EVERYTHING is protection from each and every object
 *  regardless of its characteristics (CR 702.16j), with no controller
 *  exception — the protected player's own spells and sources are barred too.
 *
 *  Typed structurally (not as `GameState`) so the pure predicate stays
 *  importable from the client, exactly like `playerHasShroud`. */
export function playerHasProtectionFromEverything(
    state: { playerProtectionFromEverything?: readonly string[] },
    playerId: string
): boolean {
    return state.playerProtectionFromEverything?.includes(playerId) ?? false;
}
