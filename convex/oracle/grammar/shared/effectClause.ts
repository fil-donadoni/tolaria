/**
 * Shared sub-grammar: EFFECT SENTENCES (CR 113.3b, CR 608.2).
 *
 * One Oracle sentence → one `EffectSentenceIR`. The IR stays in the sentence's
 * own vocabulary ("pump", "bounce") rather than in the interpreter's, for the
 * reason `ir.ts` gives: "did we understand the sentence?" and "how does the
 * engine encode it?" are separate questions with separate failure modes, and
 * collapsing them means a lowering bug reads as a parse bug.
 *
 * ── What a sentence may NOT do here ────────────────────────────────────────
 *
 * Every rule below consumes a WHOLE sentence. There is no "leading verb wins"
 * dispatch and no optional trailing group: "Destroy target creature" and
 * "Destroy target creature at the beginning of the next end step" differ by a
 * clause that changes when the effect happens, and a grammar that matched the
 * first inside the second would be the competitor's largest documented misparse
 * bucket reproduced exactly.
 *
 * ── Anaphora ───────────────────────────────────────────────────────────────
 *
 * "It", "that creature", "that player" are refused, with ONE exception that is
 * not really anaphora at all: "It can't be regenerated." is a MODIFIER of the
 * destroy sentence it follows (CR 701.19c on regenerate), carrying no referent
 * of its own, and it is parsed as such — a modifier that finds no destroy in front of it fails
 * the line rather than being dropped.
 */

import { readManaCost } from "../../manaCost";
import { readUnlessPayment, type UnlessPaymentIR } from "./unlessPayment";
import type {
    Color,
    EffectCardFilter,
    EffectChoiceSuperlative,
    EffectManaPool,
    ManaCost,
    TargetRequirement,
} from "../../../cards/types";
import type { KeywordIR } from "../ir";
import type { CardType, NameRestriction } from "../../../cards/types";
import { PERMANENT_TYPES } from "../../../cards/types";
import type { Phase } from "../../../gre/types";
import {
    fail,
    ok,
    rule,
    type FailureTrace,
    type Rule,
    type RuleResult,
    subGrammar,
} from "../../rule";
import { keywordVocabulary } from "./keywordVocabulary";
import { readQuotedAbilityOf } from "./quotedAbilityReader";
import type { QuotedAbilityIR } from "./staticClause";
import { durationRule, type DurationIR } from "./duration";
import { playerRefRule, type PlayerRefIR } from "./playerRef";
import {
    countedSetRule,
    numberOfSetRule,
    readNumberWord,
    type CountedSetIR,
} from "./quantity";
import { isSelfPhrase } from "./cost";
import { SELF_MARKER } from "../../normalize";
import type { ParseContext } from "../../types";
import {
    comparativeControlsRule,
    controlsRule,
    kickedConditionRule,
    kickedPermanentConditionRule,
    type ComparativeControlsIR,
    type ConditionIR,
    type KickedRefIR,
} from "./condition";
import {
    controlledPluralRule,
    creatureSweepRecipientRule,
    massSubjectRule,
    type MassSubjectIR,
    type PermanentSweepSelector,
} from "./massSubject";
import {
    COLOR_WORDS,
    TYPE_NOUNS,
    descriptorRule,
    dividedTargetsRule,
    narrowedStackRequirement,
    opensTargetPhrase,
    ownPermanentChoiceFilterFromDescriptor,
    unqualifiedPermanentChoiceFilter,
    sacrificeFilterFromDescriptor,
    superlativeFromClause,
    targetFilterRule,
    targetRequirementFromDescriptor,
} from "./targetFilter";
import { zoneRefRule, type ZoneRefIR } from "./zoneRef";
import { BASIC_LAND_SUBTYPE_ORDER, CREATURE_SUBTYPES } from "./subtypes";
import { readPumpThenColor } from "./pumpColorChain";
import { readThenChain } from "./thenChain";
import { readCounterAndChain } from "./counterAndChain";
import {
    foldCoinFlipSeries,
    readCoinFlipSentence,
    type CoinFlipMarker,
} from "./coinFlipSeries";
import { createTokenRule, type CreateTokenIR } from "./tokenSpec";

export const EFFECT_CLAUSE = "effect clause";

/** CR 115.3 — the head that marks an announcement as excluding an earlier one. */
const ANOTHER_HEAD = "another target ";

/** CR 120.3 — the exact damage-recipient union `subjectRule` reads whole. */
const EACH_CREATURE_AND_EACH_PLAYER = "each creature and each player";
/** CR 601.2c — the damage recipient "each of X targets", read as one exact
 *  phrase: a descriptor after it ("each of X target creatures") is a different
 *  announcement and is not read. */
const EACH_OF_X_TARGETS = "each of X targets";
/** CR 400.3 — the plural destination of a sweep bounce. */
const THEIR_OWNERS_HANDS = "their owners' hands";
/**
 * CR 400.3 — the singular-owner spelling of a sweep bounce: "Return
 * all artifacts target player owns to their hand" (Hurkyl's Recall). The
 * announced player is the sweep's whole scope, so the zone is "their hand".
 * The sweep is scoped by the announced player's battlefield (the selector has
 * no owner axis), the same reading the hand-written card carries
 * (tracked-by: #2785).
 */
const TARGET_PLAYER_OWNS = / target player owns$/;
const THEIR_HAND = "their hand";
/** CR 120.3 — the player half of a creature sweep that is not the exact phrase. */
const AND_EACH_PLAYER = " and each player";

/**
 * CR 107.3 — an effect's MAGNITUDE: a printed number, or the announced {X}.
 *
 * `X` is read by the GRAMMAR wherever a count word is read, and refused by the
 * LOWERING at every site whose source has no `{X}` pip to announce
 * (`lowerEffects.ts` — `lowerAmount`). The split is deliberate: whether the
 * word "X" appears is a fact about the sentence, whereas whether an X was
 * announced is a fact about the COST, which lives on the card and on the
 * ability, not in this span. Reading it here and judging it there keeps a
 * "deals X damage" line on a card with no {X} an honest `unparsed` rather than
 * a card that deals zero.
 */
export type AmountIR =
    | { readonly kind: "fixed"; readonly value: number }
    | { readonly kind: "x" }
    /**
     * "that much": the magnitude the trigger's own event carried (CR 120.3 —
     * the damage dealt). Read here as words, bound by the lowering SITE: a head
     * that carries no magnitude refuses the line rather than reading 0.
     */
    | { readonly kind: "event-amount" }
    /**
     * CR 107.1 — "2 life for each Swamp you control": a printed multiplier
     * over the cardinality of a SET. Read only where a site's lowering can
     * resolve the set (`lowerAmount`); every other site refuses it.
     */
    | {
          readonly kind: "counted";
          readonly times: number;
          readonly set: CountedSetIR;
      }
    /**
     * CR 107.1b — "the number of cards in your hand minus 4": a counted set
     * less a printed constant, bound by "where X is …" (Ivory Tower). The
     * difference is SIGNED (a calculated value may be negative); the consuming
     * Op clamps it, so a hand of three gains no life rather than losing any.
     */
    | {
          readonly kind: "counted-difference";
          readonly set: CountedSetIR;
          readonly minus: number;
      }
    /**
     * CR 202.3 + CR 208.1 + CR 608.2h — "its mana value" / "its power" /
     * "its toughness" / "that card's mana value" / "that permanent's mana
     * value": one characteristic of the object the sentence BEFORE acted on.
     * Read here as words; bound by the lowering to the announced object that
     * sentence recorded, and refused by a site whose earlier sentences acted
     * on none.
     *
     * The head NOUN is kept rather than folded away because it constrains
     * which antecedent the phrase may name: "that permanent" is printed only
     * where the earlier sentence acted on a permanent (CR 110.4a), and reading
     * it off a card in a graveyard or a hand would be an object the sentence
     * never pointed at. The CHARACTERISTIC is kept because the lowering reads
     * a different snapshot slot for each, and because the snapshot records
     * power and toughness only for a creature on the battlefield — a check
     * only the lowering can make, since only it sees the recorded
     * requirement.
     */
    | {
          readonly kind: "acted-on-characteristic";
          readonly noun: ActedOnNounIR;
          readonly characteristic: ActedOnCharacteristicIR;
      }
    /**
     * CR 608.2h + CR 208.1 — "its power" where "its" is the SOURCE its own
     * activation cost sacrificed ("{R}, Sacrifice this creature: It deals
     * damage equal to its power to target creature"): the source's last known
     * information, since it has left the battlefield before the ability
     * resolves.
     *
     * Read here as words; only a site whose cost sacrificed the source can
     * bind it (`SiteOptions.sourceSacrificed`), because on any other site
     * "its power" is the LIVE value of an object still in play, which the
     * value grammar has no member for. Such a site refuses the line.
     */
    | {
          readonly kind: "sacrificed-source-characteristic";
          readonly characteristic: "power";
      }
    /**
     * CR 202.3 + CR 608.2h — "the exiled card's mana value" where the card is
     * the one the ability's own "Exile the top card of your library" cost
     * exiled: its last known characteristics ride on the stack item. Read as
     * words; only a site whose cost exiles the top card can bind it
     * (`SiteOptions.costExiledTopCard`), every other site refuses the line.
     */
    | {
          readonly kind: "cost-exiled-card-characteristic";
          readonly characteristic: "manaValue";
      };

/**
 * CR 202.3 — the head noun of "<phrase> mana value": the pronoun, a card, or a
 * permanent. Three printed words, three different antecedents, so the noun
 * travels to the lowering instead of being swallowed by the pattern.
 */
export type ActedOnNounIR = "it" | "card" | "permanent";

/**
 * CR 202.3 / CR 208.1 — the characteristic a phrase reads off the acted-on
 * object. Each names a slot the acting Op's `bind` snapshot carries.
 */
export type ActedOnCharacteristicIR = "manaValue" | "power" | "toughness";

/** The three possessive phrases, printed exactly (CR 202.3 + CR 608.2h). */
const ACTED_ON_NOUNS: ReadonlyMap<string, ActedOnNounIR> = new Map([
    ["its", "it"],
    ["that card's", "card"],
    ["that permanent's", "permanent"],
]);

/** The characteristic words, printed exactly (CR 202.3, CR 208.1). */
const ACTED_ON_CHARACTERISTICS: ReadonlyMap<string, ActedOnCharacteristicIR> =
    new Map([
        ["mana value", "manaValue"],
        ["power", "power"],
        ["toughness", "toughness"],
    ]);

/**
 * A capture group over the phrases of `nouns`, DERIVED from the vocabulary so
 * a pattern and the table it reads can never drift apart.
 *
 * Each SITE names the nouns it accepts, rather than inheriting all three
 * (ADR 0137's fail-closed guard). The alternation is not a shared constant
 * because the corpus prints the same three words at a damage site meaning
 * something this rule does NOT read: "deals damage equal to that card's mana
 * value" is the card REVEALED off a library (Erratic Explosion, Riddle of
 * Lightning — 15 cards), and "deals damage equal to its mana value" is the
 * DEALER's own mana value (Goblin Tinkerer, Enchanter's Bane). Each of those
 * is refused today for a reason of its own — the dealer is not this spell, or
 * no earlier sentence bound anything — and a noun set that accepted them here
 * would be leaning on that, which is coverage held by accident.
 */
function actedOnNounGroup(nouns: readonly ActedOnNounIR[]): string {
    const phrases = [...ACTED_ON_NOUNS.entries()]
        .filter(([, noun]) => nouns.includes(noun))
        .map(([phrase]) => phrase);
    return `(${phrases.join("|")})`;
}

/** A capture group over the characteristic words, derived like the nouns. */
function actedOnCharacteristicGroup(
    characteristics: readonly ActedOnCharacteristicIR[]
): string {
    const words = [...ACTED_ON_CHARACTERISTICS.entries()]
        .filter(([, one]) => characteristics.includes(one))
        .map(([word]) => word);
    return `(${words.join("|")})`;
}

/**
 * `"its"` / `"that card's"` / `"that permanent's"` + a characteristic word →
 * the amount it names.
 *
 * Power and toughness are read through the pronoun ONLY. The corpus prints
 * "that creature's toughness" as well (Vendetta, Devour in Shadow), but that
 * noun is a fourth antecedent with its own check and no fixture here, and
 * "that card's power" names a card off the battlefield, whose snapshot
 * records no power — both stay refused rather than read by accident.
 */
function readActedOnCharacteristic(
    possessive: string,
    word: string
): AmountIR | null {
    const noun = ACTED_ON_NOUNS.get(possessive);
    const characteristic = ACTED_ON_CHARACTERISTICS.get(word);
    if (noun === undefined || characteristic === undefined) return null;
    if (characteristic !== "manaValue" && noun !== "it") return null;
    return { kind: "acted-on-characteristic", noun, characteristic };
}

/** A count word at an effect site: a cardinal, `X` (CR 107.3), or "that much". */
export function readAmount(word: string): AmountIR | null {
    if (word === "X") return { kind: "x" };
    if (word === "that much") return { kind: "event-amount" };
    const fixed = readNumberWord(word);
    return fixed === null ? null : { kind: "fixed", value: fixed };
}

/** Who or what a sentence acts on (CR 109.2, CR 115.1). */
export type SubjectIR =
    /** The object the ability is printed on (CR 109.2). */
    | { readonly kind: "self" }
    /** An announced target (CR 115.1) — object OR player. */
    | {
          readonly kind: "target";
          readonly requirement: TargetRequirement;
          /**
           * CR 115.3 — the sentence printed "ANOTHER target …": this
           * announcement may not name an object an EARLIER instance of the
           * word "target" on the same spell already named.
           *
           * A marker rather than a `TargetRequirement` field, because the
           * word has two readings and only the LOWERING can tell them apart:
           * against an earlier announcement it is `excludePriorTargets` on a
           * later group, and on a permanent's own ability ("{T}: Another
           * target creature you control gains …") it is `excludeSource`
           * instead — the same word, a different exclusion, a different
           * field. The lowering reads the walk, finds which one the site can
           * mean, and refuses the site that can mean neither.
           */
          readonly another?: true;
      }
    /** A player named without targeting (CR 109.5 — "you"). */
    | { readonly kind: "player"; readonly player: PlayerRefIR }
    /**
     * CR 400.7e — "that card": anaphora for the card a zone change
     * put somewhere. Read here, bound by the lowering SITE (a dies trigger,
     * issue #4127); a site that names no card refuses the line.
     */
    | { readonly kind: "that-card" }
    /**
     * CR 603.2 + CR 608.2h — "that spell": anaphora for the spell a
     * cast-trigger head named. Read only by the counter verb, which has no
     * announced target to point at; bound by the lowering SITE
     * (`SiteAntecedents.spell`), a site whose head names no spell refuses the
     * line.
     */
    | { readonly kind: "that-spell" }
    /**
     * CR 303.4b — "enchanted creature": the permanent the Aura's ability is
     * attached to (the activated slot's `auraHost`). Never announced (CR 115.10
     * — the ability's own text names it, so hexproof and protection do not
     * apply); lowered to `$host`. Read by the pump and keyword-grant verbs
     * only — the two forms a golden fixture pins.
     */
    | { readonly kind: "host" }
    /**
     * CR 608.2h — "that creature": the creature the site's own head named
     * (`SiteAntecedents.creature`), as "it" is the object a head named. Read
     * only as a subject; a site whose head names no creature refuses the
     * line, and so does one that has announced a target first (the nearer
     * antecedent).
     */
    | { readonly kind: "that-creature" }
    /**
     * CR 608.2h — "it": the OBJECT the text before this sentence named.
     * Which object is not a fact about the sentence, so the word is read here
     * and the referent comes from the lowering SITE
     * (`SiteAntecedents.object`); a site that names none refuses the line
     * rather than guessing. Written as a marker by
     * {@link objectPronounListRule}, never by a card.
     */
    | { readonly kind: "pronoun" }
    /**
     * CR 110.1 — every permanent a descriptor matches, without announcing a
     * target ("all enchantments"). Read only by the verbs whose lowering fans
     * out over a sweep (destroy, tap, untap); every other verb keeps reading
     * `subjectRule` and so never sees one.
     */
    | ({ readonly kind: "mass" } & MassSubjectIR)
    /**
     * CR 120.3 — the fixed two-set damage recipient union: every creature on
     * the battlefield AND every player, read as ONE exact phrase rather than
     * two `SubjectIR`s joined by a general "and" grammar (no such grammar
     * exists — a coordinated subject is refused everywhere else this rule
     * reads one). Read only by the two verbs the corpus prints it under
     * (`deal-damage`, `prevent-next-damage`); their lowering fans out into a
     * pair of `forEach` sweeps, one per set, because neither Op's `to` field
     * names more than one recipient.
     */
    | {
          readonly kind: "each-creature-and-player";
          /**
           * CR 120.3 + CR 702.9a — the creature half, when it is NARROWED
           * ("each creature without flying and each player", Earthquake).
           * Absent for the exact phrase "each creature and each player",
           * whose creature half is every creature.
           */
          readonly creatures?: PermanentSweepSelector;
      };

/**
 * CR 608.2c — "there are N or more cards in your graveyard": a count of the
 * controller's own cards in one zone, read when the sentence resolves. The zone
 * is the only one the corpus prints this threshold over today; it is a field so
 * a second zone widens the rule, not the type.
 */
export interface CardCountConditionIR {
    readonly zone: "graveyard";
    readonly atLeast: number;
}

/**
 * CR 118.12a — the price a counter's controller may be made to pay to keep
 * their spell on the stack ("… unless its controller pays <tax>").
 *
 * TWO forms: the per-tally generic tax "{N} for each <tally>", whose only tally
 * this grammar reads is CR 207.2c's Domain ("each basic land type among lands
 * you control"), and the FLAT generic tax "{N}" (Mana Leak). Both are generic
 * mana in a `mayPay` cost leg; they differ in whether the amount is a literal
 * or a runtime tally. A tax naming colored mana, {X} or any further rider
 * ("plus an additional …", "for each …", "where X is …") is neither read here
 * nor evidenced by a fixture, and stays refused under its own gap key.
 */
export type CounterTaxIR =
    | {
          readonly kind: "per-domain";
      }
    | {
          readonly kind: "flat";
          /** The printed generic amount, at least 1. */
          readonly amount: number;
      };

export type EffectSentenceIR =
    /** CR 205.3m (issue #3721) — "Choose a creature type." made as the spell
     *  or ability RESOLVES, the head of a line whose later sentences read the
     *  answer back through a `chosenType` descriptor ("of that type" / "of the
     *  chosen type"). Carries no data: the chooser is always the resolving
     *  controller (no printed card lets another player choose) and the legal
     *  space is always CR 205.3m's whole table. */
    | {
          readonly kind: "choose-creature-type";
          /** CR 205.3m — "… other than <type>": creature types the chooser
           *  may NOT name. Absent on the bare instruction. */
          readonly exclude?: readonly string[];
      }
    /** CR 205.1a / 611.2 (issue #4316) — "<subject> becomes that type <duration>",
     *  the read-back of an earlier `Choose a creature type` sentence: the
     *  subject's CREATURE types are replaced by the chosen one. */
    | {
          readonly kind: "set-chosen-creature-type";
          readonly subject: SubjectIR;
          readonly duration: DurationIR;
      }
    /** CR 205.3i / 305.6 — "Choose a land type and a basic land type." made
     *  as the spell RESOLVES: two picks, the second narrowed to the five
     *  basic land types. Carries no data, for the reason
     *  `choose-creature-type` gives; the two answers are read back only by
     *  `set-chosen-land-type`. */
    | { readonly kind: "choose-land-types" }
    /** CR 305.7 / 611.2 — "Each land of the first chosen type becomes the
     *  second chosen type <duration>": every land carrying the first pick has
     *  its land types replaced by the second. */
    | {
          readonly kind: "set-chosen-land-type";
          readonly duration: DurationIR;
      }
    /** CR 614.1a / 106.3 (issue #3811) — "Until end of turn, spells and
     *  abilities you control that would add colored mana instead add that
     *  much <colour> mana." The replacement is always the resolving
     *  controller's and always until end of turn: those words are part of the
     *  anchored form, not parameters. */
    | { readonly kind: "replace-mana-production-color"; readonly color: Color }
    /** CR 609.4b (issue #3811) — "Until end of turn, you may spend <colour>
     *  mana as though it were mana of any color|type." The grantee is always
     *  the resolving controller ("you"). */
    | {
          readonly kind: "grant-mana-substitution";
          readonly from: Color;
          readonly breadth: "any-color" | "any-type";
      }
    /** CR 609.4b / 118.14 (issue #4529) — "For one spell this turn, you may
     *  spend mana as though it were mana of any color|type to pay that spell's
     *  mana cost." The one-shot, spell-scoped grant (North Star); the grantee
     *  is always the resolving controller ("you"). */
    | {
          readonly kind: "grant-spell-mana-substitution";
          readonly breadth: "any-color" | "any-type";
      }
    /** CR 106.1 / 106.4 (issue #4529) — "Add {B}{B}{B}.": fixed pips only,
     *  into the resolving controller's pool. A coloured-or-colourless symbol
     *  string, never a generic, `{X}` or "mana of any color" (a runtime
     *  choice: the mana slot's descriptor, not this sentence's). */
    | {
          readonly kind: "add-mana";
          readonly mana: EffectManaPool;
          /**
           * CR 106.4 — "That player adds {G}{G}": the mana goes to the player
           * the head named (`SiteAntecedents.player`), not the controller.
           */
          readonly thatPlayer?: true;
      }
    /** CR 106.1 + CR 608.2c (Cabal Ritual) — "Add {B}{B}{B}. <Ability word> —
     *  Add {B}{B}{B}{B}{B} instead if there are seven or more cards in your
     *  graveyard.": the second sentence REPLACES the first when the count is
     *  met, and the first happens otherwise. Folded from an `add-mana` and the
     *  `instead-if-count` sentence behind it by `assembleSentences`. */
    | {
          readonly kind: "add-mana-instead-if";
          readonly base: EffectManaPool;
          readonly replacement: EffectManaPool;
          readonly condition: CardCountConditionIR;
      }
    /**
     * CR 701.20a — "reveal a card at random from your hand": one card of the
     * controller's hand, picked by the seeded PRNG, kept as the card a later
     * "if that card has the chosen name" sentence reads.
     */
    | { readonly kind: "reveal-random-hand-card" }
    /**
     * CR 201.2a / 701.20a — "If that card has the chosen name, <effect>": the
     * gate reads the card the preceding `reveal-random-hand-card` showed
     * against the pick of the preceding `name-card`. Refused by
     * `assembleSentences` unless both precede it in the same ability.
     */
    | {
          readonly kind: "named-card-reveal-gate";
          readonly effect: EffectSentenceIR;
      }
    /** CR 107.3f (issue #4529) — "You may pay {X}. If you do, <effect>": the
     *  controller nominates X as the payment is made, and `effect` reads the
     *  amount paid wherever it says X. A WRAPPER over an already-read
     *  sentence, like `optional`: the inner effect is read by the rule that
     *  reads it alone and lowered by the same walk. `clause` is the two
     *  sentences AS PRINTED (the prompt the player is asked). */
    | {
          readonly kind: "pay-variable-then";
          readonly clause: string;
          readonly effect: EffectSentenceIR;
      }
    /** CR 118.12 + CR 608.2c — "You may pay {R}. If you do, <effect>": a FIXED
     *  mana payment offered to the controller, gating `effect` on having paid.
     *  The fixed-cost twin of `pay-variable-then` (no nomination, no X). A
     *  WRAPPER over an already-read sentence; `clause` is the first sentence
     *  AS PRINTED (the prompt the player is asked). */
    | {
          readonly kind: "pay-mana-then";
          readonly clause: string;
          readonly mana: ManaCost;
          readonly effect: EffectSentenceIR;
      }
    /**
     * CR 701.21a — the imperative "Sacrifice this enchantment.": the source
     * (or the site's pronoun for it) is sacrificed by its controller. `then`
     * is the "If you do, <effect>." sentence behind it (CR 608.2c), folded in
     * by `assembleSentences`: it runs only when the sacrifice happened.
     */
    | {
          readonly kind: "sacrifice-source";
          readonly subject: SubjectIR;
          readonly then?: EffectSentenceIR;
      }
    | {
          readonly kind: "pump";
          readonly subject: SubjectIR;
          readonly power: number;
          readonly toughness: number;
          readonly duration: DurationIR;
          /**
           * CR 207.2c — "… for each basic land type among lands you control":
           * the printed ±1 is a per-tally step, so each stat is that step
           * times the controller's Domain. Pinned to +1/+1 and -1/-1, the two
           * forms the corpus prints; any other step (a different magnitude, a
           * mixed sign) stays refused rather than read as a multiplier nobody
           * evidenced.
           */
          readonly perDomain?: true;
          /**
           * CR 508.1 + CR 613.4c — "… for each other attacking Goblin": each
           * stat's printed step is a per-tally step, the tally being the
           * attacking creatures of one subtype OTHER than the source. The
           * subject is the source itself (lowering refuses another object,
           * since "other" excludes the source, not the pumped creature).
           */
          readonly perOtherAttacking?: string;
      }
    | {
          /**
           * CR 205.1b + CR 613.1d/f — "All lands you control become 1/1
           * creatures until end of turn. They're still lands.": every member
           * of a sweep gains the Creature type and a base P/T for a duration,
           * KEEPING the types it has. The keeping is the rider's, not the first
           * sentence's — without "They're still lands" the sentence would
           * replace the types, which is a different effect the `animate` Op
           * does not express — so `retainsTypes` is set only by folding the
           * rider in (`assembleSentences`), and lowering refuses an animate
           * that never got it.
           */
          readonly kind: "animate";
          readonly subject: SubjectIR;
          readonly power: number;
          readonly toughness: number;
          readonly duration: DurationIR;
          readonly retainsTypes?: true;
          /**
           * CR 205.1b + CR 613.1d — the SOURCE's own animation ("This land
           * becomes a 2/2 Assembly-Worker artifact creature until end of
           * turn."): the characteristics the clause prints beyond the P/T.
           * Set only with a `self` subject; a sweep prints a bare P/T. The
           * keeping of the land type is the rider's here too ("It's still a
           * land."); the subject and the rider both read the one noun
           * `land`, so a rider naming another type is not read at all.
           */
          readonly self?: {
              readonly subtype: string;
              readonly additionalTypes: readonly CardType[];
              readonly colors: readonly Color[];
              readonly keyword?: KeywordIR;
              /** CR 113.1a — an ability granted in quotation marks for the
               *  animation's duration; exclusive with `keyword`. */
              readonly quoted?: {
                  readonly text: string;
                  readonly ability: QuotedAbilityIR;
              };
          };
      }
    | {
          /**
           * CR 205.1a + CR 613.1d — "<source> becomes a N/N [color] <Subtype>
           * creature.": the source's card types and subtype line are REPLACED
           * (no "still a …" rider keeps them), its base P/T is set, with no
           * duration (indefinite). Self only: the lowering emits the three
           * source-targeted Ops the hand-written Oko encodes.
           */
          readonly kind: "become-creature";
          readonly subject: SubjectIR;
          readonly power: number;
          readonly toughness: number;
          readonly subtype: string;
          readonly colors: readonly Color[];
      }
    | {
          /**
           * CR 613.1f — a keyword granted until end of turn.
           *
           * Carries the whole Mechanics Registry row rather than just the
           * name, because the name alone cannot answer the Guard A question
           * (#962): a grant of a keyword the engine has not implemented ships
           * a card whose effect is inert, exactly like a printed one. The
           * static slot's `keyword-grant` clause already keeps the row for
           * this reason (`lowerStatic.ts`), and censusing one grant site and
           * not the other is how "Target creature gains undying until end of
           * turn." reached `ready` promising a `planned` keyword.
           */
          readonly kind: "grant-ability";
          readonly subject: SubjectIR;
          readonly keyword: KeywordIR;
          readonly duration: DurationIR;
      }
    | {
          /**
           * CR 702.34a / 514.2 (issue #4756) — "<target graveyard card> gains
           * flashback until end of turn. The flashback cost is equal to its
           * mana cost." Folded by `assembleSentences` from the two sentences'
           * markers (`flashback-grant` + `flashback-cost`): the first alone
           * grants a keyword with no cost, which is not a Flashback anyone
           * could pay, so neither sentence is an effect by itself. Kept apart
           * from `grant-ability` because the subject is a CARD in a graveyard,
           * not a permanent (CR 110.1) — the layer-6 grant cannot reach it.
           */
          readonly kind: "grant-flashback";
          readonly subject: SubjectIR;
      }
    | {
          /**
           * CR 613.1f/702.16a — "Choose a color. <mass subject> gain(s)
           * protection from the chosen color until <duration>.": one
           * `optionChoice` mode per CR 105.1 colour (`colorChoiceModes`, ADR
           * 0045 "generalize, don't add" — the SAME five-mode builder
           * `set-color-choice` uses), each granting `protection from
           * <colour>` (Guard A via the "protection" registry row) to every
           * member of the sweep.
           *
           * Folded onto the preceding `{ role: "choose-color" }` marker by
           * `assembleSentences` — a card printing the grant with no "Choose a
           * color." sentence before it has no antecedent for "the chosen
           * color" and is refused there, not here.
           */
          readonly kind: "choose-color-grant-protection";
          readonly subject: SubjectIR;
          readonly duration: DurationIR;
      }
    | {
          /**
           * CR 613.1e — layer 5: the subject's colour is SET to one the
           * controller picks as the effect resolves (CR 105.1's five — the
           * template never offers colourless), replacing every colour it had
           * (CR 105.3).
           *
           * The duration is OPTIONAL here, alone among this file's continuous
           * effects, and that is the printed distinction rather than a
           * default: "Target permanent you control becomes the color of your
           * choice." (Alchor's Tomb) sets the colour for good (CR 611.2a — no
           * duration, no reversion), where "… until end of turn" (Tidal
           * Visionary) reverts at CR 514.2's cleanup. A spell target prints no
           * duration for a third reason — it leaves the stack as it resolves
           * (CR 608.2n), so there is nothing left to revert (Vodalian Mystic).
           * Reading the absence as "until end of turn" would quietly un-set
           * Alchor's Tomb, and reading it as an error would refuse two of the
           * four printed forms, so it is carried as what it is.
           */
          readonly kind: "set-color-choice";
          readonly subject: SubjectIR;
          readonly duration?: DurationIR;
      }
    | {
          /**
           * CR 305.7 — layer 4 (CR 613.1d): the subject's land types are SET
           * to a basic land type, REPLACING the ones it had, for a printed
           * duration.
           *
           * `offered` is what the line puts on the table, in printed order,
           * and the three printed arities are one production, not three
           * rules: all five (CR 305.6 — "the basic land type of your
           * choice", Dream Thrush), a named pair ("a Plains or an Island",
           * Tundra Kavu) and a single named type ("a Forest", Kavu Recluse).
           * The pick itself is CR 608.2d — announced as the effect applies,
           * not as the ability goes on the stack — which is why a two-mode
           * offer and a five-mode one differ only in `offered.length`.
           *
           * The duration is REQUIRED, unlike the colour change above, and
           * that too is the printed distinction rather than a default: every
           * land-type change in the corpus prints one. Reading an absent
           * duration as "until end of turn" would invent it, and reading it
           * as indefinite would ship a permanent land-type change nobody
           * printed (CR 611.2a), so the form without one stays refused.
           */
          readonly kind: "set-land-type";
          readonly subject: SubjectIR;
          readonly offered: readonly string[];
          readonly duration: DurationIR;
      }
    | {
          /**
           * CR 120.1 + CR 107.1 — "{self} deals damage to each player equal to
           * twice the number of nonbasic lands that player controls": every
           * player is dealt a count of THEIR OWN set, so the set is read per
           * recipient ("that player controls" rebinds the "you control" the
           * descriptor was parsed with). The dealer is always the source.
           */
          readonly kind: "deal-damage-each-player-count";
          readonly times: number;
          readonly set: CountedSetIR;
      }
    | {
          readonly kind: "deal-damage";
          readonly amount: AmountIR;
          readonly to: SubjectIR;
          /**
           * CR 608.2h — the sentence named its damage SOURCE with "it"
           * ({@link PRONOUN_MARKER}) rather than the source's own marker.
           * Whether that is legal depends on whom the site's pronoun names,
           * which the sentence cannot know: `dealDamage` always deals from the
           * ability's own source, so the LOWERING refuses the sentence when
           * "it" names anyone else (see `lowerSentenceBody`).
           */
          readonly sourceIsPronoun?: true;
          /**
           * CR 120.1 + CR 608.2h — the sentence named its damage SOURCE as
           * "that <noun>": the object an EARLIER sentence acted on (Goblin
           * Tinkerer's "Destroy target artifact. That artifact deals damage
           * …"). The noun is kept as printed so the lowering can check it
           * against what was acted on; the dealer is that object's last known
           * information, read off the acting Op's `bind` snapshot.
           */
          readonly sourceIsActedOn?: string;
          /**
           * CR 615.12 + CR 614.9 — the spell's own rider "If {self} would deal
           * damage to a creature, that damage can't be prevented or dealt
           * instead to another permanent or player." Folded onto the preceding
           * "deals X damage to any target" by `assembleSentences` from the
           * `creature-damage-lock` marker. Conditional on the target being a
           * creature: aimed at a player it is ordinary damage.
           */
          readonly creatureDamageLock?: true;
      }
    | {
          /**
           * CR 601.2d — "{self} deals N damage divided as you choose
           * among <count phrase> <targets>".
           *
           * ONE announced group whose count is a RANGE (`among`), and a
           * magnitude the caster splits across whoever they chose. The
           * budget is a printed number or the announced {X}: any other
           * magnitude ("equal to its power", "X plus 1") is a separate
           * reference and is not read here. `among` carries no
           * `divideAsChosen` — the budget is `amount`, which only the
           * lowering can resolve against the site (`allowX`).
           *
           * `sourceIsPronoun` is the same CR 608.2h marker `deal-damage`
           * carries, refused by the lowering on the same condition.
           */
          readonly kind: "deal-damage-divided";
          readonly amount: AmountIR;
          readonly among: TargetRequirement;
          readonly sourceIsPronoun?: true;
      }
    | {
          /**
           * CR 601.2d / 122.1 — "Distribute N <kind> counters among <count
           * phrase> <targets>": the counters twin of `deal-damage-divided`.
           * ONE announced group whose count is a range (`among`), and a budget
           * of counters the caster splits across whoever they chose, each at
           * least one. The budget is a printed number or the announced {X};
           * "X …, where X is …" and every other magnitude are other sentences.
           */
          readonly kind: "distribute-counters";
          readonly amount: AmountIR;
          readonly counter: string;
          readonly among: TargetRequirement;
      }
    | {
          /**
           * CR 603.7a / 603.7c — "For each <kind> counter you put on a
           * creature this way, remove a <kind> counter from that creature at
           * the beginning of the next cleanup step" (or end step): a delayed
           * triggered ability created now, whose body takes back, creature by
           * creature, the counters an EARLIER `distribute-counters` sentence
           * of the same ability put on. "This way" is anaphora (CR 608.2c),
           * so the sentence carries no subject: the lowering binds it to that
           * sentence and refuses every other site. Both counter words must
           * name the same kind.
           */
          readonly kind: "delayed-remove-distributed-counters";
          readonly counter: string;
          readonly timing: "next-cleanup-step" | "next-end-step";
      }
    | {
          /**
           * CR 601.2c + CR 120.3 — "{self} deals N damage to each of X
           * targets": ONE announced group of exactly X targets of any kind
           * ("any target"), each dealt the full amount (unlike the divided
           * form, nothing is split). The group's width is the cast's X, so
           * the lowering reads it as a sweep over the announced set rather
           * than a positional slot. `sourceIsPronoun` is the CR 608.2h marker
           * `deal-damage` carries, refused on the same condition.
           */
          readonly kind: "deal-damage-each-of-x-targets";
          readonly amount: AmountIR;
          readonly sourceIsPronoun?: true;
      }
    | {
          /**
           * CR 615.12 — "Damage can't be prevented this turn."
           *
           * A one-shot instruction with no subject at all: it names no source,
           * no recipient and no duration but the turn, which is precisely why
           * it lowers to the game-scoped `suppressDamagePrevention` Op rather
           * than to either narrower anti-prevention shape (`lockDamage` binds
           * ONE recipient, the `combat-damage-unpreventable` static binds ONE
           * source and combat only). It carries no fields because the printed
           * sentence carries none — matched as an EXACT span, so a wording
           * that scopes the clause ("Damage from creature sources can't be
           * prevented this turn") fails the card instead of compiling to the
           * unscoped reading.
           */
          readonly kind: "suppress-damage-prevention";
      }
    | {
          /**
           * CR 615.12 + CR 614.9 — "Damage that would be dealt to that
           * creature this turn can't be prevented or dealt instead to another
           * permanent or player.": the RECIPIENT-bound twin of the line above,
           * both clauses on one creature for the rest of the turn. The subject
           * is anaphora (CR 608.2c), resolved by the lowering like every other
           * "that creature"; an announced subject ("… dealt to target
           * creature …") and either clause alone are neighbours, refused.
           */
          readonly kind: "lock-damage";
          readonly subject: SubjectIR;
      }
    | {
          /**
           * CR 615.7 — "Prevent the next N damage that would be dealt to
           * <recipient> this turn."
           *
           * A prevention SHIELD of a printed size: each 1 damage dealt to the
           * shielded permanent or player is prevented and shrinks the shield
           * by 1. `amount` is the printed number and nothing else — an X or a
           * "that much" shield is a different clause the corpus prints under
           * its own gap. `to` is the recipient phrase, read by the one
           * subject rule so a slot it announces goes through the same
           * allocation every damage verb uses; `duration` is the printed
           * "this turn".
           */
          readonly kind: "prevent-next-damage";
          readonly amount: number;
          readonly to: SubjectIR;
          readonly duration: DurationIR;
      }
    | {
          /**
           * CR 609.7a / 615.1a — "The next time a[n] <qualifier> source of
           * your choice would deal damage to you this turn, prevent that
           * damage."
           *
           * The source is CHOSEN as the effect is created, never targeted:
           * any permanent or any spell on the stack, narrowed by the printed
           * qualifier — one colour word, two joined by "or" (either colour
           * qualifies), or the card type "artifact" / "land"; nothing for "a
           * source of your choice". ONE damage event from it to you is
           * prevented. `phrase` is the printed "<qualifier> source", read
           * back into the choice prompt; `duration` is the printed "this
           * turn".
           */
          readonly kind: "prevent-next-damage-from-chosen-source";
          readonly colors?: readonly Color[];
          readonly cardType?: CardType;
          readonly phrase: string;
          readonly duration: DurationIR;
      }
    | {
          /**
           * CR 615.1a — "Prevent all combat damage that would be dealt to and
           * dealt by <this creature> this turn."
           *
           * A per-instance two-way shield (Maze of Ith / Ebony Horse's
           * `preventDamage` mode "combat-to-and-by"). `subject` is read by the
           * one subject rule and the lowering refuses everything but the
           * ability's own source: a printed "target creature" is the
           * announced-slot form no corpus card prints under this clause.
           */
          readonly kind: "prevent-combat-damage-to-and-by";
          readonly subject: SubjectIR;
          readonly duration: DurationIR;
      }
    | {
          /**
           * CR 701.14a — "<creature> fights <other>": each deals damage equal
           * to its power to the other. Both sides are read by the one subject
           * rule, in printed order, so two announced targets take slots 0 and
           * 1 as printed (Triangle of War); the lowering admits a creature
           * target or the ability's own source on either side.
           */
          readonly kind: "fight";
          readonly creature: SubjectIR;
          readonly other: SubjectIR;
      }
    | {
          /**
           * CR 615.1a + CR 510.2 — "Prevent all combat damage that would be
           * dealt by <object> this turn."
           *
           * A SOURCE-side shield: whatever combat damage the named object
           * would deal this turn, to any recipient, is prevented (`preventDamage`
           * mode "all-from-source" with `combatOnly`). `subject` is read by the
           * one subject rule; the lowering accepts an announced target only.
           */
          readonly kind: "prevent-combat-damage-by";
          readonly subject: SubjectIR;
          readonly duration: DurationIR;
      }
    | {
          /**
           * CR 614.9 — "The next N damage that would be dealt to <recipient>
           * this turn is dealt to <other recipient> instead."
           *
           * A REDIRECTION, not a prevention: nothing is erased, the recipient
           * is rewritten. `amount` is the printed budget — a number or the
           * announced {X}, which is the only reason it is an `AmountIR` here
           * where the prevention shield beside it takes a bare number.
           * `from` and `to` are read by the one subject rule, and the
           * lowering refuses every pair the engine cannot announce as one
           * distinct-targets group.
           */
          readonly kind: "redirect-next-damage";
          readonly amount: AmountIR;
          readonly from: SubjectIR;
          readonly to: SubjectIR;
          readonly duration: DurationIR;
      }
    | {
          readonly kind: "draw";
          readonly player: PlayerRefIR;
          readonly count: AmountIR;
      }
    /**
     * CR 705.2 (issue #3813, ADR 0144) — "Choose a number. Flip a coin that
     * many times or until you lose a flip, whichever comes first. If you win
     * all the flips, draw <perFlip> cards for each flip." Folded from three
     * marker sentences by `assembleSentences` (`coinFlipSeries.ts`); never
     * read from one sentence.
     */
    | {
          readonly kind: "coin-flip-series";
          /** Who draws the payoff (the only payoff form read is a draw). */
          readonly player: PlayerRefIR;
          /** Cards drawn for each flip made. */
          readonly perFlip: number;
      }
    | {
          readonly kind: "destroy";
          readonly subject: SubjectIR;
          readonly cantBeRegenerated: boolean;
          /**
           * CR 202.3 — "Destroy target artifact if its mana value
           * is 2 or less": the target is announced regardless and the
           * destruction happens only if the mana value read when the spell
           * resolves is within the bound. Only ever on an announced target.
           */
          readonly manaValueAtMost?: number;
      }
    | {
          /**
           * CR 701.13a — exile a permanent: put it into the exile zone from the
           * battlefield. The subject is always an announced target; a sweep
           * ("exile all creatures") and a card in a graveyard (`move-zone`) are
           * other shapes.
           */
          readonly kind: "exile";
          readonly subject: SubjectIR;
      }
    | {
          /**
           * CR 701.6a — counter a spell on the stack.
           *
           * The subject is always an announced spell target: nothing else is
           * counterable by this grammar, and a sweep ("counter all spells")
           * announces nothing and is refused where every other sweep is.
           *
           * `unlessPays` is CR 118.12a's PUNISHER half — "…, unless its
           * controller pays <tax>" — kept on the counter rather than modelled
           * as a separate sentence because the tax and the counter are one
           * instruction: the payment is offered only so that the counter may
           * be skipped, and a tax lowered beside a counter it did not gate
           * would price nothing.
           */
          readonly kind: "counter";
          readonly subject: SubjectIR;
          readonly unlessPays?: CounterTaxIR;
          /**
           * CR 701.6a + CR 113.7a — the rider "If a permanent's ability is
           * countered this way, destroy that permanent." Set by the fold of a
           * `destroy-countered-source` modifier; never by the counter rule.
           */
          readonly destroysCounteredSource?: true;
      }
    | {
          /**
           * CR 122.1 + CR 701.21a — "If there are three or more depletion
           * counters on this enchantment, sacrifice it": the source's own
           * tally, read when the sentence resolves, gates its sacrifice.
           */
          readonly kind: "sacrifice-source-at-counters";
          readonly counter: string;
          readonly atLeast: number;
      }
    | {
          /**
           * CR 702.33g (Kicker) + CR 115.2 — "counter that spell if its mana
           * value is N or less instead": the kicked half of a counter whose base target
           * already carries a mana-value limit. It announces no target of its
           * own — "that spell" is the one the base counter names — so it is a
           * SWAP of the spell's announced requirement, legal only inside a
           * kicker gate (lowering refuses it anywhere else).
           */
          readonly kind: "counter-limit-instead";
          readonly mvMax: number;
      }
    | {
          /**
           * CR 115.7a — "change the target of target spell with a single
           * target": the controller redirects an announced spell to another
           * legal target. The subject is always the announced stack slot
           * carrying `spellSingleTarget` (CR 115.7) — the one phrase this
           * grammar reads; "change a target" / "choose new targets" (CR
           * 115.7b–d) are different instructions and stay refused.
           */
          readonly kind: "retarget";
          readonly subject: SubjectIR;
      }
    | {
          readonly kind: "tap-untap";
          readonly action: "tap" | "untap";
          readonly subject: SubjectIR;
          /**
           * CR 106.4 — "… and that player loses all unspent mana": the sweep's
           * announced player (`targetPlayerControls`) also loses their pool.
           * Present only on a tap sweep over a target player's permanents.
           */
          readonly thenDrainsManaPool?: true;
      }
    | { readonly kind: "regenerate"; readonly subject: SubjectIR }
    | {
          /**
           * CR 701.26b + CR 109.2 — "untap up to seven lands": the controller
           * CHOOSES, as the sentence resolves, up to `max` permanents of one
           * type from EVERY player's battlefield (the phrase prints no "you
           * control", so an opponent's land is as legal a pick) and untaps
           * them. Nothing is announced, so it is not a `tap-untap` target.
           */
          readonly kind: "untap-chosen-permanents";
          readonly filter: EffectCardFilter;
          readonly max: number;
          readonly phrase: string;
      }
    /**
     * CR 509.1b — "<target creature> can't block / be blocked
     * this turn": a turn-scoped combat restriction on ONE announced
     * creature. A sweep ("Creatures can't block this turn") is a different
     * rule — it also binds creatures that arrive later — and is refused.
     */
    | {
          readonly kind: "combat-restriction";
          readonly restriction: CombatRestrictionIR;
          readonly subject: SubjectIR;
      }
    /**
     * CR 510.1c — "<this creature> assigns no combat damage this turn": a
     * turn-scoped suppression of the damage the SOURCE assigns, not a
     * prevention of damage dealt to it (CR 615.1a — the word "prevent" is a
     * different shield). Only the self spelling is read: a standalone corpus
     * card naming another creature earns the wider subject.
     */
    | { readonly kind: "assigns-no-combat-damage" }
    /**
     * CR 508.1c — "Until your next turn, you can't be attacked
     * except by creatures with flying and/or islandwalk": a player-scoped
     * attack restriction (it binds the attackers declared against the
     * controller, not a permanent) that lasts until the controller's next
     * turn begins. Only that printed duration and that carve-out are read.
     */
    | { readonly kind: "player-attack-protection" }
    /**
     * CR 510.1c + CR 608.2c — "<effect> and <this creature> assigns no combat
     * damage this turn": the head effect, then the suppression, in printed
     * order. A wrapper over an already-read sentence, like `optional`: the
     * head is read by the rule that reads it alone.
     */
    | {
          readonly kind: "effect-and-assigns-no-combat-damage";
          readonly effect: EffectSentenceIR;
      }
    /**
     * CR 509.1c — "<target creature> blocks this creature this turn if able":
     * a turn-scoped block requirement on ONE announced creature, naming the
     * ability's own source as the attacker (issue #3713). Only the self
     * spelling is read — a requirement naming another attacker is a different
     * clause and stays a Grammar Gap.
     */
    | { readonly kind: "forced-block"; readonly subject: SubjectIR }
    /**
     * CR 701.19c — "<target creature> can't be regenerated this turn": the
     * turn-scoped suppression of a regeneration shield, on an announced
     * creature. The modifier form ("It can't be regenerated.") is
     * `ModifierIR`, folded into the destroy before it.
     */
    | { readonly kind: "prevent-regeneration"; readonly subject: SubjectIR }
    | {
          /**
           * CR 701.19c + CR 608.2c — "A creature dealt damage this way can't
           * be regenerated this turn": the same lock as above, on the ONE
           * target an earlier sentence of the ability damaged. The sentence
           * carries no subject (anaphora); the lowering binds it to the single
           * announced target and refuses every other site. Only the "this
           * way" referent of a damaging sentence is read, nothing wider.
           */
          readonly kind: "prevent-regeneration-damaged";
      }
    /**
     * CR 305.1 + CR 101.2 + CR 514.2 — "Target player can't play lands this
     * turn": a turn-scoped per-player land-play lock, on the announced player.
     */
    | { readonly kind: "land-play-lock"; readonly player: "target" }
    /**
     * CR 101.2 + CR 601.2 / 602.2 — a turn-scoped lock on what a player may
     * cast or activate. `casting` is `"all"` (every spell) or the printed
     * card types the lock names; `activation` is the non-mana-ability half.
     */
    | {
          readonly kind: "player-lock";
          readonly player: "opponents" | "target" | "defending";
          readonly casting: "all" | readonly CardType[];
          readonly activation: boolean;
      }
    | {
          /**
           * CR 613.1b — "Gain control of target <permanent>": the effect's
           * controller becomes the announced permanent's controller (layer
           * 2). `whileYouControlSource` is CR 611.2b's one "for as long as"
           * duration this grammar reads — "… for as long as you control
           * <this object>"; absent, the change is indefinite. Every other
           * duration ("until end of turn", "for as long as <this> remains
           * tapped / on the battlefield") is refused: each is a different
           * engine condition, and a dropped one would be a permanent steal.
           */
          readonly kind: "gain-control";
          readonly subject: SubjectIR;
          readonly whileYouControlSource: boolean;
      }
    | {
          /**
           * CR 701.12a — "Exchange control of <this object> and up to one
           * target <permanent>": the source and the announced permanent swap
           * controllers, or neither does. `subject` is the announced
           * permanent; only the OPTIONAL announcement ("up to one") is read,
           * because the rider below makes the empty announcement meaningful.
           * Both flags are set by `assembleSentences` from the two sentences
           * that follow it, never by the exchange rule:
           * `sacrificeUnlessExchanged` is "If you don't or can't make an
           * exchange, sacrifice <this object>" (CR 701.21a) and
           * `resolvesIfTargetIllegal` is "This ability still resolves if its
           * target becomes illegal" (CR 608.2b), an ability-level fact the
           * triggered slot lifts onto the ability.
           */
          readonly kind: "exchange-control";
          readonly subject: SubjectIR;
          readonly sacrificeUnlessExchanged?: true;
          readonly resolvesIfTargetIllegal?: true;
      }
    | {
          /**
           * CR 701.3a — "Attach <this object> to target <permanent>": the
           * source moves onto the announced permanent without leaving the
           * battlefield. Only the SOURCE is ever the attached object — the
           * `attach` Op names no other mover.
           */
          readonly kind: "attach";
          readonly subject: SubjectIR;
      }
    | {
          readonly kind: "life";
          readonly action: "gain" | "lose";
          readonly player: PlayerRefIR;
          readonly amount: AmountIR;
      }
    | {
          readonly kind: "counters";
          readonly subject: SubjectIR;
          readonly counter: string;
          readonly count: AmountIR;
      }
    | {
          readonly kind: "move-zone";
          readonly subject: SubjectIR;
          readonly to: ZoneRefIR;
          /**
           * CR 110.2a + CR 400.7 — "onto the battlefield under your control":
           * the effect, not the card's owner, says who controls the new
           * object. Printed only with a battlefield destination.
           */
          readonly under?: "you";
      }
    | {
          /**
           * CR 404.2 — "Return the top creature card of your graveyard to the
           * battlefield" / "Exile the bottom card of target player's
           * graveyard": a DETERMINISTIC pick out of the ordered graveyard, no
           * target announced for the card itself (CR 115.1). `owner` is the
           * graveyard's owner: the ability's controller, or an announced
           * player.
           */
          readonly kind: "graveyard-end-card";
          readonly position: "top" | "bottom";
          readonly cardType: CardType | null;
          readonly owner: "you" | "target-player";
          readonly to: "battlefield" | "exile";
      }
    | {
          /**
           * CR 400.7 + CR 110.2a — "Return all enchantment cards from your
           * graveyard to the battlefield": every matching card, together,
           * without announcing a target.
           */
          readonly kind: "graveyard-sweep";
          readonly cardType: CardType;
      }
    | {
          /**
           * CR 113.6b + CR 400.7 — "return this card from your graveyard to
           * your hand / the battlefield": the source itself, named by the
           * sentence as sitting in the graveyard, so the ability it prints
           * functions from there. The battlefield form is the Aura's, CR
           * 303.4f: "attached to that creature" names the creature the head
           * fired for as the host the effect specifies.
           */
          readonly kind: "return-self-from-graveyard";
          readonly to: "hand" | "battlefield";
          readonly attachedTo?: "entering-creature";
      }
    | {
          /**
           * CR 101.4 + CR 400.7 — "Each player [may] put[s] a <type> card from
           * their graveyard/hand onto the battlefield": every player, in
           * APNAP order, picks one of their own cards of the listed types.
           */
          readonly kind: "each-player-puts";
          readonly from: "graveyard" | "hand";
          readonly types: readonly CardType[];
          readonly optional: boolean;
      }
    | {
          /**
           * CR 400.7 + CR 205.3 — "[You may] put a <Subtype> permanent card
           * from your hand onto the battlefield": the controller picks one
           * card of that creature type that is not an instant or sorcery. The
           * "may" is the enclosing `optional` wrapper's, folded into the
           * pick's 0..1 count at lowering.
           */
          readonly kind: "put-subtype-from-hand";
          readonly subtype: string;
      }
    | ({
          /**
           * CR 111.1 — create one or more creature tokens whose
           * characteristics the sentence defines (CR 111.3). Read by the
           * `tokenSpec.ts` sub-grammar; the controller creates them
           * (CR 111.2), the only creator this form prints.
           */
          readonly kind: "create-token";
      } & CreateTokenIR)
    | {
          /**
           * CR 701.17a — "<player> mills N cards" / "Mill N cards": the top N
           * cards of that player's library go to their graveyard. The bare
           * imperative is the controller's own library ("you").
           */
          readonly kind: "mill";
          readonly player: PlayerRefIR;
          readonly count: AmountIR;
      }
    | {
          /**
           * CR 701.24a + CR 401.4 — "You may have that player shuffle": the
           * controller decides, and the player whose library the sentence
           * before looked at shuffles it (Portent, Natural Selection). The
           * decision is part of the sentence (the spell site has no "you may"
           * wrapper), so the shuffle alone is never read. "That player" is
           * anaphora (CR 608.2c) the lowering resolves against the walk's
           * last-looked-at library, and refuses with none.
           */
          readonly kind: "optional-shuffle-that-player-library";
      }
    | {
          /**
           * CR 701.24a + CR 404.1 — "Target player shuffles up to N target
           * cards from their graveyard into their library": that player's
           * graveyard cards are chosen (up to N, the controller picks), moved
           * into their library, and the library is shuffled.
           */
          readonly kind: "shuffle-graveyard-into-library";
          readonly player: PlayerRefIR;
          /** The printed count word ("two"), kept for the choice prompt. */
          readonly word: string;
          readonly max: number;
      }
    | {
          /**
           * CR 400.3 — "return a blue or black creature you control to its
           * owner's hand": the controller CHOOSES one of their own permanents
           * as the sentence resolves; nothing is announced. `phrase` is the
           * printed clause, kept for the prompt the chooser reads.
           */
          readonly kind: "return-own-permanent";
          readonly filter: EffectCardFilter;
          readonly phrase: string;
      }
    | {
          /**
           * CR 404.1 + CR 701.13a — "Exile target player's graveyard": every
           * card in that player's graveyard moves to exile. The player is an
           * announced target; the zone is the whole pile, not a card in it
           * (`move-zone` is the single-card shape).
           */
          readonly kind: "exile-graveyard";
          readonly player: PlayerRefIR;
          /**
           * CR 205.4a — "all cards from <player>'s graveyard other than basic
           * land cards": every card EXCEPT one that is both a land and basic
           * (a nonbasic land and a basic-typed nonland both go).
           */
          readonly exceptBasicLands?: true;
      }
    | {
          /**
           * CR 608.2c + CR 400.7 + CR 701.23a — "Exile all cards from target
           * player's graveyard other than basic land cards. For each card
           * exiled this way, search that player's library for all cards with
           * the same name as that card and exile them.": the graveyard
           * sentence, folded with the per-card library sweep that reads its
           * result. Alone, the second sentence has no antecedent and fails.
           * `shuffle` is the printed "Then that player shuffles" sentence,
           * folded in the same way a search-target-library one is.
           */
          readonly kind: "exile-graveyard-and-library-copies";
          readonly player: PlayerRefIR;
          readonly shuffle: boolean;
      }
    | {
          /**
           * CR 608.2c — "For each card exiled this way, search that player's
           * library for all cards with the same name as that card and exile
           * them.": the sentence after an `exile-graveyard`, folded into
           * `exile-graveyard-and-library-copies` by the sentence-list
           * assembler. Alone it names no exiled cards and fails.
           */
          readonly kind: "exile-same-name-library-copies";
      }
    | {
          /**
           * CR 401.4 — "<player> puts N cards from their hand on top of their
           * library [in any order]": the player CHOOSES the cards (and, for
           * more than one, their order).
           */
          readonly kind: "put-back";
          readonly player: PlayerRefIR;
          readonly count: number;
      }
    | {
          /**
           * CR 121.1 + CR 401.4 — "Draw N cards, then put M cards from your
           * hand on top of your library [in any order]": one sentence, two
           * actions in printed order (the loot's counterpart that keeps the
           * cards instead of discarding them).
           */
          readonly kind: "draw-put-back";
          readonly draw: AmountIR;
          readonly count: number;
      }
    | {
          /**
           * CR 608.2n + CR 701.24a — "Shuffle {self} into its owner's
           * library": the resolving spell goes into its owner's library
           * instead of its graveyard. Spell sites only; the lowering refuses
           * every other site (an ability has no card to shuffle).
           */
          readonly kind: "shuffle-self-into-library";
      }
    | {
          /**
           * CR 610.3 — "Exile <target> until {self} leaves the battlefield":
           * a one-shot exile whose return is a SECOND one-shot effect created
           * when the source leaves (CR 610.3c: under its owner's control). The
           * subject is one announced battlefield target, as the plain exile's
           * is; "that card" (from a hand), a sweep and "phases out until" are
           * neighbours, refused.
           */
          readonly kind: "exile-until-leaves";
          readonly subject: SubjectIR;
      }
    | {
          /**
           * CR 607.2a — "Return the exiled card to the
           * battlefield under its owner's control." / "… to its owner's
           * hand.": the card this object's LINKED exile instruction exiled
           * comes back. Read as a whole phrase, since "the exiled card" is
           * anaphora across abilities, not a target. The battlefield return
           * is parsed so its refusal is precise (`linkExile.ts` — the bundle
           * Op is a CR 610.3 duration, this is not); the hand return lowers
           * to the `exiledWithSource` selector the card pass links. The
           * plural is a neighbour, refused here.
           */
          readonly kind: "return-exiled";
          readonly to: "battlefield" | "hand";
      }
    | {
          /**
           * CR 607.2a + CR 110.2a — "Each player returns to the battlefield
           * all cards they own exiled with it.": every card this object's
           * LINKED exile instruction exiled comes back, each put there by its
           * owner (so under its owner's control). No duration (CR 610.3 does
           * not apply): a card exiled after the source left stays exiled.
           * The hand twin ("… returns to their hand …") is a neighbour,
           * refused here.
           */
          readonly kind: "return-all-exiled-with";
      }
    | {
          /**
           * CR 601.3 + CR 305.1 — "Until end of turn, you may play lands and
           * cast spells from your graveyard.": a turn-scoped permission for
           * the ability's controller to play cards from their OWN graveyard
           * (Yawgmoth's Will). Exactly the printed pair of actions; one action
           * alone, a mana-value cap, or another player's graveyard is a
           * neighbour, refused.
           */
          readonly kind: "graveyard-play";
      }
    | {
          /**
           * CR 614.1a — "If a card would be put into your graveyard from
           * anywhere this turn, exile that card instead.": a turn-scoped
           * replacement on the controller's graveyard (Yawgmoth's Will's
           * second sentence). "An opponent's graveyard" and a permanent-bound
           * "as long as" redirect (Dauthi Voidwalker) are neighbours, refused.
           */
          readonly kind: "graveyard-redirect";
      }
    | {
          /**
           * CR 614.1a — "If that creature would die this turn, exile it
           * instead.": a turn-scoped replacement armed on the creature an
           * earlier sentence of the same ability named. "That creature" is
           * anaphora (CR 608.2h), so the sentence carries no subject: the
           * lowering binds it to the ONE creature target announced before it
           * and refuses every other site. The "creature or planeswalker" and
           * "a creature dealt damage this way" forms are neighbours, refused
           * here: the Op arms creatures only, and it names one object.
           */
          readonly kind: "exile-if-dies";
      }
    | {
          /**
           * CR 603.7a + CR 700.4 — "When the creature dies this turn, exile
           * the creature.": a delayed triggered ability created now, watching
           * the creature an earlier sentence named, whose body exiles the card
           * that creature became in the graveyard. Not the replacement above:
           * the creature DIES (CR 700.4 — its dies triggers fire) and only then
           * is exiled. The subject is anaphora (CR 608.2c), resolved by the
           * lowering like every other "that creature". Other bodies behind the
           * same head ("When that creature dies this turn, you gain 3 life")
           * are neighbours, refused here.
           */
          readonly kind: "exile-when-dies";
          readonly subject: SubjectIR;
      }
    | {
          /**
           * CR 608.2n — "Exile {self}": the resolving spell goes to exile
           * instead of its owner's graveyard (Restock). Spell sites only, like
           * its library twin above; on a permanent's ability the same words
           * exile a PERMANENT (or, from a graveyard, a card), which is not this
           * Op, so the lowering refuses every other site.
           */
          readonly kind: "exile-self";
      }
    | {
          /**
           * CR 701.44a — "<subject> explores": one permanent explores once.
           * "explores X times" / "explores again" are other sentences.
           */
          readonly kind: "explore";
          readonly subject: SubjectIR;
      }
    | {
          readonly kind: "discard-at-random";
          readonly player: PlayerRefIR;
          readonly count: AmountIR;
      }
    | {
          /**
           * CR 603.7a — "You draw N cards at the beginning of the next turn's
           * upkeep": a delayed triggered ability created by the resolving
           * effect (CR 603.7), fired once at the next upkeep step of ANY
           * player. The body is the draw alone; other delayed bodies and
           * timings are other forms.
           */
          readonly kind: "delayed-draw-next-upkeep";
          readonly count: AmountIR;
      }
    | {
          /**
           * CR 603.7a — "Exile it at the beginning of the next end step" /
           * "Sacrifice it …": a delayed triggered ability created by the
           * resolving effect, whose body removes the object an EARLIER
           * sentence of the same ability put onto the battlefield (a token
           * just created, CR 111.1, or a card just returned, CR 400.7j). "It"
           * is anaphora (CR 608.2h), so the sentence carries no subject: the
           * lowering binds it to that object and refuses every other site.
           * "Exile them …" (several tokens) and the cleanup-step timing are
           * neighbours, refused here.
           */
          readonly kind: "delayed-removal";
          readonly verb: "exile" | "sacrifice";
      }
    | {
          /**
           * CR 603.7a — "Return it / that card / this land to its owner's
           * hand at the beginning of the next end step" (or cleanup step), and
           * "Return it / that card to the battlefield under its owner's control
           * at the beginning of the next end step": a delayed triggered ability
           * whose body is one zone move of the object an earlier sentence (or
           * the source itself) names. The referent is anaphora (CR 608.2h), so
           * the sentence carries no subject: the lowering binds it or refuses.
           * Riders ("with a +1/+1 counter on it", "and you skip your next draw
           * step") are neighbours, refused here.
           */
          readonly kind: "delayed-return";
          readonly referent: "it" | `this ${string}`;
          readonly destination: "hand" | "battlefield";
          readonly timing: "next-end-step" | "next-cleanup-step";
      }
    | {
          /**
           * CR 201.4 — "Choose a [nonland] card name": the pick the SAME
           * ability's later sentence reads as "that name" (a `discard-named-
           * from-hand` or `dig-named-to-hand`). `prompt` is the printed
           * sentence, shown to the chooser; `restriction` is CR 201.4a's
           * narrowing of the legal names.
           */
          readonly kind: "name-card";
          readonly prompt: string;
          readonly restriction?: NameRestriction;
      }
    | {
          /**
           * CR 701.20a + CR 701.9a — "<player> reveals their hand and
           * discards all cards with that name": reads the pick of a
           * preceding `name-card`.
           */
          readonly kind: "discard-named-from-hand";
          readonly player: PlayerRefIR;
      }
    | {
          /**
           * CR 701.20a — "Reveal the top N cards of your library
           * and put all of them with that name into your hand. Exile the
           * rest.": reads the pick of a preceding `name-card`.
           */
          readonly kind: "dig-named-to-hand";
          readonly count: AmountIR;
      }
    | {
          /**
           * CR 400.2 — "Look at <player>'s hand": a PRIVATE look at the whole
           * hand (a hand is a hidden zone), shown to the controller alone. The
           * public "reveals their hand" is a different game action (CR 701.20a)
           * with a different audience and is not read here.
           */
          readonly kind: "look-hand";
          readonly player: PlayerRefIR;
      }
    | {
          /**
           * CR 400.2 — "Look at a card at random in <player>'s hand": the
           * one-card private look, the card picked by the game's seeded PRNG.
           */
          readonly kind: "look-random-hand";
          readonly player: PlayerRefIR;
      }
    | {
          /**
           * CR 701.20a + CR 701.9b — "<player> reveals their hand. You choose
           * <a card> from it. That player discards that card." (or "… and
           * exile that card" / "Exile that card."): the hand is shown to every
           * player, the CONTROLLER picks one card the description matches
           * (CR 701.9b's "another player chooses"), and that card is
           * discarded or exiled (CR 701.13a). Folded by `assembleSentences`
           * from the `hand-reveal` / `hand-pick` / `hand-pick-route` sentence
           * roles; none is an effect alone. `filter` is a closed vocabulary
           * (`HAND_PICK_FILTERS`), `phrase` the printed noun phrase for the
           * prompt.
           */
          readonly kind: "reveal-hand-pick";
          readonly player: PlayerRefIR;
          readonly filter: EffectCardFilter;
          readonly phrase: string;
          readonly route: HandPickRoute;
      }
    | {
          /**
           * CR 608.2c + CR 701.13a / CR 701.9a — "You may exile / discard a
           * card from your hand. If you do, <effect>.": an optional move of
           * one of the controller's own hand cards that gates the effect
           * after it.
           * Folded by `assembleSentences` from the `optional-hand-cost` and
           * `if-you-do` roles; either alone is refused.
           */
          readonly kind: "optional-hand-cost-then";
          readonly action: "exile" | "discard";
          readonly clause: string;
          readonly effect: EffectSentenceIR;
      }
    | {
          /**
           * CR 121.1 + CR 119.4 — "Draw N additional cards. Choose M cards in
           * your hand drawn this turn. For each of those cards, pay L life or
           * put the card on top of your library.": the draw, then the ranged
           * 0..M pick among the cards drawn this turn, each one NOT kept
           * costing L life. Folded by `assembleSentences` from the
           * `optional-draw-additional`, `choose-drawn-this-turn` and
           * `pay-life-or-topdeck` roles; any one alone is refused. The fold
           * is wrapped in an `optional` (the draw is a "may", CR 603.5).
           */
          readonly kind: "draw-then-ranged-topdeck";
          readonly count: number;
          readonly max: number;
          readonly costPerKept: number;
      }
    | {
          /**
           * CR 701.9a — "<player> discards N cards": by default the affected
           * player CHOOSES which cards (CR 701.9b), the counterpart of
           * `discard-at-random`, which lets the game pick.
           */
          readonly kind: "discard";
          readonly player: PlayerRefIR;
          readonly count: AmountIR;
      }
    | {
          /**
           * CR 118.12a — "sacrifice <this permanent> unless you <payment>": the
           * controller pays to keep the source or loses it. ONE instruction,
           * carried as one sentence so the payment is offered only to gate the
           * sacrifice (the `counter … unless` twin above).
           *
           * The subject is the source or the site's pronoun for it ("sacrifice
           * it"); any other object is a different rule and is refused.
           */
          readonly kind: "sacrifice-unless";
          readonly subject: SubjectIR;
          readonly payment: UnlessPaymentIR;
      }
    | {
          /**
           * CR 701.21a — "<player> sacrifices a <permanent filter> [of their
           * choice]": an EDICT. "Of their choice" names the chooser — the
           * sacrificing player — and the pool is their own permanents (CR
           * 701.21a: a player can't sacrifice a permanent they don't control),
           * so a sentence without the phrase means the same thing.
           *
           * `phrase` is the printed "a creature" / "two creatures", kept for
           * the prompt the chooser reads. `count` is the printed number; the
           * pick clamps to what the player controls (CR 101.3).
           */
          readonly kind: "sacrifice";
          readonly player: PlayerRefIR;
          /** A printed number, or "that many" — the damage a damage head
           *  dealt or took (CR 120.3), read by the lowering's `lowerAmount`. */
          readonly count: AmountIR;
          readonly filter: EffectCardFilter;
          /** CR 608.2h — "with the greatest power among creatures they
           *  control": the pick narrows to the permanents tied for the extreme
           *  stat. Absent for the plain edict. */
          readonly superlative?: EffectChoiceSuperlative;
          readonly phrase: string;
      }
    | {
          /**
           * CR 701.26a + CR 109.2 — "<player> taps an untapped <permanent
           * types> they control for each <type> counter on this <noun>": the
           * named player CHOOSES, among their own untapped permanents, as
           * many as the source has counters of `counterType` (a count read
           * live as the sentence resolves, CR 122.1), and taps them. Fewer
           * candidates than counters taps what exists (CR 101.3).
           */
          readonly kind: "tap-chosen-per-counter";
          readonly player: PlayerRefIR;
          readonly filter: EffectCardFilter;
          readonly counterType: string;
          readonly phrase: string;
      }
    | {
          /**
           * CR 608.2c — "You <verb phrase> and you <verb phrase>": two
           * instructions in ONE printed sentence, carried out in the order
           * printed. The repeated explicit "you" is what makes the second
           * half an independent clause (a shared subject with an elided
           * second one — "draws two cards and loses 2 life" — is a different
           * printed form and is not read here).
           *
           * A WRAPPER over already-read sentences, like `optional` and
           * `kicked`: each half is read by the SAME rule that reads it as a
           * sentence of its own, so a half this grammar does not know fails
           * the line instead of being skipped, and lowering walks the halves
           * in order through the shared walk.
           */
          readonly kind: "conjunction";
          readonly effects: readonly EffectSentenceIR[];
      }
    | {
          /**
           * CR 603.2 — "…, you may <effect>." The controller decides on
           * resolution and declining does NOTHING.
           *
           * A WRAPPER around one sentence rather than a flag on each member:
           * every effect the grammar already reads becomes optional at once,
           * the lowering has ONE place to emit the decision, and the inner
           * sentence is lowered by the SAME walk — so "you may tap target
           * creature" announces its target through the shared slot allocator
           * exactly as the non-optional sentence does.
           */
          readonly kind: "optional";
          /**
           * The inner clause AS PRINTED, which is what the player is asked.
           * The compiler has no better phrasing to offer a prompt than the
           * words the card itself uses, and inventing one would be a claim
           * about the card the Oracle text does not make (the argument
           * `lowerSpell.ts` makes for a mode's picker label).
           */
          readonly clause: string;
          readonly effect: EffectSentenceIR;
      }
    | {
          /**
           * CR 702.33e — "If this spell was kicked[ with its {A} kicker],
           * <effect>." A linked ability that does its work only if the kicker
           * cost it reads was paid as the spell was cast.
           *
           * A WRAPPER for the reason `optional` is one: every effect sentence
           * the grammar already reads becomes kicker-gated at once, and the
           * inner sentence is lowered by the SAME walk, which is how lowering
           * sees — and refuses — a target announced inside the gate
           * (CR 702.33g: such a target is chosen "only if that spell was
           * kicked", which a single card-level `targetRequirement` cannot say).
           */
          readonly kind: "kicked";
          readonly kicked: KickedRefIR;
          readonly effect: EffectSentenceIR;
      }
    | {
          /**
           * CR 608.2c + CR 109.5 — "If an opponent controls more lands than
           * you, <effect>." A leading comparison the effect is gated on when the
           * spell resolves. A WRAPPER like `kicked`, so every effect sentence
           * the grammar reads can sit behind it and lowering sees the inner
           * sentence through the same walk.
           */
          readonly kind: "controls-more";
          readonly condition: ComparativeControlsIR;
          readonly effect: EffectSentenceIR;
      }
    | {
          /**
           * CR 702.33e + CR 608.2c — "<base>. If it was kicked, <replacement>
           * instead." Two printed sentences, one effect: the second REPLACES the
           * first when the permanent's spell was kicked, and the first happens
           * otherwise. Both halves are sweeps of the same verb (the only form
           * the corpus prints), so neither announces a target and there is no
           * shared object to keep identical.
           */
          readonly kind: "replace-if-kicked";
          readonly kicked: KickedRefIR;
          readonly base: EffectSentenceIR;
          readonly replacement: EffectSentenceIR;
      }
    | {
          /**
           * CR 701.20a / CR 401.4 — "Look at [or Reveal] the top N cards of
           * your library. Put <which> into your hand and the rest <where>."
           *
           * TWO printed sentences, one effect: the first names the window,
           * the second says where its cards go, and neither means anything
           * alone (CR 608.2c — later text modifies the meaning of earlier
           * text). Each is parsed as its own sentence ROLE and
           * `assembleSentences` folds them here, the way it folds "It can't be
           * regenerated." onto its destroy — so a window with no routing, or a
           * routing with no window in front of it, fails the line.
           */
          readonly kind: "look-distribute";
          /** CR 701.20a — "reveal" shows the window to every player. */
          readonly reveal: boolean;
          readonly count: AmountIR;
          readonly route: LibraryRouteIR;
      }
    | {
          /**
           * CR 701.20a — "Reveal the top card of your library and put that
           * card into your hand." One sentence, one card: nothing is left over
           * to route, so it is no `look-distribute`. `lifeLoss` is the
           * "You lose life equal to its mana value." sentence behind it, folded
           * on by `assembleSentences` because "its" reads the revealed card
           * (CR 608.2c) and means nothing alone.
           */
          readonly kind: "reveal-top-to-hand";
          readonly lifeLoss: boolean;
      }
    | {
          /**
           * CR 701.20a / CR 400.7 — "Reveal cards from the top of your library
           * until you reveal a <card>. Put that card <where> and the rest
           * <elsewhere>." Two printed sentences, one effect: the first names
           * what ends the reveal, the second where the first match and all the
           * others go. Folded by `assembleSentences`; either half alone is
           * refused.
           */
          readonly kind: "reveal-until";
          readonly filter: EffectCardFilter;
          readonly match: UntilRouteDestination;
          readonly rest: UntilRouteDestination;
      }
    | {
          /**
           * CR 603.3d + CR 701.20a — "<Head player> chooses target player who
           * controls more creatures than they do and is their opponent. The
           * first player may reveal cards from the top of their library until
           * they reveal a creature card. If the first player does, that player
           * puts that card onto the battlefield and all other cards revealed
           * this way into their graveyard." Three printed sentences, one
           * effect, folded by `assembleSentences`: the head's player (an "each
           * player's upkeep" head) digs and routes, the announced player only
           * qualifies the trigger's target.
           */
          readonly kind: "first-player-may-reveal-until";
          readonly filter: EffectCardFilter;
          readonly match: UntilRouteDestination;
          readonly rest: UntilRouteDestination;
      }
    | {
          /**
           * CR 701.20a / CR 700.3 — a pile division of a revealed library
           * window: "Reveal the top N cards of your library. An opponent
           * separates those cards into two piles. Put one pile into your hand
           * and the other into your graveyard." The three printed sentences
           * (or the "separate them … An opponent chooses one of those piles"
           * variant) are one effect, folded by `assembleSentences`.
           */
          readonly kind: "divide-library-piles";
          readonly count: AmountIR;
          /** Who splits and who picks: an opponent splits and you pick
           *  ("separates"), or you split and an opponent picks ("chooses"). */
          readonly form: "separates" | "chooses";
      }
    | {
          /**
           * CR 701.23d (search) + CR 701.20a (reveal) — a searched pile another
           * player picks from: "Search your library for three cards and reveal
           * them. Target opponent chooses one. Put that card into your hand
           * and the rest into your graveyard. Then shuffle." The search is for
           * a bare QUANTITY, so the searcher must find that many (CR 701.23d); the
           * reveal is what lets the chooser see the pile at all. The four
           * printed sentences are one effect, folded by `assembleSentences`;
           * none is an effect alone.
           */
          readonly kind: "search-reveal-pile-pick";
          readonly count: number;
          /** Who picks from the revealed pile. */
          readonly chooser: PlayerRefIR;
      }
    | {
          /**
           * CR 401.4 — "Look at the top N cards of <player>'s library, then
           * put them back in any order." One sentence: no card leaves the
           * top of the library, the looker only re-arranges it.
           *
           * `looker` is who looks and orders. "you" at the head of the
           * sentence; "that-player" for the reply sentence Tahngarth's Glare
           * prints ("That player looks at the top three cards of your
           * library, then puts them back in any order"), whose referent is
           * the player whose library the sentence before it looked at. That
           * is the one piece of anaphora this sentence reads, and lowering
           * resolves it against the walk rather than here, where the previous
           * sentence is out of sight.
           */
          readonly kind: "look-reorder";
          readonly count: AmountIR;
          readonly library: PlayerRefIR;
          readonly looker: "you" | "that-player";
      }
    | {
          /**
           * CR 702.26b — "Target artifact, creature, or land phases out": one
           * announced permanent phases out until its controller's next untap
           * step. A sweep or a pronoun is not read (nothing prints it yet).
           */
          readonly kind: "phase-out";
          readonly subject: SubjectIR;
      }
    | {
          /**
           * CR 101.4 + CR 701.21a — "Each player chooses from among the
           * permanents they control an artifact, a creature, an enchantment,
           * and a land, then sacrifices the rest": every player (APNAP order)
           * keeps one permanent per listed type — one permanent may answer
           * several of them — and every player then sacrifices the rest, only
           * after all the choices are made.
           */
          readonly kind: "keep-one-of-each-permanent-type";
          readonly types: readonly CardType[];
      }
    | {
          /**
           * CR 101.4 + CR 701.21a / CR 701.9a — "Each player chooses … one
           * <permanent|card> of each <category>" over a closed category axis
           * (the five basic land types, the five colours): every player (APNAP
           * order) keeps one member per category — one member may answer
           * several — and `rest` says what happens to the others, only after
           * all the choices are made. `return-chosen` is the other leg: the
           * picked lands go to their owners' hands and nothing else is swept.
           */
          readonly kind: "choose-one-per-category";
          readonly axis: "basic-land-type" | "color";
          readonly rest: "sacrifice" | "discard-nonland" | "return-chosen";
      }
    | {
          /**
           * CR 701.22a — "Scry N": the controller looks at the top N cards of
           * their library, puts any number on the bottom and the rest back on
           * top in any order. One sentence, one action.
           */
          readonly kind: "scry";
          readonly count: AmountIR;
      }
    | {
          /**
           * CR 121.1 + CR 701.9a — "Draw N cards, then discard M cards": the
           * controller draws, then discards cards of their choice. One
           * sentence, two actions in printed order; the discard is a CHOICE
           * (never "at random", which is `discard-at-random`).
           */
          readonly kind: "loot";
          readonly draw: AmountIR;
          readonly discard: AmountIR;
      }
    | {
          /**
           * CR 701.24a + CR 121.1 — "Shuffle the cards from your hand into your
           * library, then draw that many cards.": the controller puts their
           * whole hand into their library, shuffles it, and draws as many cards
           * as the hand held. One sentence, two actions in printed order; "that
           * many" is the size of the hand BEFORE it moved, so lowering binds
           * that count when the hand moves rather than recounting afterwards.
           * Only the controller's own hand: the "each player" reading is a
           * different sentence with a different subject.
           */
          readonly kind: "shuffle-hand-redraw";
      }
    | {
          /**
           * CR 701.24a + CR 404.1 — "Shuffle your graveyard into your
           * library.": the controller puts their whole graveyard into their
           * library, then the library is shuffled. Only the controller's own
           * graveyard; a targeted or "each player" reading is a different
           * sentence.
           */
          readonly kind: "shuffle-own-graveyard-into-library";
      }
    | {
          /**
           * CR 701.23a (search) + CR 701.20a (reveal) + CR 701.24a (shuffle) — "Search your library for a
           * basic land card, reveal it, put it into your hand, then shuffle.":
           * the controller looks through their OWN library, may find one card
           * the description matches, shows it to every player, takes it, and
           * shuffles. One sentence, four actions in printed order.
           *
           * The find is optional (CR 701.23b — a search of a hidden zone for
           * cards with a stated quality never compels it), which is what makes
           * the reveal worth printing: it is how the other players learn what
           * was taken, and lowering keeps it in front of the move for the
           * reason `EffectOp`'s own `reveal` doc gives.
           *
           * `filter` is what the search may find, `phrase` the noun phrase
           * that named it, kept for the prompt. The accepted descriptions are
           * a closed vocabulary (`LIBRARY_SEARCH_FILTERS`): one this grammar
           * cannot turn into an `EffectCardFilter` fails the line rather than
           * searching wider than the card said.
           */
          readonly kind: "search-library-to-hand";
          readonly filter: EffectCardFilter;
          readonly phrase: string;
      }
    | {
          /**
           * CR 701.23a (search) + CR 701.24a (shuffle) + CR 110.5b — "Search
           * your library for a Forest or Plains card, put it onto the
           * battlefield, then shuffle.": the controller looks through their OWN
           * library, may find one card the description matches, puts it onto
           * the battlefield (tapped when the line says so) and shuffles. No
           * reveal: the line prints none, so the card is not shown to the
           * other players. The find is optional (CR 701.23b).
           *
           * `filter` and `phrase` are as `search-library-to-hand`'s; the
           * accepted whole clauses are a closed table
           * (`LIBRARY_SEARCH_TO_BATTLEFIELD`), so a description, pronoun or
           * tapped state with no printed form fails the line.
           */
          readonly kind: "search-library-to-battlefield";
          readonly filter: EffectCardFilter;
          readonly phrase: string;
          readonly tapped: boolean;
      }
    | {
          /**
           * CR 701.23a (search) + CR 701.20a (reveal) + CR 701.24a (shuffle) —
           * "Search your library for a creature card, reveal it,
           * then shuffle and put the card on top.": the controller looks
           * through their OWN library, may find one card the description
           * matches, shows it to every player, shuffles, and puts the found
           * card on top of the library. One sentence, four actions in printed
           * order: the shuffle comes BEFORE the placement (the shuffle would
           * otherwise bury the card it just placed), and the find is optional
           * (CR 701.23b).
           *
           * `filter` and `phrase` are as `search-library-to-hand`'s; the
           * accepted whole clauses are a closed table (`LIBRARY_SEARCH_TO_TOP`)
           * so a description or pronoun with no printed form fails the line.
           */
          readonly kind: "search-library-to-top";
          readonly filter: EffectCardFilter;
          readonly phrase: string;
      }
    | {
          /**
           * CR 701.23a (search) + CR 701.23b (stated quality) + CR 406.1 /
           * CR 404.1 (the denial routes) — "Search target player's library for
           * three cards and exile them [, then that player shuffles]": the
           * CONTROLLER looks through the library of a TARGET player and takes
           * cards out of it, so the opponent is denied them (exiled or milled).
           * The library owner is the announced target (`player`); the chooser
           * stays the controller.
           *
           * `count` is the printed number and `upTo` its "up to" form. A plain
           * count is mandatory: a search for plain "cards" states no quality
           * (CR 701.23b), so the controller must find as many as the library
           * holds. "up to N" is the optional range. The one quality read is
           * `flashback` ("with flashback", CR 702.34a), only behind "up to N";
           * any other quality fails rather than searching wider than the card
           * said.
           *
           * `shuffle` is the printed "then that player shuffles" — in the
           * sentence itself, or folded in from the sentence after it
           * (`shuffle-searched-library`).
           */
          readonly kind: "search-target-library";
          readonly player: PlayerRefIR;
          readonly count: number;
          readonly upTo: boolean;
          readonly flashback: boolean;
          readonly route: "exile" | "graveyard";
          readonly shuffle: boolean;
      }
    | {
          /**
           * CR 701.24a — "Then that player shuffles.": the sentence after a
           * `search-target-library`, folded into its `shuffle` flag by the
           * sentence-list assembler. Alone it names no library and fails.
           */
          readonly kind: "shuffle-searched-library";
      }
    | {
          /**
           * CR 608.2c — "<base>. If you control a <A> and a <B>, <upgraded>
           * instead." Two printed sentences, one effect: the second REPLACES
           * the first when every condition holds as the ability resolves, and
           * leaves it alone otherwise. `upgraded` is the base effect with only
           * its magnitude changed, sharing the base's subject objects — the
           * replacement acts on the SAME announced target (CR 601.2c: it was
           * chosen once, as the ability was put on the stack).
           *
           * Each condition is counted on its own, so one permanent that is
           * both colours satisfies both ("a blue permanent and a black
           * permanent" — a blue-black permanent is each of those).
           */
          readonly kind: "upgrade-if-controls";
          readonly conditions: readonly ConditionIR[];
          readonly base: EffectSentenceIR;
          readonly upgraded: EffectSentenceIR;
      };

/**
 * Where a looked-at window goes (CR 401.4), as the routing sentence prints it.
 *
 * `all-of-subtype` — "Put all <Subtype> cards revealed this way into your hand
 * and the rest on the bottom of your library in any order": every matching
 * card, no choice. `take` — "Put <N> of them into your hand and the rest
 * <rest>": the controller picks N.
 */
export type LibraryRouteIR =
    | { readonly kind: "all-of-subtype"; readonly subtype: string }
    | {
          readonly kind: "take";
          readonly count: AmountIR;
          readonly rest:
              | "bottom-any-order"
              | "bottom-random-order"
              | "graveyard";
          /**
           * "… and the OTHER on the bottom": the rest is exactly one card, so
           * the window must be two cards wide (CR 401.4 — one kept, one left).
           */
          readonly other?: true;
      };

/** Where a `reveal-until` sentence sends a card (the Op's own vocabulary). */
export type UntilRouteDestination =
    | "hand"
    | "battlefield"
    | "graveyard"
    | "exile";

/** CR 602.5 — a clause restricting WHEN the ability may be activated. */
export type RestrictionIR =
    /** CR 602.5d — "Activate only as a sorcery." */
    | { readonly kind: "sorcery-only" }
    /** CR 602.5b — "Activate only once each turn." */
    | { readonly kind: "once-per-turn" }
    /** CR 602.5 — "Activate only during your turn." */
    | { readonly kind: "your-turn-only" }
    /** CR 602.5 — "Activate only during your upkeep." */
    | { readonly kind: "phase"; readonly phase: Phase }
    /** CR 602.1 — "Any player may activate this ability." */
    | { readonly kind: "any-player" }
    /** CR 113.6/602.5b — "Activate only if this card is in your graveyard."
     *  (`ActivatedAbility.activateFromGraveyard`, Ashen Ghoul's shape.) */
    | { readonly kind: "activate-from-graveyard" }
    /** CR 602.1b (issue #3685) — "Activate only if there are N or more cards
     *  in your graveyard." (Threshold's spelled-out condition), lowered to a
     *  declarative `ActivatedAbility.activationCondition`. */
    | { readonly kind: "own-graveyard-at-least"; readonly count: number };

/** The two turn-scoped combat restrictions one announced creature can carry. */
export type CombatRestrictionIR = "cant-block" | "cant-be-blocked";

/** A sentence that modifies the sentence before it rather than acting itself. */
export type ModifierIR =
    | {
          readonly kind: "cant-be-regenerated";
          /** "They can't be regenerated." — the plural pronoun of a SWEEP. */
          readonly plural?: true;
      }
    /**
     * CR 701.6a + CR 113.7a — "If a permanent's ability is countered this way,
     * destroy that permanent.": the rider of a counter that can name an
     * ability, folded onto the `counter` in front of it by `assembleSentences`.
     */
    | { readonly kind: "destroy-countered-source" }
    /** CR 701.12a — "If you don't or can't make an exchange, sacrifice
     *  <this object>." (the sacrifice is CR 701.21a), folded onto the
     *  exchange in front of it. */
    | { readonly kind: "exchange-fallback-sacrifice" }
    /** CR 608.2b — "This ability still resolves if its target becomes
     *  illegal.", folded onto the exchange in front of it. */
    | { readonly kind: "resolves-if-target-illegal" }
    /** CR 205.1b — "They're still lands.": the animated set keeps its types. */
    | {
          readonly kind: "still-types";
          readonly types: readonly CardType[];
          /** "It's still a land." — the SOURCE's own animation, not a sweep. */
          readonly singular?: true;
      };

export type SentenceIR =
    | { readonly role: "effect"; readonly effect: EffectSentenceIR }
    | { readonly role: "restriction"; readonly restriction: RestrictionIR }
    | { readonly role: "modifier"; readonly modifier: ModifierIR }
    /**
     * CR 105.1 — "Choose a color.": a marker establishing the pick a LATER
     * sentence of the same ability reads as "the chosen color"
     * (`choose-color-grant-protection`). Diverted from `effects` by
     * `assembleSentences`, mirroring the `library-look` window — it carries
     * no effect of its own and is never lowered.
     */
    | { readonly role: "choose-color" }
    /**
     * CR 101.4 — "Each player chooses a land they control of each basic land
     * type.": the pick whose fate the NEXT sentence ("Return those lands to
     * their owners' hands.") names. Folded with it into one
     * `choose-one-per-category` by `assembleSentences`; either alone is refused.
     */
    | { readonly role: "choose-per-basic-land-type" }
    | { readonly role: "return-chosen-lands" }
    /**
     * CR 107.3f (issue #4529) — the two sentences of a variable payment:
     * "You may pay {X}." then "If you do, <effect>." Folded into one
     * `pay-variable-then` effect by `assembleSentences`; the first alone
     * pays for nothing and the second alone names no payment, so either one
     * without the other is refused.
     */
    | { readonly role: "pay-variable-mana"; readonly text: string }
    /** CR 118.12 — the first sentence of a fixed mana payment ("You may pay
     *  {R}"); the `if-you-do` after it is the second. Folded into a
     *  `pay-mana-then` by `assembleSentences`. */
    | {
          readonly role: "pay-mana";
          readonly text: string;
          readonly mana: ManaCost;
      }
    | {
          readonly role: "if-you-do";
          readonly text: string;
          readonly effect: EffectSentenceIR;
      }
    /**
     * CR 702.34a (issue #4756) — the two sentences of a granted Flashback:
     * "<subject> gains flashback until end of turn." then "The flashback cost
     * is equal to its mana cost." Folded into one `grant-flashback` effect by
     * `assembleSentences`, mirroring the `library-look` window: the grant
     * waits for the sentence that prices it, and either one alone is refused.
     */
    | { readonly role: "flashback-grant"; readonly subject: SubjectIR }
    | { readonly role: "flashback-cost" }
    /**
     * CR 615.12 + CR 614.9 — "If {self} would deal damage to a creature, that
     * damage can't be prevented or dealt instead to another permanent or
     * player.": the rider of the damage sentence before it, folded onto that
     * `deal-damage` as `creatureDamageLock` by `assembleSentences`. Alone it
     * names no damage, so it is refused.
     */
    | { readonly role: "creature-damage-lock" }
    /**
     * CR 107.1c / CR 705.2 — the three sentences of a coin-flip series
     * (`coinFlipSeries.ts`): each names an antecedent only the next one
     * reads, so none is an effect alone. Folded into one `coin-flip-series`
     * effect by `assembleSentences`.
     */
    | { readonly role: "choose-number" }
    | { readonly role: "coin-flip-series" }
    | {
          readonly role: "coin-flip-payoff";
          readonly draw: Extract<EffectSentenceIR, { kind: "draw" }>;
          readonly perFlip: number;
      }
    /**
     * CR 608.2c — "Create <token>, then <effect>": two effects in printed
     * order, flattened by `assembleSentences` into the same list the two
     * full-stop sentences would give (`thenChain.ts`).
     */
    | {
          readonly role: "then-chain";
          readonly effects: readonly EffectSentenceIR[];
      }
    /** The window half of a `dig-named-to-hand` (see there). */
    | { readonly role: "named-dig"; readonly count: AmountIR }
    /** The routing half of a `dig-named-to-hand`: "Exile the rest." */
    | { readonly role: "exile-rest" }
    /** The window half of a `look-distribute` (see there). */
    | {
          readonly role: "library-look";
          readonly reveal: boolean;
          readonly count: AmountIR;
      }
    /** CR 401.4 — the routing half of a `look-distribute` (see there). */
    | { readonly role: "library-route"; readonly route: LibraryRouteIR }
    /** CR 701.20a — the window half of a `reveal-until` (see there). */
    | { readonly role: "reveal-until"; readonly filter: EffectCardFilter }
    /** The routing half of a `reveal-until` (see there). */
    | {
          readonly role: "reveal-until-route";
          readonly match: UntilRouteDestination;
          readonly rest: UntilRouteDestination;
      }
    /**
     * CR 603.3d — the three sentences of `first-player-may-reveal-until` (see
     * there): the head player's choice of an opposing player who controls
     * more creatures, the optional reveal-until window, and its routing.
     */
    | { readonly role: "chooses-player-with-more-creatures" }
    | {
          readonly role: "first-player-may-reveal-until";
          readonly filter: EffectCardFilter;
      }
    | {
          readonly role: "first-player-reveal-route";
          readonly match: UntilRouteDestination;
          readonly rest: UntilRouteDestination;
      }
    /**
     * CR 700.3 — the pile-division sentences of `divide-library-piles`.
     * `pile-split` follows a revealed window ("An opponent separates those
     * cards into two piles"); `pile-split-window` is the window and the split
     * in one sentence ("Reveal the top N cards of your library and separate
     * them into two piles"), which `pile-opponent-picks` ("An opponent
     * chooses one of those piles") must follow; `pile-route` ends the run.
     */
    | { readonly role: "pile-split" }
    | { readonly role: "pile-split-window"; readonly count: AmountIR }
    | { readonly role: "pile-opponent-picks" }
    | { readonly role: "pile-route"; readonly pronoun: "one" | "that" }
    /**
     * CR 701.23d + CR 701.20a — the sentences of a `search-reveal-pile-pick`
     * (see there): the searched and revealed pile (`search-reveal-pile`), the
     * other player's pick from it (`search-pile-pick`), where the pick and
     * the rest go (the `reveal-until-route` words "Put that card into your
     * hand and the rest into your graveyard", read here against the pile),
     * and the closing shuffle (`search-pile-shuffle`). Each names an
     * antecedent only the next reads.
     */
    | { readonly role: "search-reveal-pile"; readonly count: number }
    | { readonly role: "search-pile-pick"; readonly chooser: PlayerRefIR }
    | { readonly role: "search-pile-shuffle" }
    /**
     * CR 608.2c — "If you control a <A> and a <B>, <effect> instead": the
     * replacement half of an `upgrade-if-controls`, folded onto the effect in
     * front of it by `assembleSentences`. `body` is the replacement clause
     * WITHOUT "instead"; it is read against that effect, whose referents it
     * reuses ("that creature", an elided damage recipient).
     */
    | {
          readonly role: "instead";
          readonly conditions: readonly ConditionIR[];
          readonly body: string;
      }
    /**
     * CR 702.33e — "If it was kicked, <effect> instead": the replacement half of
     * a `replace-if-kicked`, folded onto the effect in front of it by
     * `assembleSentences`. `replacement` is already a parsed sentence — the
     * clause is a full effect in its own right, not a magnitude change.
     */
    | {
          readonly role: "kicked-instead";
          readonly kicked: KickedRefIR;
          readonly replacement: EffectSentenceIR;
      }
    /**
     * CR 702.33e + CR 202.3 — "If this spell was kicked, destroy that artifact
     * if its mana value is 5 or less instead": the replacement half of a
     * `replace-if-kicked` over a bounded destroy. It re-names the base's own
     * target ("that <type>") and changes only the bound, so it is folded onto
     * the destroy in front of it (`foldKickedBoundInstead`) rather than parsed
     * to a sentence of its own.
     */
    | {
          readonly role: "kicked-bound-instead";
          readonly kicked: KickedRefIR;
          readonly noun: string;
          readonly manaValueAtMost: number;
      }
    /**
     * CR 608.2c — "Add {B}{B}{B}{B}{B} instead if there are seven or more cards
     * in your graveyard": the replacement half of an `add-mana-instead-if`,
     * folded onto the `add-mana` in front of it by `assembleSentences`.
     */
    | {
          readonly role: "add-mana-instead-if";
          readonly mana: EffectManaPool;
          readonly condition: CardCountConditionIR;
      }
    /**
     * CR 701.20a — the sentences of a `reveal-hand-pick` (see there):
     * "<player> reveals their hand" (`hand-reveal`), "You choose <a card> from
     * it[ and exile that card]" (`hand-pick`), the trigger's one-sentence
     * "<player> reveals their hand and you choose <a card> from it"
     * (`hand-reveal-pick`), and the routing "That player discards that card" /
     * "Exile that card" (`hand-pick-route`). Each names an antecedent only the
     * next one reads.
     */
    | { readonly role: "hand-reveal"; readonly player: PlayerRefIR }
    | {
          readonly role: "hand-reveal-pick";
          readonly player: PlayerRefIR;
          readonly pick: HandPickIR;
      }
    | {
          readonly role: "hand-pick";
          readonly pick: HandPickIR;
          /** "… and exile that card": the route is printed in the pick. */
          readonly exile: boolean;
      }
    | { readonly role: "hand-pick-route"; readonly route: HandPickRoute }
    /**
     * CR 608.2c — "You may exile a card from your hand.", the first half of
     * an `optional-hand-cost-then`; the `if-you-do` after it is the second.
     */
    | {
          readonly role: "optional-hand-cost";
          readonly text: string;
          readonly action: "exile" | "discard";
      }
    /**
     * CR 121.1 + CR 603.5 — "You may draw N additional cards.", the first
     * sentence of a `draw-then-ranged-topdeck`; the `choose-drawn-this-turn`
     * and `pay-life-or-topdeck` after it are the other two.
     */
    | {
          readonly role: "optional-draw-additional";
          readonly text: string;
          readonly count: number;
      }
    /** "If you do, choose N cards in your hand drawn this turn." */
    | { readonly role: "choose-drawn-this-turn"; readonly max: number }
    /** "For each of those cards, pay L life or put the card on top of your library." */
    | { readonly role: "pay-life-or-topdeck"; readonly costPerKept: number };

/** Where a `reveal-hand-pick`'s chosen card goes. */
export type HandPickRoute = "discard" | "exile";

/** The card a `reveal-hand-pick` lets the controller choose. */
export interface HandPickIR {
    readonly filter: EffectCardFilter;
    readonly phrase: string;
}

/**
 * A parsed sentence LIST assembled into what an ability site actually carries.
 *
 * The third consumer is what made this shared: the activated slot, the
 * triggered slot and the spell slot all read the same `". "`-separated sentence
 * list, and all three have to fold the CR 701.19c "It can't be regenerated."
 * MODIFIER onto the destroy in front of it. Two copies had already drifted
 * apart only in their prose; a third would have made the fold a convention
 * rather than a rule.
 *
 * What still differs is the one thing that genuinely does: a CR 602.5
 * activation restriction is a sentence only an ACTIVATED ability can carry —
 * there is no activation to restrict on a trigger or on a spell. So the caller
 * either accepts restrictions (and inherits the ordering rule: a restriction
 * applies to the whole ability and is printed last, so an effect that follows
 * one is a sequence we have misread) or names the reason it refuses them.
 */
export type AssembledSentences =
    | {
          readonly ok: true;
          readonly effects: EffectSentenceIR[];
          readonly restrictions: RestrictionIR[];
      }
    | { readonly ok: false; readonly reason: string };

/**
 * The attribution sub-grammar of a line whose every sentence PARSED and whose
 * sentence list was then refused as a whole (issue #3822) — a restriction on a
 * spell, an effect after a restriction. The slot got further than any sentence
 * inside it could, so the trace outranks all of them: one step of progress per
 * sentence read, plus the list itself.
 */
export const SENTENCE_ASSEMBLY = "sentence assembly";

export function assemblyTrace(span: string, sentences: number): FailureTrace {
    return { path: [SENTENCE_ASSEMBLY], span, progress: sentences + 1 };
}

export function assembleSentences(
    sentences: readonly SentenceIR[],
    opts: {
        /** Set to REFUSE CR 602.5 restrictions, with this as the reason. */
        readonly rejectRestrictions?: string;
        /** What an empty effect list is called in the failure reason. */
        readonly site: string;
    }
): AssembledSentences {
    const effects: EffectSentenceIR[] = [];
    const restrictions: RestrictionIR[] = [];
    // CR 608.2c — a library window waits for the sentence that routes it.
    let window: Extract<SentenceIR, { role: "library-look" }> | null = null;
    // CR 105.1 — a "Choose a color." marker waits for the ONE sentence that
    // reads its pick (`choose-color-grant-protection`); every other
    // follower, including a second marker or the end of the list, has no
    // antecedent to feed.
    let awaitingColorChoice = false;
    // CR 705.2 — the coin-flip series' three markers, gathered while they are
    // consecutive and folded into one effect when the run ends.
    let coinFlip: CoinFlipMarker[] = [];
    const flushCoinFlip = (): string | null => {
        if (coinFlip.length === 0) return null;
        const folded = foldCoinFlipSeries(coinFlip);
        coinFlip = [];
        if (typeof folded === "string") return folded;
        effects.push(folded);
        return null;
    };
    // CR 107.3f — a variable payment waits for the "If you do" it feeds.
    let payVariable: Extract<SentenceIR, { role: "pay-variable-mana" }> | null =
        null;
    // CR 118.12 — a fixed payment waits for the "If you do" it feeds.
    let payMana: Extract<SentenceIR, { role: "pay-mana" }> | null = null;
    // CR 702.34a — a flashback grant waits for the sentence that prices it.
    let flashbackGrant: Extract<
        SentenceIR,
        { role: "flashback-grant" }
    > | null = null;
    // CR 101.4 — a per-land-type pick waits for the sentence that returns it.
    let landTypePick = false;
    // CR 701.20a — a reveal-until window waits for the sentence that routes it.
    let revealUntil: Extract<SentenceIR, { role: "reveal-until" }> | null =
        null;
    // CR 603.3d — the head player's choice waits for the optional reveal and
    // its routing: "chosen" → "window" (holding the filter).
    let firstPlayerReveal:
        | { readonly stage: "chosen" }
        | { readonly stage: "window"; readonly filter: EffectCardFilter }
        | null = null;
    // CR 201.4 — a chosen card name must be read back by a later sentence of
    // the same ability ("that name"); `namedDig` waits for "Exile the rest."
    let namePending = false;
    let nameRead = false;
    let namedDig: Extract<SentenceIR, { role: "named-dig" }> | null = null;
    // CR 700.3 — a pile division in progress: "needs-picker" after the
    // one-sentence window+split, "ready" once an opponent has split/chosen.
    let piles: {
        readonly count: AmountIR;
        readonly stage: "needs-picker" | "ready";
        readonly form: "separates" | "chooses";
    } | null = null;
    // CR 701.23d — a searched, revealed pile waits for who picks from it,
    // then for where the pick and the rest go, then for the shuffle.
    let searchPile:
        | { readonly stage: "needs-chooser"; readonly count: number }
        | {
              readonly stage: "needs-route" | "needs-shuffle";
              readonly count: number;
              readonly chooser: PlayerRefIR;
          }
        | null = null;
    // CR 701.20a — a revealed hand waits for the card chosen from it, and the
    // chosen card for where it goes.
    let handReveal: {
        readonly player: PlayerRefIR;
        readonly pick?: HandPickIR;
    } | null = null;
    // CR 608.2c — an optional hand exile waits for the "If you do" it gates.
    let optionalHandCost: Extract<
        SentenceIR,
        { role: "optional-hand-cost" }
    > | null = null;
    // CR 121.1 — "You may draw N additional cards" waits for the pick among
    // the cards drawn this turn, then for the price of each card not kept.
    let drawTopdeck: {
        readonly clause: string;
        readonly count: number;
        readonly max: number | null;
    } | null = null;
    for (const sentence of sentences) {
        if (firstPlayerReveal !== null) {
            if (
                firstPlayerReveal.stage === "chosen" &&
                sentence.role === "first-player-may-reveal-until"
            ) {
                firstPlayerReveal = {
                    stage: "window",
                    filter: sentence.filter,
                };
                continue;
            }
            if (
                firstPlayerReveal.stage === "window" &&
                sentence.role === "first-player-reveal-route"
            ) {
                effects.push({
                    kind: "first-player-may-reveal-until",
                    filter: firstPlayerReveal.filter,
                    match: sentence.match,
                    rest: sentence.rest,
                });
                firstPlayerReveal = null;
                continue;
            }
            return {
                ok: false,
                reason: "a player's choice of an opposing player is not followed by their optional reveal and its routing",
            };
        }
        if (sentence.role === "chooses-player-with-more-creatures") {
            if (
                effects.length > 0 ||
                restrictions.length > 0 ||
                window !== null ||
                revealUntil !== null ||
                piles !== null
            )
                return {
                    ok: false,
                    reason: "a player's choice of an opposing player follows an earlier sentence",
                };
            firstPlayerReveal = { stage: "chosen" };
            continue;
        }
        if (
            sentence.role === "first-player-may-reveal-until" ||
            sentence.role === "first-player-reveal-route"
        )
            return {
                ok: false,
                reason: '"The first player" follows no choice of an opposing player',
            };
        if (drawTopdeck !== null) {
            if (drawTopdeck.max === null) {
                if (sentence.role !== "choose-drawn-this-turn")
                    return {
                        ok: false,
                        reason: '"You may draw additional cards" is not followed by "If you do, choose … cards in your hand drawn this turn"',
                    };
                // Only the printed form has a fixture: the pick is as wide as
                // the draw (a wider pool is a different card).
                if (sentence.max !== drawTopdeck.count)
                    return {
                        ok: false,
                        reason: "the pick among the cards drawn this turn is not as wide as the draw",
                    };
                drawTopdeck = {
                    clause: drawTopdeck.clause,
                    count: drawTopdeck.count,
                    max: sentence.max,
                };
                continue;
            }
            if (sentence.role !== "pay-life-or-topdeck")
                return {
                    ok: false,
                    reason: "a pick among the cards drawn this turn is not followed by what each card not kept costs",
                };
            effects.push({
                kind: "optional",
                clause: drawTopdeck.clause,
                effect: {
                    kind: "draw-then-ranged-topdeck",
                    count: drawTopdeck.count,
                    max: drawTopdeck.max,
                    costPerKept: sentence.costPerKept,
                },
            });
            drawTopdeck = null;
            continue;
        }
        if (
            sentence.role === "choose-drawn-this-turn" ||
            sentence.role === "pay-life-or-topdeck"
        )
            return {
                ok: false,
                reason: '"cards drawn this turn" follows no "You may draw additional cards"',
            };
        if (optionalHandCost !== null) {
            if (sentence.role !== "if-you-do")
                return {
                    ok: false,
                    reason: '"You may exile / discard a card from your hand" is not followed by "If you do, …"',
                };
            effects.push({
                kind: "optional-hand-cost-then",
                action: optionalHandCost.action,
                clause: optionalHandCost.text,
                effect: sentence.effect,
            });
            optionalHandCost = null;
            continue;
        }
        if (searchPile !== null) {
            if (searchPile.stage === "needs-chooser") {
                if (sentence.role !== "search-pile-pick")
                    return {
                        ok: false,
                        reason: "a searched and revealed pile is not followed by who picks from it",
                    };
                searchPile = {
                    stage: "needs-route",
                    count: searchPile.count,
                    chooser: sentence.chooser,
                };
                continue;
            }
            if (searchPile.stage === "needs-route") {
                // "that card" is the pick, "the rest" the pile's other cards.
                if (
                    sentence.role !== "reveal-until-route" ||
                    sentence.match !== "hand" ||
                    sentence.rest !== "graveyard"
                )
                    return {
                        ok: false,
                        reason: "a pick from a searched pile is not followed by where its cards go",
                    };
                searchPile = { ...searchPile, stage: "needs-shuffle" };
                continue;
            }
            // CR 701.24a — the search ends in a shuffle; a pile routed with no
            // shuffle after it is a different card.
            if (sentence.role !== "search-pile-shuffle")
                return {
                    ok: false,
                    reason: "a searched pile is not followed by the shuffle that ends the search",
                };
            effects.push({
                kind: "search-reveal-pile-pick",
                count: searchPile.count,
                chooser: searchPile.chooser,
            });
            searchPile = null;
            continue;
        }
        if (
            sentence.role === "search-pile-pick" ||
            sentence.role === "search-pile-shuffle"
        )
            return {
                ok: false,
                reason: '"chooses one" / "Then shuffle" follows no searched and revealed pile',
            };
        if (handReveal !== null) {
            if (handReveal.pick === undefined) {
                if (sentence.role !== "hand-pick")
                    return {
                        ok: false,
                        reason: "a revealed hand is not followed by the card chosen from it",
                    };
                if (sentence.exile) {
                    effects.push({
                        kind: "reveal-hand-pick",
                        player: handReveal.player,
                        ...sentence.pick,
                        route: "exile",
                    });
                    handReveal = null;
                    continue;
                }
                handReveal = { player: handReveal.player, pick: sentence.pick };
                continue;
            }
            const route =
                sentence.role === "hand-pick-route"
                    ? sentence.route
                    : isExileThatCard(sentence)
                      ? "exile"
                      : null;
            if (route === null)
                return {
                    ok: false,
                    reason: "a card chosen from a revealed hand is not followed by where it goes",
                };
            effects.push({
                kind: "reveal-hand-pick",
                player: handReveal.player,
                ...handReveal.pick,
                route,
            });
            handReveal = null;
            continue;
        }
        if (
            sentence.role === "hand-pick" ||
            sentence.role === "hand-pick-route"
        )
            return {
                ok: false,
                reason: '"from it" / "that card" follows no revealed hand',
            };
        if (payMana !== null) {
            if (sentence.role !== "if-you-do")
                return {
                    ok: false,
                    reason: '"You may pay {cost}" is not followed by "If you do, …"',
                };
            effects.push({
                kind: "pay-mana-then",
                clause: `${payMana.text}. ${sentence.text}`,
                mana: payMana.mana,
                effect: sentence.effect,
            });
            payMana = null;
            continue;
        }
        if (payVariable !== null) {
            if (sentence.role !== "if-you-do")
                return {
                    ok: false,
                    reason: '"You may pay {X}" is not followed by "If you do, …"',
                };
            effects.push({
                kind: "pay-variable-then",
                clause: `${payVariable.text}. ${sentence.text}`,
                effect: sentence.effect,
            });
            payVariable = null;
            continue;
        }
        if (sentence.role === "if-you-do") {
            // CR 608.2c — "Sacrifice this enchantment. If you do, <effect>."
            const last = effects[effects.length - 1];
            if (last?.kind === "sacrifice-source" && last.then === undefined) {
                effects[effects.length - 1] = {
                    ...last,
                    then: sentence.effect,
                };
                continue;
            }
            return {
                ok: false,
                reason: '"If you do, …" follows no "You may pay {X}"',
            };
        }
        if (landTypePick) {
            if (sentence.role !== "return-chosen-lands")
                return {
                    ok: false,
                    reason: "a pick of a land of each basic land type is not followed by what happens to those lands",
                };
            effects.push({
                kind: "choose-one-per-category",
                axis: "basic-land-type",
                rest: "return-chosen",
            });
            landTypePick = false;
            continue;
        }
        if (sentence.role === "return-chosen-lands")
            return {
                ok: false,
                reason: '"Return those lands" follows no pick of a land of each basic land type',
            };
        if (sentence.role === "choose-per-basic-land-type") {
            if (
                restrictions.length > 0 ||
                window !== null ||
                awaitingColorChoice ||
                revealUntil !== null ||
                piles !== null
            )
                return {
                    ok: false,
                    reason: "a pick per basic land type follows an unfinished sentence run",
                };
            landTypePick = true;
            continue;
        }
        if (flashbackGrant !== null) {
            if (sentence.role !== "flashback-cost")
                return {
                    ok: false,
                    reason: "a flashback grant is not followed by its flashback cost",
                };
            effects.push({
                kind: "grant-flashback",
                subject: flashbackGrant.subject,
            });
            flashbackGrant = null;
            continue;
        }
        if (sentence.role === "flashback-cost")
            return {
                ok: false,
                reason: "a flashback cost follows no flashback grant",
            };
        if (sentence.role === "creature-damage-lock") {
            const previous = effects[effects.length - 1];
            if (
                previous === undefined ||
                previous.kind !== "deal-damage" ||
                previous.creatureDamageLock === true ||
                previous.sourceIsPronoun === true ||
                previous.sourceIsActedOn !== undefined ||
                previous.to.kind !== "target" ||
                previous.to.requirement.type !== "any" ||
                (previous.to.requirement.count ?? 1) !== 1 ||
                window !== null ||
                awaitingColorChoice ||
                restrictions.length > 0 ||
                revealUntil !== null ||
                piles !== null ||
                coinFlip.length > 0
            )
                return {
                    ok: false,
                    reason: 'a creature damage lock follows no "deals damage to any target" sentence',
                };
            effects[effects.length - 1] = {
                ...previous,
                creatureDamageLock: true,
            };
            continue;
        }
        if (sentence.role === "flashback-grant") {
            const coinFlipPending = flushCoinFlip();
            if (coinFlipPending !== null)
                return { ok: false, reason: coinFlipPending };
            if (window !== null)
                return {
                    ok: false,
                    reason: "a library look is not followed by where its cards go",
                };
            if (awaitingColorChoice)
                return {
                    ok: false,
                    reason: '"Choose a color." is not followed by an effect that reads the choice',
                };
            if (restrictions.length > 0)
                return {
                    ok: false,
                    reason: "an effect sentence follows an activation restriction",
                };
            flashbackGrant = sentence;
            continue;
        }
        if (
            sentence.role === "choose-number" ||
            sentence.role === "coin-flip-series" ||
            sentence.role === "coin-flip-payoff"
        ) {
            if (restrictions.length > 0)
                return {
                    ok: false,
                    reason: "an effect sentence follows an activation restriction",
                };
            // A pending library window or "Choose a color." waits for the
            // sentence that FOLLOWS it; folding the series first would
            // silently reorder the effects.
            if (window !== null)
                return {
                    ok: false,
                    reason: "a library look is not followed by where its cards go",
                };
            if (awaitingColorChoice)
                return {
                    ok: false,
                    reason: '"Choose a color." is not followed by an effect that reads the choice',
                };
            coinFlip.push(sentence);
            continue;
        }
        const coinFlipRefused = flushCoinFlip();
        if (coinFlipRefused !== null)
            return { ok: false, reason: coinFlipRefused };
        if (sentence.role === "pay-variable-mana") {
            if (
                restrictions.length > 0 ||
                window !== null ||
                awaitingColorChoice ||
                revealUntil !== null ||
                piles !== null
            )
                return {
                    ok: false,
                    reason: "a variable payment follows an unfinished sentence run",
                };
            payVariable = sentence;
            continue;
        }
        if (sentence.role === "pay-mana") {
            if (
                restrictions.length > 0 ||
                window !== null ||
                awaitingColorChoice ||
                revealUntil !== null ||
                piles !== null
            )
                return {
                    ok: false,
                    reason: "a mana payment follows an unfinished sentence run",
                };
            payMana = sentence;
            continue;
        }
        if (awaitingColorChoice) {
            awaitingColorChoice = false;
            if (
                sentence.role !== "effect" ||
                sentence.effect.kind !== "choose-color-grant-protection"
            )
                return {
                    ok: false,
                    reason: '"Choose a color." is not followed by an effect that reads the choice',
                };
            if (restrictions.length > 0)
                return {
                    ok: false,
                    reason: "an effect sentence follows an activation restriction",
                };
            effects.push(sentence.effect);
            continue;
        }
        if (sentence.role === "choose-color") {
            if (restrictions.length > 0)
                return {
                    ok: false,
                    reason: "an effect sentence follows an activation restriction",
                };
            awaitingColorChoice = true;
            continue;
        }
        if (namedDig !== null) {
            if (sentence.role !== "exile-rest")
                return {
                    ok: false,
                    reason: "a named library reveal is not followed by where the rest goes",
                };
            effects.push({ kind: "dig-named-to-hand", count: namedDig.count });
            namedDig = null;
            nameRead = true;
            continue;
        }
        if (sentence.role === "named-dig") {
            if (!namePending)
                return {
                    ok: false,
                    reason: '"with that name" follows no "Choose a card name."',
                };
            namedDig = sentence;
            continue;
        }
        if (sentence.role === "exile-rest")
            return {
                ok: false,
                reason: '"Exile the rest." follows no named library reveal',
            };
        if (sentence.role === "effect") {
            if (sentence.effect.kind === "name-card") {
                if (namePending)
                    return {
                        ok: false,
                        reason: "a second card name is chosen before the first is read",
                    };
                namePending = true;
            } else if (sentence.effect.kind === "named-card-reveal-gate") {
                // CR 201.2a — the gate compares the revealed card with the
                // pick: both must come from earlier sentences of this ability.
                if (
                    !namePending ||
                    !effects.some((e) => e.kind === "reveal-random-hand-card")
                )
                    return {
                        ok: false,
                        reason: '"If that card has the chosen name" follows no "Choose a card name, then reveal a card at random from your hand."',
                    };
                nameRead = true;
            } else if (sentence.effect.kind === "discard-named-from-hand") {
                if (!namePending)
                    return {
                        ok: false,
                        reason: '"with that name" follows no "Choose a card name."',
                    };
                nameRead = true;
            }
        }
        if (revealUntil !== null) {
            if (sentence.role !== "reveal-until-route")
                return {
                    ok: false,
                    reason: "a reveal-until window is not followed by where its cards go",
                };
            effects.push({
                kind: "reveal-until",
                filter: revealUntil.filter,
                match: sentence.match,
                rest: sentence.rest,
            });
            revealUntil = null;
            continue;
        }
        if (sentence.role === "reveal-until") {
            if (restrictions.length > 0 || window !== null || piles !== null)
                return {
                    ok: false,
                    reason: "an effect sentence follows an activation restriction",
                };
            revealUntil = sentence;
            continue;
        }
        if (sentence.role === "reveal-until-route")
            return {
                ok: false,
                reason: "a reveal-until routing follows no reveal-until window",
            };
        if (piles !== null) {
            if (piles.stage === "needs-picker") {
                if (sentence.role !== "pile-opponent-picks")
                    return {
                        ok: false,
                        reason: "a pile split is not followed by an opponent's pick",
                    };
                piles = {
                    count: piles.count,
                    stage: "ready",
                    form: piles.form,
                };
                continue;
            }
            if (
                sentence.role !== "pile-route" ||
                sentence.pronoun !==
                    (piles.form === "separates" ? "one" : "that")
            )
                return {
                    ok: false,
                    reason: "a pile division is not followed by where its piles go",
                };
            effects.push({
                kind: "divide-library-piles",
                count: piles.count,
                form: piles.form,
            });
            piles = null;
            continue;
        }
        if (window !== null && sentence.role === "pile-split") {
            // CR 701.20a — the piles are made of the window's cards, which only
            // a REVEAL puts in front of the opponent who splits them.
            if (!window.reveal)
                return {
                    ok: false,
                    reason: "a pile division of a look, not a reveal, is not in this grammar",
                };
            piles = { count: window.count, stage: "ready", form: "separates" };
            window = null;
            continue;
        }
        if (sentence.role === "pile-split-window") {
            if (restrictions.length > 0 || window !== null)
                return {
                    ok: false,
                    reason: "an effect sentence follows an activation restriction",
                };
            piles = {
                count: sentence.count,
                stage: "needs-picker",
                form: "chooses",
            };
            continue;
        }
        if (
            sentence.role === "pile-split" ||
            sentence.role === "pile-opponent-picks" ||
            sentence.role === "pile-route"
        )
            return {
                ok: false,
                reason: "a pile sentence follows no revealed window it divides",
            };
        if (
            sentence.role === "effect" &&
            isManaValueLifeLoss(sentence.effect) &&
            effects[effects.length - 1]?.kind === "reveal-top-to-hand"
        ) {
            // CR 608.2c — "its mana value" reads the card the sentence before
            // revealed; the pair is one effect. Behind any other sentence the
            // same words name a different object, so this fold does not apply.
            const previous = effects[effects.length - 1]!;
            if (previous.kind === "reveal-top-to-hand" && !previous.lifeLoss) {
                effects[effects.length - 1] = { ...previous, lifeLoss: true };
                continue;
            }
        }
        if (window !== null) {
            if (sentence.role !== "library-route")
                return {
                    ok: false,
                    reason: "a library look is not followed by where its cards go",
                };
            const folded = foldLibraryRoute(window, sentence.route);
            if (typeof folded === "string")
                return { ok: false, reason: folded };
            effects.push(folded);
            window = null;
            continue;
        }
        if (sentence.role === "library-look") {
            if (restrictions.length > 0)
                return {
                    ok: false,
                    reason: "an effect sentence follows an activation restriction",
                };
            window = sentence;
            continue;
        }
        if (sentence.role === "library-route")
            return {
                ok: false,
                reason: "a library routing follows no look at the top of a library",
            };
        if (sentence.role === "restriction") {
            if (opts.rejectRestrictions !== undefined)
                return { ok: false, reason: opts.rejectRestrictions };
            restrictions.push(sentence.restriction);
            continue;
        }
        if (restrictions.length > 0)
            return {
                ok: false,
                reason: "an effect sentence follows an activation restriction",
            };
        if (sentence.role === "hand-reveal") {
            handReveal = { player: sentence.player };
            continue;
        }
        if (sentence.role === "search-reveal-pile") {
            searchPile = { stage: "needs-chooser", count: sentence.count };
            continue;
        }
        if (sentence.role === "hand-reveal-pick") {
            handReveal = { player: sentence.player, pick: sentence.pick };
            continue;
        }
        if (sentence.role === "optional-hand-cost") {
            optionalHandCost = sentence;
            continue;
        }
        if (sentence.role === "optional-draw-additional") {
            drawTopdeck = {
                clause: sentence.text,
                count: sentence.count,
                max: null,
            };
            continue;
        }
        if (sentence.role === "instead") {
            const previous = effects[effects.length - 1];
            if (previous === undefined)
                return {
                    ok: false,
                    reason: '"… instead" follows no effect it could replace',
                };
            const upgraded = readUpgrade(previous, sentence.body);
            if (typeof upgraded === "string")
                return { ok: false, reason: upgraded };
            effects[effects.length - 1] = {
                kind: "upgrade-if-controls",
                conditions: sentence.conditions,
                base: previous,
                upgraded,
            };
            continue;
        }
        if (sentence.role === "add-mana-instead-if") {
            const previous = effects[effects.length - 1];
            if (
                previous === undefined ||
                previous.kind !== "add-mana" ||
                previous.thatPlayer === true
            )
                return {
                    ok: false,
                    reason: '"Add … instead" follows no "Add …" it could replace',
                };
            effects[effects.length - 1] = {
                kind: "add-mana-instead-if",
                base: previous.mana,
                replacement: sentence.mana,
                condition: sentence.condition,
            };
            continue;
        }
        if (sentence.role === "kicked-bound-instead") {
            const previous = effects[effects.length - 1];
            if (previous === undefined)
                return {
                    ok: false,
                    reason: '"… instead" follows no effect it could replace',
                };
            const replaced = foldKickedBoundInstead(previous, sentence);
            if (typeof replaced === "string")
                return { ok: false, reason: replaced };
            effects[effects.length - 1] = replaced;
            continue;
        }
        if (sentence.role === "kicked-instead") {
            const previous = effects[effects.length - 1];
            if (previous === undefined)
                return {
                    ok: false,
                    reason: '"… instead" follows no effect it could replace',
                };
            const replaced = foldKickedInstead(previous, sentence);
            if (typeof replaced === "string")
                return { ok: false, reason: replaced };
            effects[effects.length - 1] = replaced;
            continue;
        }
        if (
            sentence.role === "modifier" &&
            sentence.modifier.kind === "still-types"
        ) {
            const previous = effects[effects.length - 1];
            if (sentence.modifier.singular === true) {
                // CR 205.1b — "It's still a land." restates the type the
                // animated SOURCE named ("This land"): both are the one noun
                // `land` (STILL_TYPE_SELF / ANIMATE_SELF), so no type is
                // compared here.
                if (
                    previous === undefined ||
                    previous.kind !== "animate" ||
                    previous.self === undefined ||
                    previous.retainsTypes === true
                )
                    return {
                        ok: false,
                        reason: '"It\'s still a <type>." follows no animation of that type',
                    };
                effects[effects.length - 1] = {
                    ...previous,
                    retainsTypes: true,
                };
                continue;
            }
            const swept =
                previous !== undefined &&
                previous.kind === "animate" &&
                previous.subject.kind === "mass"
                    ? previous.subject.select.filter?.type
                    : undefined;
            const named = [...sentence.modifier.types].sort();
            const sweptTypes = (
                swept === undefined
                    ? []
                    : Array.isArray(swept)
                      ? [...swept]
                      : [swept]
            ).sort();
            // CR 205.1b — "They're still lands" restates the swept set's own
            // types; a rider naming any other type keeps nothing that was asked.
            if (
                previous === undefined ||
                previous.kind !== "animate" ||
                previous.retainsTypes === true ||
                JSON.stringify(named) !== JSON.stringify(sweptTypes)
            )
                return {
                    ok: false,
                    reason: '"They\'re still <types>." follows no animation of those types',
                };
            effects[effects.length - 1] = { ...previous, retainsTypes: true };
            continue;
        }
        if (
            sentence.role === "modifier" &&
            (sentence.modifier.kind === "exchange-fallback-sacrifice" ||
                sentence.modifier.kind === "resolves-if-target-illegal")
        ) {
            const previous = effects[effects.length - 1];
            const isFallback =
                sentence.modifier.kind === "exchange-fallback-sacrifice";
            if (
                previous === undefined ||
                previous.kind !== "exchange-control" ||
                (isFallback
                    ? previous.sacrificeUnlessExchanged === true
                    : previous.resolvesIfTargetIllegal === true)
            )
                return {
                    ok: false,
                    reason: isFallback
                        ? "\"If you don't or can't make an exchange\" follows no exchange of control"
                        : '"This ability still resolves" follows no exchange of control',
                };
            effects[effects.length - 1] = isFallback
                ? { ...previous, sacrificeUnlessExchanged: true }
                : { ...previous, resolvesIfTargetIllegal: true };
            continue;
        }
        if (
            sentence.role === "modifier" &&
            sentence.modifier.kind === "destroy-countered-source"
        ) {
            const previous = effects[effects.length - 1];
            // A rider that can never fire is a sentence we have misread: only
            // a counter whose target admits an ability binds a source, and a
            // taxed counter's rider would read a different condition.
            if (
                previous === undefined ||
                previous.kind !== "counter" ||
                previous.unlessPays !== undefined ||
                previous.subject.kind !== "target" ||
                !["ability", "any", "activated-ability"].includes(
                    previous.subject.requirement.spellStackKind ?? "spell"
                )
            )
                return {
                    ok: false,
                    reason: '"If a permanent\'s ability is countered this way" follows no counter of an ability',
                };
            effects[effects.length - 1] = {
                ...previous,
                destroysCounteredSource: true,
            };
            continue;
        }
        if (sentence.role === "modifier") {
            const previous = effects[effects.length - 1];
            if (previous === undefined || previous.kind !== "destroy")
                return {
                    ok: false,
                    reason: '"It can\'t be regenerated." follows no destroy',
                };
            // CR 701.19c — "It" names ONE destroyed object. Behind a sweep the
            // pronoun has no single referent, so folding it onto the sweep
            // would forbid regeneration for a set the sentence never named;
            // "They" is the sweep's own pronoun and, in turn, has no referent
            // behind one object. The number of the pronoun must match.
            const isSweep = previous.subject.kind === "mass";
            if (
                isSweep !==
                (sentence.modifier.kind === "cant-be-regenerated" &&
                    sentence.modifier.plural === true)
            )
                return {
                    ok: false,
                    reason: isSweep
                        ? '"It can\'t be regenerated." follows a sweep, not one object'
                        : '"They can\'t be regenerated." follows one object, not a sweep',
                };
            effects[effects.length - 1] = {
                ...previous,
                cantBeRegenerated: true,
            };
            continue;
        }
        if (sentence.role === "then-chain") {
            // CR 201.4 — a chain may open a card-name pick ("Choose a card
            // name, then reveal …"); it is read back like a bare one.
            if (sentence.effects.some((e) => e.kind === "name-card")) {
                if (namePending)
                    return {
                        ok: false,
                        reason: "a second card name is chosen before the first is read",
                    };
                namePending = true;
            }
            effects.push(...sentence.effects);
            continue;
        }
        // CR 608.2c — "For each card exiled this way, search …" reads the
        // graveyard exile of the sentence before it, and nothing else.
        if (sentence.effect.kind === "exile-same-name-library-copies") {
            const previous = effects[effects.length - 1];
            if (
                previous?.kind !== "exile-graveyard" ||
                previous.exceptBasicLands !== true
            )
                return {
                    ok: false,
                    reason: '"For each card exiled this way, search … same name" follows no graveyard exile of the same player',
                };
            effects[effects.length - 1] = {
                kind: "exile-graveyard-and-library-copies",
                player: previous.player,
                shuffle: false,
            };
            continue;
        }
        // CR 701.24a — "Then that player shuffles." belongs to the target
        // library the sentence before searched; nothing else names it.
        if (sentence.effect.kind === "shuffle-searched-library") {
            const previous = effects[effects.length - 1];
            if (
                previous?.kind === "exile-graveyard-and-library-copies" &&
                !previous.shuffle
            ) {
                effects[effects.length - 1] = { ...previous, shuffle: true };
                continue;
            }
            if (previous?.kind !== "search-target-library" || previous.shuffle)
                return {
                    ok: false,
                    reason: '"Then that player shuffles." follows no search of a target library',
                };
            effects[effects.length - 1] = { ...previous, shuffle: true };
            continue;
        }
        // "The chosen color" names no pick without a "Choose a color."
        // sentence right before it; reaching this fold (rather than the
        // `awaitingColorChoice` one above) means it never got one.
        if (sentence.effect.kind === "choose-color-grant-protection")
            return {
                ok: false,
                reason: '"… protection from the chosen color" follows no "Choose a color."',
            };
        effects.push(sentence.effect);
    }
    const coinFlipRefused = flushCoinFlip();
    if (coinFlipRefused !== null) return { ok: false, reason: coinFlipRefused };
    if (flashbackGrant !== null)
        return {
            ok: false,
            reason: "a flashback grant is not followed by its flashback cost",
        };
    if (payVariable !== null)
        return {
            ok: false,
            reason: '"You may pay {X}" is the last sentence and feeds no effect',
        };
    if (payMana !== null)
        return {
            ok: false,
            reason: '"You may pay {cost}" is the last sentence and feeds no effect',
        };
    if (window !== null)
        return {
            ok: false,
            reason: "a library look is not followed by where its cards go",
        };
    if (firstPlayerReveal !== null)
        return {
            ok: false,
            reason: "a player's choice of an opposing player is not followed by their optional reveal and its routing",
        };
    if (revealUntil !== null || piles !== null)
        return {
            ok: false,
            reason: "a library reveal is not followed by where its cards go",
        };
    if (namedDig !== null)
        return {
            ok: false,
            reason: "a named library reveal is not followed by where the rest goes",
        };
    if (handReveal !== null)
        return {
            ok: false,
            reason: "a revealed hand is not followed by the card chosen from it and where it goes",
        };
    if (searchPile !== null)
        return {
            ok: false,
            reason: "a searched and revealed pile is not followed by who picks from it, where its cards go and the shuffle",
        };
    if (optionalHandCost !== null)
        return {
            ok: false,
            reason: '"You may exile a card from your hand" is the last sentence and gates no effect',
        };
    if (drawTopdeck !== null)
        return {
            ok: false,
            reason: '"You may draw additional cards" is not followed by the pick among the cards drawn this turn and its price',
        };
    if (namePending && !nameRead)
        return {
            ok: false,
            reason: "a chosen card name is never read back",
        };
    if (landTypePick)
        return {
            ok: false,
            reason: "a pick of a land of each basic land type is the last sentence and returns nothing",
        };
    if (awaitingColorChoice)
        return {
            ok: false,
            reason: '"Choose a color." is the last sentence and reads no effect',
        };
    if (effects.length === 0)
        return { ok: false, reason: `the ${opts.site} has no effect sentence` };
    return { ok: true, effects, restrictions };
}

/**
 * "Exile that card." — read by the effect grammar as a `move-zone` of the
 * CR 400.7e zone-change anaphora (Planar Void's "exile that card"); behind a
 * pick from a revealed hand the same words name the picked card, so
 * `assembleSentences` folds them into the pick's exile route there and
 * nowhere else.
 */
function isExileThatCard(sentence: SentenceIR): boolean {
    return (
        sentence.role === "effect" &&
        sentence.effect.kind === "move-zone" &&
        sentence.effect.subject.kind === "that-card" &&
        sentence.effect.to.zone === "exile" &&
        sentence.effect.to.owner === "any"
    );
}

/** CR 119.3 — "You lose life equal to its mana value": the tail of a reveal-top-to-hand. */
function isManaValueLifeLoss(effect: EffectSentenceIR): boolean {
    return (
        effect.kind === "life" &&
        effect.action === "lose" &&
        effect.player.kind === "you" &&
        effect.amount.kind === "acted-on-characteristic" &&
        effect.amount.noun === "it" &&
        effect.amount.characteristic === "manaValue"
    );
}

/**
 * Pair a window with its routing, or name why the pair is not one form.
 *
 * Only the two pairings the corpus prints are one effect: "revealed this way"
 * reads back a REVEAL (CR 701.20a), and "<N> of them" picks from a private
 * LOOK. The crossed pairs are refused rather than lowered to whichever half
 * came first, because a reveal the routing does not mention and a routing that
 * names a reveal that never happened are both a sentence we have misread.
 */
function foldLibraryRoute(
    window: Extract<SentenceIR, { role: "library-look" }>,
    route: LibraryRouteIR
): EffectSentenceIR | string {
    if (route.kind === "all-of-subtype" && !window.reveal)
        return '"revealed this way" follows a look, not a reveal (CR 701.20a)';
    if (route.kind === "take" && window.reveal)
        return "a pick from a revealed window is not in this grammar";
    if (
        route.kind === "take" &&
        route.other === true &&
        !(window.count.kind === "fixed" && window.count.value === 2)
    )
        return '"the other" names the single card left of a two-card window';
    return {
        kind: "look-distribute",
        reveal: window.reveal,
        count: window.count,
        route,
    };
}

// ── Subjects ───────────────────────────────────────────────────────────────

/**
 * A subject phrase: the source, an announced target, or a named player.
 *
 * The three are disjoint by their opening words, so this is a cascade rather
 * than an `oneOf` — but each branch is still all-consuming (`isSelfPhrase` is
 * an exact table lookup; `targetFilterRule` and `playerRefRule` consume their
 * whole span).
 */
export const subjectRule: Rule<SubjectIR> = rule<SubjectIR>(
    "subject",
    (span, ctx) => {
        // A subject that OPENS its sentence is capitalised ("Target creature gets
        // …"), the same subject mid-sentence is not ("… deals 1 damage to target
        // creature"). Only the first letter differs, and only for the FUNCTION
        // words this grammar dispatches on — every capital that carries meaning (a
        // CR 205.3 subtype) sits later in the phrase and is left alone.
        const probe = uncapitalise(span);
        if (isSelfPhrase(probe)) return ok({ kind: "self" as const });
        if (probe === "that card") return ok({ kind: "that-card" as const });
        if (probe === "that creature")
            return ok({ kind: "that-creature" as const });
        // CR 120.3 — read as ONE exact phrase, not a general coordination of
        // two subjects: the grammar has no "X and Y" combinator, and widening
        // to one would read neighbours no fixture covers (e.g. "each
        // opponent and each creature they control").
        if (probe === EACH_CREATURE_AND_EACH_PLAYER)
            return ok({ kind: "each-creature-and-player" as const });
        // CR 608.2h — the pronoun, in its two reachable spellings.
        //
        // `{it}` is the marker `objectPronounListRule` writes over the
        // SENTENCE-LEADING "It" of a site's FIRST sentence, where the slot has
        // already checked the head names a referent at all.
        //
        // The bare, LOWERCASE word is the same pronoun sitting in an object
        // position INSIDE a sentence ("this enchantment deals 2 damage to
        // it"), which no rewrite reaches. The case is load-bearing, not
        // incidental: a capitalised "It" here would be a LATER sentence's
        // subject, whose antecedent is the object the sentence before it named
        // and not the site's ("… put a +1/+1 counter on target creature you
        // control. It gains lifelink") — so that one stays unread, exactly as
        // it was before this branch existed.
        if (probe === PRONOUN_MARKER || span === "it")
            return ok({ kind: "pronoun" as const });
        // CR 115.3 — "Another target creature …" is an ordinary target phrase
        // under an EXCLUSION the sentence alone cannot resolve (see
        // `SubjectIR`), so the head is peeled off here and the rest is read by
        // the one target rule. The word is kept as a marker, never dropped: a
        // dropped "another" is a spell that may name one creature twice.
        const another = probe.startsWith(ANOTHER_HEAD);
        const phrase = another ? probe.slice("another ".length) : probe;
        // CR 601.2c — the "up to N target …" heads are `targetFilterRule`'s
        // own; `opensTargetPhrase` is the single list both dispatch on.
        if (opensTargetPhrase(phrase)) {
            const requirement = targetFilterRule.run(phrase, ctx);
            if (!requirement.ok) return requirement;
            return ok({
                kind: "target" as const,
                requirement: requirement.value,
                ...(another ? { another: true as const } : {}),
            });
        }
        const player = playerRefRule.run(span, ctx);
        if (player.ok)
            return ok({ kind: "player" as const, player: player.value });
        return fail(`"${span}" is not a subject this grammar knows`, span);
    }
);

/**
 * CR 303.4b — "Enchanted creature" as the subject of an Aura's own ability.
 *
 * Deliberately NOT a branch of {@link subjectRule}: that rule is every verb's
 * and every site's, and a verb nobody has shown it to (fights, deals damage,
 * phases out) would start reading a phrase it has no fixture for. The two
 * verbs the corpus prints it under — the pump and the keyword grant — ask for
 * it here, and only where the activated slot said the site is an Aura's
 * (`ParseContext.auraHost`); anything else returns `null` and falls through to
 * `subjectRule`'s refusal, under the gap key it already had.
 */
function hostSubject(span: string, ctx: unknown): RuleResult<SubjectIR> | null {
    if (uncapitalise(span) !== "enchanted creature") return null;
    if ((ctx as ParseContext).auraHost !== true) return null;
    return ok({ kind: "host" as const });
}

/** A target requirement's card types, the one-type spelling widened. */
function requirementTypes(requirement: TargetRequirement): readonly string[] {
    return Array.isArray(requirement.type)
        ? requirement.type
        : [requirement.type];
}

/**
 * CR 701.3a — the card types the SOURCE may be attached to: an Aura enchants
 * what its Enchant line names, read only when that line is a bare type
 * ("Enchant creature") so that every permanent of the type is one the Aura
 * could enchant. A qualified Enchant line ("Enchant creature you control") is
 * refused: CR 701.3b leaves an Aura attached to an illegal object where it is,
 * and the `attach` Op checks no enchant restriction to make it so.
 *
 * An Equipment's "Attach this Equipment to target creature …" is refused too,
 * for want of evidence rather than of meaning: every corpus card printing it
 * also prints an Equip line no rule reads yet, so no whole-card golden can
 * pin the form.
 */
function attachableTypes(
    ctx: ParseContext
): { ok: true; value: readonly string[] } | { ok: false; reason: string } {
    if (!ctx.typeLine.subtypes.includes("Aura"))
        return { ok: false, reason: "only an Aura's attach is read" };
    const enchant = (ctx.card.oracleText ?? "")
        .split("\n")
        .filter((line) => line.startsWith(ENCHANT_HEAD));
    if (enchant.length !== 1)
        return { ok: false, reason: "the Aura has no single Enchant line" };
    const descriptor = descriptorRule.run(
        enchant[0]!.slice(ENCHANT_HEAD.length),
        ctx
    );
    if (!descriptor.ok)
        return { ok: false, reason: "the Aura's Enchant line is not read" };
    const requirement = targetRequirementFromDescriptor(descriptor.value);
    if (
        !requirement.ok ||
        Object.keys(requirement.value).some(
            (key) => key !== "type" && key !== "count"
        )
    )
        return {
            ok: false,
            reason: "the Aura's Enchant line is qualified beyond a card type",
        };
    return { ok: true, value: requirementTypes(requirement.value) };
}

/**
 * ONE announced permanent on the battlefield — the object of a verb whose Op
 * acts on a permanent and nothing else (gain control, attach). A spell, a
 * player, a card in another zone or a multi-target group is refused here,
 * not left for the Op to ignore at resolution.
 */
function permanentTarget(span: string, ctx: unknown): RuleResult<SubjectIR> {
    const subject = subjectRule.run(span, ctx);
    if (!subject.ok) return subject;
    const value = subject.value;
    if (value.kind !== "target")
        return fail(`"${span}" is not an announced target`, span);
    const { requirement } = value;
    const types = requirementTypes(requirement);
    if (
        requirement.zone !== undefined ||
        requirement.count !== 1 ||
        !types.every((t) => (PERMANENT_TYPES as readonly string[]).includes(t))
    )
        return fail(`"${span}" is not one target permanent`, span);
    return subject;
}

/**
 * The subject of a verb that can act on a SWEEP: a mass subject when the span
 * opens on "all"/"each" (CR 110.1), else the ordinary subject.
 *
 * The two openings are disjoint with every ordinary subject — `subjectRule`
 * knows "target …", the source phrases and the player table, none of which
 * starts with either word — so this is a cascade, not a choice.
 */
function sweepableSubject(span: string, ctx: unknown) {
    const probe = uncapitalise(span);
    if (probe.startsWith("all ") || probe.startsWith("each ")) {
        const mass = massSubjectRule.run(probe, ctx);
        return mass.ok
            ? ok({ kind: "mass" as const, ...mass.value } as SubjectIR)
            : mass;
    }
    return subjectRule.run(span, ctx);
}

/**
 * The subject of a GROUP verb ("get", "become"): a sweep and nothing else —
 * "all <plural>", "each <singular>" or a plural qualified by whose permanents
 * it names ("Creatures you control", "Creatures target player controls").
 * A single object is not a group, and the verb's number says so.
 */
function groupSubject(span: string, ctx: unknown): RuleResult<SubjectIR> {
    const probe = uncapitalise(span);
    // "Each creature get …" is not English: "each" takes a singular verb, and
    // the singular verbs read one object, never a sweep.
    if (probe.startsWith("each "))
        return fail('"each" takes a singular verb, not a group one', span);
    const mass = probe.startsWith("all ")
        ? massSubjectRule.run(probe, ctx)
        : controlledPluralRule.run(span, ctx);
    return mass.ok
        ? ok({ kind: "mass" as const, ...mass.value } as SubjectIR)
        : mass;
}

/**
 * CR 120.3 — a damage recipient read by `creatureSweepRecipientRule`: the sweep
 * alone, or (`withPlayers`) the sweep PLUS every player, the two-set union
 * Earthquake prints. The union carries the narrowed creature half; an
 * announced opponent or a mana-value bound has no place in it.
 */
function sweepRecipient(
    mass: MassSubjectIR,
    withPlayers: boolean
): RuleResult<SubjectIR> {
    if (!withPlayers)
        return ok({ kind: "mass" as const, ...mass } as SubjectIR);
    if (mass.targetOpponentControls === true || mass.manaValueAtMostX)
        return fail(
            "a creature sweep joined to every player names no announced opponent or bound",
            "each player"
        );
    return ok({
        kind: "each-creature-and-player" as const,
        creatures: mass.select,
    });
}

/** Lowercase a sentence-initial capital, leaving the rest of the span alone. */
export function uncapitalise(span: string): string {
    return span.length === 0 ? span : span[0]!.toLowerCase() + span.slice(1);
}

/**
 * The mirror: raise a sentence-initial letter (CR 113.3c).
 *
 * A trigger prints its effect clause lowercase ("…, draw a card") where a
 * spell or activated site prints the same sentence capitalised ("Draw a
 * card"). Only the sentence-initial letter differs, and only for the FUNCTION
 * words this grammar dispatches on, so the two casings are one sentence read
 * through one rule rather than two near-identical pattern tables.
 */
export function capitalise(span: string): string {
    return span.length === 0 ? span : span[0]!.toUpperCase() + span.slice(1);
}

/** CR 603.2's optional marker, as printed at a trigger's effect clause. */
const MAY_PREFIX = "you may ";
/** The optional spelling of "it deals", up to the damage amount. */
const HAVE_IT_DEAL = /^have it deal (.+ damage to .+)$/;
/** CR 701.13a — the optional move of one of the controller's hand cards. */
const OPTIONAL_HAND_COSTS = {
    "exile a card from your hand": "exile",
    // CR 701.9a — "discard a card" (Gigapede): the hand discard of the cost leg.
    "discard a card": "discard",
} as const;

/**
 * Wrap a sentence rule so it also reads CR 603.2's "you may <effect>".
 *
 * A COMBINATOR over the caller's sentence rule rather than a branch inside
 * `sentenceRule`, because the marker is printed at trigger casing ("…, you may
 * draw a card") and each slot capitalises for itself: composing here keeps one
 * sentence table and lets a slot that has no optional shape stay unable to
 * read one.
 *
 * Fail-closed twice over (ADR 0105). An inner sentence the effect grammar
 * cannot parse fails the WHOLE span — the marker never licences a half-read
 * line — and a CR 602.5 restriction or a CR 701.19c modifier under "you may"
 * is a line we have misread rather than an optional effect, so it fails too.
 * There is no nesting: the inner rule is the caller's plain sentence, so
 * "you may you may draw a card" is not a sentence this grammar knows.
 */
export function optionalSentenceRule(
    inner: Rule<SentenceIR>
): Rule<SentenceIR> {
    return rule(`optional ${inner.label}`, (span, ctx) => {
        // The marker is a FUNCTION word at the head of its sentence, so it is
        // read at either casing — lowercase where a trigger's first clause
        // prints it ("…, you may draw a card"), capitalised where a following
        // sentence does ("… . You may gain 1 life"). Same probe the subject
        // rule uses, for the same reason: only the sentence-initial letter
        // differs, and only for the words this grammar dispatches on.
        const probe = uncapitalise(span);
        // CR 107.3f (issue #4529) — "you may pay {X}" is the first half of a
        // variable payment, not an optional effect: the marker would strip it
        // to "Pay {X}", a sentence nothing reads. `sentenceRule` reads the
        // capitalised spelling; the trigger site prints it lowercase.
        if (probe === PAY_VARIABLE_MANA)
            return ok({
                role: "pay-variable-mana" as const,
                text: capitalise(probe),
            });
        const fixedPay = probe.match(PAY_FIXED_MANA);
        if (fixedPay !== null) {
            const read = readManaCost(fixedPay[1]!);
            if (!read.ok) return fail(read.reason, read.fragment);
            return ok({
                role: "pay-mana" as const,
                text: capitalise(probe),
                mana: read.cost,
            });
        }
        if (!probe.startsWith(MAY_PREFIX)) return inner.run(span, ctx);
        const clause = probe.slice(MAY_PREFIX.length);
        // CR 608.2c — "you may exile a card from your hand" is the first half
        // of an `optional-hand-cost-then`: what it gates is the "If you do"
        // after it, not an effect of its own.
        if (Object.prototype.hasOwnProperty.call(OPTIONAL_HAND_COSTS, clause))
            return ok({
                role: "optional-hand-cost" as const,
                text: capitalise(clause),
                action: OPTIONAL_HAND_COSTS[
                    clause as keyof typeof OPTIONAL_HAND_COSTS
                ],
            });
        // CR 121.1 + CR 603.5 — "you may draw N additional cards" is the
        // first of the three sentences of a `draw-then-ranged-topdeck`.
        const additional = clause.match(DRAW_ADDITIONAL_CARDS);
        if (additional !== null) {
            const count = readNumberWord(additional[1]!);
            if (count === null || count < 1)
                return fail(`"${additional[1]}" is not a count`, span);
            return ok({
                role: "optional-draw-additional" as const,
                text: clause,
                count,
            });
        }
        // CR 608.2h — "you may have it deal X damage to …": "have it deal" is
        // the optional spelling of "it deals", the pronoun naming the object
        // the trigger head names. Rewritten to the marker the leading-"It"
        // sentence uses, so ONE damage rule reads both and the lowering's
        // referent check (`pronounIsSource`) refuses a head naming no source.
        // Only the damage verb: "have it <other verb>" is a form nobody here
        // has shown a fixture for.
        const haveItDeal = clause.match(HAVE_IT_DEAL);
        const parsed = inner.run(
            haveItDeal === null
                ? clause
                : `${PRONOUN_MARKER} deals ${haveItDeal[1]}`,
            ctx
        );
        if (!parsed.ok) return parsed;
        if (parsed.value.role !== "effect")
            return fail(
                `"you may" offers an effect, not a ${parsed.value.role}`,
                span
            );
        return ok({
            role: "effect" as const,
            effect: {
                kind: "optional" as const,
                clause,
                effect: parsed.value.effect,
            },
        });
    });
}

/**
 * Wrap a sentence rule so it also reads CR 702.33e's "If this spell was
 * kicked, <effect>".
 *
 * A combinator for the reason `optionalSentenceRule` is one: only the spell
 * site prints this shape (the permanent's "If this creature was kicked, it
 * enters with …" is an ENTRY rider, read by the static slot), so composing it
 * there keeps every other site unable to read a gate it has no kicker for.
 *
 * Fail-closed like its sibling: a head that reads as a kicked condition with a
 * tail the effect grammar cannot parse fails the whole span, and a restriction
 * or modifier behind the gate is a line we have misread. A span that does not
 * open on the condition is the inner rule's to read or refuse.
 */
export function kickedSentenceRule(inner: Rule<SentenceIR>): Rule<SentenceIR> {
    return rule(`kicked ${inner.label}`, (span, ctx) => {
        const comma = span.indexOf(", ");
        const head = comma === -1 ? null : uncapitalise(span.slice(0, comma));
        const condition =
            head === null ? null : kickedConditionRule.run(head, ctx);
        if (condition === null || !condition.ok) return inner.run(span, ctx);
        // CR 608.2h — "If this spell was kicked, it deals …": the clause's
        // own subject is the spell, the nearest antecedent the pronoun has
        // (`bindSourcePronoun`), and a spell's source is the spell itself.
        // Only a SPELL can be what "it" deals damage from; "…, it gains
        // flying" names the creature an earlier sentence targeted, so any
        // other verb behind a bound pronoun fails rather than granting the
        // ability to the spell.
        const bound = span.slice(comma + 2).match(KICKED_BOUND_INSTEAD);
        if (bound !== null)
            return ok({
                role: "kicked-bound-instead" as const,
                kicked: condition.value,
                noun: bound[1]!,
                manaValueAtMost: Number(bound[2]),
            });
        const tail = bindSourcePronoun(span.slice(comma + 2));
        const parsed = inner.run(capitalise(tail.span), ctx);
        if (!parsed.ok) return parsed;
        if (
            tail.bound &&
            (parsed.value.role !== "effect" ||
                parsed.value.effect.kind !== "deal-damage")
        )
            return fail(
                '"it" after a kicked condition is the spell only as a damage source',
                span
            );
        if (parsed.value.role !== "effect")
            return fail(
                `a kicked condition gates an effect, not a ${parsed.value.role}`,
                span
            );
        return ok({
            role: "effect" as const,
            effect: {
                kind: "kicked" as const,
                kicked: condition.value,
                effect: parsed.value.effect,
            },
        });
    });
}

/**
 * CR 608.2c — a spell sentence gated on a leading comparison: "If an opponent
 * controls more lands than you, search …".
 *
 * Only the "an opponent … than you" form reads here: "that player" names a
 * player only a trigger head introduces, and the other subjects have no spell
 * that prints them. Fail-closed like `kickedSentenceRule`: a head that reads as
 * the comparison with a tail the effect grammar cannot parse fails the span.
 */
export function comparativeSentenceRule(
    inner: Rule<SentenceIR>
): Rule<SentenceIR> {
    return rule(`comparative ${inner.label}`, (span, ctx) => {
        const comma = span.indexOf(", ");
        if (comma === -1 || !span.startsWith("If "))
            return inner.run(span, ctx);
        const head = span.slice("If ".length, comma);
        if (!head.startsWith("an opponent controls more "))
            return inner.run(span, ctx);
        const condition = comparativeControlsRule.run(head, ctx);
        if (!condition.ok) return condition;
        const parsed = inner.run(capitalise(span.slice(comma + 2)), ctx);
        if (!parsed.ok) return parsed;
        if (parsed.value.role !== "effect")
            return fail(
                `a comparison gates an effect, not a ${parsed.value.role}`,
                span
            );
        return ok({
            role: "effect" as const,
            effect: {
                kind: "controls-more" as const,
                condition: condition.value,
                effect: parsed.value.effect,
            },
        });
    });
}

/**
 * A sentence opening on the pronoun "It", with the pronoun already bound.
 *
 * CR 608.2h — "If an ability states that an object does something, it's the
 * object as it exists—or as it most recently existed—that does it". The
 * pronoun names an object; WHICH object is not a fact about the sentence but
 * about the text before it, so this sub-grammar never guesses: it binds only
 * what its CALLER — the site that printed the antecedent — says the pronoun
 * names, and a caller that binds nothing leaves "It" unread (the sentence
 * table has no entry for the word, so the line stays `unparsed`).
 *
 * The one referent any site binds today is the SOURCE, and the binding is
 * written as the source's own marker (`{self}`, CR 201.5), so "It deals 2
 * damage" and "{self} deals 2 damage" are ONE sentence read by one table —
 * `normalize.ts` makes the same substitution for the card's printed name.
 * Only the LEADING word is rebound: "Put a +1/+1 counter on target creature.
 * It gains flying" names the target, and a later sentence's "It" never
 * reaches this function.
 */
export function bindSourcePronoun(span: string): {
    readonly span: string;
    readonly bound: boolean;
} {
    const probe = uncapitalise(span);
    return probe.startsWith(SOURCE_PRONOUN)
        ? {
              span: `${SELF_MARKER} ${probe.slice(SOURCE_PRONOUN.length)}`,
              bound: true,
          }
        : { span, bound: false };
}

const SOURCE_PRONOUN = "it ";

/**
 * The marker a bound "It" is rewritten to when its referent is whatever the
 * SITE says, rather than the source (see `SubjectIR`'s `pronoun`).
 *
 * A marker in the span, exactly like `{self}`, rather than a flag riding
 * beside it: the sentence table dispatches on WORDS, and a subject that is a
 * word goes through the same `subjectRule` as every other. It is deliberately
 * not a phrase a card could print — "that creature" is one, and reading it
 * here would silently claim every printed "that creature" for this referent.
 */
export const PRONOUN_MARKER = "{it}";

/**
 * A leading "It" rewritten to {@link PRONOUN_MARKER}, and whether it was.
 *
 * The site-referent twin of {@link bindSourcePronoun}: same rewrite, same
 * leading-word-only rule (CR 608.2h), different referent. The two are separate
 * functions rather than one parameterised by marker because the CALLERS differ
 * in what they may bind — an activated ability has only its source to name,
 * a trigger head may have named someone else.
 */
export function bindObjectPronoun(span: string): {
    readonly span: string;
    readonly bound: boolean;
} {
    const probe = uncapitalise(span);
    return probe.startsWith(SOURCE_PRONOUN)
        ? {
              span: `${PRONOUN_MARKER} ${probe.slice(SOURCE_PRONOUN.length)}`,
              bound: true,
          }
        : { span, bound: false };
}

/**
 * Wrap a sentence-LIST rule so a leading "It" is read as the SITE's object
 * referent, and say whether it was — the caller owns the antecedent check.
 * {@link sourcePronounListRule}'s twin (see {@link bindObjectPronoun}).
 */
export function objectPronounListRule<T>(
    inner: Rule<T>
): Rule<{ readonly value: T; readonly boundPronoun: boolean }> {
    return rule(`object-pronoun ${inner.label}`, (span, ctx) => {
        const bound = bindObjectPronoun(span);
        const parsed = inner.run(bound.span, ctx);
        return parsed.ok
            ? ok({ value: parsed.value, boundPronoun: bound.bound })
            : parsed;
    });
}

/**
 * Wrap a sentence-LIST rule so a leading "It" is read as the source, and say
 * whether it was — the caller owns the antecedent check (`bindSourcePronoun`).
 */
export function sourcePronounListRule<T>(
    inner: Rule<T>
): Rule<{ readonly value: T; readonly boundPronoun: boolean }> {
    return rule(`source-pronoun ${inner.label}`, (span, ctx) => {
        const bound = bindSourcePronoun(span);
        const parsed = inner.run(bound.span, ctx);
        return parsed.ok
            ? ok({ value: parsed.value, boundPronoun: bound.bound })
            : parsed;
    });
}

/** A subject that must be a player (CR 102.1) — "you", "target player". */
function playerSubject(span: string, ctx: unknown): PlayerRefIR | null {
    const player = playerRefRule.run(span, ctx);
    return player.ok ? player.value : null;
}

// ── Sentence patterns ──────────────────────────────────────────────────────

/**
 * CR 613.4c — "<subject> gets +N/+N <tail>" (one object) and "<subject> get
 * +N/+N <tail>" (a group). The verb's number is the subject's: `get` is read
 * only over a sweep and `gets` only over one object, so a sentence that
 * disagrees is a line we have misread. "an additional" (CR 613.4c stacks the
 * bonus with the one an earlier sentence gave) is read only behind the group
 * verb, the one form the corpus prints.
 */
const PUMP = /^(.+) (gets|get) (an additional )?([+-]\d+)\/([+-]\d+) (.+)$/;
/** CR 207.2c — the Domain tally a per-step pump scales by. */
const PUMP_PER_DOMAIN = / for each basic land type among lands you control$/;
/** CR 508.1 — the attacking-creature tally a pump scales by. */
const PUMP_PER_OTHER_ATTACKING = / for each other attacking (\S+)$/;
/** CR 205.1b — "All lands you control become 1/1 creatures until end of turn". */
const ANIMATE = /^(.+) become (\d+)\/(\d+) creatures (.+)$/;
/** CR 205.1b — the rider that keeps the animated set's types. */
const STILL_TYPES = /^They(?:'|’)re still (.+)$/;
/** CR 205.1b — the same rider after the SOURCE's own animation. */
const STILL_TYPE_SELF = /^It(?:'|’)s still a (land)$/;
/**
 * CR 205.1b + CR 613.1d/f — "This land becomes a N/N [color] <Subtype>
 * [artifact] creature[ with <keyword>] <duration>": the manland's own
 * animation. The article is the printed "a" (a digit follows it, never "an");
 * the middle is read word by word by `readSelfAnimation`, never by a lenient
 * capture.
 */
const ANIMATE_SELF =
    /^This (land) becomes a (\d+)\/(\d+) (.+?) creature(?: with (.+?))? (until .+)$/;
/**
 * CR 205.1a + CR 613.1d — "<source> becomes a N/N [color] <Subtype> creature":
 * a permanent type-line replacement with no duration. The middle is read word
 * by word by `readBecomeCreature` (one colour at most, ONE creature subtype).
 */
const BECOME_CREATURE = /^(\S+) becomes a (\d+)\/(\d+) (.+) creature$/;
/** CR 113.1a — the `with` tail of an animation that is ONE quoted ability. */
const QUOTED_GRANT_TAIL = /^"([^"]+)"$/;
const DAMAGE = /^(.+) deals (\S+|that much) damage to (.+)$/;
const THAT_CREATURE_CONTROLLER = "that creature's controller";
/** CR 601.2d — "deals N damage divided as you choose among <targets>". */
const DAMAGE_DIVIDED =
    /^(.+) deals (\S+) damage divided as you choose among (.+)$/;
/** CR 601.2d / 122.1a — "Distribute N +X/+Y counters among <targets>". The
 *  kind is a P/T counter only: a stun, shield or oil counter is a different
 *  mechanic the corpus distributes under other wording, and stays unread. */
const DISTRIBUTE_COUNTERS =
    /^Distribute (\S+) ([+-]\d+\/[+-]\d+) counters among (.+)$/;
/** CR 603.7a — the delayed take-back of the counters distributed this way. */
const REMOVE_DISTRIBUTED_COUNTERS =
    /^For each ([+-]\d+\/[+-]\d+) counter you put on a creature this way, remove a ([+-]\d+\/[+-]\d+) counter from that creature at the beginning of the next (cleanup|end) step$/;
/**
 * CR 613.1e — "<subject> becomes the color of your choice[ <duration>]".
 *
 * The colour clause is matched as a WHOLE phrase and the subject is whatever
 * precedes it, which is what keeps the neighbouring colour templates out: "…
 * becomes the color of that card" names a colour the sentence read elsewhere,
 * "… becomes white" names one the card printed, and "becomes the color of your
 * choice and gains hexproof from that color" (Mondo Gecko) ties a keyword
 * grant to the pick. None of the three ends here, so none is read — the tail
 * group is a DURATION or nothing.
 */
const SET_COLOR_CHOICE = /^(.+) becomes the color of your choice(?: (.+))?$/;
// CR 305.7 — "<subject> becomes <land types> <duration>". The duration half is
// spelled into the pattern rather than left to a trailing `(.+)`: every
// land-type change in the corpus prints one, and a pattern that made it
// optional would read "Target land becomes a Forest" — a form nobody prints —
// as an indefinite change (CR 611.2a).
const SET_LAND_TYPE = /^(.+) becomes (.+?) (until .+)$/;
/** CR 305.6 / CR 608.2d — the free choice among all five basic land types. */
const ANY_BASIC_LAND_TYPE = "the basic land type of your choice";
/**
 * CR 305.6 — each basic land type as a named leg spells it, ARTICLE included.
 *
 * A table rather than `/^an? (\w+)$/`, so the article has to be the one the
 * card prints: "an Island" and "a Swamp", never "an Swamp". The lenient
 * pattern would read a line no printer has ever set, which is the shape
 * ADR 0105 § 2 refuses — the grammar reads printed English, not a
 * near-English superset.
 */
const BASIC_LAND_TYPE_LEGS: ReadonlyMap<string, string> = new Map(
    BASIC_LAND_SUBTYPE_ORDER.map((type) => [
        `${/^[AEIOU]/.test(type) ? "an" : "a"} ${type}`,
        type,
    ])
);
const DRAW_SELF = /^Draw (\S+) cards?$/;
const DRAW_PLAYER = /^(.+) draws (\S+) cards?$/;
/** CR 121.1 + CR 107.1 — "Draw cards equal to the number of <set>". */
const DRAW_EQUAL_COUNT = /^Draw cards equal to (the number of .+)$/;
const LIFE = /^(.+) (gain|gains|lose|loses) (\S+|that much) life$/;
/**
 * CR 107.3 — "<effect>, where X is <count>": the head sentence prints X and the
 * tail defines it. The tail is one of two counts: "the number of <plural
 * descriptor>" and "the number of cards in your hand minus N".
 */
const WHERE_X_IS =
    /^(.+), where X is (the number of .+|the exiled card(?:'|’)s mana value)$/;
const EXILED_CARD_MANA_VALUE = /^the exiled card(?:'|’)s mana value$/;
const CARDS_IN_YOUR_HAND_MINUS =
    /^the number of cards in your hand minus (\S+)$/;
/**
 * CR 107.1 — "<player> gains/loses N life for each <set>". The multiplier is a
 * printed number: "X life for each …" is a product of two variables this
 * grammar does not read.
 */
/** CR 205.3m — "Choose a creature type." The whole sentence; see the branch
 *  in `effectSentence` for why it is anchored at both ends. */
const CHOOSE_CREATURE_TYPE = /^Choose a creature type$/;
/** CR 205.3m (issue #4316) — the same instruction with ONE excluded type. The
 *  type is validated against CR 205.3m's table by the branch, so "other than
 *  Forest" (a land type) stays refused. */
const CHOOSE_CREATURE_TYPE_EXCEPT = /^Choose a creature type other than (.+)$/;
/** CR 205.1a (issue #4316) — the chosen type written onto a subject. "that
 *  type" is the ONLY spelling read: it names the binding the choose sentence
 *  wrote; a literal type ("becomes a Wall") is a different clause. */
const SET_CHOSEN_CREATURE_TYPE = /^(.+) becomes that type (until .+)$/;
/** CR 205.3i / 305.6 — the two-pick land-type instruction, whole. */
const CHOOSE_LAND_TYPES = /^Choose a land type and a basic land type$/;
/** CR 305.7 — the two picks written back, whole but for the duration. "Each
 *  land" is the only subject read: a narrower one ("each land you control")
 *  is a different set this rule has no fixture for. */
const SET_CHOSEN_LAND_TYPE =
    /^Each land of the first chosen type becomes the second chosen type (until .+)$/;
/** CR 614.1a (issue #3811) — the production-colour replacement, whole. */
const REPLACE_MANA_PRODUCTION_COLOR =
    /^Until end of turn, spells and abilities you control that would add colored mana instead add that much (white|blue|black|red|green) mana$/;
/** CR 609.4b (issue #3811) — the until-end-of-turn spend permission, whole.
 *  "colorless" is a mana type (CR 106.1b), so it may be the spent side. */
const GRANT_MANA_SUBSTITUTION =
    /^Until end of turn, you may spend (white|blue|black|red|green|colorless) mana as though it were mana of any (color|type)$/;
/** CR 609.4b / 118.14 (issue #4529) — the one-shot spell-scoped spend
 *  permission, whole. Anchored at both ends: a scope clause appended to it
 *  ("… to cast creature spells") narrows the grant and must not be dropped. */
const GRANT_SPELL_MANA_SUBSTITUTION =
    /^For one spell this turn, you may spend mana as though it were mana of any (color|type) to pay that spell's mana cost$/;
/** CR 107.3f (issue #4529) — the first sentence of a variable payment. */
const PAY_VARIABLE_MANA = "you may pay {X}";
/** CR 118.12 + CR 107.4e — a FIXED mana payment: "you may pay" then pips only,
 *  whole; a guild-hybrid pip ("{W/B}") is one of them, kept as a hybrid pair by
 *  `readManaCost`. A variable {X} is `PAY_VARIABLE_MANA`'s; a non-mana leg
 *  ("pay 2 life") is another payment this rule does not read. */
const PAY_FIXED_MANA =
    /^you may pay ((?:\{(?:[WUBRGC0-9]+|[WUBRG]\/[WUBRG])\})+)$/;
/** CR 508.1c — the player-scoped attack restriction with its evasion
 *  carve-out, whole. */
const PLAYER_ATTACK_PROTECTION =
    /^Until your next turn, you can't be attacked except by creatures with flying and\/or islandwalk$/;
/** CR 510.1c — the source's own assignment suppression, whole. */
const ASSIGNS_NO_COMBAT_DAMAGE = /^(.+) assigns no combat damage this turn$/;
const AND_ASSIGNS_NO_COMBAT_DAMAGE =
    /^(.+) and (.+) assigns no combat damage this turn$/;
/** CR 107.3f (issue #4529) — the payoff sentence of a variable payment. */
const IF_YOU_DO = /^If you do, (.+)$/;
/** CR 121.1 — the first half of a `draw-then-ranged-topdeck`, whole. */
const DRAW_ADDITIONAL_CARDS = /^draw (\S+) additional cards$/;
/** The pick among the cards drawn this turn, whole. */
const CHOOSE_DRAWN_THIS_TURN =
    /^If you do, choose (\S+) cards in your hand drawn this turn$/;
/** What each card not kept costs, whole (CR 119.4 + CR 401.4). */
const PAY_LIFE_OR_TOPDECK =
    /^For each of those cards, pay (\S+) life or put the card on top of your library$/;
/** CR 106.1 — "Add " then one or more coloured / colorless pip symbols, whole. */
const ADD_MANA = /^(That player adds|Add) ((?:\{[WUBRGC]\})+)$/;
/** CR 608.2c — the replacement sentence of a conditional ritual, whole. */
const ADD_MANA_INSTEAD_IF_COUNT =
    /^Add ((?:\{[WUBRGC]\})+) instead if there are (\S+) or more cards in your graveyard$/;

/** CR 106.1 — a run of `{W}{U}{B}{R}{G}{C}` pips as a per-symbol tally. */
function readManaPips(pips: string): EffectManaPool {
    const mana: EffectManaPool = {};
    for (const pip of pips.matchAll(/\{([WUBRGC])\}/g)) {
        const symbol = pip[1] as keyof EffectManaPool;
        mana[symbol] = (mana[symbol] ?? 0) + 1;
    }
    return mana;
}
const LIFE_FOR_EACH = /^(.+) (gain|gains|lose|loses) (\S+) life (for each .+)$/;
/** CR 107.1 + CR 119.3 — "You gain life equal to the number of creature cards
 *  in your graveyard" (Blossoming Wreath): the set is a plural noun phrase read
 *  by `numberOfSetRule`, the same read as damage "equal to the number of". */
const LIFE_EQUAL_COUNT =
    /^(.+) (gain|gains|lose|loses) life equal to (the number of .+)$/;
/** CR 119.3 + CR 202.3 + CR 208.1 — "You lose life equal to its mana value"
 *  (or "that card's", or "that permanent's" — Feed the Swarm), and "You gain
 *  life equal to its power" (Chastise). The characteristic is a capture group
 *  because the same clause shape prints all three; which noun may take which
 *  characteristic is `readActedOnCharacteristic`'s. */
/** CR 109.4 — "Its controller" / "That artifact's controller", a life recipient. */
const ACTED_ON_CONTROLLER = /^(?:Its|That (artifact)'s) controller$/;
const LIFE_EQUAL_ACTED_ON = new RegExp(
    `^(.+) (gain|gains|lose|loses) life equal to ${actedOnNounGroup(["it", "card", "permanent"])} ${actedOnCharacteristicGroup(["manaValue", "power", "toughness"])}$`
);
/**
 * CR 119.3 + CR 202.3 — "{self} deals damage equal to that permanent's mana
 * value to target creature" (Orim's Thunder, issue #4221).
 *
 * The neighbouring `DAMAGE` template reads its magnitude as ONE token, so a
 * multi-word amount needs its own pattern rather than a widened `(\S+)`: the
 * amount phrase and the recipient are both open spans, and a single pattern
 * loose enough to hold either would read "deals 3 damage to target creature"
 * as an amount phrase.
 */
const DAMAGE_EQUAL_MANA_VALUE = new RegExp(
    `^(.+) deals damage equal to ${actedOnNounGroup(["permanent"])} mana value to (.+)$`
);
/**
 * CR 120.1 + CR 202.3 + CR 608.2h — "That artifact deals damage equal to its
 * mana value to this creature" (Goblin Tinkerer): the DEALER is the object an
 * earlier sentence acted on, and "its" is that same dealer. One printed noun,
 * checked by the lowering against what was acted on; the magnitude is pinned
 * to "its mana value", the only characteristic the corpus prints here.
 */
const ACTED_ON_DEALS_DAMAGE_EQUAL_MANA_VALUE =
    /^That (\S+) deals damage equal to its mana value to (.+)$/;
/**
 * CR 107.1 + CR 120.1 — "{self} deals damage to target creature equal to the
 * number of Mountains you control" (Rockslide Ambush). Recipient and count are
 * both open spans; "equal to the number of" is the only anchor between them,
 * so the recipient is read lazily up to it.
 */
const DAMAGE_EACH_PLAYER_COUNT =
    /^(.+) deals damage to each player equal to (twice )?(the number of .+?) that player controls$/;
const DAMAGE_EQUAL_COUNT =
    /^(.+) deals damage to (.+?) equal to (the number of .+)$/;
/**
 * CR 608.2h + CR 208.1 — "{self} deals damage equal to its power to target
 * creature" (Cinder Shade): the dealer's OWN power, last known because the
 * cost sacrificed it.
 *
 * Pinned to the literal "its power": "its toughness" and "its mana value" name
 * the same object but no corpus card prints them at a damage site, so neither
 * has a fixture (ADR 0137 anti-leniency). The neighbouring
 * {@link DAMAGE_EQUAL_MANA_VALUE} reads "that permanent's" — an object an
 * EARLIER SENTENCE acted on — so the two patterns cannot claim one line.
 */
const DAMAGE_EQUAL_OWN_POWER = /^(.+) deals damage equal to its power to (.+)$/;
/**
 * CR 608.2c — a drain: "Target player loses 2 life and you gain 2 life". The
 * loss reads through `LIFE` like any other, and the gain is pinned to exactly
 * "you gain N life" (anti-leniency, as `YOU_DRAW_AND_LOSE_LIFE`): every other
 * second half stays refused until a corpus card prints it.
 */
const DRAIN = /^(.+) loses (\S+) life and (you gain \S+ life)$/;
/**
 * CR 115.1 + CR 701.8a — "Destroy target artifact and target enchantment": two
 * announced targets under ONE verb. Each half must open its own "target", so a
 * bare "and" inside one descriptor ("artifact and/or enchantment") is not
 * split here; each half is then read as a destroy of its own, in printed
 * order.
 */
const DESTROY_TWO_TARGETS = /^Destroy (target .+?) and (target .+)$/;
/**
 * CR 608.2c — a damage-and-gain: "{self} deals 2 damage to target creature and
 * you gain 2 life". The damage reads through `DAMAGE` like any other and the
 * gain is pinned to exactly "you gain N life" (anti-leniency, as `DRAIN`): the
 * gain is a printed number, not the damage dealt, so the two Ops are
 * independent and resolve in printed order.
 */
const DAMAGE_THEN_GAIN =
    /^(.+ deals \S+ damage to .+) and (you gain \S+ life)$/;
const COUNTERS = /^Put (\S+) (\S+) counters? on (.+)$/;
const DISCARD_RANDOM = /^(.+) discards (\S+) cards? at random$/;
/** CR 603.7a — "You draw a card at the beginning of the next turn's upkeep". */
const DELAYED_DRAW_NEXT_UPKEEP =
    /^(?:You draw (\S+) cards?|Draw (a) card) at the beginning of the next turn(?:'|’)s upkeep$/;
/**
 * CR 603.7a — "Return it to its owner's hand at the beginning of the next end
 * step" / "… cleanup step" and "Return that card to the battlefield under its
 * owner's control at the beginning of the next end step".
 */
const DELAYED_RETURN =
    /^Return (it|that card|this (?:land|artifact|creature|permanent|enchantment)) to (?:its owner(?:'|’)s hand at the beginning of the next (end|cleanup) step|the battlefield under its owner(?:'|’)s control at the beginning of the next (end) step)$/;
/** CR 603.7a — "Exile it at the beginning of the next end step" / "Sacrifice it …". */
const DELAYED_REMOVAL_NEXT_END_STEP =
    /^(Exile|Sacrifice) it at the beginning of the next end step$/;
/** CR 201.4a — "Choose a card name" and its two printed restrictions. */
/** CR 201.4 + CR 701.20a — the Cursed Scroll sentence, whole. */
const NAME_THEN_REVEAL_RANDOM =
    /^Choose a card name, then reveal a card at random from your hand$/;
/** CR 201.2a — the gate sentence that reads it back. */
const IF_REVEALED_HAS_CHOSEN_NAME = /^If that card has the chosen name, (.+)$/;
const NAME_CARD =
    /^Choose a (nonland )?card name( other than a basic land card name)?$/;
/** CR 201.4 — a sentence that reads the pick as "that name". */
const DISCARD_NAMED =
    /^(.+) reveals their hand and discards all cards with that name$/;
const DIG_NAMED =
    /^Reveal the top (\S+) cards of your library and put all of them with that name into your hand$/;
const EXILE_REST = /^Exile the rest$/;
/** CR 400.2 — "Look at target player's hand": the owner is a possessive. */
const LOOK_HAND = /^Look at (.+?)(?:'|’)s hand$/;
/** CR 400.2 — "Look at a card at random in target player's hand". */
const LOOK_RANDOM_HAND = /^Look at a card at random in (.+?)(?:'|’)s hand$/;
/** CR 701.9b — "Target player discards two cards": the player's own choice. */
const DISCARD_CHOICE = /^(.+) discards (\S+) cards?$/;
/** CR 701.9b — "Discard a card": the controller discards one of their choice. */
const DISCARD_SELF = "Discard a card";
/** CR 105.1 — "green or white": two colour words joined by a printed "or". */
const COLOR_ALTERNATIVES =
    /^(?:white|blue|black|red|green) or (?:white|blue|black|red|green) /;
/**
 * CR 701.21a — "Target player sacrifices a creature of their choice": the
 * count word and the permanent phrase, "of their choice" optional. Anything
 * after the phrase ("with flying", "for each …", ", then …") stays inside
 * the phrase, where the descriptor reader refuses it.
 */
/** CR 118.12a — where a sacrifice rider's payment begins. */
const SACRIFICE_UNLESS = " unless you ";
const SACRIFICE_EDICT = /^(.+?) sacrifices (\S+) (.+?)(?: of their choice)?$/;
/** CR 701.26a — "<player> taps an untapped <types> they control for each <type> counter on this <noun>". */
const TAP_CHOSEN_PER_COUNTER =
    /^(.+?) taps an untapped (.+?) (?:they|that player) control for each (\S+) counter on this (\S+)$/;
/** CR 701.21a — the imperative "Sacrifice that many permanents": the controller's own edict. */
const SACRIFICE_THAT_MANY = /^Sacrifice that many (permanents)$/;
/**
 * CR 608.2h — the superlative tail of an edict's permanent phrase: "creature
 * with the greatest power among creatures they control". Head, extreme, stat
 * and set; each is validated by `superlativeFromClause`.
 */
const SUPERLATIVE_TAIL = /^(.+?) with the (\S+) (.+?) among (.+)$/;
/**
 * CR 608.2c — "You draw a card and you lose 1 life" / "You draw a card and
 * lose 1 life": a draw, then a life loss, the second "you" printed or elided. Anchored at both
 * ends and pinned to exactly these two verbs: every other conjunction stays
 * refused until a corpus card prints it (ADR 0137 anti-leniency).
 */
const YOU_DRAW_AND_LOSE_LIFE =
    /^You (draw \S+ cards?) and (?:you )?(lose \S+ life)$/;
/**
 * CR 608.2c — "You draw a card and that opponent discards a card": a draw by
 * the controller, then a discard by the player the head named. Pinned to
 * exactly this pair, like the conjunction above: a different second subject or
 * verb stays refused until a corpus card prints it.
 */
const YOU_DRAW_AND_THAT_OPPONENT_DISCARDS =
    /^You (draw \S+ cards?) and (that opponent discards \S+ cards?)$/;
/** CR 701.17a — "Mill three cards" (the controller's own library). */
/** CR 404.2 — "Return the top creature card of your graveyard to the battlefield". */
const RETURN_TOP_CARD =
    /^Return the top (\w+) card of your graveyard to the battlefield$/;
/** CR 404.2 — "Exile the bottom card of target player's graveyard". */
const EXILE_BOTTOM_CARD =
    /^Exile the bottom card of target player(?:'|’)s graveyard$/;
/** CR 400.7 — "Return all enchantment cards from your graveyard to the battlefield". */
const RETURN_ALL_FROM_GRAVEYARD =
    /^Return all (\w+) cards from your graveyard to the battlefield$/;
/** CR 113.6b — "return this card from your graveyard to your hand". */
const RETURN_SELF_FROM_GRAVEYARD =
    /^Return this card (?:from your graveyard )?to your hand$/;
/** CR 303.4f — "return this card from your graveyard to the battlefield attached to that creature". */
const RETURN_SELF_FROM_GRAVEYARD_ATTACHED =
    /^Return this card from your graveyard to the battlefield attached to that creature$/;
/** CR 101.4 — "Each player puts a creature card from their graveyard onto the battlefield". */
const EACH_PLAYER_PUTS =
    /^Each player (puts|may put) an? (.+) card from their (graveyard|hand) onto the battlefield$/;

/** CR 205.3 — "Put a Goblin permanent card from your hand onto the battlefield". */
const PUT_SUBTYPE_FROM_HAND =
    /^Put an? (\S+) permanent card from your hand onto the battlefield$/;

/** A permanent card type word ("creature", "enchantment") as a `CardType`. */
function permanentCardType(word: string): CardType | null {
    const type = word.charAt(0).toUpperCase() + word.slice(1);
    return (PERMANENT_TYPES as readonly string[]).includes(type)
        ? (type as CardType)
        : null;
}

/** "an artifact, creature, enchantment, or land" → its permanent types. */
function permanentCardTypeList(phrase: string): readonly CardType[] | null {
    const words = phrase.split(/, or |, | or /);
    const types: CardType[] = [];
    for (const word of words) {
        const type = permanentCardType(word);
        if (type === null || types.includes(type)) return null;
        types.push(type);
    }
    return types;
}

/** CR 110.2a — "Put <object> onto the battlefield under your control". */
const PUT_UNDER_YOUR_CONTROL =
    /^Put (.+) onto the battlefield under your control$/;
/** CR 404.1 — "Exile target player's graveyard": the owner is a possessive. */
const RETURN_OWN_PERMANENT =
    /^Return (an? .+ you control) to its owner(?:'|’)s hand$/;
/** CR 701.26b — "Untap up to seven lands": a choice, not a target. */
/** "up to one target creature" is a TARGET (CR 115.1) and stays with the
 *  announced-subject path; only an unannounced noun phrase is a choice. */
const UNTAP_UP_TO = /^Untap up to (\S+) (?!target )(.+)$/;
/** CR 106.4 — the tail of a tap sweep over an announced player's permanents. */
const TAP_TARGET_PLAYER_SWEEP_DRAIN =
    /^Tap (all .+) target player controls and that player loses all unspent mana$/;
const EXILE_GRAVEYARD = /^Exile (.+?)(?:'|’)s graveyard$/;
/** CR 205.4a — "Exile all cards from <player>'s graveyard other than basic land cards". */
const EXILE_GRAVEYARD_EXCEPT_BASIC_LANDS =
    /^Exile all cards from (.+?)(?:'|’)s graveyard other than basic land cards$/;
/** CR 608.2c — the per-card library sweep behind the graveyard exile. */
const EXILE_SAME_NAME_LIBRARY_COPIES =
    /^For each card exiled this way, search (.+?)(?:'|’)s library for all cards with the same name as that card and exile them$/;
const MILL_IMPERATIVE = /^Mill (\S+) cards?$/;
/** CR 701.17a — "Target player mills three cards". */
const MILL_PLAYER = /^(.+) mills (\S+) cards?$/;
/** CR 401.4 — "Target opponent puts a card from their hand on top of their library". */
const PUT_BACK_PLAYER =
    /^(.+) puts (\S+) cards? from their hand on top of their library( in any order)?$/;
/** CR 121.1 + CR 401.4 — "Draw three cards, then put two cards from your hand on top of your library in any order". */
const DRAW_PUT_BACK =
    /^Draw (\S+) cards?, then put (\S+) cards? from your hand on top of your library( in any order)?$/;
/** CR 701.24a — "Shuffle {self} into its owner's library". */
const SHUFFLE_SELF = `Shuffle ${SELF_MARKER} into its owner's library`;
/** CR 610.3 — "Exile <target> until <this permanent> leaves the battlefield". */
const EXILE_UNTIL_LEAVES = /^Exile (.+) until (.+) leaves the battlefield$/;
/** CR 607.2a — the O-Ring family's linked return. */
const RETURN_EXILED =
    "Return the exiled card to the battlefield under its owner's control";
/** CR 607.2a + CR 400.7 — the hand-disruption family's linked return. */
const RETURN_EXILED_TO_HAND = "Return the exiled card to its owner's hand";
/** CR 607.2a + CR 110.2a — the Parallax family's linked return of the pile. */
const RETURN_ALL_EXILED_WITH =
    "Each player returns to the battlefield all cards they own exiled with it";
/** CR 601.3 + CR 305.1 — Yawgmoth's Will's graveyard permission. */
const GRAVEYARD_PLAY =
    "Until end of turn, you may play lands and cast spells from your graveyard";
/** CR 614.1a — Yawgmoth's Will's graveyard redirect. */
const GRAVEYARD_REDIRECT =
    "If a card would be put into your graveyard from anywhere this turn, exile that card instead";
/** CR 614.1a — "If that creature would die this turn, exile it instead". */
const EXILE_IF_DIES = "If that creature would die this turn, exile it instead";
/** CR 603.7a + CR 700.4 — "When the creature dies this turn, exile the creature". */
const EXILE_WHEN_DIES = "When the creature dies this turn, exile the creature";
/** CR 608.2n — "Exile {self}" (the resolving spell exiles itself). */
const EXILE_SELF = `Exile ${SELF_MARKER}`;
const GAIN_CONTROL_VERB = "Gain control of ";
/** CR 701.12a — "Exchange control of <this object> and <target>". */
const EXCHANGE_CONTROL =
    /^Exchange control of (.+?) and (up to one target .+)$/;
/** CR 701.12a — the fallback sentence. */
const EXCHANGE_FALLBACK_SACRIFICE =
    /^If you don't or can't make an exchange, sacrifice (.+)$/;
/** CR 608.2b — the ability-level opt-out of the all-targets-illegal fizzle. */
const RESOLVES_IF_TARGET_ILLEGAL =
    "This ability still resolves if its target becomes illegal";
const WHILE_YOU_CONTROL = " for as long as you control ";
const ATTACH_SELF = /^Attach (.+?) to (.+)$/;
const ENCHANT_HEAD = "Enchant ";
/** CR 701.44a — "<subject> explores". */
const EXPLORE = /^(.+) explores$/;
/** CR 121.1 + CR 701.9a — "Draw a card, then discard a card". */
const LOOT = /^Draw (\S+) cards?, then discard (\S+) cards?$/;
const SHUFFLE_HAND_REDRAW =
    /^Shuffle the cards from your hand into your library, then draw that many cards$/;
/** CR 701.24a + CR 404.1 — "Shuffle your graveyard into your library". */
const SHUFFLE_OWN_GRAVEYARD = "Shuffle your graveyard into your library";
/** CR 701.23a (search) + CR 701.20a (reveal) + CR 701.24a (shuffle) — "Search your library for <what>,
 *  reveal it, put it into your hand, then shuffle". */
const SEARCH_LIBRARY_TO_HAND =
    /^Search your library for (.+?), reveal (it|that card), put it into your hand, then shuffle$/;
/**
 * What a library search may be told to find (CR 701.23a — "a card that matches
 * the given description"), as an `EffectCardFilter`. Fail-closed by
 * construction: a description with no row here is one this grammar has no
 * fixture for, and the sentence fails rather than searching wider than the
 * card said. A row is earned by a printed form, never by symmetry.
 */
const LIBRARY_SEARCH_FILTERS = new Map<string, EffectCardFilter>([
    ["a basic land card|it", { type: "Land", supertype: "Basic" }],
    ["a land card|it", { type: "Land" }],
    ["a creature card|that card", { type: "Creature" }],
    ["a Goblin card|that card", { subtype: "Goblin" }],
    ["a Forest card|that card", { subtype: "Forest" }],
]);
/**
 * CR 701.23a (search) + CR 110.5b — "Search your library for <what>, put <it>
 * onto the battlefield[ tapped], then shuffle". A closed table of the whole
 * printed middle of the clause, so the pronoun and the tapped state are part of
 * what is accepted (the basic-land fetch prints "that card ... tapped", the
 * dual-land fetch "it" untapped); a pairing no card prints has no row and fails
 * the line.
 */
const SEARCH_LIBRARY_TO_BATTLEFIELD =
    /^Search your library for (.+?), put (it|that card) onto the battlefield( tapped)?, then shuffle$/;
const DUAL_LAND_FETCHES: readonly (readonly [string, string])[] = [
    ["Forest", "Plains"],
    ["Mountain", "Forest"],
    ["Plains", "Island"],
    ["Swamp", "Mountain"],
    ["Island", "Swamp"],
];
const LIBRARY_SEARCH_TO_BATTLEFIELD = new Map<
    string,
    { filter: EffectCardFilter; tapped: boolean }
>([
    [
        "a basic land card|that card|tapped",
        { filter: { type: "Land", supertype: "Basic" }, tapped: true },
    ],
    [
        "an Elf permanent card|it|",
        {
            filter: { type: [...PERMANENT_TYPES], subtype: "Elf" },
            tapped: false,
        },
    ],
    ...DUAL_LAND_FETCHES.map(
        ([first, second]): [
            string,
            { filter: EffectCardFilter; tapped: boolean },
        ] => [
            `${/^[AEIOU]/.test(first!) ? "an" : "a"} ${first} or ${second} card|it|`,
            { filter: { subtype: [first!, second!] }, tapped: false },
        ]
    ),
]);
/**
 * CR 701.23a (search) + CR 701.20a (reveal) + CR 701.24a (shuffle) —
 * "Search your library for <what>, reveal it, then shuffle and put <the|that>
 * card on top". A closed table of the printed middle of the clause (phrase and
 * pronoun together): the instant tutors print "the card" / "that card" by
 * card, so a pairing no card prints has no row and fails the line.
 */
const SEARCH_LIBRARY_TO_TOP =
    /^Search your library for (.+?), reveal it, then shuffle and put (the|that) card on top$/;
const LIBRARY_SEARCH_TO_TOP = new Map<string, EffectCardFilter>([
    ["a creature card|the", { type: "Creature" }],
    [
        "an artifact or enchantment card|that",
        { type: ["Artifact", "Enchantment"] },
    ],
    ["an enchantment card|that", { type: "Enchantment" }],
]);
/**
 * CR 701.23a — "Search target player's library for <count> and exile them":
 * the library owner is a target. The count group is read by
 * `readTargetLibrarySearch`; the one quality admitted between the count and
 * the denial verb is "with flashback" (CR 702.34a), and only behind "up to N"
 * (see `search-target-library`); any other quality fails the match.
 */
const SEARCH_TARGET_LIBRARY =
    /^Search (target player|target opponent)'s library for (a card|up to (\S+) cards|(\S+) cards)( with flashback)?(?:,| and) (exile|put) (it|them)(?: into that player's graveyard)?(, then that player shuffles)?$/;
/** CR 701.24a — the sentence that shuffles the library a search just looked at. */
const THEN_THAT_PLAYER_SHUFFLES =
    /^Then (?:that|the) player shuffles(?: their library)?$/;
/** CR 608.2c — "If you control <A> and <B>, <body> instead" (either order). */
const INSTEAD = /^If (you control .+?), (?:instead (.+)|(.+) instead)$/;

/** The window: "Look at [or Reveal] the top four cards of your library". */
const LIBRARY_LOOK = /^(Look at|Reveal) the top (\S+) cards of your library$/;
/** CR 701.20a — "Reveal the top card of your library and put that card into your hand". */
const REVEAL_TOP_TO_HAND =
    /^Reveal the top card of your library and put that card into your hand$/;
/** CR 701.20a — the reveal-until window: what ends the reveal. */
const REVEAL_UNTIL =
    /^Reveal cards from the top of your library until you reveal (a basic land card|a land card|a creature card|a white card)$/;
/** CR 400.7 — the reveal-until routing: the first match, then every other card. */
const REVEAL_UNTIL_ROUTE =
    /^Put that card (into your hand|onto the battlefield) and (?:(?:put )?(?:all other cards revealed this way|the rest) into your (graveyard)|(exile) all other cards revealed this way)$/;
/** CR 603.3d — the head player's choice of an opposing player with more creatures. */
const CHOOSES_PLAYER_MORE_CREATURES =
    /^That player chooses target player who controls more creatures than they do and is their opponent$/;
/** CR 701.20a — the head player's optional reveal-until window. */
const FIRST_PLAYER_REVEAL_UNTIL =
    /^The first player may reveal cards from the top of their library until they reveal (a creature card)$/;
/** CR 400.7 — its routing, gated on the player having taken the option. */
const FIRST_PLAYER_REVEAL_ROUTE =
    /^If the first player does, that player puts that card onto the battlefield and all other cards revealed this way into their graveyard$/;
/** CR 700.3 — a pile division of a revealed window. */
const PILE_SPLIT = /^An opponent separates those cards into two piles$/;
const PILE_SPLIT_WINDOW =
    /^Reveal the top (\S+) cards of your library and separate them into two piles$/;
const PILE_OPPONENT_PICKS = /^An opponent chooses one of those piles$/;
const PILE_ROUTE =
    /^Put (one|that) pile into your hand and the other into your graveyard$/;
/** CR 701.23d (search) + CR 701.20a (reveal) — a searched pile: "Search your
 *  library for three cards and reveal them". A bare QUANTITY only; a
 *  described search ("three creature cards", "with different names") is not
 *  this window. */
const SEARCH_REVEAL_PILE =
    /^Search your library for (\S+) cards and reveal them$/;
/** The other player's pick from the pile: "Target opponent chooses one". */
const SEARCH_PILE_PICK = /^Target opponent chooses one$/;
/** CR 701.24a — the shuffle that ends the search. */
const SEARCH_PILE_SHUFFLE = /^Then shuffle$/;

const REVEAL_UNTIL_FILTERS = new Map<string, EffectCardFilter>([
    ["a basic land card", { type: "Land", supertype: "Basic" }],
    ["a land card", { type: "Land" }],
    ["a creature card", { type: "Creature" }],
    ["a white card", { color: "W" }],
]);
/** CR 701.24a — the shuffle a "You may" offers after a looked-at library. */
const SHUFFLE_THAT_PLAYER = "You may have that player shuffle";
/** CR 701.24a — "Target player shuffles up to two target cards from their graveyard into their library". */
const SHUFFLE_GRAVEYARD_BACK =
    /^Target player shuffles up to (\S+) target cards from their graveyard into their library$/;
/** CR 401.4 — the one-sentence reorder, looked at by "you". */
const LIBRARY_REORDER =
    /^Look at the top (\S+) cards of (your|target player's|target opponent's) library, then put them back in any order$/;
/** CR 101.4 — the first sentence of the per-land-type bounce. */
const CHOOSE_LAND_PER_BASIC_TYPE =
    /^Each player chooses a land they control of each basic land type$/;
/** CR 101.4 — its second sentence: the picked lands go back to hand. */
const RETURN_CHOSEN_LANDS = /^Return those lands to their owners' hands$/;
/** CR 101.4 + CR 701.21a — one land per basic land type, sacrifice the rest. */
const KEEP_LAND_PER_BASIC_TYPE =
    /^Each player chooses from the lands they control a land of each basic land type, then sacrifices the rest$/;
/** CR 701.20a + CR 701.9a — reveal the hand, keep one card per colour. */
const KEEP_CARD_PER_COLOR =
    /^Each player reveals their hand, chooses one card of each color from it, then discards all other nonland cards$/;
/** CR 702.26b — "<target> phases out". */
const PHASES_OUT = /^(Target .+) phases out$/;
/** CR 101.4 — the keep-one-of-each edict, over a list of permanent types. */
const KEEP_ONE_OF_EACH_TYPE =
    /^Each player chooses from among the permanents they control (.+), then sacrifices the rest$/;
/** CR 205.2a — the permanent types the edict's list names, singular. */
const KEEP_TYPE_NOUNS: ReadonlyMap<string, CardType> = new Map([
    ["an artifact", "Artifact"],
    ["a creature", "Creature"],
    ["an enchantment", "Enchantment"],
    ["a land", "Land"],
]);
/** CR 701.22a — "Scry N": the controller looks at their own library's top N. */
const SCRY_IMPERATIVE = /^Scry (\S+)$/;
/** CR 401.4 — the same reorder, looked at by the previous sentence's player. */
const LIBRARY_REORDER_THAT_PLAYER =
    /^That player looks at the top (\S+) cards of your library, then puts them back in any order$/;
/** The routing half, every matching card: "Put all Goblin cards revealed …". */
const ROUTE_ALL_OF_SUBTYPE =
    /^Put all (\S+) cards revealed this way into your hand and the rest on the bottom of your library in any order$/;
/** The routing half, a pick: "Put one of them into your hand and the rest …". */
const ROUTE_TAKE =
    /^Put (\S+) of (?:them|those cards) into your hand and the rest (on the bottom of your library in any order|on the bottom of your library in a random order|into your graveyard)$/;

/** The two-card window's routing: "Put one of them into your hand and the other on the bottom of your library". */
const ROUTE_TAKE_OTHER =
    /^Put one of them into your hand and the other on the bottom of your library$/;

const ROUTE_REST: ReadonlyMap<
    string,
    Extract<LibraryRouteIR, { kind: "take" }>["rest"]
> = new Map([
    ["on the bottom of your library in any order", "bottom-any-order"],
    ["on the bottom of your library in a random order", "bottom-random-order"],
    ["into your graveyard", "graveyard"],
]);

/**
 * CR 701.6a — the keyword action, at PROBE casing.
 *
 * Lowercase, unlike the `"Destroy "` / `"Tap "` literals beside it, because
 * this branch is entered through `uncapitalise`: `optionalSentenceRule` hands
 * its inner rule the clause UNCAPITALISED ("you may counter target spell"),
 * and Frilled Mystic prints exactly that. The casing convention lives one
 * level up and is inconsistent there — `kickedSentenceRule` re-capitalises
 * its tail, `optionalSentenceRule` does not — so the probe is what this
 * branch can rely on.
 */
const COUNTER_VERB = "counter ";

/** CR 115.7a — the instruction's opening, sentence-initial casing. */
const RETARGET_VERB = "Change the target of ";
/** CR 115.7 — the one subject phrase the retarget rule reads. */
const RETARGET_SPELL_PHRASE = "target spell with a single target";

/** CR 122.1 — "If there are N or more <kind> counters on <self>, sacrifice it". */
const SACRIFICE_AT_COUNTERS =
    /^If there are (\S+) or more (\S+) counters on (.+), sacrifice it$/;
/**
 * CR 701.6a + CR 113.7a — the counter rider, whole, without its full stop. The
 * "permanent" is the SOURCE of the countered ability (CR 113.7a), which only a
 * counter that can target an ability binds.
 */
const DESTROY_COUNTERED_SOURCE =
    "If a permanent's ability is countered this way, destroy that permanent";
/**
 * CR 702.33g + CR 202.3 — the kicked counter's replacement limit, whole:
 * "counter that spell if its mana value is N or less instead". Printed digits
 * only; "that spell" is the base counter's target, never a second announcement.
 */
const COUNTER_LIMIT_INSTEAD =
    /^counter that spell if its mana value is (\d+) or less instead$/;
/** CR 115.2 — the Blast cycle's conditional destroy target. */
const DESTROY_PERMANENT_IF_COLOR = /^target permanent if it's (blue|red)$/;
/** CR 118.12a — where a counter's punisher clause begins. */
const UNLESS_PAYS = " unless its controller pays ";
/**
 * CR 118.12a + CR 207.2c — the Domain tax, whole: "{1} for each basic land
 * type among lands you control". Anchored over the REST of the sentence, so a
 * tax this grammar does not price fails the counter rather than being dropped
 * — a counter that silently forgot its "unless" is a free counterspell.
 *
 * The price is the LITERAL {1}, not `\{(\d+)\}`: Evasive Action is the only
 * card in the corpus that prints a per-basic-land-type tax, so a captured
 * amount would be an accepted form with no fixture behind it (ADR 0105 § 2)
 * — and a captured {0} lowers to a tax anyone pays, i.e. a counterspell that
 * never counters. The day a second amount prints, capture it and give the
 * capture its own fixture.
 */
const COUNTER_DOMAIN_TAX =
    /^ unless its controller pays \{1\} for each basic land type among lands you control$/;
/**
 * CR 118.12a — the FLAT tax, whole: "{N}" with printed digits and nothing
 * after. A captured {0} would be a tax anyone pays — a counterspell that never
 * counters — so the amount starts at 1; {X}, a colored symbol and a trailing
 * rider fail the anchor and refuse the counter.
 */
const COUNTER_FLAT_TAX = /^ unless its controller pays \{([1-9]\d*)\}$/;

/** CR 615.12 — the printed sentence, whole, without its full stop. */
const SUPPRESS_DAMAGE_PREVENTION = "Damage can't be prevented this turn";
/** CR 615.12 + CR 614.9 — both locks on one recipient, this turn. */
const LOCK_DAMAGE_THIS_TURN =
    /^Damage that would be dealt to (.+) this turn can't be prevented or dealt instead to another permanent or player$/;

/**
 * CR 615.7 — the prevention shield's printed form. The size is the printed
 * DIGITS and nothing else (no spelled number, no X, no "that much"): a size
 * this rule has no fixture for is refused, not read. The recipient runs up to
 * the trailing duration, which is read by the duration rule itself.
 */
const PREVENT_NEXT_DAMAGE =
    /^Prevent the next (\d+) damage that would be dealt to (.+?) (this turn)$/;

/**
 * CR 609.7a / 615.1a — a chosen-source shield on "you", whole. The qualifier
 * runs up to "source of your choice" and is read by `chosenSourceQualifier`;
 * the recipient is "you" and nothing else — "to any target", "to target
 * creature" and the recipient-less "would deal damage this turn" are other
 * shields under their own gaps; the trailing duration is read by the duration
 * rule itself.
 */
const PREVENT_NEXT_DAMAGE_FROM_CHOSEN_SOURCE =
    /^The next time an? (?:(.+?) )?source of your choice would deal damage to you (this turn), prevent that damage$/;

/**
 * CR 609.7a — the card types a chosen-source qualifier is read for: the two
 * the corpus prints ("an artifact source", "a land source"). Any other noun is
 * refused, not guessed.
 */
const CHOSEN_SOURCE_TYPE_WORDS: ReadonlySet<string> = new Set([
    "artifact",
    "land",
]);

/**
 * CR 609.7a / 105.1 / 205.2a — the qualifier on "a <qualifier> source of your
 * choice", for exactly the forms the corpus prints: one colour word, two joined
 * by "or" (either colour qualifies), or a card type in
 * `CHOSEN_SOURCE_TYPE_WORDS`. Anything else — three colours, "nonblack", a
 * type and a colour together — is null, and the sentence is refused.
 */
function chosenSourceQualifier(
    text: string
): { colors: Color[] } | { cardType: CardType } | null {
    const colors = text.split(" or ").map((word) => COLOR_WORDS.get(word));
    if (colors.length <= 2 && colors.every((c) => c !== undefined)) {
        return { colors: colors as Color[] };
    }
    const cardType = CHOSEN_SOURCE_TYPE_WORDS.has(text)
        ? TYPE_NOUNS.get(text)?.[0]
        : undefined;
    return cardType === undefined ? null : { cardType };
}

/**
 * CR 615.7 — the announced recipients a prevention shield is read for: "any
 * target", or a single bare "target creature". The creature requirement must
 * carry NOTHING beyond `type` and `count` — a qualifier the subject rule reads
 * ("legendary", "you control", "attacking") is a recipient this rule has no
 * fixture for, and is refused rather than silently dropped.
 */
function isPreventionShieldRecipient(requirement: TargetRequirement): boolean {
    if (requirement.type === "any") return true;
    return (
        requirement.type === "Creature" &&
        requirement.count === 1 &&
        Object.keys(requirement).every((k) => k === "type" || k === "count")
    );
}

/**
 * CR 615.1a — the two-way combat prevention shield's printed form. The
 * shielded object runs up to the trailing duration, which is read by the
 * duration rule itself.
 */
const PREVENT_COMBAT_DAMAGE_TO_AND_BY =
    /^Prevent all combat damage that would be dealt to and dealt by (.+?) (this turn)$/;

/**
 * CR 615.1a — the one-way, source-side combat prevention shield's printed
 * form. The source runs up to the trailing duration, which is read by the
 * duration rule itself. Disjoint from the two-way form above: "to and dealt
 * by" never begins with "by".
 */
const PREVENT_COMBAT_DAMAGE_BY =
    /^Prevent all combat damage that would be dealt by (.+?) (this turn)$/;

/**
 * CR 701.14a — the keyword action "fights", between two printed creatures.
 * The first combatant runs up to the verb; the second is the rest of the span.
 */
const FIGHTS = /^(.+?) fights (.+)$/;

/**
 * CR 614.9 — the redirection shield's printed form. The budget is the printed
 * DIGITS or the announced {X} (Captain's Maneuver is the corpus's only {X}
 * spelling); "that much" and a spelled number are refused, not read. Both
 * recipients run up to their own delimiter, and the trailing duration is read
 * by the duration rule itself.
 */
const REDIRECT_NEXT_DAMAGE =
    /^The next (\d+|X) damage that would be dealt to (.+?) (this turn) is dealt to (.+?) instead$/;

/**
 * CR 509.1b — "<subject> can't block|be blocked this
 * turn". The subject is read by `subjectRule`; the verb is a closed set, so
 * "can't attack or block" (two restrictions in one sentence, Off Balance) is
 * refused rather than read as one, and "can't attack" is refused until a
 * standalone corpus card gives it a fixture (Change of Heart carries Buyback).
 */
const COMBAT_RESTRICTION = /^(.+) can't (block|be blocked) this turn$/;
const COMBAT_RESTRICTION_WORDS: ReadonlyMap<string, CombatRestrictionIR> =
    new Map([
        ["block", "cant-block"],
        ["be blocked", "cant-be-blocked"],
    ]);
/**
 * CR 509.1c — "<subject> blocks this creature this turn if able". The attacker
 * is the ability's own source, so the subject (the blocker) is the only
 * variable; "blocks target creature …" and "blocks ~" are not read.
 */
const FORCED_BLOCK = /^(.+) blocks this creature this turn if able$/;
/** CR 701.19c — the regeneration lock's printed form. */
const CANT_BE_REGENERATED_THIS_TURN = /^(.+) can't be regenerated this turn$/;
/** CR 701.19c + CR 608.2c — the lock on "a creature dealt damage this way". */
const CANT_BE_REGENERATED_DAMAGED_THIS_WAY =
    "A creature dealt damage this way can't be regenerated this turn";
/** CR 101.2 + CR 601.2 — the opponents' whole-turn cast lock, whole. */
const OPPONENTS_CANT_CAST = "Your opponents can't cast spells this turn";
/**
 * CR 101.2 + CR 601.2 + CR 506.2 — the defending player's whole-turn cast
 * lock, whole. WHO the defending player is the trigger head says (CR 508.5).
 */
const DEFENDING_PLAYER_CANT_CAST =
    "Defending player can't cast spells this turn";
/** CR 305.1 + CR 101.2 — a targeted player's turn-scoped land-play lock, whole. */
const TARGET_PLAYER_CANT_PLAY_LANDS =
    "Target player can't play lands this turn";
/**
 * CR 101.2 + CR 601.2 + CR 602.2 — a targeted player's cast lock (instants and
 * sorceries) AND activation lock (non-mana abilities), whole. Both clauses
 * name the same player, so they are one sentence with one announcement.
 */
const TARGET_PLAYER_CANT_CAST_OR_ACTIVATE =
    "Until end of turn, target player can't cast instant or sorcery spells, and that player can't activate abilities that aren't mana abilities";

/**
 * The subject a one-creature restriction reads: an announced creature, with
 * no "another" exclusion (a restriction has no earlier target to exclude).
 */
function isAnnouncedCreature(subject: SubjectIR): boolean {
    return (
        subject.kind === "target" &&
        subject.requirement.type === "Creature" &&
        subject.another === undefined
    );
}

const KEYWORDS = keywordVocabulary();

/**
 * CR 702.34a / 514.2 (issue #4756) — "<subject> gains flashback until end of
 * turn". Only the end-of-turn duration: it is the one the corpus prints, and
 * the one `grantedFlashback`'s cleanup reset honours. An explicit cost
 * ("gains flashback {2}{R}{G} until end of turn") does not match and stays
 * its own Grammar Gap.
 */
const GRANT_FLASHBACK = /^(.+) gains flashback until end of turn$/;
/**
 * CR 615.12 + CR 614.9 — the damage-lock rider, whole. The subject must be the
 * spell itself; both halves ("can't be prevented" AND "or dealt instead to
 * another permanent or player") and the creature condition are required.
 */
const CREATURE_DAMAGE_LOCK =
    /^If (.+) would deal damage to a creature, that damage can't be prevented or dealt instead to another permanent or player$/;
/** CR 702.34a — the pricing sentence, in both of its printed spellings. */
const FLASHBACK_COST_IS_MANA_COST =
    /^The flashback cost is equal to (?:its|that card's) mana cost$/;

/** Exact restriction sentences (CR 602.5). Both templatings are printed. */
const RESTRICTIONS: ReadonlyMap<string, RestrictionIR> = new Map<
    string,
    RestrictionIR
>([
    ["activate only as a sorcery", { kind: "sorcery-only" }],
    ["activate this ability only as a sorcery", { kind: "sorcery-only" }],
    ["activate only once each turn", { kind: "once-per-turn" }],
    ["activate this ability only once each turn", { kind: "once-per-turn" }],
    ["activate only during your turn", { kind: "your-turn-only" }],
    ["activate this ability only during your turn", { kind: "your-turn-only" }],
    ["activate only during your upkeep", { kind: "phase", phase: "UPKEEP" }],
    [
        "activate this ability only during your upkeep",
        { kind: "phase", phase: "UPKEEP" },
    ],
    ["any player may activate this ability", { kind: "any-player" }],
    [
        "activate only if this card is in your graveyard",
        { kind: "activate-from-graveyard" },
    ],
]);

/**
 * CR 602.1b (issue #3685) — "Activate only if there are N or more cards in
 * your graveyard", in both printed word orders. Only the UNFILTERED count of
 * the activator's own graveyard: "N or more creature cards" needs a card
 * filter and "N or more card types among cards" a type tally, neither of which
 * an activation-time condition reads, so both stay refused under their own key.
 */
const OWN_GRAVEYARD_AT_LEAST = [
    /^activate only if there are (\S+) or more cards in your graveyard$/,
    /^activate only if (\S+) or more cards are in your graveyard$/,
];

function readOwnGraveyardAtLeast(span: string): RestrictionIR | undefined {
    for (const form of OWN_GRAVEYARD_AT_LEAST) {
        const match = form.exec(span);
        if (match === null) continue;
        const count = readNumberWord(match[1]);
        // "a"/"an" read as one, but no card prints "a or more" — only a
        // cardinal of two or more is a threshold.
        if (count === null || count < 2) return undefined;
        return { kind: "own-graveyard-at-least", count };
    }
    return undefined;
}

/**
 * CR 613.1f — "<mass subject> gain protection from the chosen color until
 * <duration>", the plural-verb reader for `choose-color-grant-protection`
 * (Glory). The GRANT half a "Choose a color." marker's antecedent feeds; the
 * marker itself is read where restrictions are, in `sentenceRule`.
 */
const MASS_GAIN_PROTECTION_CHOSEN_COLOR =
    /^(.+) gain protection from the chosen color (until .+)$/;

/**
 * CR 207.2c — the ability words, as that rule enumerates them.
 *
 * Lowercased and apostrophe-normalised on the way in, because the Oracle
 * prints them capitalised at the head of a line ("Domain —") and the CR
 * prints "council\u2019s dilemma" with a typographic apostrophe.
 */
const ABILITY_WORDS: ReadonlySet<string> = new Set(
    (
        "adamant, addendum, alliance, battalion, bloodrush, celebration, " +
        "channel, chroma, cohort, constellation, converge, council's dilemma, " +
        "coven, delirium, descend 4, descend 8, disappear, domain, eerie, " +
        "eminence, enrage, fateful hour, fathomless descent, ferocious, " +
        "flurry, formidable, grandeur, hellbent, heroic, imprint, infusion, " +
        "inspired, join forces, kinship, landfall, lieutenant, magecraft, " +
        "metalcraft, morbid, opus, pack tactics, paradox, parley, radiance, " +
        "raid, rally, renew, repartee, revolt, secret council, spell mastery, " +
        "strive, survival, sweep, tempting offer, threshold, undergrowth, " +
        "valiant, vivid, void, will of the council"
    ).split(", ")
);

/** How the Oracle separates an ability word from the ability it heads. */
const ABILITY_WORD_SEPARATOR = " \u2014 ";

/**
 * CR 207.2c — the sentence with its leading ability word removed, or the
 * sentence unchanged when it has none.
 *
 * Exact by construction: the head must be the WHOLE span before the first
 * em dash separator AND a member of the CR census, so a sentence that merely
 * contains an em dash keeps every word it printed.
 */
export function withoutAbilityWord(span: string): string {
    const at = span.indexOf(ABILITY_WORD_SEPARATOR);
    if (at === -1) return span;
    const head = span
        .slice(0, at)
        .toLowerCase()
        .replace(/\u2019/g, "'");
    return ABILITY_WORDS.has(head)
        ? span.slice(at + ABILITY_WORD_SEPARATOR.length)
        : span;
}

/**
 * CR 305.6 — the basic land types a "becomes …" clause puts on the table, in
 * printed order, or `null` when the span is not a land-type phrase at all.
 *
 * `null` rather than a failure, because this reader is a DISPATCH test: the
 * same "<subject> becomes <something> <duration>" shape spells the P/T
 * animation ("becomes a 3/3 creature"), the colour change and several static
 * clauses, and a failure here would refuse those before their own branch ran.
 * Everything the reader DOES accept is anchored on the vendored CR 305.6
 * table and on the two printed arities, so a land type Wizards has not
 * printed, a creature type, a three-legged list and an Oxford comma are
 * all outside it and fall through to be refused under their own Grammar
 * Gap key.
 */
function readBasicLandTypes(span: string): readonly string[] | null {
    if (span === ANY_BASIC_LAND_TYPE) return BASIC_LAND_SUBTYPE_ORDER;
    const legs = span.split(" or ");
    // The printed arities are ONE and TWO ("a Forest", "a Plains or an
    // Island"). A longer list is a form no card sets, and a line that offered
    // three of the five would be spelled with commas anyway — so it is
    // refused here rather than read on the strength of the splitter
    // accepting it.
    if (legs.length > 2) return null;
    const types: string[] = [];
    for (const leg of legs) {
        // CR 305.6 names five; every other CR 205.3i land type ("a Desert",
        // "a Gate") is a type a land can HAVE but not one this template ever
        // sets, and a repeated leg would offer the same mode twice.
        const type = BASIC_LAND_TYPE_LEGS.get(leg);
        if (type === undefined) return null;
        if (types.includes(type)) return null;
        types.push(type);
    }
    return types;
}

/**
 * One sentence, without its full stop.
 *
 * Every branch below is entered on an exact keyword and then required to match
 * an ANCHORED pattern over the whole span, so an unrecognised trailing clause
 * fails the sentence instead of being ignored.
 */
export const sentenceRule: Rule<SentenceIR> = subGrammar(
    EFFECT_CLAUSE,
    rule<SentenceIR>(EFFECT_CLAUSE, (printed, ctx) => {
        // CR 207.2c — an ability word is italic decoration at the head of an
        // ability: it "ties together cards that have similar functionality"
        // and has NO rules meaning. Every card that prints one spells the
        // condition or tally out in the text that follows (Evasive Action's
        // Domain names "each basic land type among lands you control" in
        // full), so dropping the word loses nothing and reading it as a noun
        // would lose the sentence. Dropped from the WHOLE vocabulary CR 207.2c
        // enumerates, not from the one word this rule's first card printed —
        // the list is a closed CR census, so a per-card subset would be a
        // catalogue of card names wearing a grammar's clothes.
        const span = withoutAbilityWord(printed);
        const restriction =
            RESTRICTIONS.get(span.toLowerCase()) ??
            readOwnGraveyardAtLeast(span.toLowerCase());
        if (restriction !== undefined)
            return ok({ role: "restriction" as const, restriction });
        if (ADD_MANA_INSTEAD_IF_COUNT.test(span))
            return addManaInsteadIfRule.run(span, ctx);
        if (span === "It can't be regenerated")
            return ok({
                role: "modifier" as const,
                modifier: { kind: "cant-be-regenerated" as const },
            });
        // CR 701.12a — the fallback; the sacrificed object (CR 701.21a)
        // must be the source the exchange moves.
        const exchangeFallback = span.match(EXCHANGE_FALLBACK_SACRIFICE);
        if (exchangeFallback !== null) {
            if (!isSelfPhrase(exchangeFallback[1]!))
                return fail(
                    `"${exchangeFallback[1]}" is not the object the exchange moves`,
                    span
                );
            return ok({
                role: "modifier" as const,
                modifier: { kind: "exchange-fallback-sacrifice" as const },
            });
        }
        if (span === RESOLVES_IF_TARGET_ILLEGAL)
            return ok({
                role: "modifier" as const,
                modifier: { kind: "resolves-if-target-illegal" as const },
            });
        if (span === DESTROY_COUNTERED_SOURCE)
            return ok({
                role: "modifier" as const,
                modifier: { kind: "destroy-countered-source" as const },
            });
        // CR 701.19c — the plural pronoun of a sweep ("Destroy all green
        // creatures. They can't be regenerated."); the fold checks the number
        // against the destroy it modifies.
        if (span === "They can't be regenerated")
            return ok({
                role: "modifier" as const,
                modifier: {
                    kind: "cant-be-regenerated" as const,
                    plural: true as const,
                },
            });
        // CR 105.1 — "Choose a color.", a marker (see the role's own doc
        // comment); never printed lowercase (a trigger's effect clause reads
        // it as an antecedent-carrying sentence too, but no corpus card
        // prints it there, so only the sentence-initial casing is read).
        if (span === "Choose a color")
            return ok({ role: "choose-color" as const });
        // CR 101.4 — the two sentences of Planar Overlay's per-land-type
        // bounce (the role's own doc comment).
        if (CHOOSE_LAND_PER_BASIC_TYPE.test(span))
            return ok({ role: "choose-per-basic-land-type" as const });
        if (RETURN_CHOSEN_LANDS.test(span))
            return ok({ role: "return-chosen-lands" as const });
        if (STILL_TYPE_SELF.test(span))
            return ok({
                role: "modifier" as const,
                modifier: {
                    kind: "still-types" as const,
                    types: ["Land"] as readonly CardType[],
                    singular: true as const,
                },
            });
        const still = span.match(STILL_TYPES);
        if (still !== null) {
            const noun = descriptorRule.run(still[1]!, ctx);
            if (!noun.ok) return noun;
            if (
                noun.value.plural !== true ||
                noun.value.types === undefined ||
                Object.keys(noun.value).some(
                    (k) => !["types", "plural"].includes(k)
                )
            )
                return fail(
                    '"They\'re still" names bare plural card types',
                    span
                );
            return ok({
                role: "modifier" as const,
                modifier: {
                    kind: "still-types" as const,
                    types: noun.value.types as readonly CardType[],
                },
            });
        }

        // CR 702.34a / 514.2 (issue #4756) — a granted Flashback, in its two
        // sentences (the role's own doc comment). Read before the effect
        // cascade: its keyword-grant branch would otherwise take the first
        // sentence as a layer-6 grant to a permanent.
        const grantsFlashback = span.match(GRANT_FLASHBACK);
        if (grantsFlashback !== null) {
            const subject = subjectRule.run(grantsFlashback[1]!, ctx);
            if (!subject.ok) return subject;
            return ok({
                role: "flashback-grant" as const,
                subject: subject.value,
            });
        }
        if (FLASHBACK_COST_IS_MANA_COST.test(span))
            return ok({ role: "flashback-cost" as const });

        // CR 615.12 + CR 614.9 — the creature-conditional damage lock rider.
        const damageLock = span.match(CREATURE_DAMAGE_LOCK);
        if (damageLock !== null) {
            if (!isSelfPhrase(damageLock[1]!))
                return fail(
                    `"${damageLock[1]}" is not the spell whose damage is locked`,
                    span
                );
            return ok({ role: "creature-damage-lock" as const });
        }

        // CR 107.3f (issue #4529) — a variable payment in its two sentences
        // (the roles' own doc comment). "You may pay {X}" is the whole first
        // sentence: a trailing "where X is …" or a fixed leg ("{X}{R}") is a
        // different payment this rule does not read.
        if (uncapitalise(span) === PAY_VARIABLE_MANA)
            return ok({ role: "pay-variable-mana" as const, text: span });
        // CR 118.12 — a fixed mana payment in its two sentences; the
        // capitalised spelling a full stop introduces (the trigger site
        // prints it lowercase, `optionalSentenceRule`).
        const fixedPay = uncapitalise(span).match(PAY_FIXED_MANA);
        if (fixedPay !== null) {
            const read = readManaCost(fixedPay[1]!);
            if (!read.ok) return fail(read.reason, read.fragment);
            return ok({
                role: "pay-mana" as const,
                text: span,
                mana: read.cost,
            });
        }
        const chooseDrawn = span.match(CHOOSE_DRAWN_THIS_TURN);
        if (chooseDrawn !== null) {
            const max = readNumberWord(chooseDrawn[1]!);
            if (max === null || max < 1)
                return fail(`"${chooseDrawn[1]}" is not a count`, span);
            return ok({ role: "choose-drawn-this-turn" as const, max });
        }
        const payOrTopdeck = span.match(PAY_LIFE_OR_TOPDECK);
        if (payOrTopdeck !== null) {
            const costPerKept = readNumberWord(payOrTopdeck[1]!);
            if (costPerKept === null || costPerKept < 1)
                return fail(`"${payOrTopdeck[1]}" is not an amount`, span);
            return ok({ role: "pay-life-or-topdeck" as const, costPerKept });
        }
        const ifYouDo = span.match(IF_YOU_DO);
        if (ifYouDo !== null) {
            const inner = sentenceRule.run(capitalise(ifYouDo[1]!), ctx);
            if (!inner.ok) return inner;
            if (inner.value.role !== "effect")
                return fail('"If you do" feeds a plain effect sentence', span);
            return ok({
                role: "if-you-do" as const,
                text: span,
                effect: inner.value.effect,
            });
        }

        const coinFlip = readCoinFlipSentence(span, (clause) =>
            effectSentence(clause, ctx)
        );
        if (coinFlip !== null) return coinFlip;

        if (INSTEAD.test(span)) return insteadRule.run(span, ctx);

        const named = chosenNameSentence(span, ctx);
        if (named !== null) return named;

        const handPick = handPickSentence(span, ctx);
        if (handPick !== null) return handPick;

        const library = libraryHalf(span);
        if (library !== null) return library;

        const recoloured = readPumpThenColor(span, (half) =>
            sentenceRule.run(half, ctx)
        );
        if (recoloured !== null) return recoloured;

        const chained = readThenChain(span, ctx, (tail) =>
            sentenceRule.run(capitalise(tail), ctx)
        );
        if (chained !== null) return chained;

        const counterChain = readCounterAndChain(span, (sentence) =>
            sentenceRule.run(sentence, ctx)
        );
        if (counterChain !== null) return counterChain;

        const effect = effectSentence(span, ctx);
        if (!effect.ok) return effect;
        return ok({ role: "effect" as const, effect: effect.value });
    })
);

/**
 * CR 608.2c — the replacement sentence: "If you control a <A> and a <B>,
 * <body> instead".
 *
 * Exactly TWO controls clauses, each read by the shared `controlsRule`: the
 * shape every printed card of this family has, and "and" between two
 * singular "you control a …" clauses is the only conjunction read here.
 */
export const insteadRule: Rule<SentenceIR> = rule<SentenceIR>(
    "instead if you control",
    (span, ctx) => {
        const match = span.match(INSTEAD);
        if (match === null) return fail('not an "… instead" sentence', span);
        const clauses = match[1]!
            .slice("you control ".length)
            .split(/ and (?=an? )/);
        if (clauses.length !== 2)
            return fail(
                '"instead" reads exactly two "you control" clauses',
                span
            );
        const conditions: ConditionIR[] = [];
        for (const clause of clauses) {
            const condition = controlsRule.run(`you control ${clause}`, ctx);
            if (!condition.ok) return condition;
            conditions.push(condition.value);
        }
        return ok({
            role: "instead" as const,
            conditions,
            body: match[2] ?? match[3]!,
        } satisfies SentenceIR);
    }
);

/**
 * CR 106.1 + CR 608.2c — the replacement sentence of a conditional ritual:
 * "Add {B}{B}{B}{B}{B} instead if there are seven or more cards in your
 * graveyard" (Cabal Ritual, behind its CR 207.2c ability word). Exactly one
 * threshold over the controller's graveyard, whole-sentence anchored; the
 * `Add …` it replaces is checked where the pair is folded.
 */
export const addManaInsteadIfRule: Rule<SentenceIR> = rule<SentenceIR>(
    "add mana instead if count",
    (span) => {
        const match = span.match(ADD_MANA_INSTEAD_IF_COUNT);
        if (match === null)
            return fail('not an "Add … instead if there are N" sentence', span);
        const atLeast = readNumberWord(match[2]!);
        if (atLeast === null || atLeast < 1)
            return fail(`"${match[2]}" is not a card count`, span);
        return ok({
            role: "add-mana-instead-if" as const,
            mana: readManaPips(match[1]!),
            condition: { zone: "graveyard" as const, atLeast },
        });
    }
);

/**
 * CR 702.33e — pair a sweep with the kicked sweep that replaces it.
 *
 * Only a destroy over a mass subject on BOTH sides: that is the whole printed
 * form (a sweep with a wider reach when kicked), and a replacement of another
 * verb, or of a single target, would have to say which object it keeps — the
 * `upgrade-if-controls` machinery for that shape does not apply here, so the
 * pair is refused rather than lowered to a guess.
 */
function foldKickedInstead(
    previous: EffectSentenceIR,
    sentence: Extract<SentenceIR, { role: "kicked-instead" }>
): EffectSentenceIR | string {
    const replacement = sentence.replacement;
    if (
        previous.kind !== "destroy" ||
        replacement.kind !== "destroy" ||
        previous.subject.kind !== "mass" ||
        replacement.subject.kind !== "mass"
    )
        return '"If it was kicked, … instead" replaces a sweep with a sweep of the same verb';
    return {
        kind: "replace-if-kicked",
        kicked: sentence.kicked,
        base: previous,
        replacement,
    };
}

/**
 * CR 702.33e + CR 202.3 — pair a bounded destroy with the kicked destroy that
 * re-bounds it. The replacement names the base's target by its type
 * ("that artifact") and nothing else may differ, so the new effect is the base
 * with only its bound changed, sharing the base's subject object (the target
 * was announced once, CR 601.2c).
 */
function foldKickedBoundInstead(
    previous: EffectSentenceIR,
    sentence: Extract<SentenceIR, { role: "kicked-bound-instead" }>
): EffectSentenceIR | string {
    if (
        previous.kind !== "destroy" ||
        previous.manaValueAtMost === undefined ||
        previous.subject.kind !== "target" ||
        typeof previous.subject.requirement.type !== "string" ||
        previous.subject.requirement.type.toLowerCase() !== sentence.noun
    )
        return `"that ${sentence.noun}" is not the target of a bounded destroy`;
    return {
        kind: "replace-if-kicked",
        kicked: sentence.kicked,
        base: previous,
        replacement: {
            ...previous,
            manaValueAtMost: sentence.manaValueAtMost,
        },
    };
}

const KICKED_INSTEAD = /^If it was kicked, (.+) instead$/;
/** CR 702.33e + CR 202.3 — the spell-site re-bound, whole. */
const KICKED_BOUND_INSTEAD =
    /^destroy that (\w+) if its mana value is (\d+) or less instead$/;
/** CR 202.3 — the trailing bound of a conditional destroy. */
const MANA_VALUE_BOUND = / if its mana value is (\d+) or less$/;

/**
 * Wrap a sentence rule so it also reads CR 702.33e's "If it was kicked,
 * <effect> instead" — the trigger site's replacement sentence.
 *
 * A combinator for the reason `kickedSentenceRule` is one, and the SAME shape:
 * the head is the condition, the tail is the caller's own sentence, so every
 * effect the grammar reads is a candidate replacement and `foldKickedInstead`
 * decides which pairs are one form. Fail-closed like its sibling: a head that
 * reads as the condition with a tail the sentence grammar cannot parse fails
 * the whole span, and a restriction or modifier behind it is a line we have
 * misread.
 */
export function kickedInsteadSentenceRule(
    inner: Rule<SentenceIR>
): Rule<SentenceIR> {
    return rule(`kicked instead ${inner.label}`, (span, ctx) => {
        const match = span.match(KICKED_INSTEAD);
        if (match === null) return inner.run(span, ctx);
        const condition = kickedPermanentConditionRule.run(
            "if it was kicked",
            ctx
        );
        if (!condition.ok) return condition;
        const parsed = inner.run(capitalise(match[1]!), ctx);
        if (!parsed.ok) return parsed;
        if (parsed.value.role !== "effect")
            return fail(
                `a kicked replacement is an effect, not a ${parsed.value.role}`,
                span
            );
        return ok({
            role: "kicked-instead" as const,
            kicked: condition.value,
            replacement: parsed.value.effect,
        });
    });
}

const UPGRADE_PUMP = /^that (\w+) gets ([+-]\d+)\/([+-]\d+) (.+)$/;
const UPGRADE_DAMAGE = /^(.+) deals (\S+) damage$/;
const UPGRADE_LIFE = /^(you|that player) (gain|gains|lose|loses) (\S+) life$/;
const UPGRADE_LOOT = /^draw (\S+) cards?, then discard (\S+) cards?$/;

/**
 * The replacement clause read AGAINST the effect it replaces (CR 608.2c).
 *
 * Each form changes only a magnitude and names the base effect's referent by
 * anaphora or ellipsis — "that creature gets +5/+5 …", "this enchantment
 * deals 3 damage" (to the same recipient), "that player loses 3 life", "you
 * gain 4 life", "draw two cards, then discard a card" — so the upgraded IR is
 * the base IR with the new magnitude, keeping the base's subject OBJECTS
 * (lowering reads that identity as "the same announced target"). A referent
 * the base does not have, a different action or a different duration is a
 * sentence we have misread, and fails the line.
 */
function readUpgrade(
    base: EffectSentenceIR,
    body: string
): EffectSentenceIR | string {
    switch (base.kind) {
        case "pump": {
            const m = body.match(UPGRADE_PUMP);
            if (m === null) return `"${body}" does not upgrade a pump`;
            // CR 207.2c — a per-basic-land-type base is a STEP, and the flat
            // "+5/+5 instead" is a magnitude: copying the base's flag onto it
            // would read the printed 5 as a step of one.
            if (base.perDomain === true)
                return "a per-basic-land-type pump has no flat upgrade";
            if (
                base.subject.kind !== "target" ||
                typeof base.subject.requirement.type !== "string" ||
                base.subject.requirement.type.toLowerCase() !== m[1]
            )
                return `"that ${m[1]}" is not the pumped target`;
            const duration = durationRule.run(m[4]!, undefined);
            if (
                !duration.ok ||
                JSON.stringify(duration.value) !== JSON.stringify(base.duration)
            )
                return "the upgraded pump lasts a different duration";
            return {
                ...base,
                power: signedModifier(m[2]!),
                toughness: signedModifier(m[3]!),
            };
        }
        case "deal-damage": {
            const m = body.match(UPGRADE_DAMAGE);
            if (m === null || !isSelfPhrase(m[1]!))
                return `"${body}" does not upgrade the source's damage`;
            const amount = readAmount(m[2]!);
            if (amount === null) return `"${m[2]}" is not a damage amount`;
            return { ...base, amount };
        }
        case "life": {
            const m = body.match(UPGRADE_LIFE);
            if (m === null) return `"${body}" does not upgrade a life change`;
            const who = m[1] === "you" ? "you" : "target";
            if (base.player.kind !== who)
                return `"${m[1]}" is not the player the base effect named`;
            if (!m[2]!.startsWith(base.action))
                return "the upgrade changes gain to lose, or back";
            const amount = readAmount(m[3]!);
            if (amount === null) return `"${m[3]}" is not an amount`;
            return { ...base, amount };
        }
        case "loot": {
            const m = body.match(UPGRADE_LOOT);
            if (m === null) return `"${body}" does not upgrade a loot`;
            const draw = readAmount(m[1]!);
            const discard = readAmount(m[2]!);
            if (draw === null || discard === null)
                return "a loot needs two counts";
            return { ...base, draw, discard };
        }
        default:
            return `"… instead" cannot replace a ${base.kind}`;
    }
}

/**
 * CR 205.1b + CR 613.1d/f — the middle of "This land becomes a N/N … creature".
 * Words are read in the order printers set them — colour, ONE creature
 * subtype, then "artifact" — each against its own table; an unknown word, a
 * second subtype or a colour list ("blue and black") refuses the line, so the
 * rule reads exactly the forms with a fixture rather than a near-English
 * superset (ADR 0105 § 2). A `with` tail must be ONE Mechanics Registry
 * keyword, or ONE quoted ability ("with \"{B}: Regenerate this creature\"",
 * CR 113.1a) read by the slots through `quotedAbilityReader`.
 */
function readSelfAnimation(
    m: RegExpMatchArray,
    span: string,
    ctx: unknown
): RuleResult<EffectSentenceIR> {
    const words = m[4]!.split(" ");
    const colors: Color[] = [];
    let subtype: string | undefined;
    const additionalTypes: CardType[] = [];
    for (const word of words) {
        const color = COLOR_WORDS.get(word);
        if (color !== undefined && subtype === undefined && colors.length === 0)
            colors.push(color);
        else if (subtype === undefined && CREATURE_SUBTYPES.has(word))
            subtype = word;
        else if (
            word === "artifact" &&
            subtype !== undefined &&
            additionalTypes.length === 0
        )
            additionalTypes.push("Artifact");
        else
            return fail(
                `"${word}" is not read inside an animated source's type line`,
                span
            );
    }
    if (subtype === undefined)
        return fail("an animated source names its creature subtype", span);
    let keyword: KeywordIR | undefined;
    let quoted: { text: string; ability: QuotedAbilityIR } | undefined;
    if (m[5] !== undefined) {
        const quote = m[5].match(QUOTED_GRANT_TAIL);
        if (quote !== null) {
            // The quote's own sentence ends with the full stop the printer
            // left outside the marks; the granted ability's Oracle text has it.
            const text = `${quote[1]!}.`;
            const ability = readQuotedAbilityOf(text, ctx as ParseContext);
            if (!ability.ok) return ability;
            quoted = { text, ability: ability.value };
        } else {
            keyword = KEYWORDS.get(m[5].toLowerCase());
            if (keyword === undefined)
                return fail(
                    `"${m[5]}" is not a Mechanics Registry keyword`,
                    span
                );
        }
    }
    const duration = durationRule.run(m[6]!, ctx);
    if (!duration.ok) return duration;
    return ok({
        kind: "animate" as const,
        subject: { kind: "self" as const },
        power: signedModifier(m[2]!),
        toughness: signedModifier(m[3]!),
        duration: duration.value,
        self: {
            subtype,
            additionalTypes,
            colors,
            ...(keyword !== undefined ? { keyword } : {}),
            ...(quoted !== undefined ? { quoted } : {}),
        },
    } satisfies EffectSentenceIR);
}

/**
 * CR 205.1a + CR 613.1d — "{self} becomes a N/N [color] <Subtype> creature".
 * Subject is the source only; words are read in printed order (colour, then ONE
 * creature subtype) so a colour list, a second subtype or an unknown word
 * refuses the line (ADR 0105 § 2).
 */
function readBecomeCreature(
    m: RegExpMatchArray,
    span: string,
    ctx: unknown
): RuleResult<EffectSentenceIR> {
    const subject = subjectRule.run(m[1]!, ctx);
    if (!subject.ok) return subject;
    if (subject.value.kind !== "self")
        return fail("a type-line replacement is read on the source only", span);
    const colors: Color[] = [];
    let subtype: string | undefined;
    for (const word of m[4]!.split(" ")) {
        const color = COLOR_WORDS.get(word);
        if (color !== undefined && subtype === undefined && colors.length === 0)
            colors.push(color);
        else if (subtype === undefined && CREATURE_SUBTYPES.has(word))
            subtype = word;
        else return fail(`"${word}" is not read in a replaced type line`, span);
    }
    if (subtype === undefined)
        return fail("a replaced type line names its creature subtype", span);
    return ok({
        kind: "become-creature" as const,
        subject: subject.value,
        power: signedModifier(m[2]!),
        toughness: signedModifier(m[3]!),
        subtype,
        colors,
    } satisfies EffectSentenceIR);
}

/** A printed signed modifier as a number. "-0" ("gets -3/-0") is zero: the
 *  `+ 0` folds IEEE negative zero, which JSON would print as `0` anyway and
 *  which a structural comparison would otherwise tell apart from it. */
export function signedModifier(printed: string): number {
    return Number(printed) + 0;
}

/**
 * The two halves of a CR 401.4 look-and-route (`look-distribute`), each a
 * sentence role `assembleSentences` pairs up. `null` = neither half's head.
 */
/**
 * CR 201.4 — the sentences of a chosen card name: the pick itself, and the
 * two sentences that read it back as "that name". `null` = not one of them.
 */
function chosenNameSentence(span: string, ctx: unknown) {
    if (NAME_THEN_REVEAL_RANDOM.test(span))
        return ok({
            role: "then-chain" as const,
            effects: [
                {
                    kind: "name-card" as const,
                    prompt: "Choose a card name.",
                },
                { kind: "reveal-random-hand-card" as const },
            ],
        } satisfies SentenceIR);
    const gate = span.match(IF_REVEALED_HAS_CHOSEN_NAME);
    if (gate !== null) {
        const inner = sentenceRule.run(capitalise(gate[1]!), ctx);
        if (!inner.ok) return inner;
        if (inner.value.role !== "effect")
            return fail(
                '"If that card has the chosen name" feeds a plain effect sentence',
                span
            );
        return ok({
            role: "effect" as const,
            effect: {
                kind: "named-card-reveal-gate" as const,
                effect: inner.value.effect,
            },
        } satisfies SentenceIR);
    }
    const name = span.match(NAME_CARD);
    if (name !== null) {
        // "a nonland card name" and "other than a basic land card name" are
        // two printed strengths, never printed together.
        if (name[1] !== undefined && name[2] !== undefined)
            return fail("two name restrictions on one pick", span);
        const restriction: NameRestriction | undefined =
            name[1] !== undefined
                ? "no-land"
                : name[2] !== undefined
                  ? "no-basic-land"
                  : undefined;
        return ok({
            role: "effect" as const,
            effect: {
                kind: "name-card" as const,
                prompt: `${span}.`,
                ...(restriction === undefined ? {} : { restriction }),
            },
        } satisfies SentenceIR);
    }
    const discard = span.match(DISCARD_NAMED);
    if (discard !== null) {
        const player = playerSubject(discard[1]!, ctx);
        if (player === null)
            return fail(`"${discard[1]}" is not a player`, span);
        return ok({
            role: "effect" as const,
            effect: { kind: "discard-named-from-hand" as const, player },
        } satisfies SentenceIR);
    }
    const dig = span.match(DIG_NAMED);
    if (dig !== null) {
        const count = readAmount(dig[1]!);
        if (count === null) return fail(`"${dig[1]}" is not a count`, span);
        return ok({ role: "named-dig" as const, count } satisfies SentenceIR);
    }
    if (EXILE_REST.test(span))
        return ok({ role: "exile-rest" as const } satisfies SentenceIR);
    return null;
}

/** CR 701.20a — "<player> reveals their hand", the head of a hand pick. */
const HAND_REVEAL = /^(.+) reveals their hand$/;
/** The trigger's one-sentence reveal and pick. */
const HAND_REVEAL_PICK =
    /^(.+) reveals their hand and you choose (.+) from it$/;
/** CR 701.9b — the controller's pick from the revealed hand. */
const HAND_PICK = /^You choose (.+) from it( and exile that card)?$/;
/** Where the picked card goes: the routing sentence, whole. */
const HAND_PICK_ROUTES: ReadonlyMap<string, HandPickRoute> = new Map([
    ["That player discards that card", "discard"],
]);
/**
 * What the controller may choose from a revealed hand, as an
 * `EffectCardFilter`. A closed table, as `LIBRARY_SEARCH_FILTERS` is: a
 * description with no row ("a card from it with mana value 4 or greater", "a
 * nonlegendary, nonland card") fails the sentence rather than letting the pick
 * range wider than the card said. A row is earned by a printed form.
 */
const HAND_PICK_FILTERS: ReadonlyMap<string, EffectCardFilter> = new Map<
    string,
    EffectCardFilter
>([
    ["a card", {}],
    ["a nonland card", { excludeType: "Land" }],
    ["a noncreature, nonland card", { excludeType: ["Land", "Creature"] }],
    ["a creature card", { type: "Creature" }],
    ["an artifact card", { type: "Artifact" }],
    ["an artifact or creature card", { type: ["Artifact", "Creature"] }],
    ["a creature or planeswalker card", { type: ["Creature", "Planeswalker"] }],
]);

function readHandPick(phrase: string): HandPickIR | null {
    const filter = HAND_PICK_FILTERS.get(phrase);
    return filter === undefined ? null : { filter, phrase };
}

/**
 * CR 701.20a — a target player's revealed hand, read only in front of the
 * pick that needs it: "Each opponent reveals their hand" is a sweep of
 * reveals no pick follows, and "that player" would name a referent this
 * sentence does not bind.
 */
function handRevealPlayer(span: string, ctx: unknown): PlayerRefIR | null {
    const player = playerSubject(span, ctx);
    return player !== null && player.kind === "target" ? player : null;
}

/**
 * CR 701.20a + CR 701.9b — the sentences of a `reveal-hand-pick`, as the
 * sentence roles `assembleSentences` folds. `null` = none of them.
 */
function handPickSentence(span: string, ctx: unknown) {
    const route = HAND_PICK_ROUTES.get(span);
    if (route !== undefined)
        return ok({
            role: "hand-pick-route" as const,
            route,
        } satisfies SentenceIR);
    const revealPick = span.match(HAND_REVEAL_PICK);
    if (revealPick !== null) {
        const player = handRevealPlayer(revealPick[1]!, ctx);
        if (player === null)
            return fail(`"${revealPick[1]}" is not a target player`, span);
        const pick = readHandPick(revealPick[2]!);
        if (pick === null)
            return fail(
                `"${revealPick[2]}" is not a card this pick reads`,
                span
            );
        return ok({
            role: "hand-reveal-pick" as const,
            player,
            pick,
        } satisfies SentenceIR);
    }
    const reveal = span.match(HAND_REVEAL);
    if (reveal !== null) {
        const player = handRevealPlayer(reveal[1]!, ctx);
        if (player === null)
            return fail(`"${reveal[1]}" is not a target player`, span);
        return ok({
            role: "hand-reveal" as const,
            player,
        } satisfies SentenceIR);
    }
    const chosen = span.match(HAND_PICK);
    if (chosen !== null) {
        const pick = readHandPick(chosen[1]!);
        if (pick === null)
            return fail(`"${chosen[1]}" is not a card this pick reads`, span);
        return ok({
            role: "hand-pick" as const,
            pick,
            exile: chosen[2] !== undefined,
        } satisfies SentenceIR);
    }
    return null;
}

function libraryHalf(span: string) {
    const look = span.match(LIBRARY_LOOK);
    if (look !== null) {
        const count = readAmount(look[2]!);
        if (count === null) return fail(`"${look[2]}" is not a count`, span);
        return ok({
            role: "library-look" as const,
            reveal: look[1] === "Reveal",
            count,
        } satisfies SentenceIR);
    }
    const until = span.match(REVEAL_UNTIL);
    if (until !== null) {
        return ok({
            role: "reveal-until" as const,
            filter: REVEAL_UNTIL_FILTERS.get(until[1]!)!,
        } satisfies SentenceIR);
    }
    if (CHOOSES_PLAYER_MORE_CREATURES.test(span))
        return ok({
            role: "chooses-player-with-more-creatures" as const,
        } satisfies SentenceIR);
    const firstUntil = span.match(FIRST_PLAYER_REVEAL_UNTIL);
    if (firstUntil !== null)
        return ok({
            role: "first-player-may-reveal-until" as const,
            filter: REVEAL_UNTIL_FILTERS.get(firstUntil[1]!)!,
        } satisfies SentenceIR);
    if (FIRST_PLAYER_REVEAL_ROUTE.test(span))
        return ok({
            role: "first-player-reveal-route" as const,
            match: "battlefield",
            rest: "graveyard",
        } satisfies SentenceIR);
    const untilRoute = span.match(REVEAL_UNTIL_ROUTE);
    if (untilRoute !== null) {
        return ok({
            role: "reveal-until-route" as const,
            match: untilRoute[1] === "into your hand" ? "hand" : "battlefield",
            rest: untilRoute[3] !== undefined ? "exile" : "graveyard",
        } satisfies SentenceIR);
    }
    if (PILE_SPLIT.test(span)) return ok({ role: "pile-split" as const });
    const splitWindow = span.match(PILE_SPLIT_WINDOW);
    if (splitWindow !== null) {
        const count = readAmount(splitWindow[1]!);
        if (count === null)
            return fail(`"${splitWindow[1]}" is not a count`, span);
        return ok({
            role: "pile-split-window" as const,
            count,
        } satisfies SentenceIR);
    }
    if (PILE_OPPONENT_PICKS.test(span))
        return ok({ role: "pile-opponent-picks" as const });
    const searchPile = span.match(SEARCH_REVEAL_PILE);
    if (searchPile !== null) {
        const count = readNumberWord(searchPile[1]!);
        if (count === null || count < 2)
            return fail(`"${searchPile[1]}" is not a pile's count`, span);
        return ok({
            role: "search-reveal-pile" as const,
            count,
        } satisfies SentenceIR);
    }
    if (SEARCH_PILE_PICK.test(span))
        return ok({
            role: "search-pile-pick" as const,
            chooser: { kind: "target", opponent: true },
        } satisfies SentenceIR);
    if (SEARCH_PILE_SHUFFLE.test(span))
        return ok({ role: "search-pile-shuffle" as const });
    const pileRoute = span.match(PILE_ROUTE);
    if (pileRoute !== null)
        return ok({
            role: "pile-route" as const,
            pronoun: pileRoute[1] as "one" | "that",
        } satisfies SentenceIR);
    const all = span.match(ROUTE_ALL_OF_SUBTYPE);
    if (all !== null) {
        // CR 205.3m — a creature type; anything else ("land", "creature")
        // is a card TYPE the filter would have to read differently.
        if (!CREATURE_SUBTYPES.has(all[1]!))
            return fail(`"${all[1]}" is not a creature type`, span);
        return ok({
            role: "library-route" as const,
            route: { kind: "all-of-subtype" as const, subtype: all[1]! },
        } satisfies SentenceIR);
    }
    if (ROUTE_TAKE_OTHER.test(span))
        return ok({
            role: "library-route" as const,
            route: {
                kind: "take" as const,
                count: { kind: "fixed" as const, value: 1 },
                rest: "bottom-any-order" as const,
                other: true as const,
            },
        } satisfies SentenceIR);
    const take = span.match(ROUTE_TAKE);
    if (take !== null) {
        const count = readAmount(take[1]!);
        if (count === null) return fail(`"${take[1]}" is not a count`, span);
        return ok({
            role: "library-route" as const,
            route: {
                kind: "take" as const,
                count,
                rest: ROUTE_REST.get(take[2]!)!,
            },
        } satisfies SentenceIR);
    }
    return null;
}

/**
 * CR 107.3 — the count a "where X is …" tail defines, as an amount.
 *
 * Only the two forms a fixture pins: a plural descriptor ("the number of
 * Zombies you control") and the controller's hand less a printed constant. A
 * descriptor clause the count cannot express is the LOWERING's refusal.
 */
function whereXAmount(tail: string, ctx: unknown): RuleResult<AmountIR> {
    // CR 202.3 — the card the activation cost exiled; the site binds it.
    if (EXILED_CARD_MANA_VALUE.test(tail))
        return ok({
            kind: "cost-exiled-card-characteristic" as const,
            characteristic: "manaValue" as const,
        });
    const hand = tail.match(CARDS_IN_YOUR_HAND_MINUS);
    if (hand !== null) {
        const minus = readNumberWord(hand[1]!);
        if (minus === null) return fail(`"${hand[1]}" is not a number`, tail);
        return ok({
            kind: "counted-difference" as const,
            set: {
                kind: "cards-in-hand" as const,
                player: { kind: "you" as const },
            },
            minus,
        });
    }
    const set = numberOfSetRule.run(tail, ctx);
    if (!set.ok) return set;
    return ok({ kind: "counted" as const, times: 1, set: set.value });
}

/**
 * CR 107.3 — replace every printed X of a draw / life-change sentence (or a
 * conjunction of them) with the amount its "where X is …" tail defines.
 * `null` when the sentence is another kind, or prints no X: an X the tail does
 * not define, or a tail defining an X nobody prints, is a line we have misread.
 */
function bindWhereX(
    sentence: EffectSentenceIR,
    amount: AmountIR
): EffectSentenceIR | null {
    switch (sentence.kind) {
        case "draw":
            return sentence.count.kind === "x"
                ? { ...sentence, count: amount }
                : null;
        case "life":
            return sentence.amount.kind === "x"
                ? { ...sentence, amount }
                : null;
        case "deal-damage":
            return sentence.amount.kind === "x"
                ? { ...sentence, amount }
                : null;
        case "counters":
            return sentence.count.kind === "x"
                ? { ...sentence, count: amount }
                : null;
        case "conjunction": {
            const effects = sentence.effects.map((e) => bindWhereX(e, amount));
            return effects.every((e) => e !== null)
                ? { ...sentence, effects: effects as EffectSentenceIR[] }
                : null;
        }
        default:
            return null;
    }
}

function effectSentence(
    span: string,
    ctx: unknown
): RuleResult<EffectSentenceIR> {
    // ── player-scoped attack protection (CR 508.1c) ─────────────────────
    if (PLAYER_ATTACK_PROTECTION.test(span))
        return ok({
            kind: "player-attack-protection" as const,
        } satisfies EffectSentenceIR);
    // ── source's assignment suppression (CR 510.1c) ─────────────────────
    const assignsNone = span.match(ASSIGNS_NO_COMBAT_DAMAGE);
    if (assignsNone !== null && isSelfPhrase(assignsNone[1]!))
        return ok({
            kind: "assigns-no-combat-damage" as const,
        } satisfies EffectSentenceIR);
    const andAssignsNone = span.match(AND_ASSIGNS_NO_COMBAT_DAMAGE);
    if (andAssignsNone !== null && isSelfPhrase(andAssignsNone[2]!)) {
        const head = effectSentence(andAssignsNone[1]!, ctx);
        if (!head.ok) return head;
        return ok({
            kind: "effect-and-assigns-no-combat-damage" as const,
            effect: head.value,
        } satisfies EffectSentenceIR);
    }

    // ── "…, where X is the number of …" (CR 107.3) ─────────────────────────
    const whereX = span.match(WHERE_X_IS);
    if (whereX !== null) {
        const head = effectSentence(whereX[1]!, ctx);
        if (!head.ok) return head;
        const amount = whereXAmount(whereX[2]!, ctx);
        if (!amount.ok) return amount;
        const bound = bindWhereX(head.value, amount.value);
        if (bound === null)
            return fail(
                '"where X is" defines an X a draw or life change prints',
                span
            );
        return ok(bound);
    }

    // ── delayed removal at the next end step (CR 603.7a) ───────────────────
    // Before every verb branch: "Exile it …" would otherwise reach the exile
    // verb, whose subject grammar refuses "it at the beginning of …".
    const delayedRemoval = span.match(DELAYED_REMOVAL_NEXT_END_STEP);
    if (delayedRemoval !== null) {
        return ok({
            kind: "delayed-removal" as const,
            verb:
                delayedRemoval[1] === "Exile"
                    ? ("exile" as const)
                    : ("sacrifice" as const),
        } satisfies EffectSentenceIR);
    }

    // ── delayed return at the next end / cleanup step (CR 603.7a) ──────────
    // Before every verb branch for the same reason as the removal above.
    const delayedReturn = span.match(DELAYED_RETURN);
    if (delayedReturn !== null) {
        const toHand = delayedReturn[2] !== undefined;
        return ok({
            kind: "delayed-return" as const,
            referent: delayedReturn[1]!.startsWith("this ")
                ? (delayedReturn[1]! as `this ${string}`)
                : ("it" as const),
            destination: toHand ? ("hand" as const) : ("battlefield" as const),
            timing:
                (delayedReturn[2] ?? delayedReturn[3]) === "cleanup"
                    ? ("next-cleanup-step" as const)
                    : ("next-end-step" as const),
        } satisfies EffectSentenceIR);
    }

    // ── reveal the top card into hand (CR 701.20a) ─────────────────────────
    if (REVEAL_TOP_TO_HAND.test(span))
        return ok({ kind: "reveal-top-to-hand" as const, lifeLoss: false });

    // ── choose a creature type (CR 205.3m) ─────────────────────────────────
    // An EXACT match, not a prefix: the whole sentence is the instruction, and
    // anything appended to it ("Choose a creature type other than Wall") is a
    // restriction this rule does not read and must not silently drop.
    if (CHOOSE_CREATURE_TYPE.test(span)) {
        return ok({ kind: "choose-creature-type" as const });
    }
    const chooseExcept = span.match(CHOOSE_CREATURE_TYPE_EXCEPT);
    if (chooseExcept !== null) {
        const excluded = chooseExcept[1]!;
        if (!CREATURE_SUBTYPES.has(excluded))
            return fail(`"${excluded}" is not a creature type`, span);
        return ok({
            kind: "choose-creature-type" as const,
            exclude: [excluded],
        });
    }

    // ── choose a land type and a basic land type (CR 205.3i / 305.6) ──────
    // Exact, for the reason the creature-type branch gives; and the written
    // back sentence before the land-type branch below, which would otherwise
    // read "becomes the second chosen type" as a CR 305.6 list and refuse it.
    if (CHOOSE_LAND_TYPES.test(span)) {
        return ok({ kind: "choose-land-types" as const });
    }
    const setChosenLand = span.match(SET_CHOSEN_LAND_TYPE);
    if (setChosenLand !== null) {
        const duration = durationRule.run(setChosenLand[1]!, ctx);
        if (!duration.ok) return duration;
        return ok({
            kind: "set-chosen-land-type" as const,
            duration: duration.value,
        } satisfies EffectSentenceIR);
    }

    // ── chosen creature type written back (CR 205.1a, issue #4316) ─────────
    // Before the land-type branch below: "that type" is not a CR 305.6 list,
    // and the duration is REQUIRED for the reason that branch gives.
    const setChosen = span.match(SET_CHOSEN_CREATURE_TYPE);
    if (setChosen !== null) {
        const subject = subjectRule.run(setChosen[1]!, ctx);
        if (!subject.ok) return subject;
        const duration = durationRule.run(setChosen[2]!, ctx);
        if (!duration.ok) return duration;
        return ok({
            kind: "set-chosen-creature-type" as const,
            subject: subject.value,
            duration: duration.value,
        } satisfies EffectSentenceIR);
    }

    // ── mana colour rules (CR 614.1a / 609.4b, issue #3811) ────────────────
    // Both anchored at both ends, for the reason the rule above gives: a
    // scope clause appended to either ("… to cast creature spells") narrows
    // the effect, and reading the head alone would silently widen it.
    const production = span.match(REPLACE_MANA_PRODUCTION_COLOR);
    if (production !== null) {
        const color = COLOR_WORDS.get(production[1]!);
        if (color !== undefined) {
            return ok({
                kind: "replace-mana-production-color" as const,
                color,
            });
        }
    }
    const substitution = span.match(GRANT_MANA_SUBSTITUTION);
    if (substitution !== null) {
        const from =
            substitution[1] === "colorless"
                ? ("C" as const)
                : COLOR_WORDS.get(substitution[1]!);
        if (from !== undefined) {
            return ok({
                kind: "grant-mana-substitution" as const,
                from,
                breadth:
                    substitution[2] === "type"
                        ? ("any-type" as const)
                        : ("any-color" as const),
            });
        }
    }

    const spellSubstitution = span.match(GRANT_SPELL_MANA_SUBSTITUTION);
    if (spellSubstitution !== null) {
        return ok({
            kind: "grant-spell-mana-substitution" as const,
            breadth:
                spellSubstitution[1] === "type"
                    ? ("any-type" as const)
                    : ("any-color" as const),
        });
    }

    // ── add mana (CR 106.1) ────────────────────────────────────────────────
    const addMana = span.match(ADD_MANA);
    if (addMana !== null) {
        return ok({
            kind: "add-mana" as const,
            mana: readManaPips(addMana[2]!),
            ...(addMana[1] === "That player adds"
                ? { thatPlayer: true as const }
                : {}),
        });
    }

    // ── pump (CR 613.4c, layer 7c) ─────────────────────────────────────────
    const pump = span.match(PUMP);
    if (pump !== null) {
        const group = pump[2] === "get";
        if (pump[3] !== undefined && !group)
            return fail(
                '"an additional" is read behind the group verb only',
                span
            );
        const subject = group
            ? groupSubject(pump[1]!, ctx)
            : (hostSubject(pump[1]!, ctx) ?? subjectRule.run(pump[1]!, ctx));
        if (!subject.ok) return subject;
        const power = signedModifier(pump[4]!);
        const toughness = signedModifier(pump[5]!);
        let tail = pump[6]!;
        const perDomain = PUMP_PER_DOMAIN.test(tail);
        if (perDomain) {
            tail = tail.replace(PUMP_PER_DOMAIN, "");
            if (power !== toughness || Math.abs(power) !== 1)
                return fail(
                    "a per-basic-land-type pump is read for +1/+1 or -1/-1, the two the corpus prints",
                    span
                );
        }
        const perOther = tail.match(PUMP_PER_OTHER_ATTACKING);
        if (perOther !== null) {
            tail = tail.replace(PUMP_PER_OTHER_ATTACKING, "");
            if (!CREATURE_SUBTYPES.has(perOther[1]!))
                return fail(`"${perOther[1]}" is not a creature type`, span);
            if (perDomain) return fail("a pump scales by one tally", span);
        }
        const duration = durationRule.run(tail, ctx);
        if (!duration.ok) return duration;
        return ok({
            kind: "pump" as const,
            subject: subject.value,
            power,
            toughness,
            duration: duration.value,
            ...(perDomain ? { perDomain: true as const } : {}),
            ...(perOther !== null ? { perOtherAttacking: perOther[1]! } : {}),
        } satisfies EffectSentenceIR);
    }

    // ── animate a sweep (CR 205.1b, layers 4 and 7b) ───────────────────────
    const animate = span.match(ANIMATE);
    if (animate !== null) {
        const subject = groupSubject(animate[1]!, ctx);
        if (!subject.ok) return subject;
        const duration = durationRule.run(animate[4]!, ctx);
        if (!duration.ok) return duration;
        return ok({
            kind: "animate" as const,
            subject: subject.value,
            power: signedModifier(animate[2]!),
            toughness: signedModifier(animate[3]!),
            duration: duration.value,
        } satisfies EffectSentenceIR);
    }

    // ── animate the source itself (CR 205.1b, layers 4, 5, 6 and 7b) ───────
    const animateSelf = span.match(ANIMATE_SELF);
    if (animateSelf !== null) return readSelfAnimation(animateSelf, span, ctx);

    // ── the source's permanent type-line replacement (CR 205.1a) ──────────
    const becomeCreature = span.match(BECOME_CREATURE);
    if (becomeCreature !== null)
        return readBecomeCreature(becomeCreature, span, ctx);

    // ── grant a keyword (CR 613.1f, layer 6) ───────────────────────────────
    const gainsAt = span.indexOf(" gains ");
    if (
        gainsAt !== -1 &&
        !LIFE.test(span) &&
        !LIFE_FOR_EACH.test(span) &&
        !LIFE_EQUAL_ACTED_ON.test(span) &&
        !DRAIN.test(span)
    ) {
        const subjectSpan = span.slice(0, gainsAt);
        const subject =
            hostSubject(subjectSpan, ctx) ?? subjectRule.run(subjectSpan, ctx);
        if (!subject.ok) return subject;
        const rest = span.slice(gainsAt + " gains ".length);
        const untilAt = rest.lastIndexOf(" until ");
        if (untilAt === -1)
            return fail("a granted ability needs a duration", span);
        const keyword = KEYWORDS.get(rest.slice(0, untilAt).toLowerCase());
        if (keyword === undefined)
            return fail(
                `"${rest.slice(0, untilAt)}" is not a Mechanics Registry keyword`,
                span
            );
        const duration = durationRule.run(rest.slice(untilAt + 1), ctx);
        if (!duration.ok) return duration;
        return ok({
            kind: "grant-ability" as const,
            subject: subject.value,
            keyword,
            duration: duration.value,
        } satisfies EffectSentenceIR);
    }

    // ── protection from a color chosen earlier in the SAME ability ─────────
    //
    // "Creatures you control gain protection from the chosen color until end
    // of turn." (Glory) — the plural-verb ("gain", not "gains") twin of the
    // grant-a-keyword branch above, narrowed to the one parameterised
    // keyword and the one antecedent this fixture evidences ("the chosen
    // color", never "that color" — a neighbour with no fixture, refused).
    const chosenProtection = span.match(MASS_GAIN_PROTECTION_CHOSEN_COLOR);
    if (chosenProtection !== null) {
        const subject = groupSubject(chosenProtection[1]!, ctx);
        if (!subject.ok) return subject;
        const duration = durationRule.run(chosenProtection[2]!, ctx);
        if (!duration.ok) return duration;
        return ok({
            kind: "choose-color-grant-protection" as const,
            subject: subject.value,
            duration: duration.value,
        } satisfies EffectSentenceIR);
    }

    // ── colour change, chosen on resolution (CR 613.1e, layer 5) ───────────
    const setColor = span.match(SET_COLOR_CHOICE);
    if (setColor !== null) {
        const subject = subjectRule.run(setColor[1]!, ctx);
        if (!subject.ok) return subject;
        const tail = setColor[2];
        if (tail === undefined)
            return ok({
                kind: "set-color-choice" as const,
                subject: subject.value,
            } satisfies EffectSentenceIR);
        const duration = durationRule.run(tail, ctx);
        if (!duration.ok) return duration;
        return ok({
            kind: "set-color-choice" as const,
            subject: subject.value,
            duration: duration.value,
        } satisfies EffectSentenceIR);
    }

    // ── land-type change, chosen on resolution (CR 305.7, layer 4) ─────────
    //
    // Entered only when the middle of the sentence reads as a CR 305.6 land
    // type list, so "becomes a 3/3 creature until end of turn" and every other
    // "becomes …" template falls through to its own branch (`readBasicLandTypes`).
    const setLandType = span.match(SET_LAND_TYPE);
    if (setLandType !== null) {
        const offered = readBasicLandTypes(setLandType[2]!);
        if (offered !== null) {
            const subject = subjectRule.run(setLandType[1]!, ctx);
            if (!subject.ok) return subject;
            const duration = durationRule.run(setLandType[3]!, ctx);
            if (!duration.ok) return duration;
            return ok({
                kind: "set-land-type" as const,
                subject: subject.value,
                offered,
                duration: duration.value,
            } satisfies EffectSentenceIR);
        }
    }

    // ── anti-prevention lock (CR 615.12) ───────────────────────────────────
    if (span === SUPPRESS_DAMAGE_PREVENTION)
        return ok({
            kind: "suppress-damage-prevention" as const,
        } satisfies EffectSentenceIR);

    // ── recipient-bound damage lock (CR 615.12 + CR 614.9) ────────────────
    const lockDamage = span.match(LOCK_DAMAGE_THIS_TURN);
    if (lockDamage !== null) {
        const subject = subjectRule.run(lockDamage[1]!, ctx);
        if (!subject.ok) return subject;
        if (subject.value.kind !== "that-creature")
            return fail('a damage lock names "that creature"', span);
        return ok({
            kind: "lock-damage" as const,
            subject: subject.value,
        } satisfies EffectSentenceIR);
    }

    // ── prevent the next N damage (CR 615.7) ───────────────────────────────
    const preventNext = span.match(PREVENT_NEXT_DAMAGE);
    if (preventNext !== null) {
        const to = subjectRule.run(preventNext[2]!, ctx);
        if (!to.ok) return to;
        // CR 115.4 / CR 115.1c — read for the two announced recipients the
        // corpus prints this shield under: "any target" and a bare "target
        // creature" (Oasis, Martyrs' Tomb). A qualified creature ("target
        // legendary creature") and every other recipient phrase are refused
        // under their own reason so each stays its own Grammar Gap. CR
        // 120.3's fixed two-set union is the one exception, read by its own
        // kind rather than an announced target.
        if (
            to.value.kind !== "each-creature-and-player" &&
            (to.value.kind !== "target" ||
                !isPreventionShieldRecipient(to.value.requirement))
        )
            return fail(
                `a prevention shield is read for "any target" or "target creature" only, not "${preventNext[2]}" (CR 615.7)`,
                span
            );
        const duration = durationRule.run(preventNext[3]!, ctx);
        if (!duration.ok) return duration;
        return ok({
            kind: "prevent-next-damage" as const,
            amount: Number(preventNext[1]),
            to: to.value,
            duration: duration.value,
        } satisfies EffectSentenceIR);
    }

    // ── the next damage from a source of your choice (CR 609.7a) ───────────
    const chosenSource = span.match(PREVENT_NEXT_DAMAGE_FROM_CHOSEN_SOURCE);
    if (chosenSource !== null) {
        const printed = chosenSource[1];
        const qualifier =
            printed === undefined ? {} : chosenSourceQualifier(printed);
        if (qualifier === null)
            return fail(
                `a source of your choice is read for one colour, two colours joined by "or", "artifact" or "land" only, not "${printed}" (CR 609.7a)`,
                span
            );
        const duration = durationRule.run(chosenSource[2]!, ctx);
        if (!duration.ok) return duration;
        return ok({
            kind: "prevent-next-damage-from-chosen-source" as const,
            ...qualifier,
            phrase: printed === undefined ? "source" : `${printed} source`,
            duration: duration.value,
        } satisfies EffectSentenceIR);
    }

    // ── prevent all combat damage to and by <object> (CR 615.1a) ───────────
    const preventCombatBoth = span.match(PREVENT_COMBAT_DAMAGE_TO_AND_BY);
    if (preventCombatBoth !== null) {
        const subject = subjectRule.run(preventCombatBoth[1]!, ctx);
        if (!subject.ok) return subject;
        const duration = durationRule.run(preventCombatBoth[2]!, ctx);
        if (!duration.ok) return duration;
        return ok({
            kind: "prevent-combat-damage-to-and-by" as const,
            subject: subject.value,
            duration: duration.value,
        } satisfies EffectSentenceIR);
    }

    // ── <creature> fights <other> (CR 701.14a) ─────────────────────────────
    const fights = span.match(FIGHTS);
    if (fights !== null) {
        const creature = subjectRule.run(fights[1]!, ctx);
        if (!creature.ok) return creature;
        const other = subjectRule.run(fights[2]!, ctx);
        if (!other.ok) return other;
        return ok({
            kind: "fight" as const,
            creature: creature.value,
            other: other.value,
        } satisfies EffectSentenceIR);
    }

    // ── prevent all combat damage by <object> (CR 615.1a) ──────────────────
    const preventCombatBy = span.match(PREVENT_COMBAT_DAMAGE_BY);
    if (preventCombatBy !== null) {
        const subject = subjectRule.run(preventCombatBy[1]!, ctx);
        if (!subject.ok) return subject;
        const duration = durationRule.run(preventCombatBy[2]!, ctx);
        if (!duration.ok) return duration;
        return ok({
            kind: "prevent-combat-damage-by" as const,
            subject: subject.value,
            duration: duration.value,
        } satisfies EffectSentenceIR);
    }

    // ── redirect the next N damage (CR 614.9) ──────────────────────────────
    const redirectNext = span.match(REDIRECT_NEXT_DAMAGE);
    if (redirectNext !== null) {
        const amount = readAmount(redirectNext[1]!);
        if (amount === null)
            return fail(`"${redirectNext[1]}" is not a damage amount`, span);
        const from = subjectRule.run(redirectNext[2]!, ctx);
        if (!from.ok) return from;
        const to = subjectRule.run(redirectNext[4]!, ctx);
        if (!to.ok) return to;
        const duration = durationRule.run(redirectNext[3]!, ctx);
        if (!duration.ok) return duration;
        return ok({
            kind: "redirect-next-damage" as const,
            amount,
            from: from.value,
            to: to.value,
            duration: duration.value,
        } satisfies EffectSentenceIR);
    }

    // ── the acted-on object deals damage equal to its mana value ───────────
    const actedOnDealer = span.match(ACTED_ON_DEALS_DAMAGE_EQUAL_MANA_VALUE);
    if (actedOnDealer !== null) {
        const to = subjectRule.run(actedOnDealer[2]!, ctx);
        if (!to.ok) return to;
        return ok({
            kind: "deal-damage" as const,
            amount: {
                kind: "acted-on-characteristic" as const,
                noun: "it" as const,
                characteristic: "manaValue" as const,
            },
            to: to.value,
            sourceIsActedOn: actedOnDealer[1]!,
        } satisfies EffectSentenceIR);
    }

    // ── damage equal to the acted-on object's mana value (CR 202.3) ────────
    const damageMv = span.match(DAMAGE_EQUAL_MANA_VALUE);
    if (damageMv !== null) {
        const dealer = uncapitalise(damageMv[1]!);
        const dealerIsPronoun = dealer === PRONOUN_MARKER;
        if (!dealerIsPronoun && !isSelfPhrase(dealer))
            return fail(
                `"${damageMv[1]}" is not a damage source this grammar knows`,
                span
            );
        const amount = readActedOnCharacteristic(damageMv[2]!, "mana value");
        if (amount === null)
            return fail(`"${damageMv[2]}" names no acted-on object`, span);
        const to = subjectRule.run(damageMv[3]!, ctx);
        if (!to.ok) return to;
        return ok({
            kind: "deal-damage" as const,
            amount,
            to: to.value,
            ...(dealerIsPronoun ? { sourceIsPronoun: true as const } : {}),
        } satisfies EffectSentenceIR);
    }

    // ── damage to each player equal to THEIR count (CR 120.1, CR 107.1) ────
    const damageEachPlayer = span.match(DAMAGE_EACH_PLAYER_COUNT);
    if (damageEachPlayer !== null) {
        if (!isSelfPhrase(uncapitalise(damageEachPlayer[1]!)))
            return fail(
                `"${damageEachPlayer[1]}" is not a damage source this grammar knows`,
                span
            );
        // "that player controls" is "you control" said once per recipient.
        const set = numberOfSetRule.run(
            `${damageEachPlayer[3]} you control`,
            ctx
        );
        if (!set.ok) return set;
        return ok({
            kind: "deal-damage-each-player-count" as const,
            times: damageEachPlayer[2] === undefined ? 1 : 2,
            set: set.value,
        } satisfies EffectSentenceIR);
    }

    // ── damage equal to a counted set (CR 107.1) ───────────────────────────
    const damageCount = span.match(DAMAGE_EQUAL_COUNT);
    if (damageCount !== null) {
        const dealer = uncapitalise(damageCount[1]!);
        const dealerIsPronoun = dealer === PRONOUN_MARKER;
        if (!dealerIsPronoun && !isSelfPhrase(dealer))
            return fail(
                `"${damageCount[1]}" is not a damage source this grammar knows`,
                span
            );
        const set = numberOfSetRule.run(damageCount[3]!, ctx);
        if (!set.ok) return set;
        if (set.value.kind !== "permanents")
            return fail("damage counts a permanent set only", span);
        const to = subjectRule.run(damageCount[2]!, ctx);
        if (!to.ok) return to;
        return ok({
            kind: "deal-damage" as const,
            amount: { kind: "counted" as const, times: 1, set: set.value },
            to: to.value,
            ...(dealerIsPronoun ? { sourceIsPronoun: true as const } : {}),
        } satisfies EffectSentenceIR);
    }

    // ── damage equal to the dealer's own power (CR 608.2h) ────────────────
    const damageOwnPower = span.match(DAMAGE_EQUAL_OWN_POWER);
    if (damageOwnPower !== null) {
        const dealer = uncapitalise(damageOwnPower[1]!);
        const dealerIsPronoun = dealer === PRONOUN_MARKER;
        if (!dealerIsPronoun && !isSelfPhrase(dealer))
            return fail(
                `"${damageOwnPower[1]}" is not a damage source this grammar knows`,
                span
            );
        const to = subjectRule.run(damageOwnPower[2]!, ctx);
        if (!to.ok) return to;
        return ok({
            kind: "deal-damage" as const,
            amount: {
                kind: "sacrificed-source-characteristic" as const,
                characteristic: "power" as const,
            },
            to: to.value,
            ...(dealerIsPronoun ? { sourceIsPronoun: true as const } : {}),
        } satisfies EffectSentenceIR);
    }

    // ── damage divided as you choose (CR 601.2d) ────────────────
    const divided = span.match(DAMAGE_DIVIDED);
    if (divided !== null) {
        const dealer = uncapitalise(divided[1]!);
        const dealerIsPronoun = dealer === PRONOUN_MARKER;
        if (!dealerIsPronoun && !isSelfPhrase(dealer))
            return fail(
                `"${divided[1]}" is not a damage source this grammar knows`,
                span
            );
        const amount = readAmount(divided[2]!);
        if (amount === null)
            return fail(`"${divided[2]}" is not a damage amount`, span);
        const among = dividedTargetsRule.run(divided[3]!, ctx);
        if (!among.ok) return among;
        return ok({
            kind: "deal-damage-divided" as const,
            amount,
            among: among.value,
            ...(dealerIsPronoun ? { sourceIsPronoun: true as const } : {}),
        } satisfies EffectSentenceIR);
    }

    // ── counters distributed as you choose (CR 601.2d) ─────────────────────
    const distributed = span.match(DISTRIBUTE_COUNTERS);
    if (distributed !== null) {
        const amount = readAmount(distributed[1]!);
        if (amount === null)
            return fail(`"${distributed[1]}" is not a counter count`, span);
        const among = dividedTargetsRule.run(distributed[3]!, ctx);
        if (!among.ok) return among;
        return ok({
            kind: "distribute-counters" as const,
            amount,
            counter: distributed[2]!,
            among: among.value,
        } satisfies EffectSentenceIR);
    }
    const takeBack = span.match(REMOVE_DISTRIBUTED_COUNTERS);
    if (takeBack !== null) {
        if (takeBack[1] !== takeBack[2])
            return fail(
                `"${takeBack[2]}" counters are not the "${takeBack[1]}" counters put on this way`,
                span
            );
        return ok({
            kind: "delayed-remove-distributed-counters" as const,
            counter: takeBack[1]!,
            timing:
                takeBack[3] === "cleanup"
                    ? ("next-cleanup-step" as const)
                    : ("next-end-step" as const),
        } satisfies EffectSentenceIR);
    }

    // ── damage, then the controller's gain (CR 608.2c) ─────────────────────
    const damageThenGain = span.match(DAMAGE_THEN_GAIN);
    if (damageThenGain !== null) {
        const dealt = effectSentence(damageThenGain[1]!, ctx);
        if (!dealt.ok) return dealt;
        const gain = effectSentence(capitalise(damageThenGain[2]!), ctx);
        if (!gain.ok) return gain;
        return ok({
            kind: "conjunction" as const,
            effects: [dealt.value, gain.value],
        } satisfies EffectSentenceIR);
    }

    // ── damage (CR 119.3) ──────────────────────────────────────────────────
    const damage = span.match(DAMAGE);
    if (damage !== null) {
        // CR 120.1 — "An object that deals damage is the source of that
        // damage", and the Op names no other: grammar v0 reads the source's
        // own name and the bound pronoun; "that creature deals" is anaphora
        // whose referent lives in another sentence.
        const dealer = uncapitalise(damage[1]!);
        const dealerIsPronoun = dealer === PRONOUN_MARKER;
        if (!dealerIsPronoun && !isSelfPhrase(dealer))
            return fail(
                `"${damage[1]}" is not a damage source this grammar knows`,
                span
            );
        const amount = readAmount(damage[2]!);
        if (amount === null)
            return fail(`"${damage[2]}" is not a damage amount`, span);
        // CR 601.2c — "to each of X targets": the announced group is X wide
        // and every member takes the whole amount.
        if (damage[3] === EACH_OF_X_TARGETS)
            return ok({
                kind: "deal-damage-each-of-x-targets" as const,
                amount,
                ...(dealerIsPronoun ? { sourceIsPronoun: true as const } : {}),
            } satisfies EffectSentenceIR);
        // CR 120.3 + CR 702.9a — "to each creature", "to each creature without
        // flying", "to each creature target opponent controls": a creature
        // sweep as the damage recipient. Tried by its own rule so the general
        // sweep grammar keeps refusing a bare "each creature" and "without
        // <keyword>" for every other verb. The creature half may be followed
        // by " and each player" (Earthquake) — the exact phrase "each creature
        // and each player" is `subjectRule`'s, not read here.
        const recipient = damage[3]!;
        const withPlayers =
            recipient !== EACH_CREATURE_AND_EACH_PLAYER &&
            recipient.endsWith(AND_EACH_PLAYER);
        const sweep = recipient.startsWith("each ")
            ? creatureSweepRecipientRule.run(
                  withPlayers
                      ? recipient.slice(0, -AND_EACH_PLAYER.length)
                      : recipient,
                  ctx
              )
            : null;
        // CR 110.2 + CR 608.2h — "that creature's controller": the player who
        // controls the creature an earlier sentence targeted. Read as one exact
        // phrase; the referent is the lowering's to check.
        const to: RuleResult<SubjectIR> =
            damage[3] === THAT_CREATURE_CONTROLLER
                ? ok({
                      kind: "player" as const,
                      player: { kind: "that-creature-controller" as const },
                  })
                : sweep !== null && sweep.ok
                  ? sweepRecipient(sweep.value, withPlayers)
                  : subjectRule.run(damage[3]!, ctx);
        if (!to.ok) return to;
        return ok({
            kind: "deal-damage" as const,
            amount,
            to: to.value,
            ...(dealerIsPronoun ? { sourceIsPronoun: true as const } : {}),
        } satisfies EffectSentenceIR);
    }

    // ── loot: draw, then discard (CR 121.1 + CR 701.9a) ──────────────────────
    const loot = span.match(LOOT);
    if (loot !== null) {
        const draw = readAmount(loot[1]!);
        const discard = readAmount(loot[2]!);
        if (draw === null || discard === null)
            return fail("a loot needs two counts", span);
        return ok({
            kind: "loot" as const,
            draw,
            discard,
        } satisfies EffectSentenceIR);
    }

    // ── shuffle the hand into the library, then draw that many ──────────────
    // CR 701.24a + CR 121.1
    if (SHUFFLE_HAND_REDRAW.test(span)) {
        return ok({
            kind: "shuffle-hand-redraw" as const,
        } satisfies EffectSentenceIR);
    }

    // ── shuffle the graveyard into the library ─────────────────────────────
    // CR 701.24a + CR 404.1
    if (span === SHUFFLE_OWN_GRAVEYARD) {
        return ok({
            kind: "shuffle-own-graveyard-into-library" as const,
        } satisfies EffectSentenceIR);
    }

    // ── search the library, reveal the find, take it, shuffle ──────────────
    // CR 701.23a (search) + CR 701.20a (reveal) + CR 701.24a (shuffle)
    const searchToHand = span.match(SEARCH_LIBRARY_TO_HAND);
    if (searchToHand !== null) {
        const phrase = searchToHand[1]!;
        // The reveal pronoun is part of the printed form: each description is
        // earned with the wording a card prints it in, so a pairing no card
        // prints has no row and fails the line.
        const filter = LIBRARY_SEARCH_FILTERS.get(
            `${phrase}|${searchToHand[2]}`
        );
        if (filter === undefined)
            return fail(`"${span}" is not a library search description`, span);
        return ok({
            kind: "search-library-to-hand" as const,
            filter,
            phrase,
        } satisfies EffectSentenceIR);
    }

    // ── search the library, reveal the find, shuffle, put it on top ─────────
    // CR 701.23a (search) + CR 701.20a (reveal) + CR 701.24a (shuffle)
    const searchToTop = span.match(SEARCH_LIBRARY_TO_TOP);
    if (searchToTop !== null) {
        const [, phrase, pronoun] = searchToTop;
        const filter = LIBRARY_SEARCH_TO_TOP.get(`${phrase}|${pronoun}`);
        if (filter === undefined)
            return fail(
                `"${span}" is not a library search to the top of the library`,
                span
            );
        return ok({
            kind: "search-library-to-top" as const,
            filter,
            phrase: phrase!,
        } satisfies EffectSentenceIR);
    }

    // ── search the library, put the find onto the battlefield, shuffle ─────
    // CR 701.23a (search) + CR 110.5b (tapped) + CR 701.24a (shuffle)
    const searchToBattlefield = span.match(SEARCH_LIBRARY_TO_BATTLEFIELD);
    if (searchToBattlefield !== null) {
        const [, phrase, pronoun, tapped] = searchToBattlefield;
        const row = LIBRARY_SEARCH_TO_BATTLEFIELD.get(
            `${phrase}|${pronoun}|${tapped === undefined ? "" : "tapped"}`
        );
        if (row === undefined)
            return fail(
                `"${span}" is not a library search onto the battlefield`,
                span
            );
        return ok({
            kind: "search-library-to-battlefield" as const,
            filter: row.filter,
            phrase: phrase!,
            tapped: row.tapped,
        } satisfies EffectSentenceIR);
    }

    // ── search a TARGET player's library, exile or mill the find ───────────
    // CR 701.23a (search) + CR 701.23b (stated quality) + CR 701.24a (shuffle)
    const searchTarget = span.match(SEARCH_TARGET_LIBRARY);
    if (searchTarget !== null) {
        const [, who, , upToWord, plainWord, quality, verb, pronoun, shuffles] =
            searchTarget;
        const word = upToWord ?? plainWord;
        const count = word === undefined ? 1 : readNumberWord(word);
        // "a card" takes "it"; a spelled count takes "them" and is plural, so a
        // count of one or zero behind "cards" is a misreading, not a form.
        if (count === null || (word !== undefined && count < 2))
            return fail(`"${span}" has no printed search count`, span);
        if ((word === undefined) !== (pronoun === "it"))
            return fail(
                `"${span}" pairs the count with the wrong pronoun`,
                span
            );
        // CR 701.23b — a stated quality makes the find optional, which only
        // the "up to N" range says; a plain count with a quality is a form
        // no card prints, so it fails rather than compelling the find.
        if (quality !== undefined && upToWord === undefined)
            return fail(
                `"${span}" states a quality behind a plain count`,
                span
            );
        // CR 404.1 — "put them into that player's graveyard" is the other
        // denial route; the regex admits that suffix only behind "put", and
        // "put" only with it.
        const intoGraveyard = span.includes("graveyard");
        if ((verb === "put") !== intoGraveyard)
            return fail(`"${span}" is not a library search denial route`, span);
        const player = playerSubject(capitalise(who!), ctx);
        if (player === null || player.kind !== "target")
            return fail(`"${who}" is not a targeted player`, span);
        return ok({
            kind: "search-target-library" as const,
            player,
            count,
            upTo: upToWord !== undefined,
            flashback: quality !== undefined,
            route: intoGraveyard ? ("graveyard" as const) : ("exile" as const),
            shuffle: shuffles !== undefined,
        } satisfies EffectSentenceIR);
    }
    // ── the per-card library sweep after a graveyard exile (CR 608.2c) ─────
    const sameName = span.match(EXILE_SAME_NAME_LIBRARY_COPIES);
    if (sameName !== null) {
        // "that player" is anaphora (CR 109.5) for the player whose graveyard
        // the sentence before exiled; the fold below binds it.
        const player = playerSubject(sameName[1]!, ctx);
        if (player === null || player.kind !== "that-player")
            return fail(`"${sameName[1]}" is not the player just named`, span);
        return ok({
            kind: "exile-same-name-library-copies" as const,
        } satisfies EffectSentenceIR);
    }
    if (THEN_THAT_PLAYER_SHUFFLES.test(span))
        return ok({
            kind: "shuffle-searched-library" as const,
        } satisfies EffectSentenceIR);

    // ── draw, and lose life / and the opponent discards (CR 608.2c) ────────
    const drawAnd =
        span.match(YOU_DRAW_AND_LOSE_LIFE) ??
        span.match(YOU_DRAW_AND_THAT_OPPONENT_DISCARDS);
    if (drawAnd !== null) {
        const draw = effectSentence(capitalise(drawAnd[1]!), ctx);
        if (!draw.ok) return draw;
        // The second subject is the same "you" whether printed ("and you lose")
        // or elided ("and lose"): normalise to the printed-subject form.
        const secondClause = /^lose /.test(drawAnd[2]!)
            ? `you ${drawAnd[2]!}`
            : drawAnd[2]!;
        const second = effectSentence(capitalise(secondClause), ctx);
        if (!second.ok) return second;
        return ok({
            kind: "conjunction" as const,
            effects: [draw.value, second.value],
        } satisfies EffectSentenceIR);
    }

    // ── draw (CR 121.1) ────────────────────────────────────────────────────
    const drawSelf = span.match(DRAW_SELF);
    if (drawSelf !== null) {
        const count = readAmount(drawSelf[1]!);
        if (count === null)
            return fail(`"${drawSelf[1]}" is not a count`, span);
        return ok({
            kind: "draw" as const,
            player: { kind: "you" as const },
            count,
        } satisfies EffectSentenceIR);
    }
    const drawCount = span.match(DRAW_EQUAL_COUNT);
    if (drawCount !== null) {
        const set = numberOfSetRule.run(drawCount[1]!, ctx);
        if (!set.ok) return set;
        // Only the name count is fixtured; a permanent count would draw
        // through a set no golden reads back.
        if (set.value.kind !== "named-self-in-all-graveyards")
            return fail(
                "a draw reads a name count over the graveyards only",
                span
            );
        return ok({
            kind: "draw" as const,
            player: { kind: "you" as const },
            count: { kind: "counted" as const, times: 1, set: set.value },
        } satisfies EffectSentenceIR);
    }
    const drawPlayer = span.match(DRAW_PLAYER);
    if (drawPlayer !== null) {
        const player = playerSubject(drawPlayer[1]!, ctx);
        if (player === null)
            return fail(`"${drawPlayer[1]}" is not a player`, span);
        const count = readAmount(drawPlayer[2]!);
        if (count === null)
            return fail(`"${drawPlayer[2]}" is not a count`, span);
        return ok({
            kind: "draw" as const,
            player,
            count,
        } satisfies EffectSentenceIR);
    }

    // ── destroy (CR 701.8a) ────────────────────────────────────────────────
    const destroyTwo = span.includes(" if its ")
        ? null
        : span.match(DESTROY_TWO_TARGETS);
    if (destroyTwo !== null) {
        const first = effectSentence(`Destroy ${destroyTwo[1]}`, ctx);
        if (!first.ok) return first;
        const second = effectSentence(`Destroy ${destroyTwo[2]}`, ctx);
        if (!second.ok) return second;
        return ok({
            kind: "conjunction" as const,
            effects: [first.value, second.value],
        } satisfies EffectSentenceIR);
    }
    if (span.startsWith("Destroy ")) {
        // CR 115.2 + CR 105.1 — the Blast cycle's "target permanent if it's
        // <colour>" is read AS "target <colour> permanent" by the destroy verb
        // alone (same requirement as the hand-written cycle; the announcement
        // offers coloured permanents only). No other verb reads the spelling.
        const conditional = span
            .slice("Destroy ".length)
            .match(DESTROY_PERMANENT_IF_COLOR);
        // CR 202.3 — "… if its mana value is N or less": a bound on an
        // announced target, checked at resolution.
        const bound =
            conditional === null ? span.match(MANA_VALUE_BOUND) : null;
        const subject = sweepableSubject(
            conditional !== null
                ? `target ${conditional[1]} permanent`
                : span.slice(
                      "Destroy ".length,
                      bound === null ? undefined : span.length - bound[0].length
                  ),
            ctx
        );
        if (!subject.ok) return subject;
        if (bound !== null && subject.value.kind !== "target")
            return fail("a mana-value bound needs an announced target", span);
        return ok({
            kind: "destroy" as const,
            subject: subject.value,
            cantBeRegenerated: false,
            ...(bound === null ? {} : { manaValueAtMost: Number(bound[1]) }),
        } satisfies EffectSentenceIR);
    }

    // ── source tally gates its own sacrifice (CR 122.1, CR 701.21a) ────────
    const tally = span.match(SACRIFICE_AT_COUNTERS);
    if (tally !== null) {
        const atLeast = readNumberWord(tally[1]!);
        if (atLeast === null || atLeast < 1 || !isSelfPhrase(tally[3]!))
            return fail(
                `"${span}" is not a source counter-threshold sacrifice`,
                span
            );
        return ok({
            kind: "sacrifice-source-at-counters" as const,
            counter: tally[2]!,
            atLeast,
        } satisfies EffectSentenceIR);
    }

    // ── change the target of a spell (CR 115.7a) ───────────────────────────
    //
    // Exact spelling, for the reason the narrowed stack phrases are: the
    // "with a single target" restriction is a filter beside `type: "spell"`,
    // not a descriptor an adjective could be dropped from.
    if (span.startsWith(RETARGET_VERB)) {
        const phrase = span.slice(RETARGET_VERB.length);
        if (phrase !== RETARGET_SPELL_PHRASE)
            return fail(
                `"${phrase}" is not a retargetable phrase this grammar reads`,
                span
            );
        return ok({
            kind: "retarget" as const,
            subject: {
                kind: "target" as const,
                requirement: {
                    type: "spell",
                    count: 1,
                    spellSingleTarget: true,
                } as TargetRequirement,
            },
        } satisfies EffectSentenceIR);
    }

    // ── counter a spell (CR 701.6a) ────────────────────────────────────────
    //
    // Read at either casing, for the reason `subjectRule` gives: "Counter
    // target spell." opens its own sentence, "you may counter target spell"
    // hands `optionalSentenceRule`'s inner rule the same words uncapitalised,
    // and only the sentence-initial letter differs on a word this grammar
    // dispatches on.
    const counter = uncapitalise(span);
    const limit = counter.match(COUNTER_LIMIT_INSTEAD);
    if (limit !== null)
        return ok({
            kind: "counter-limit-instead" as const,
            mvMax: Number(limit[1]),
        } satisfies EffectSentenceIR);
    if (counter.startsWith(COUNTER_VERB)) {
        const rest = counter.slice(COUNTER_VERB.length);
        // CR 118.12a — the punisher clause, when there is one. Split before
        // the subject is read so the subject rule sees a target phrase and
        // not a target phrase with a cost glued to it.
        const taxAt = rest.indexOf(UNLESS_PAYS);
        const phrase = taxAt === -1 ? rest : rest.slice(0, taxAt);
        // CR 603.2 + CR 701.6a — "counter that spell": the spell the head's
        // cast event named, countered without an announcement. A tax on it is
        // a neighbour no fixture pins and stays refused.
        if (phrase === "that spell") {
            if (taxAt !== -1)
                return fail(
                    '"counter that spell" takes no counter tax in this grammar',
                    span
                );
            return ok({
                kind: "counter" as const,
                subject: { kind: "that-spell" as const },
            } satisfies EffectSentenceIR);
        }
        // CR 115.2 — the narrowed stack phrases are the COUNTER verb's own
        // (see `narrowedStackRequirement`); every other target phrase goes
        // through the shared subject rule.
        const narrowed = narrowedStackRequirement(phrase);
        const subject: RuleResult<SubjectIR> =
            narrowed === null
                ? subjectRule.run(phrase, ctx)
                : ok({ kind: "target" as const, requirement: narrowed });
        if (!subject.ok) return subject;
        // CR 701.6a — only an announced STACK OBJECT is countered by this
        // rule: a spell, or (CR 701.6a names "spell or ability") an ability
        // the requirement's `spellStackKind` admits. A sweep announces nothing
        // to point at.
        if (
            subject.value.kind !== "target" ||
            subject.value.requirement.type !== "spell"
        )
            return fail(
                "a counter names an announced spell target (CR 701.6a)",
                span
            );
        if (taxAt === -1)
            return ok({
                kind: "counter" as const,
                subject: subject.value,
            } satisfies EffectSentenceIR);
        const flat = rest.slice(taxAt).match(COUNTER_FLAT_TAX);
        if (flat !== null)
            return ok({
                kind: "counter" as const,
                subject: subject.value,
                unlessPays: { kind: "flat", amount: Number(flat[1]) },
            } satisfies EffectSentenceIR);
        const tax = rest.slice(taxAt).match(COUNTER_DOMAIN_TAX);
        if (tax === null)
            return fail(
                `"${rest.slice(taxAt + 1)}" is not a counter tax this grammar reads`,
                span
            );
        return ok({
            kind: "counter" as const,
            subject: subject.value,
            unlessPays: { kind: "per-domain" },
        } satisfies EffectSentenceIR);
    }

    // ── tap and untap (CR 701.26a) ─────────────────────────────────────────
    for (const [verb, action] of [
        ["Tap ", "tap"],
        ["Untap ", "untap"],
    ] as const) {
        if (!span.startsWith(verb)) continue;
        const upTo = action === "untap" ? span.match(UNTAP_UP_TO) : null;
        if (upTo !== null) {
            const max = readNumberWord(upTo[1]!);
            if (max === null || max < 1)
                return fail(`"${upTo[1]}" is not a count`, span);
            const descriptor = descriptorRule.run(upTo[2]!, ctx);
            if (!descriptor.ok) return descriptor;
            const filter = unqualifiedPermanentChoiceFilter(descriptor.value);
            if (!filter.ok) return filter;
            return ok({
                kind: "untap-chosen-permanents" as const,
                filter: filter.value,
                max,
                phrase: uncapitalise(span),
            } satisfies EffectSentenceIR);
        }
        // CR 106.4 + CR 701.26a — "Tap all lands target player controls and
        // that player loses all unspent mana": the sweep names the announced
        // player whose pool is then emptied. The tail is read only behind a
        // tap sweep whose swept permanents are that player's.
        const drained =
            action === "tap" ? span.match(TAP_TARGET_PLAYER_SWEEP_DRAIN) : null;
        if (drained !== null) {
            const mass = massSubjectRule.run(drained[1]!, ctx);
            if (!mass.ok) return mass;
            if (mass.value.select.controller !== undefined)
                return fail("two controller clauses", span);
            return ok({
                kind: "tap-untap" as const,
                action,
                subject: {
                    kind: "mass" as const,
                    ...mass.value,
                    targetPlayerControls: true as const,
                } as SubjectIR,
                thenDrainsManaPool: true as const,
            } satisfies EffectSentenceIR);
        }
        const subject = sweepableSubject(span.slice(verb.length), ctx);
        if (!subject.ok) return subject;
        return ok({
            kind: "tap-untap" as const,
            action,
            subject: subject.value,
        } satisfies EffectSentenceIR);
    }

    // ── combat restriction (CR 509.1b) ──────────────────────────
    const combat = span.match(COMBAT_RESTRICTION);
    if (combat !== null) {
        const subject = subjectRule.run(combat[1]!, ctx);
        if (!subject.ok) return subject;
        if (!isAnnouncedCreature(subject.value))
            return fail(
                "a combat restriction names one announced creature (a sweep also binds later arrivals)",
                span
            );
        return ok({
            kind: "combat-restriction" as const,
            restriction: COMBAT_RESTRICTION_WORDS.get(combat[2]!)!,
            subject: subject.value,
        } satisfies EffectSentenceIR);
    }

    // ── forced block (CR 509.1c) ───────────────────────────────────────────
    const forced = span.match(FORCED_BLOCK);
    if (forced !== null) {
        const subject = subjectRule.run(forced[1]!, ctx);
        if (!subject.ok) return subject;
        if (!isAnnouncedCreature(subject.value))
            return fail(
                "a block requirement names one announced creature (a sweep also binds later arrivals)",
                span
            );
        return ok({
            kind: "forced-block" as const,
            subject: subject.value,
        } satisfies EffectSentenceIR);
    }

    // ── regeneration lock on what the ability just damaged (CR 701.19c) ───
    if (span === CANT_BE_REGENERATED_DAMAGED_THIS_WAY)
        return ok({
            kind: "prevent-regeneration-damaged" as const,
        } satisfies EffectSentenceIR);

    // ── regeneration lock (CR 701.19c) ─────────────────────────────────────
    const noRegen = span.match(CANT_BE_REGENERATED_THIS_TURN);
    if (noRegen !== null) {
        const subject = subjectRule.run(noRegen[1]!, ctx);
        if (!subject.ok) return subject;
        if (!isAnnouncedCreature(subject.value))
            return fail(
                "a regeneration lock names one announced creature",
                span
            );
        return ok({
            kind: "prevent-regeneration" as const,
            subject: subject.value,
        } satisfies EffectSentenceIR);
    }

    // ── cast / activation lock on a player (CR 101.2, CR 601.2, CR 602.2) ──
    if (span === OPPONENTS_CANT_CAST)
        return ok({
            kind: "player-lock" as const,
            player: "opponents" as const,
            casting: "all" as const,
            activation: false,
        } satisfies EffectSentenceIR);
    if (span === DEFENDING_PLAYER_CANT_CAST)
        return ok({
            kind: "player-lock" as const,
            player: "defending" as const,
            casting: "all" as const,
            activation: false,
        } satisfies EffectSentenceIR);
    if (span === TARGET_PLAYER_CANT_CAST_OR_ACTIVATE)
        return ok({
            kind: "player-lock" as const,
            player: "target" as const,
            casting: ["Instant", "Sorcery"] as const,
            activation: true,
        } satisfies EffectSentenceIR);

    // ── land-play lock on a player (CR 305.1, CR 101.2) ────────────────────
    if (span === TARGET_PLAYER_CANT_PLAY_LANDS)
        return ok({
            kind: "land-play-lock" as const,
            player: "target" as const,
        } satisfies EffectSentenceIR);

    // ── regenerate (CR 701.19a) ────────────────────────────────────────────
    if (span.startsWith("Regenerate ")) {
        const subject = subjectRule.run(span.slice("Regenerate ".length), ctx);
        if (!subject.ok) return subject;
        return ok({
            kind: "regenerate" as const,
            subject: subject.value,
        } satisfies EffectSentenceIR);
    }

    // ── exchange control (CR 701.12a) ──────────────────────────────────────
    const exchange = span.match(EXCHANGE_CONTROL);
    if (exchange !== null) {
        // The source is the object that moves; the exchange of two announced
        // permanents is a different instruction (no fixture).
        if (!isSelfPhrase(exchange[1]!))
            return fail(`"${exchange[1]}" is not the source object`, span);
        const subject = subjectRule.run(exchange[2]!, ctx);
        if (!subject.ok) return subject;
        if (
            subject.value.kind !== "target" ||
            subject.value.requirement.zone !== undefined ||
            typeof subject.value.requirement.count !== "object" ||
            subject.value.requirement.controller !== "opponent" ||
            !requirementTypes(subject.value.requirement).every((t) =>
                (PERMANENT_TYPES as readonly string[]).includes(t)
            )
        )
            return fail(
                `"${exchange[2]}" is not an optional target permanent`,
                span
            );
        return ok({
            kind: "exchange-control" as const,
            subject: subject.value,
        } satisfies EffectSentenceIR);
    }

    // ── gain control (CR 613.1b, CR 611.2b) ────────────────────────────────
    if (span.startsWith(GAIN_CONTROL_VERB)) {
        const rest = span.slice(GAIN_CONTROL_VERB.length);
        const tailAt = rest.indexOf(WHILE_YOU_CONTROL);
        const object = tailAt === -1 ? rest : rest.slice(0, tailAt);
        // CR 611.2b — the tail names the SOURCE ("this creature", the card's
        // own name); a duration tied to any other object is another engine
        // condition, and is refused rather than read as this one.
        if (
            tailAt !== -1 &&
            !isSelfPhrase(rest.slice(tailAt + WHILE_YOU_CONTROL.length))
        )
            return fail(
                `"${rest.slice(tailAt + 1)}" is not "for as long as you control" this object`,
                span
            );
        const subject = permanentTarget(object, ctx);
        if (!subject.ok) return subject;
        return ok({
            kind: "gain-control" as const,
            subject: subject.value,
            whileYouControlSource: tailAt !== -1,
        } satisfies EffectSentenceIR);
    }

    // ── attach (CR 701.3a) ─────────────────────────────────────────────────
    const attach = span.match(ATTACH_SELF);
    if (attach !== null) {
        // The `attach` Op moves the SOURCE and nothing else: "Attach target
        // Equipment you control to this creature" names another mover.
        if (!isSelfPhrase(uncapitalise(attach[1]!)))
            return fail(`"${attach[1]}" is not the source object`, span);
        const subject = permanentTarget(attach[2]!, ctx);
        if (!subject.ok) return subject;
        const legal = attachableTypes(ctx as ParseContext);
        if (!legal.ok) return fail(legal.reason, span);
        if (
            subject.value.kind !== "target" ||
            !requirementTypes(subject.value.requirement).every((t) =>
                legal.value.includes(t)
            )
        )
            return fail(
                `"${attach[2]}" names a permanent the source can't be attached to (CR 701.3a)`,
                span
            );
        return ok({
            kind: "attach" as const,
            subject: subject.value,
        } satisfies EffectSentenceIR);
    }

    // ── drain: a loss, then the controller's gain (CR 608.2c) ──────────────
    const drain = span.match(DRAIN);
    if (drain !== null) {
        const loss = effectSentence(`${drain[1]} loses ${drain[2]} life`, ctx);
        if (!loss.ok) return loss;
        const gain = effectSentence(capitalise(drain[3]!), ctx);
        if (!gain.ok) return gain;
        return ok({
            kind: "conjunction" as const,
            effects: [loss.value, gain.value],
        } satisfies EffectSentenceIR);
    }

    // ── life per counted set (CR 107.1, CR 119.3) ──────────────────────────
    const lifeEach = span.match(LIFE_FOR_EACH);
    if (lifeEach !== null) {
        const player = playerSubject(lifeEach[1]!, ctx);
        if (player === null)
            return fail(`"${lifeEach[1]}" is not a player`, span);
        const times = readNumberWord(lifeEach[3]!);
        if (times === null || times < 1)
            return fail(`"${lifeEach[3]}" is not a multiplier`, span);
        const set = countedSetRule.run(lifeEach[4]!, ctx);
        if (!set.ok) return set;
        return ok({
            kind: "life" as const,
            action: lifeEach[2]!.startsWith("gain") ? "gain" : "lose",
            player,
            amount: { kind: "counted" as const, times, set: set.value },
        } satisfies EffectSentenceIR);
    }

    // ── life equal to a counted set (CR 107.1, CR 119.3) ───────────────────
    const lifeCount = span.match(LIFE_EQUAL_COUNT);
    if (lifeCount !== null) {
        const player = playerSubject(lifeCount[1]!, ctx);
        if (player === null)
            return fail(`"${lifeCount[1]}" is not a player`, span);
        const set = numberOfSetRule.run(lifeCount[3]!, ctx);
        if (!set.ok) return set;
        return ok({
            kind: "life" as const,
            action: lifeCount[2]!.startsWith("gain") ? "gain" : "lose",
            player,
            amount: { kind: "counted" as const, times: 1, set: set.value },
        } satisfies EffectSentenceIR);
    }

    // ── life equal to a characteristic of the acted-on object ──────────────
    // CR 119.3 + CR 202.3 + CR 208.1: the amount is read off the snapshot the
    // acting Op took (CR 608.2h), for a gain as well as a loss.
    const lifeActedOn = span.match(LIFE_EQUAL_ACTED_ON);
    if (lifeActedOn !== null) {
        const controller = lifeActedOn[1]!.match(ACTED_ON_CONTROLLER);
        // Only the gain is fixtured (Swords to Plowshares, Crumble).
        if (
            (controller !== null || lifeActedOn[1] === "Its controller") &&
            !lifeActedOn[2]!.startsWith("gain")
        )
            return fail("an acted-on controller only gains life", span);
        const player: PlayerRefIR | null =
            controller === null
                ? playerSubject(lifeActedOn[1]!, ctx)
                : {
                      kind: "acted-on-controller" as const,
                      noun: controller[1] ?? "it",
                  };
        if (player === null)
            return fail(`"${lifeActedOn[1]}" is not a player`, span);
        const amount = readActedOnCharacteristic(
            lifeActedOn[3]!,
            lifeActedOn[4]!
        );
        if (amount === null)
            return fail(
                `"${lifeActedOn[3]} ${lifeActedOn[4]}" names no acted-on object`,
                span
            );
        return ok({
            kind: "life" as const,
            action: lifeActedOn[2]!.startsWith("gain") ? "gain" : "lose",
            player,
            amount,
        } satisfies EffectSentenceIR);
    }

    // ── life (CR 119.3) ────────────────────────────────────────────────────
    const life = span.match(LIFE);
    if (life !== null) {
        const player = playerSubject(life[1]!, ctx);
        if (player === null) return fail(`"${life[1]}" is not a player`, span);
        const amount = readAmount(life[3]!);
        if (amount === null) return fail(`"${life[3]}" is not an amount`, span);
        return ok({
            kind: "life" as const,
            action: life[2]!.startsWith("gain") ? "gain" : "lose",
            player,
            amount,
        } satisfies EffectSentenceIR);
    }

    // ── counters (CR 122.1) ────────────────────────────────────────────────
    const counters = span.match(COUNTERS);
    if (counters !== null) {
        const count = readAmount(counters[1]!);
        if (count === null)
            return fail(`"${counters[1]}" is not a count`, span);
        const subject = subjectRule.run(counters[3]!, ctx);
        if (!subject.ok) return subject;
        return ok({
            kind: "counters" as const,
            subject: subject.value,
            counter: counters[2]!,
            count,
        } satisfies EffectSentenceIR);
    }

    // ── the linked exile's card comes back (CR 607.2a) ─────────────────────
    if (span === RETURN_EXILED || span === RETURN_EXILED_TO_HAND)
        return ok({
            kind: "return-exiled" as const,
            to: span === RETURN_EXILED ? "battlefield" : "hand",
        } satisfies EffectSentenceIR);
    if (span === RETURN_ALL_EXILED_WITH)
        return ok({
            kind: "return-all-exiled-with" as const,
        } satisfies EffectSentenceIR);

    // ── the ordered graveyard, swept or taken from the end (CR 404.2) ──────
    const topCard = span.match(RETURN_TOP_CARD);
    if (topCard !== null) {
        const cardType = permanentCardType(topCard[1]!);
        if (cardType === null)
            return fail(`"${topCard[1]}" is not a permanent card type`, span);
        return ok({
            kind: "graveyard-end-card" as const,
            position: "top" as const,
            cardType,
            owner: "you" as const,
            to: "battlefield" as const,
        } satisfies EffectSentenceIR);
    }
    if (EXILE_BOTTOM_CARD.test(span))
        return ok({
            kind: "graveyard-end-card" as const,
            position: "bottom" as const,
            cardType: null,
            owner: "target-player" as const,
            to: "exile" as const,
        } satisfies EffectSentenceIR);
    const sweep = span.match(RETURN_ALL_FROM_GRAVEYARD);
    if (sweep !== null) {
        const cardType = permanentCardType(sweep[1]!);
        if (cardType === null)
            return fail(`"${sweep[1]}" is not a permanent card type`, span);
        return ok({
            kind: "graveyard-sweep" as const,
            cardType,
        } satisfies EffectSentenceIR);
    }
    if (RETURN_SELF_FROM_GRAVEYARD.test(span))
        return ok({
            kind: "return-self-from-graveyard" as const,
            to: "hand" as const,
        } satisfies EffectSentenceIR);
    if (RETURN_SELF_FROM_GRAVEYARD_ATTACHED.test(span))
        return ok({
            kind: "return-self-from-graveyard" as const,
            to: "battlefield" as const,
            attachedTo: "entering-creature" as const,
        } satisfies EffectSentenceIR);
    const putFromHand = span.match(PUT_SUBTYPE_FROM_HAND);
    if (putFromHand !== null) {
        // CR 205.3m — a creature type; any other word is a card type or
        // supertype the filter would have to read differently.
        if (!CREATURE_SUBTYPES.has(putFromHand[1]!))
            return fail(`"${putFromHand[1]}" is not a creature type`, span);
        return ok({
            kind: "put-subtype-from-hand" as const,
            subtype: putFromHand[1]!,
        } satisfies EffectSentenceIR);
    }
    const eachPuts = span.match(EACH_PLAYER_PUTS);
    if (eachPuts !== null) {
        const types = permanentCardTypeList(eachPuts[2]!);
        if (types === null)
            return fail(
                `"${eachPuts[2]}" is not a list of permanent types`,
                span
            );
        return ok({
            kind: "each-player-puts" as const,
            from: eachPuts[3] === "graveyard" ? "graveyard" : "hand",
            types,
            optional: eachPuts[1] === "may put",
        } satisfies EffectSentenceIR);
    }

    // ── zone change (CR 400.6) ─────────────────────────────────────────────
    if (span.startsWith("Return ")) {
        // CR 400.3 — a chosen permanent of the controller's own, not an
        // announced target ("return a creature you control to its owner's hand").
        const own = span.match(RETURN_OWN_PERMANENT);
        if (own !== null) {
            const descriptor = descriptorRule.run(
                own[1]!.replace(/^an? /, ""),
                ctx
            );
            if (!descriptor.ok) return descriptor;
            if (descriptor.value.plural === true)
                return fail(`"${own[1]}" is not one permanent`, own[1]!);
            const filter = ownPermanentChoiceFilterFromDescriptor(
                descriptor.value
            );
            if (!filter.ok) return filter;
            return ok({
                kind: "return-own-permanent" as const,
                filter: filter.value,
                phrase: uncapitalise(span),
            } satisfies EffectSentenceIR);
        }
        const toAt = span.lastIndexOf(" to ");
        if (toAt === -1) return fail("a return needs a destination zone", span);
        const objectSpan = span.slice("Return ".length, toAt);
        // CR 400.3 + CR 110.1 — "Return all <permanents> to their owners'
        // hands": a sweep bounce. The destination is the PLURAL spelling of
        // "its owner's hand" and is read only behind a sweep, whose number it
        // agrees with ("Return target creature to their owners' hands" is not
        // English, so the singular subject keeps the singular zone).
        if (
            objectSpan.startsWith("all ") &&
            span.slice(toAt + " to ".length) === THEIR_OWNERS_HANDS
        ) {
            const mass = massSubjectRule.run(objectSpan, ctx);
            if (!mass.ok) return mass;
            return ok({
                kind: "move-zone" as const,
                subject: { kind: "mass" as const, ...mass.value } as SubjectIR,
                to: { zone: "hand" as const, owner: "its-owner" as const },
            } satisfies EffectSentenceIR);
        }
        if (
            objectSpan.startsWith("all ") &&
            TARGET_PLAYER_OWNS.test(objectSpan) &&
            span.slice(toAt + " to ".length) === THEIR_HAND
        ) {
            const mass = massSubjectRule.run(
                objectSpan.replace(TARGET_PLAYER_OWNS, ""),
                ctx
            );
            if (!mass.ok) return mass;
            if (mass.value.select.controller !== undefined)
                return fail("two owner clauses", span);
            return ok({
                kind: "move-zone" as const,
                subject: {
                    kind: "mass" as const,
                    ...mass.value,
                    targetPlayerControls: true as const,
                } as SubjectIR,
                to: { zone: "hand" as const, owner: "its-owner" as const },
            } satisfies EffectSentenceIR);
        }
        const subject = subjectRule.run(objectSpan, ctx);
        if (!subject.ok) return subject;
        const zone = zoneRefRule.run(span.slice(toAt + " to ".length), ctx);
        if (!zone.ok) return zone;
        return ok({
            kind: "move-zone" as const,
            subject: subject.value,
            to: zone.value,
        } satisfies EffectSentenceIR);
    }

    // ── put an announced permanent on top of its owner's library ───────────
    // CR 400.3 — "Put target creature you control on top of its owner's
    // library": the same zone change as "Return … to", spelled with "on" and
    // the library end in the destination phrase. Only the top-of-library
    // spelling is read; the subject must be a single announced object.
    if (span.startsWith("Put ")) {
        // CR 110.2a + CR 400.7 — "Put target creature card from a graveyard
        // onto the battlefield under your control" (Reanimate): the card
        // leaves ANY graveyard and the effect names its new controller.
        const reanimate = span.match(PUT_UNDER_YOUR_CONTROL);
        if (reanimate !== null) {
            const subject = subjectRule.run(reanimate[1]!, ctx);
            if (!subject.ok) return subject;
            return ok({
                kind: "move-zone" as const,
                subject: subject.value,
                to: { zone: "battlefield" as const, owner: "any" as const },
                under: "you" as const,
            } satisfies EffectSentenceIR);
        }
        const onAt = span.lastIndexOf(" on top of ");
        if (onAt !== -1) {
            const subject = subjectRule.run(
                span.slice("Put ".length, onAt),
                ctx
            );
            if (!subject.ok) return subject;
            if (subject.value.kind !== "target")
                return fail(
                    "putting on top of a library reads one announced object",
                    span
                );
            const zone = zoneRefRule.run(
                `the top of ${span.slice(onAt + " on top of ".length)}`,
                ctx
            );
            if (!zone.ok) return zone;
            return ok({
                kind: "move-zone" as const,
                subject: subject.value,
                to: zone.value,
            } satisfies EffectSentenceIR);
        }
    }

    // ── play from your graveyard, exile what would go there (CR 601.3) ────
    if (span === GRAVEYARD_PLAY)
        return ok({
            kind: "graveyard-play" as const,
        } satisfies EffectSentenceIR);
    if (span === GRAVEYARD_REDIRECT)
        return ok({
            kind: "graveyard-redirect" as const,
        } satisfies EffectSentenceIR);

    // ── that creature is exiled if it would die this turn (CR 614.1a) ─────
    if (span === EXILE_IF_DIES)
        return ok({
            kind: "exile-if-dies" as const,
        } satisfies EffectSentenceIR);

    // ── that creature is exiled after it dies this turn (CR 603.7a) ───────
    if (span === EXILE_WHEN_DIES)
        return ok({
            kind: "exile-when-dies" as const,
            subject: { kind: "that-creature" as const },
        } satisfies EffectSentenceIR);

    // ── the resolving spell exiles itself (CR 608.2n) ─────────────────────
    if (span === EXILE_SELF)
        return ok({ kind: "exile-self" as const } satisfies EffectSentenceIR);

    // ── exile until this permanent leaves (CR 610.3) ──────────────────────
    const untilLeaves = span.match(EXILE_UNTIL_LEAVES);
    if (untilLeaves !== null) {
        if (!isSelfPhrase(untilLeaves[2]!))
            return fail(
                '"until … leaves the battlefield" names a permanent other than this one',
                span
            );
        const subject = subjectRule.run(untilLeaves[1]!, ctx);
        if (!subject.ok) return subject;
        if (
            subject.value.kind !== "target" ||
            subject.value.requirement.zone !== undefined
        )
            return fail(
                "exiling until this leaves reads one announced permanent",
                span
            );
        return ok({
            kind: "exile-until-leaves" as const,
            subject: subject.value,
        } satisfies EffectSentenceIR);
    }

    // ── exile (CR 701.13a) ─────────────────────────────────────────────────
    // An announced permanent (`exile`) or a card in a graveyard (`move-zone`).
    if (span.startsWith("Exile ")) {
        // CR 404.1 — "Exile target player's graveyard": the whole pile of an
        // announced player (Tormod's Crypt). Only a target player is printed.
        const exceptBasic = span.match(EXILE_GRAVEYARD_EXCEPT_BASIC_LANDS);
        if (exceptBasic !== null) {
            const player = playerSubject(exceptBasic[1]!, ctx);
            if (player === null || player.kind !== "target")
                return fail(
                    `"${exceptBasic[1]}" is not a target player whose graveyard is exiled`,
                    span
                );
            return ok({
                kind: "exile-graveyard" as const,
                player,
                exceptBasicLands: true as const,
            } satisfies EffectSentenceIR);
        }
        const graveyard = span.match(EXILE_GRAVEYARD);
        if (graveyard !== null) {
            const player = playerSubject(graveyard[1]!, ctx);
            if (player === null || player.kind !== "target")
                return fail(
                    `"${graveyard[1]}" is not a target player whose graveyard is exiled`,
                    span
                );
            return ok({
                kind: "exile-graveyard" as const,
                player,
            } satisfies EffectSentenceIR);
        }
        const subject = subjectRule.run(span.slice("Exile ".length), ctx);
        if (!subject.ok) return subject;
        // CR 400.7e — "exile that card": the card a zone change put into a
        // graveyard; the lowering site binds it or refuses the line.
        if (subject.value.kind === "that-card")
            return ok({
                kind: "move-zone" as const,
                subject: subject.value,
                to: { zone: "exile" as const, owner: "any" as const },
            } satisfies EffectSentenceIR);
        // Only a CARD in a graveyard, never a battlefield permanent: the
        // catalogue writes the graveyard case as `moveZone`/`to: "exile"` and
        // the battlefield case as the dedicated `exile` Op, and picking one for
        // both would encode half the corpus in the wrong shape.
        if (
            subject.value.kind === "target" &&
            subject.value.requirement.zone === undefined
        )
            return ok({
                kind: "exile" as const,
                subject: subject.value,
            } satisfies EffectSentenceIR);
        if (
            subject.value.kind !== "target" ||
            subject.value.requirement.zone !== "graveyard"
        )
            return fail(
                "exiling anything but a card in a graveyard is not in grammar v0",
                span
            );
        return ok({
            kind: "move-zone" as const,
            subject: subject.value,
            to: { zone: "exile" as const, owner: "any" as const },
        } satisfies EffectSentenceIR);
    }

    // ── look at the top of a library, put it back (CR 401.4) ──────────────
    const reorder = span.match(LIBRARY_REORDER);
    if (reorder !== null) {
        const count = readAmount(reorder[1]!);
        if (count === null) return fail(`"${reorder[1]}" is not a count`, span);
        // The possessive of a player phrase: "your" is "you"'s, the rest
        // drop their "'s" ("target opponent's" → "target opponent").
        const owner =
            reorder[2] === "your" ? "you" : reorder[2]!.replace(/'s$/, "");
        const library = playerSubject(owner, ctx);
        if (library === null)
            return fail(`"${reorder[2]}" is not a library owner`, span);
        return ok({
            kind: "look-reorder" as const,
            count,
            library,
            looker: "you" as const,
        } satisfies EffectSentenceIR);
    }
    const reorderThat = span.match(LIBRARY_REORDER_THAT_PLAYER);
    if (reorderThat !== null) {
        const count = readAmount(reorderThat[1]!);
        if (count === null)
            return fail(`"${reorderThat[1]}" is not a count`, span);
        return ok({
            kind: "look-reorder" as const,
            count,
            library: { kind: "you" as const },
            looker: "that-player" as const,
        } satisfies EffectSentenceIR);
    }

    // ── keep one of each permanent type, sacrifice the rest (CR 101.4) ─────
    const keepEach = span.match(KEEP_ONE_OF_EACH_TYPE);
    if (keepEach !== null) {
        const nouns = keepEach[1]!.replace(/, and /, ", ").split(", ");
        const types = nouns.map((noun) => KEEP_TYPE_NOUNS.get(noun));
        // Exactly the four printed, in print order: a shorter list would
        // sacrifice a type the card never named a keeper for.
        if (
            types.some((type) => type === undefined) ||
            types.join() !== "Artifact,Creature,Enchantment,Land"
        )
            return fail(
                `"${keepEach[1]}" is not the artifact, creature, enchantment and land list`,
                span
            );
        return ok({
            kind: "keep-one-of-each-permanent-type" as const,
            types: types as CardType[],
        } satisfies EffectSentenceIR);
    }

    // ── keep one per category, sweep the rest (CR 101.4) ───────────────────
    if (KEEP_LAND_PER_BASIC_TYPE.test(span))
        return ok({
            kind: "choose-one-per-category" as const,
            axis: "basic-land-type" as const,
            rest: "sacrifice" as const,
        } satisfies EffectSentenceIR);
    if (KEEP_CARD_PER_COLOR.test(span))
        return ok({
            kind: "choose-one-per-category" as const,
            axis: "color" as const,
            rest: "discard-nonland" as const,
        } satisfies EffectSentenceIR);

    // ── phase out (CR 702.26b) ──────────────────────────────────────────────
    const phasesOut = span.match(PHASES_OUT);
    if (phasesOut !== null) {
        const subject = subjectRule.run(phasesOut[1]!, ctx);
        if (!subject.ok) return subject;
        if (subject.value.kind !== "target")
            return fail("only an announced target phases out", span);
        return ok({
            kind: "phase-out" as const,
            subject: subject.value,
        } satisfies EffectSentenceIR);
    }

    // ── scry (CR 701.22a) ───────────────────────────────────────────────────
    const scry = span.match(SCRY_IMPERATIVE);
    if (scry !== null) {
        const count = readAmount(scry[1]!);
        if (count === null) return fail(`"${scry[1]}" is not a count`, span);
        return ok({ kind: "scry" as const, count } satisfies EffectSentenceIR);
    }

    // ── create tokens (CR 111.1) ───────────────────────────────────────────
    if (span.startsWith("Create ")) {
        const created = createTokenRule.run(span, ctx);
        if (!created.ok) return created;
        return ok({
            kind: "create-token" as const,
            ...created.value,
        } satisfies EffectSentenceIR);
    }

    // ── mill (CR 701.17a) ───────────────────────────────────────────────────
    const millBare = span.match(MILL_IMPERATIVE);
    const millNamed = millBare === null ? span.match(MILL_PLAYER) : null;
    if (millBare !== null || millNamed !== null) {
        const subject = millNamed === null ? "you" : millNamed[1]!;
        const word = millNamed === null ? millBare![1]! : millNamed[2]!;
        const player = playerSubject(subject, ctx);
        if (player === null) return fail(`"${subject}" is not a player`, span);
        const count = readAmount(word);
        if (count === null) return fail(`"${word}" is not a count`, span);
        return ok({
            kind: "mill" as const,
            player,
            count,
        } satisfies EffectSentenceIR);
    }

    // ── "You may have that player shuffle" (CR 701.24a) ─────────────────────
    if (span === SHUFFLE_THAT_PLAYER)
        return ok({
            kind: "optional-shuffle-that-player-library" as const,
        } satisfies EffectSentenceIR);

    // ── shuffle cards from a graveyard into the library (CR 701.24a) ───────
    const shuffleBack = span.match(SHUFFLE_GRAVEYARD_BACK);
    if (shuffleBack !== null) {
        const word = shuffleBack[1]!;
        const count = readAmount(word);
        if (count === null || count.kind !== "fixed")
            return fail(`"${word}" is not a printed count`, span);
        const player = playerSubject("Target player", ctx);
        if (player === null)
            return fail('"Target player" is not a player', span);
        return ok({
            kind: "shuffle-graveyard-into-library" as const,
            player,
            word,
            max: count.value,
        } satisfies EffectSentenceIR);
    }

    // ── put cards from the hand on top of the library (CR 401.4) ───────────
    const putBackPlayer = span.match(PUT_BACK_PLAYER);
    const drawPutBack =
        putBackPlayer === null ? span.match(DRAW_PUT_BACK) : null;
    if (putBackPlayer !== null || drawPutBack !== null) {
        const word =
            putBackPlayer !== null ? putBackPlayer[2]! : drawPutBack![2]!;
        const order =
            putBackPlayer !== null ? putBackPlayer[3] : drawPutBack![3];
        const count = readAmount(word);
        if (count === null || count.kind !== "fixed")
            return fail(`"${word}" is not a printed count`, span);
        // "in any order" is printed exactly when there is an order to choose.
        if ((order !== undefined) !== count.value > 1)
            return fail("the order clause disagrees with the count", span);
        if (drawPutBack !== null) {
            const draw = readAmount(drawPutBack[1]!);
            if (draw === null) return fail("a draw needs a count", span);
            return ok({
                kind: "draw-put-back" as const,
                draw,
                count: count.value,
            } satisfies EffectSentenceIR);
        }
        const player = playerSubject(putBackPlayer![1]!, ctx);
        if (player === null)
            return fail(`"${putBackPlayer![1]}" is not a player`, span);
        return ok({
            kind: "put-back" as const,
            player,
            count: count.value,
        } satisfies EffectSentenceIR);
    }

    // ── shuffle the resolving spell into its owner's library (CR 701.24a) ──
    if (span === SHUFFLE_SELF) {
        return ok({
            kind: "shuffle-self-into-library" as const,
        } satisfies EffectSentenceIR);
    }

    // ── explore (CR 701.44a) ───────────────────────────────────────────────
    const explore = span.match(EXPLORE);
    if (explore !== null) {
        const subject = subjectRule.run(explore[1]!, ctx);
        if (!subject.ok) return subject;
        return ok({
            kind: "explore" as const,
            subject: subject.value,
        } satisfies EffectSentenceIR);
    }

    // ── delayed draw at the next upkeep (CR 603.7a) ────────────────────────
    const delayedDraw = span.match(DELAYED_DRAW_NEXT_UPKEEP);
    if (delayedDraw !== null) {
        // The imperative "Draw a card at …" (Portent) is the same delayed
        // trigger as "You draw a card at …" — the controller draws either way.
        const printed = delayedDraw[1] ?? delayedDraw[2]!;
        const count = readAmount(printed);
        if (count === null) return fail(`"${printed}" is not a count`, span);
        return ok({
            kind: "delayed-draw-next-upkeep" as const,
            count,
        } satisfies EffectSentenceIR);
    }

    // ── private look at a hand (CR 400.2) ──────────────────────────────────
    const lookRandom = span.match(LOOK_RANDOM_HAND);
    if (lookRandom !== null) {
        const player = playerSubject(lookRandom[1]!, ctx);
        if (player === null)
            return fail(`"${lookRandom[1]}" is not a player`, span);
        return ok({
            kind: "look-random-hand" as const,
            player,
        } satisfies EffectSentenceIR);
    }
    const look = span.match(LOOK_HAND);
    if (look !== null) {
        const player = playerSubject(look[1]!, ctx);
        if (player === null) return fail(`"${look[1]}" is not a player`, span);
        return ok({
            kind: "look-hand" as const,
            player,
        } satisfies EffectSentenceIR);
    }

    // ── discard at random (CR 701.9a) ──────────────────────────────────────
    const discard = span.match(DISCARD_RANDOM);
    if (discard !== null) {
        const player = playerSubject(discard[1]!, ctx);
        if (player === null)
            return fail(`"${discard[1]}" is not a player`, span);
        const count = readAmount(discard[2]!);
        if (count === null) return fail(`"${discard[2]}" is not a count`, span);
        return ok({
            kind: "discard-at-random" as const,
            player,
            count,
        } satisfies EffectSentenceIR);
    }

    // ── discard, the player's choice (CR 701.9b) ───────────────────────────
    // The imperative is the controller's own discard; only the one-card form
    // is printed as a sentence of its own.
    if (span === DISCARD_SELF)
        return ok({
            kind: "discard" as const,
            player: { kind: "you" as const },
            count: { kind: "fixed" as const, value: 1 },
        } satisfies EffectSentenceIR);
    const chosen = span.match(DISCARD_CHOICE);
    if (chosen !== null) {
        const player = playerSubject(chosen[1]!, ctx);
        if (player === null)
            return fail(`"${chosen[1]}" is not a player`, span);
        const count = readAmount(chosen[2]!);
        if (count === null) return fail(`"${chosen[2]}" is not a count`, span);
        return ok({
            kind: "discard" as const,
            player,
            count,
        } satisfies EffectSentenceIR);
    }

    // ── sacrifice it unless you pay (CR 118.12a) ───────────────────────────
    const unlessAt = span.indexOf(SACRIFICE_UNLESS);
    if (unlessAt !== -1 && uncapitalise(span).startsWith("sacrifice ")) {
        const subject = subjectRule.run(
            span.slice("Sacrifice ".length, unlessAt),
            ctx
        );
        if (!subject.ok) return fail(subject.reason, span);
        // Only the source (or the site's pronoun for it) is sacrificed unless
        // paid for; "sacrifice target creature unless …" is not a printed form.
        if (subject.value.kind !== "self" && subject.value.kind !== "pronoun")
            return fail("only the source is sacrificed unless paid for", span);
        const payment = readUnlessPayment(
            span.slice(unlessAt + SACRIFICE_UNLESS.length),
            ctx
        );
        // The refusal names the WHOLE sentence, not the payment: the gap key
        // is the sentence's, so a refused payment stays under the key its
        // backlog issue already claims.
        if (!payment.ok) return fail(payment.reason, span);
        return ok({
            kind: "sacrifice-unless" as const,
            subject: subject.value,
            payment: payment.value,
        } satisfies EffectSentenceIR);
    }

    // ── tap the player's own untapped permanents, one per counter (CR 701.26a)
    const tapPer = span.match(TAP_CHOSEN_PER_COUNTER);
    if (tapPer !== null) {
        const player = playerSubject(tapPer[1]!, ctx);
        if (player === null)
            return fail(`"${tapPer[1]}" is not a player`, span);
        const source = subjectRule.run(`this ${tapPer[4]}`, ctx);
        if (!source.ok || source.value.kind !== "self")
            return fail(`"this ${tapPer[4]}" is not the source`, span);
        const descriptor = descriptorRule.run(tapPer[2]!, ctx);
        if (!descriptor.ok) return descriptor;
        // "an untapped creatures" disagrees in number: one permanent per counter.
        if (descriptor.value.plural === true)
            return fail(`"${tapPer[2]}" disagrees in number`, tapPer[2]!);
        const filter = sacrificeFilterFromDescriptor(
            descriptor.value,
            COLOR_ALTERNATIVES.test(tapPer[2]!)
        );
        if (!filter.ok) return filter;
        return ok({
            kind: "tap-chosen-per-counter" as const,
            player,
            filter: { ...filter.value, tapped: false },
            counterType: tapPer[3]!,
            phrase: `an untapped ${tapPer[2]}`,
        } satisfies EffectSentenceIR);
    }

    // ── sacrifice, the player's choice (CR 701.21a) ────────────────────────
    // The imperative is the controller's own edict, its size the amount the
    // head carried ("that many" — the damage dealt, CR 120.3).
    if (SACRIFICE_THAT_MANY.test(span))
        return ok({
            kind: "sacrifice" as const,
            player: { kind: "you" as const },
            count: { kind: "event-amount" as const },
            filter: {},
            phrase: "that many permanents",
        } satisfies EffectSentenceIR);
    const edict = span.match(SACRIFICE_EDICT);
    if (edict !== null) {
        const player = playerSubject(edict[1]!, ctx);
        if (player === null) return fail(`"${edict[1]}" is not a player`, span);
        const count = readNumberWord(edict[2]!);
        if (count === null) return fail(`"${edict[2]}" is not a count`, span);
        const tail = SUPERLATIVE_TAIL.exec(edict[3]!);
        const descriptor = descriptorRule.run(
            tail === null ? edict[3]! : tail[1]!,
            ctx
        );
        if (!descriptor.ok) return descriptor;
        // The noun's number is the count's: "a creature", "two creatures".
        if ((descriptor.value.plural === true) !== (count !== 1))
            return fail(
                `"${edict[2]} ${edict[3]}" disagrees in number`,
                edict[3]!
            );
        const filter = sacrificeFilterFromDescriptor(
            descriptor.value,
            COLOR_ALTERNATIVES.test(edict[3]!)
        );
        if (!filter.ok) return filter;
        let superlative: EffectChoiceSuperlative | undefined;
        if (tail !== null) {
            // "two creatures with the greatest power" ranks each pick, not the
            // pool once — no encoding, so refused rather than read as one.
            if (count !== 1)
                return fail("a superlative selects ONE permanent", edict[2]!);
            const read = superlativeFromClause(
                tail[2]!,
                tail[3]!,
                tail[4]!,
                filter.value,
                ctx
            );
            if (!read.ok) return read;
            superlative = read.value;
        }
        return ok({
            kind: "sacrifice" as const,
            player,
            count: { kind: "fixed" as const, value: count },
            filter: filter.value,
            ...(superlative === undefined ? {} : { superlative }),
            phrase: `${edict[2]} ${edict[3]}`,
        } satisfies EffectSentenceIR);
    }

    // ── sacrifice the source itself (CR 701.21a) ───────────────────────────
    // "Sacrifice this enchantment": no choice, the source is the permanent.
    if (uncapitalise(span).startsWith("sacrifice ")) {
        const subject = subjectRule.run(span.slice("Sacrifice ".length), ctx);
        if (
            subject.ok &&
            (subject.value.kind === "self" || subject.value.kind === "pronoun")
        )
            return ok({
                kind: "sacrifice-source" as const,
                subject: subject.value,
            } satisfies EffectSentenceIR);
    }

    return fail("not an effect sentence this grammar knows", span);
}
