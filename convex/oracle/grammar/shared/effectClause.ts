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

import type { EffectCardFilter, TargetRequirement } from "../../../cards/types";
import type { KeywordIR } from "../ir";
import type { CardType } from "../../../cards/types";
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
import { durationRule, type DurationIR } from "./duration";
import { playerRefRule, type PlayerRefIR } from "./playerRef";
import { countedSetRule, readNumberWord, type CountedSetIR } from "./quantity";
import { isSelfPhrase } from "./cost";
import { SELF_MARKER } from "../../normalize";
import {
    controlsRule,
    kickedConditionRule,
    kickedPermanentConditionRule,
    type ConditionIR,
    type KickedRefIR,
} from "./condition";
import {
    controlledPluralRule,
    massSubjectRule,
    type MassSubjectIR,
} from "./massSubject";
import {
    descriptorRule,
    dividedTargetsRule,
    opensTargetPhrase,
    sacrificeFilterFromDescriptor,
    targetFilterRule,
} from "./targetFilter";
import { zoneRefRule, type ZoneRefIR } from "./zoneRef";
import { BASIC_LAND_SUBTYPE_ORDER, CREATURE_SUBTYPES } from "./subtypes";
import { createTokenRule, type CreateTokenIR } from "./tokenSpec";

export const EFFECT_CLAUSE = "effect clause";

/** CR 115.3 — the head that marks an announcement as excluding an earlier one. */
const ANOTHER_HEAD = "another target ";

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
     * CR 202.3 + CR 608.2h — "its mana value" / "that card's mana value" /
     * "that permanent's mana value": the object the sentence BEFORE acted on.
     * Read here as words; bound by the lowering to the announced object that
     * sentence recorded, and refused by a site whose earlier sentences acted
     * on none.
     *
     * The head NOUN is kept rather than folded away because it constrains
     * which antecedent the phrase may name: "that permanent" is printed only
     * where the earlier sentence acted on a permanent (CR 110.4a), and reading
     * it off a card in a graveyard or a hand would be an object the sentence
     * never pointed at. The lowering does that check — only it can see the
     * recorded requirement.
     */
    | {
          readonly kind: "acted-on-mana-value";
          readonly noun: ActedOnNounIR;
      };

/**
 * CR 202.3 — the head noun of "<phrase> mana value": the pronoun, a card, or a
 * permanent. Three printed words, three different antecedents, so the noun
 * travels to the lowering instead of being swallowed by the pattern.
 */
export type ActedOnNounIR = "it" | "card" | "permanent";

/** The three possessive phrases, printed exactly (CR 202.3 + CR 608.2h). */
const ACTED_ON_NOUNS: ReadonlyMap<string, ActedOnNounIR> = new Map([
    ["its", "it"],
    ["that card's", "card"],
    ["that permanent's", "permanent"],
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

/** `"its"` / `"that card's"` / `"that permanent's"` → the amount it names. */
function readActedOnManaValue(possessive: string): AmountIR | null {
    const noun = ACTED_ON_NOUNS.get(possessive);
    return noun === undefined ? null : { kind: "acted-on-mana-value", noun };
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
    | ({ readonly kind: "mass" } & MassSubjectIR);

/**
 * CR 118.12a — the price a counter's controller may be made to pay to keep
 * their spell on the stack ("… unless its controller pays <tax>").
 *
 * ONE form today: the per-tally generic tax "{N} for each <tally>", whose only
 * tally this grammar reads is CR 207.2c's Domain ("each basic land type among
 * lands you control"). A FLAT tax ("… unless its controller pays {3}", Mana
 * Leak) is a different price in a different `mayPay` cost leg — a literal
 * `ManaCost` rather than `genericEqualTo` — so it is neither read here nor
 * evidenced by this form's fixture, and stays refused under its own gap key.
 */
export type CounterTaxIR = {
    readonly kind: "per-domain";
};

export type EffectSentenceIR =
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
          readonly kind: "draw";
          readonly player: PlayerRefIR;
          readonly count: AmountIR;
      }
    | {
          readonly kind: "destroy";
          readonly subject: SubjectIR;
          readonly cantBeRegenerated: boolean;
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
      }
    | {
          readonly kind: "tap-untap";
          readonly action: "tap" | "untap";
          readonly subject: SubjectIR;
      }
    | { readonly kind: "regenerate"; readonly subject: SubjectIR }
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
          readonly kind: "discard-at-random";
          readonly player: PlayerRefIR;
          readonly count: AmountIR;
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
          readonly count: number;
          readonly filter: EffectCardFilter;
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
      };

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
    | { readonly kind: "any-player" };

/** A sentence that modifies the sentence before it rather than acting itself. */
export type ModifierIR =
    | { readonly kind: "cant-be-regenerated" }
    /** CR 205.1b — "They're still lands.": the animated set keeps its types. */
    | { readonly kind: "still-types"; readonly types: readonly CardType[] };

export type SentenceIR =
    | { readonly role: "effect"; readonly effect: EffectSentenceIR }
    | { readonly role: "restriction"; readonly restriction: RestrictionIR }
    | { readonly role: "modifier"; readonly modifier: ModifierIR }
    /** The window half of a `look-distribute` (see there). */
    | {
          readonly role: "library-look";
          readonly reveal: boolean;
          readonly count: AmountIR;
      }
    /** CR 401.4 — the routing half of a `look-distribute` (see there). */
    | { readonly role: "library-route"; readonly route: LibraryRouteIR }
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
      };

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
    for (const sentence of sentences) {
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
        if (sentence.role === "modifier") {
            const previous = effects[effects.length - 1];
            if (previous === undefined || previous.kind !== "destroy")
                return {
                    ok: false,
                    reason: '"It can\'t be regenerated." follows no destroy',
                };
            // CR 701.19c — "It" names ONE destroyed object. Behind a sweep the
            // pronoun has no single referent, so folding it onto the sweep
            // would forbid regeneration for a set the sentence never named.
            if (previous.subject.kind === "mass")
                return {
                    ok: false,
                    reason: '"It can\'t be regenerated." follows a sweep, not one object',
                };
            effects[effects.length - 1] = {
                ...previous,
                cantBeRegenerated: true,
            };
            continue;
        }
        effects.push(sentence.effect);
    }
    if (window !== null)
        return {
            ok: false,
            reason: "a library look is not followed by where its cards go",
        };
    if (effects.length === 0)
        return { ok: false, reason: `the ${opts.site} has no effect sentence` };
    return { ok: true, effects, restrictions };
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
        if (!probe.startsWith(MAY_PREFIX)) return inner.run(span, ctx);
        const clause = probe.slice(MAY_PREFIX.length);
        const parsed = inner.run(clause, ctx);
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
/** CR 205.1b — "All lands you control become 1/1 creatures until end of turn". */
const ANIMATE = /^(.+) become (\d+)\/(\d+) creatures (.+)$/;
/** CR 205.1b — the rider that keeps the animated set's types. */
const STILL_TYPES = /^They(?:'|’)re still (.+)$/;
const DAMAGE = /^(.+) deals (\S+) damage to (.+)$/;
/** CR 601.2d — "deals N damage divided as you choose among <targets>". */
const DAMAGE_DIVIDED =
    /^(.+) deals (\S+) damage divided as you choose among (.+)$/;
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
const LIFE = /^(.+) (gain|gains|lose|loses) (\S+|that much) life$/;
/**
 * CR 107.1 — "<player> gains/loses N life for each <set>". The multiplier is a
 * printed number: "X life for each …" is a product of two variables this
 * grammar does not read.
 */
const LIFE_FOR_EACH = /^(.+) (gain|gains|lose|loses) (\S+) life (for each .+)$/;
/** CR 202.3 — "You lose life equal to its mana value" (or "that card's", or
 *  "that permanent's" — Feed the Swarm). */
const LIFE_EQUAL_MANA_VALUE = new RegExp(
    `^(.+) (lose|loses) life equal to ${actedOnNounGroup(["it", "card", "permanent"])} mana value$`
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
 * CR 608.2c — a drain: "Target player loses 2 life and you gain 2 life". The
 * loss reads through `LIFE` like any other, and the gain is pinned to exactly
 * "you gain N life" (anti-leniency, as `YOU_DRAW_AND_LOSE_LIFE`): every other
 * second half stays refused until a corpus card prints it.
 */
const DRAIN = /^(.+) loses (\S+) life and (you gain \S+ life)$/;
const COUNTERS = /^Put (\S+) (\S+) counters? on (.+)$/;
const DISCARD_RANDOM = /^(.+) discards (\S+) cards? at random$/;
/** CR 701.9b — "Target player discards two cards": the player's own choice. */
const DISCARD_CHOICE = /^(.+) discards (\S+) cards?$/;
/**
 * CR 701.21a — "Target player sacrifices a creature of their choice": the
 * count word and the permanent phrase, "of their choice" optional. Anything
 * after the phrase ("with flying", "for each …", ", then …") stays inside
 * the phrase, where the descriptor reader refuses it.
 */
const SACRIFICE_EDICT = /^(.+?) sacrifices (\S+) (.+?)(?: of their choice)?$/;
/**
 * CR 608.2c — "You draw a card and you lose 1 life": a draw, then a life
 * loss, each with the explicit "you" the Oracle text prints. Anchored at both
 * ends and pinned to exactly these two verbs: every other conjunction stays
 * refused until a corpus card prints it (ADR 0137 anti-leniency).
 */
const YOU_DRAW_AND_LOSE_LIFE =
    /^You (draw \S+ cards?) and (you lose \S+ life)$/;
/**
 * CR 608.2c — "You draw a card and that opponent discards a card": a draw by
 * the controller, then a discard by the player the head named. Pinned to
 * exactly this pair, like the conjunction above: a different second subject or
 * verb stays refused until a corpus card prints it.
 */
const YOU_DRAW_AND_THAT_OPPONENT_DISCARDS =
    /^You (draw \S+ cards?) and (that opponent discards \S+ cards?)$/;
/** CR 121.1 + CR 701.9a — "Draw a card, then discard a card". */
const LOOT = /^Draw (\S+) cards?, then discard (\S+) cards?$/;
/** CR 608.2c — "If you control <A> and <B>, <body> instead" (either order). */
const INSTEAD = /^If (you control .+?), (?:instead (.+)|(.+) instead)$/;

/** The window: "Look at [or Reveal] the top four cards of your library". */
const LIBRARY_LOOK = /^(Look at|Reveal) the top (\S+) cards of your library$/;
/** CR 401.4 — the one-sentence reorder, looked at by "you". */
const LIBRARY_REORDER =
    /^Look at the top (\S+) cards of (your|target player's|target opponent's) library, then put them back in any order$/;
/** CR 401.4 — the same reorder, looked at by the previous sentence's player. */
const LIBRARY_REORDER_THAT_PLAYER =
    /^That player looks at the top (\S+) cards of your library, then puts them back in any order$/;
/** The routing half, every matching card: "Put all Goblin cards revealed …". */
const ROUTE_ALL_OF_SUBTYPE =
    /^Put all (\S+) cards revealed this way into your hand and the rest on the bottom of your library in any order$/;
/** The routing half, a pick: "Put one of them into your hand and the rest …". */
const ROUTE_TAKE =
    /^Put (\S+) of (?:them|those cards) into your hand and the rest (on the bottom of your library in any order|on the bottom of your library in a random order|into your graveyard)$/;

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

/** CR 615.12 — the printed sentence, whole, without its full stop. */
const SUPPRESS_DAMAGE_PREVENTION = "Damage can't be prevented this turn";

const KEYWORDS = keywordVocabulary();

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
]);

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
function withoutAbilityWord(span: string): string {
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
        const restriction = RESTRICTIONS.get(span.toLowerCase());
        if (restriction !== undefined)
            return ok({ role: "restriction" as const, restriction });
        if (span === "It can't be regenerated")
            return ok({
                role: "modifier" as const,
                modifier: { kind: "cant-be-regenerated" as const },
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

        if (INSTEAD.test(span)) return insteadRule.run(span, ctx);

        const library = libraryHalf(span);
        if (library !== null) return library;

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

const KICKED_INSTEAD = /^If it was kicked, (.+) instead$/;

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

function effectSentence(
    span: string,
    ctx: unknown
): RuleResult<EffectSentenceIR> {
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
            : subjectRule.run(pump[1]!, ctx);
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
        const duration = durationRule.run(tail, ctx);
        if (!duration.ok) return duration;
        return ok({
            kind: "pump" as const,
            subject: subject.value,
            power,
            toughness,
            duration: duration.value,
            ...(perDomain ? { perDomain: true as const } : {}),
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

    // ── grant a keyword (CR 613.1f, layer 6) ───────────────────────────────
    const gainsAt = span.indexOf(" gains ");
    if (
        gainsAt !== -1 &&
        !LIFE.test(span) &&
        !LIFE_FOR_EACH.test(span) &&
        !DRAIN.test(span)
    ) {
        const subject = subjectRule.run(span.slice(0, gainsAt), ctx);
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
        const amount = readActedOnManaValue(damageMv[2]!);
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
        const to = subjectRule.run(damage[3]!, ctx);
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

    // ── draw, and lose life / and the opponent discards (CR 608.2c) ────────
    const drawAnd =
        span.match(YOU_DRAW_AND_LOSE_LIFE) ??
        span.match(YOU_DRAW_AND_THAT_OPPONENT_DISCARDS);
    if (drawAnd !== null) {
        const draw = effectSentence(capitalise(drawAnd[1]!), ctx);
        if (!draw.ok) return draw;
        const second = effectSentence(capitalise(drawAnd[2]!), ctx);
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
    if (span.startsWith("Destroy ")) {
        const subject = sweepableSubject(span.slice("Destroy ".length), ctx);
        if (!subject.ok) return subject;
        return ok({
            kind: "destroy" as const,
            subject: subject.value,
            cantBeRegenerated: false,
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
    if (counter.startsWith(COUNTER_VERB)) {
        const rest = counter.slice(COUNTER_VERB.length);
        // CR 118.12a — the punisher clause, when there is one. Split before
        // the subject is read so the subject rule sees a target phrase and
        // not a target phrase with a cost glued to it.
        const taxAt = rest.indexOf(UNLESS_PAYS);
        const subject = subjectRule.run(
            taxAt === -1 ? rest : rest.slice(0, taxAt),
            ctx
        );
        if (!subject.ok) return subject;
        // CR 701.6a — only a SPELL is countered by this rule. An ability
        // ("counter target activated or triggered ability") is countered by
        // the same keyword action on a different object, which the `counter`
        // Op does not reach; a sweep announces nothing to point at.
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
        const subject = sweepableSubject(span.slice(verb.length), ctx);
        if (!subject.ok) return subject;
        return ok({
            kind: "tap-untap" as const,
            action,
            subject: subject.value,
        } satisfies EffectSentenceIR);
    }

    // ── regenerate (CR 701.19a) ────────────────────────────────────────────
    if (span.startsWith("Regenerate ")) {
        const subject = subjectRule.run(span.slice("Regenerate ".length), ctx);
        if (!subject.ok) return subject;
        return ok({
            kind: "regenerate" as const,
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

    // ── life equal to the acted-on object's mana value (CR 202.3) ──────────
    const lifeMv = span.match(LIFE_EQUAL_MANA_VALUE);
    if (lifeMv !== null) {
        const player = playerSubject(lifeMv[1]!, ctx);
        if (player === null)
            return fail(`"${lifeMv[1]}" is not a player`, span);
        const amount = readActedOnManaValue(lifeMv[3]!);
        if (amount === null)
            return fail(`"${lifeMv[3]}" names no acted-on object`, span);
        return ok({
            kind: "life" as const,
            action: "lose" as const,
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

    // ── zone change (CR 400.6) ─────────────────────────────────────────────
    if (span.startsWith("Return ")) {
        const toAt = span.lastIndexOf(" to ");
        if (toAt === -1) return fail("a return needs a destination zone", span);
        const subject = subjectRule.run(
            span.slice("Return ".length, toAt),
            ctx
        );
        if (!subject.ok) return subject;
        const zone = zoneRefRule.run(span.slice(toAt + " to ".length), ctx);
        if (!zone.ok) return zone;
        return ok({
            kind: "move-zone" as const,
            subject: subject.value,
            to: zone.value,
        } satisfies EffectSentenceIR);
    }

    // ── exile a card from a graveyard (CR 701.13a) ─────────────────────────
    if (span.startsWith("Exile ")) {
        const subject = subjectRule.run(span.slice("Exile ".length), ctx);
        if (!subject.ok) return subject;
        // Only a CARD in a graveyard, never a battlefield permanent: the
        // catalogue writes the graveyard case as `moveZone`/`to: "exile"` and
        // the battlefield case as the dedicated `exile` Op, and picking one for
        // both would encode half the corpus in the wrong shape.
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

    // ── create tokens (CR 111.1) ───────────────────────────────────────────
    if (span.startsWith("Create ")) {
        const created = createTokenRule.run(span, ctx);
        if (!created.ok) return created;
        return ok({
            kind: "create-token" as const,
            ...created.value,
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

    // ── sacrifice, the player's choice (CR 701.21a) ────────────────────────
    const edict = span.match(SACRIFICE_EDICT);
    if (edict !== null) {
        const player = playerSubject(edict[1]!, ctx);
        if (player === null) return fail(`"${edict[1]}" is not a player`, span);
        const count = readNumberWord(edict[2]!);
        if (count === null) return fail(`"${edict[2]}" is not a count`, span);
        const descriptor = descriptorRule.run(edict[3]!, ctx);
        if (!descriptor.ok) return descriptor;
        // The noun's number is the count's: "a creature", "two creatures".
        if ((descriptor.value.plural === true) !== (count !== 1))
            return fail(
                `"${edict[2]} ${edict[3]}" disagrees in number`,
                edict[3]!
            );
        const filter = sacrificeFilterFromDescriptor(descriptor.value);
        if (!filter.ok) return filter;
        return ok({
            kind: "sacrifice" as const,
            player,
            count,
            filter: filter.value,
            phrase: `${edict[2]} ${edict[3]}`,
        } satisfies EffectSentenceIR);
    }

    return fail("not an effect sentence this grammar knows", span);
}
