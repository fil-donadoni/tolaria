/**
 * The static-clause sub-grammar (CR 113.3d, CR 604.1) — issue #2700.
 *
 * A static ability "is simply true" while its source is on the battlefield: it
 * has no trigger event, no cost and no resolution, so unlike every other slot
 * there is no shared skeleton to hang the reading on. What there IS instead is
 * a small set of SENTENCE FRAMES, each of which lowers to exactly one engine
 * encoding, and each of which is written here as its own rule:
 *
 *   "<plural descriptor> get +N/+N"                 → layer 7c `pt-buff`
 *   "<plural descriptor> have <keyword>"            → layer 6 `keyword-grant`
 *   "<spells> cost {N} more/less to cast"           → CR 601.2f `cost-modifier`
 *   "Each spell costs {N} more to cast except during its controller's turn"
 *                                                   → the same, turn-gated
 *   "Activated abilities of <permanents> cost {N} more to activate"
 *                                                   → CR 602.2b `cost-modifier`
 *   "Creatures can't attack you unless their controller pays {N} for each
 *    creature they control that's attacking you"   → CR 508.1d `attack-mana-tax`
 *   "<self> enters tapped[ with N <kind> counters on it]"
 *                                                   → CR 614.1c entry riders
 *   "If <self> was kicked, it enters with N <kind> counters on it",
 *   "<self> enters with N <kind> counters on it for each time it was kicked"
 *                                                   → kicker-counted riders
 *   "<self> doesn't untap during your untap step"   → the `does-not-untap` marker
 *   "Skip your draw step"                          → CR 614.10 `drawStepReplacement`
 *   "If <self> would be put into a graveyard from anywhere, reveal <self>
 *    and shuffle it into its owner's library instead"
 *                                                   → CR 614.1a `shuffleFromAnywhere`
 *   "If damage would be dealt to <self>, prevent that damage. Remove a
 *    +1/+1 counter from <self>"                     → CR 615 `damagePreventionCounterRemoval`
 *   "<grantee> may cast <class> spells [without paying
 *    their mana costs] [as though they had flash]"  → CR 601.3 `cast-permission`
 *   "While an opponent is choosing targets as part of casting a spell they
 *    control or activating an ability they control, that player must choose
 *    at least one Flagbearer on the battlefield if able"
 *                                                   → CR 601.2c `target-choice-requirement`
 *
 * The frames are combined with `oneOf`, never a cascade: they are told apart by
 * a verb in the middle of the line rather than by a first word, so "first rule
 * that matches" would be a genuine coin flip rather than a harmless one, and
 * `oneOf` turns a line two frames both accept into a failed card instead of an
 * arbitrary reading (`rule.ts`).
 *
 * ── What v1 refuses, and why each refusal is the point ────────────────────
 *
 * CONDITIONAL statics ("… as long as …", CR 611.3a) are refused whole, with
 * ONE exception: "<self> gets +N/+N as long as you control a <descriptor>"
 * (issue #4126), and its opponent twin "… as long as an opponent controls a
 * <descriptor>" (issue #4565). The condition is not a second vocabulary — it
 * IS the `controls` condition a trigger's intervening-if carries, read by the
 * shared `controlsRule` / `opponentControlsRule`, and the descriptor rebuilds
 * it into `StaticPTBuff.condition`. Every other "as long as" tail ("it's
 * untapped", "you have …") still fails the line.
 *
 * ENCHANTED-scope statics are read by their own frames (issue #3833), now
 * that an Aura's "Enchant <filter>" line parses (issue #3825):
 *
 *   "Enchanted <noun> gets +N/+N[ and <rest>]"      → layer 7c, host scope
 *   "Enchanted <noun> has <keyword>[, …, and <kw>]" → layer 6, host scope
 *   'Enchanted <noun> has "<activated ability>"'    → layer 6 `activated-grant`
 *   "Enchanted <noun> can't attack[ or block]"      → CR 508.1c / 509.1b
 *   "You control enchanted <noun>"                  → layer 2 `control-change`
 *
 * "Enchanted" names ONE object — the Aura's host (CR 303.4b) — so these
 * frames carry no filter at all; the scope is an identity, and it is lowered
 * to the `AURA_AFFECTS_HOST` predicate every hand-written Aura declares. That
 * the card IS an Aura is a card-level fact, checked in `lower.ts` against the
 * enchant line, not here. EQUIPPED-scope ("Equipped creature gets +2/+0") is
 * still refused: no "Equip" line parses yet.
 *
 * SINGULAR "gets" with any OTHER subject is refused: essentially every printed
 * "<x> gets +N/+N." with a singular subject is either attached-scope or
 * carries an "as long as" clause, so a rule for it would exist to accept the
 * half of a sentence it understood.
 */

import { readNumberWord } from "./quantity";
import { isSelfPhrase } from "./cost";
import {
    abilityLossPtSetRule,
    animateManaValueRule,
    chosenTypePumpRule,
    selfPtCdaGraveyardsRule,
    selfPtCdaExiledTotalsRule,
    type CharacteristicStaticIR,
} from "./characteristicStatic";
import {
    controlsRule,
    graveyardCountRule,
    opponentControlsRule,
    type ConditionIR,
    type StaticConditionIR,
} from "./condition";
import {
    assembleSentences,
    capitalise,
    sentenceRule,
    signedModifier,
    uncapitalise,
    type EffectSentenceIR,
} from "./effectClause";
import {
    COLOR_WORDS,
    descriptorRule,
    staticFilterFromDescriptor,
    type DescriptorIR,
    type StaticFilterEvaluation,
} from "./targetFilter";
import { keywordVocabulary } from "./keywordVocabulary";
import { registerQuotedAbilityReader } from "./quotedAbilityReader";
import type { KeywordIR, SlotIR } from "../ir";
import { activatedSlot } from "../slots/activated";
import { manaAbilitySlot } from "../slots/manaAbility";
import { triggeredSlot } from "../slots/triggered";
import type { ParseContext } from "../../types";
import type { CardType, ManaCost } from "../../../cards/types";
import { readManaCost } from "../../manaCost";
import type { CompiledSpellFilter } from "../../../cards/compiledStatics";
import type { EffectCardFilter, PermanentFilter } from "../../../cards/types";
import {
    fail,
    ok,
    oneOf,
    pattern,
    rule,
    type Rule,
    type RuleResult,
    subGrammar,
} from "../../rule";

export const STATIC_CLAUSE = "static clause";

/**
 * What one static line means.
 *
 * Two members carry an engine-side `PermanentFilter` rather than a
 * `DescriptorIR`: the descriptor → filter conversion is where a phrase the
 * static site cannot honour is REFUSED (`staticFilterFromDescriptor`), and
 * doing it at parse time is what makes "we read the line" and "we can encode
 * it" one answer instead of a parse that lowering later has to walk back.
 */
export type StaticClauseIR =
    /** CR 613 — the frames that SET a characteristic (`characteristicStatic.ts`). */
    | CharacteristicStaticIR
    /** CR 613.4c layer 7c — an anthem or a tribal lord. */
    | {
          readonly kind: "pt-buff";
          readonly filter: PermanentFilter;
          readonly power: number;
          readonly toughness: number;
      }
    /** CR 613.1f layer 6 — a keyword granted to a matching set. */
    | {
          readonly kind: "keyword-grant";
          readonly filter: PermanentFilter;
          readonly keyword: KeywordIR;
      }
    /**
     * CR 612.6 + CR 613.1c — "As long as the top card of your graveyard is a
     * creature card, <self> has the full text of that card and has the text
     * "<ability>"": a layer-3 full-text effect, with the quoted ability kept.
     */
    | {
          readonly kind: "full-text-effect";
          readonly from: "controller-graveyard-top";
          readonly requiresType: "Creature";
          /** The quoted ability's Oracle text, resolved to an id in `lower.ts`. */
          readonly retainedAbilityText: string;
      }
    /**
     * CR 113.6b + CR 611.3a — "As long as <self> is in your graveyard and you
     * control a <descriptor>, <filter> have <keyword>": a keyword grant whose
     * source functions from its owner's graveyard, gated on a controls count.
     */
    | {
          readonly kind: "graveyard-keyword-grant";
          readonly filter: PermanentFilter;
          readonly keyword: KeywordIR;
          readonly condition: ConditionIR;
      }
    /** CR 601.2f — a cost modifier on a class of spells, or (CR 602.2b) on
     *  the activated abilities of a class of permanents. */
    | ({
          readonly kind: "cost-modifier";
          readonly direction: "more" | "less";
          readonly amount: number;
          /** CR 601.2f — "except during its controller's turn". */
          readonly onlyOutsideAnnouncersTurn?: true;
      } & (
          | {
                readonly spells: CompiledSpellFilter;
                readonly abilities?: never;
            }
          | {
                readonly abilities: PermanentFilter;
                readonly spells?: never;
            }
      ))
    /** CR 508.1d / 508.1h — a per-attacker mana cost to attack you. */
    | {
          readonly kind: "attack-mana-tax";
          readonly attackers: PermanentFilter;
          readonly perAttacker: number;
      }
    /** CR 508.1c — a flat prohibition: matching creatures can't attack you. */
    | {
          readonly kind: "attack-prohibition";
          readonly attackers: PermanentFilter;
      }
    /** CR 602.5 / 605.1a — "Activated abilities of creatures can't be
     *  activated": every creature's activated abilities, mana abilities
     *  included, are locked while the source is on the battlefield. */
    | { readonly kind: "creature-activation-lock" }
    /** CR 601.3 / 118.9 — a board permission to cast a CLASS of spells. */
    | {
          readonly kind: "cast-permission";
          readonly grantee: "any-player" | "controller";
          readonly filter: EffectCardFilter;
          readonly withoutPayingManaCost?: true;
          readonly asThoughFlash?: true;
      }
    /** CR 614.1c / 122.1 — "<self> enters with N <kind> counters on it":
     *  the entry replacement with no other rider (Gemstone Mine). */
    | {
          readonly kind: "enters-with-counters";
          readonly counters: { readonly type: string; readonly count: number };
      }
    /** CR 614.1c / 122.1 — how this permanent enters. */
    | {
          readonly kind: "enters-tapped";
          readonly counters?: { readonly type: string; readonly count: number };
      }
    /** CR 722.3a — "<self> enters prepared": the designation, given as the
     *  permanent enters (the `enters-tapped` shape). */
    | { readonly kind: "enters-prepared" }
    /**
     * CR 614.1c / 614.12a / 205.3m — "As this creature enters, choose a
     * creature type": a choice made BEFORE the permanent enters, over the
     * whole CR 205.3m creature-type list, kept on the permanent for the
     * abilities that read "the chosen type" (CR 607.2d).
     */
    | { readonly kind: "as-enters-choose-creature-type" }
    /**
     * CR 614.12a / 201.4 / 201.4a — "As this creature enters, choose a
     * nonland card name": the name kept on the permanent (`chosenName`) for
     * the abilities that read "the chosen name".
     */
    | { readonly kind: "as-enters-choose-card-name" }
    /**
     * CR 614.1c / 614.12a — "As this artifact enters, choose an opponent": a
     * choice made BEFORE the permanent enters, kept on the permanent as its
     * `chosenPlayerId` for the abilities that read "the chosen player".
     */
    | { readonly kind: "as-enters-choose-opponent" }
    /** CR 601.3a — "Spells with the chosen name can't be cast." Reads the
     *  `chosenName` an `as-enters-choose-card-name` line of the SAME card
     *  made (checked in `lower.ts`). */
    | { readonly kind: "chosen-name-spells-cant-be-cast" }
    /**
     * CR 614.1c / 702.33e — "If this creature was kicked, it enters with N
     * <kind> counters on it" (`per: "kicked"`) and "This creature enters with
     * N <kind> counters on it for each time it was kicked" (`per: "each-kick"`,
     * CR 702.33d — a multikicked spell is kicked once per payment). An entry
     * rider like `enters-tapped`, whose COUNT is read off the kicker payment
     * record rather than printed.
     */
    | {
          readonly kind: "kicked-enters-with";
          readonly counters: { readonly type: string; readonly count: number };
          readonly per: "kicked" | "each-kick";
          /** CR 702.33f — "kicked with its {1}{U} kicker": the PRINTED cost
           *  of the one kicker this rider reads, resolved to a kicker id in
           *  lowering (the id is a fact about the kicker line, not this one).
           *  Absent: "if this creature was kicked" — any kicker. */
          readonly kickedWith?: ManaCost;
          /** CR 614.1c — "… and with <keyword>" / "… and with \"<ability>\"":
           *  what the kicked permanent ALSO enters with, in printed order. */
          readonly grants?: readonly SelfGrantIR[];
      }
    /** CR 502.3 — "doesn't untap during your untap step". */
    | { readonly kind: "does-not-untap" }
    /** CR 401.5 — "Play with the top card of your library revealed". */
    | { readonly kind: "reveal-library-top" }
    /**
     * CR 509.1b — "This creature can't block": the source's own printed
     * restriction as a BLOCKER. The Aura twin ("Enchanted creature can't
     * block") is an `enchanted-host` effect; this one binds the card itself.
     */
    | {
          readonly kind: "self-block-restriction";
          readonly sentence: string;
          /** CR 509.1b — "… unless you control more creatures than attacking
           *  player": the block is legal only while the blocker's controller
           *  controls more creatures than the attacker's controller. */
          readonly unlessControlMoreCreatures?: true;
      }
    /**
     * CR 508.1c — "This creature can't attack unless <condition>": the
     * source's own printed attack restriction, lifted when `unless` holds.
     */
    | {
          readonly kind: "self-attack-restriction";
          readonly unless: "more-creatures-than-defender";
          readonly sentence: string;
      }
    /**
     * CR 502.3 — an untap-step lock over a SET: "Islands don't untap during
     * their controllers' untap steps" (`maxUntap: 0`), "players can't untap
     * more than one land during their untap steps" (`maxUntap: 1`). The
     * source's own "doesn't untap during your untap step" is the separate
     * `does-not-untap` marker above.
     */
    | {
          readonly kind: "untap-lock";
          readonly filter: PermanentFilter;
          readonly maxUntap: number;
          /** CR 611.3a — "As long as <self> is untapped, …". */
          readonly whileSourceUntapped?: true;
          /** CR 605.1a — "with an activated ability that isn't a mana ability". */
          readonly nonManaActivatedAbility?: true;
      }
    /** CR 614.10 / 502.3 — "Players skip their untap steps": no permanent of
     *  any player untaps. Lowered to an `untap-lock` over every permanent
     *  type — the encoding the hand-written Stasis writes. */
    | { readonly kind: "skip-untap-steps" }
    /** CR 614.1d — "<plural descriptor> enter tapped": a replacement on every
     *  matching permanent entering, whoever controls it. */
    | { readonly kind: "enters-tapped-lock"; readonly filter: PermanentFilter }
    /** CR 614.10 / 504.1 — "Skip your draw step": an unconditional
     *  replacement of the controller's own turn-based draw. Lowered to
     *  `drawStepReplacement`, which suppresses the draw but not the step. */
    | { readonly kind: "skip-draw-step" }
    /**
     * CR 614.1a + CR 614.11 — "If you would draw a card during your draw step,
     * instead you may skip that draw. If you do, <body>": the draw-step
     * replacement flag plus the choice made AT the step. `effects` is the
     * shared effect grammar's reading of the "If you do" body.
     */
    | {
          readonly kind: "optional-draw-skip";
          readonly effects: readonly EffectSentenceIR[];
      }
    /** CR 305.2 — "You may play an additional land on each of your turns":
     *  `count` more land plays than the one CR 305.2a already grants. */
    | { readonly kind: "extra-land-drop"; readonly count: number }
    /**
     * CR 614.1a / 614.12 — "If <self> would enter, you may discard a <type>
     * card instead. If you do, put <self> onto the battlefield. If you
     * don't, put it into its owner's graveyard": an as-enters cost the
     * entering permanent's controller may decline, declining sending the
     * permanent to the graveyard.
     */
    | {
          readonly kind: "as-enters-discard";
          readonly filter: { readonly type: CardType };
      }
    /**
     * CR 614.1a / 701.21a — "If <self> would enter, sacrifice a <basic land
     * type> instead. If you do, put <self> onto the battlefield. If you
     * don't, put it into its owner's graveyard": the mandatory sibling of
     * `as-enters-discard`, sending the permanent to the graveyard only when
     * the controller has nothing to sacrifice.
     */
    | {
          readonly kind: "as-enters-sacrifice";
          readonly filter: PermanentFilter;
      }
    /**
     * CR 614.12a / 614.1c — "As <self> enters, exile any number of <type>
     * cards from your graveyard" (Sutured Ghoul): the controller picks any
     * number of their own matching graveyard cards, none included, and they
     * are exiled linked to the entering permanent (CR 607.2b).
     */
    | {
          readonly kind: "as-enters-exile-from-graveyard";
          readonly filter: { readonly type: CardType };
      }
    /** CR 702.18 / 115.1 — "You have shroud": the controller can't be the
     *  target of spells or abilities. */
    | { readonly kind: "player-shroud" }
    /** CR 601.3 + CR 305.1 — "You may play lands and cast spells from the top
     *  of your library": the controller's permission to play the top land and
     *  cast the top spell of their own library. Lowered to the card-level
     *  `playsLandsFromTopOfLibrary` + `castsSpellsFromTopOfLibrary`. */
    | { readonly kind: "play-from-library-top" }
    /** CR 702.8a + CR 307.1 + CR 603.7a — "You may cast this spell as though
     *  it had flash. If you cast it any time a sorcery couldn't have been
     *  cast, the controller of the permanent it becomes sacrifices it at the
     *  beginning of the next cleanup step." Lowered to `castAsThoughFlash`
     *  and an entered trigger gated on the cast-time timing snapshot. */
    | { readonly kind: "flash-cast-cleanup-sacrifice" }
    /** CR 614.1a — "If <self> would be put into a graveyard from anywhere,
     *  reveal <self> and shuffle it into its owner's library instead".
     *  Lowered to `shuffleFromAnywhere`. */
    | { readonly kind: "shuffle-from-anywhere" }
    /** CR 615 — "If damage would be dealt to <self>, prevent that damage.
     *  Remove a +1/+1 counter from <self>". Lowered to
     *  `damagePreventionCounterRemoval`. */
    | { readonly kind: "damage-prevention-counter-removal" }
    /** CR 615 — "Prevent all damage that would be dealt to you". Lowered to
     *  `preventsDamageToController`. */
    | { readonly kind: "controller-damage-prevention" }
    /** CR 614.1a + CR 120.4c — "If you control a creature, damage that would
     *  reduce your life total to less than N reduces it to N instead".
     *  Lowered to `damageLifeFloor`. */
    | { readonly kind: "damage-life-floor"; readonly floor: number }
    /**
     * CR 601.2c — "While an opponent is choosing targets as part of casting a
     * spell they control or activating an ability they control, that player
     * must choose at least one <subtype> on the battlefield if able". The
     * objects that SATISFY the requirement are named by a creature type, not
     * by the source: the clause says "at least one Flagbearer", not "at least
     * one of me".
     */
    | {
          readonly kind: "target-choice-requirement";
          readonly binds: "opponents";
          readonly subtype: string;
      }
    /**
     * CR 611.3a / 613.4c — "This creature gets +N/+N as long as you control a
     * <descriptor>" / "Threshold — This creature gets +N/+N as long as there
     * are seven or more cards in your graveyard": the permanent's own layer-7c
     * buff, present only while the condition holds (re-checked at every layer
     * read).
     */
    | {
          readonly kind: "self-pt-buff-conditional";
          readonly power: number;
          readonly toughness: number;
          readonly condition: StaticConditionIR;
      }
    /**
     * CR 303.4b — one or more effects on the Aura's host ("Enchanted creature
     * gets +2/+2 and has flying", "You control enchanted creature"). `host`
     * is the printed noun, kept so lowering can check it against the Aura's
     * own enchant restriction.
     */
    | {
          readonly kind: "enchanted-host";
          readonly host: HostNoun;
          readonly effects: readonly HostEffectIR[];
          /** CR 702.16n — "This effect doesn't remove this Aura." */
          readonly keepsThisAura?: true;
      };

/** What a kicked entry rider's "and with …" tail grants the permanent itself
 *  — the three host-effect shapes that name an ABILITY (CR 614.1c). */
export type SelfGrantIR = Extract<
    HostEffectIR,
    | { kind: "keyword-grant" }
    | { kind: "activated-grant" }
    | { kind: "triggered-grant" }
>;

/** What "enchanted <noun>" names: a card type, or any permanent. */
export type HostNoun = CardType | "permanent";

/** An ability printed in quotation marks: an activated, mana or triggered
 *  ability (CR 614.1c — "… and with '<ability>'", Necravolver's "Whenever
 *  this creature deals damage, you gain that much life."). */
export type QuotedAbilityIR = Extract<
    SlotIR,
    { kind: "activated" } | { kind: "mana-ability" } | { kind: "triggered" }
>;

/** One effect a host frame applies to the enchanted permanent. */
export type HostEffectIR =
    /** CR 613.4c layer 7c. */
    | {
          readonly kind: "pt-buff";
          readonly power: number;
          readonly toughness: number;
      }
    /** CR 613.1f layer 6. */
    | { readonly kind: "keyword-grant"; readonly keyword: KeywordIR }
    /** CR 113.1a / 613.1f — an ability granted in quotation marks. */
    | {
          readonly kind: "activated-grant";
          /** The quoted text, full stop included — the granted ability's
           *  own Oracle text. */
          readonly text: string;
          readonly ability: QuotedAbilityIR;
      }
    /** CR 113.1a / 613.1f — the TRIGGERED twin of `activated-grant` above,
     *  for a quoted ability the triggered slot reads (issue #4139 —
     *  Necravolver's "Whenever this creature deals damage, you gain that
     *  much life."). Kept as its own member, never folded into
     *  `activated-grant`, because the two lower onto different card-level
     *  destinations (`grantTemplates[]` vs `triggeredGrantTemplates[]`). */
    | {
          readonly kind: "triggered-grant";
          readonly text: string;
          readonly ability: QuotedAbilityIR;
      }
    /** CR 613.1b layer 2. */
    | { readonly kind: "control-change" }
    /**
     * CR 508.1c / 509.1b. `sentence` is the restriction ALONE ("Enchanted
     * creature can't block.") — the rejection reason the engine shows, which
     * must not carry a P/T clause the same line also printed; it is the text
     * the hand-written catalogue writes (Maniacal Rage, Hobble).
     */
    | {
          readonly kind: "attack-restriction" | "block-restriction";
          readonly sentence: string;
      };

// ── Shared pieces ──────────────────────────────────────────────────────────

/**
 * Read the subject of an anthem or a lord sentence.
 *
 * PLURAL is required, not incidental: "Creatures you control" describes a SET,
 * and the singular "This creature" / "Enchanted creature" sentences are the
 * two shapes this grammar deliberately does not read (see the header). Without
 * the check, "Enchanted creature" would not parse anyway — but by accident,
 * and an accident is not a guarantee.
 *
 * A leading "All " is stripped, and only there. CR 109.1: "All creatures" and
 * "Creatures" describe the same set, so the word carries no filtering meaning
 * — but it is not an adjective the descriptor grammar knows, so a line that
 * uses it would otherwise be refused for a phrasing difference rather than for
 * anything about the card (342 corpus lines open with it).
 */
function readSubject(
    span: string,
    evaluation: StaticFilterEvaluation
): RuleResult<PermanentFilter> {
    const head = span.startsWith("All ") ? span.slice("All ".length) : span;
    if (head.length === 0) return fail("empty static subject", span);
    const descriptor = descriptorRule.run(head, undefined);
    if (!descriptor.ok) return descriptor;
    const value: DescriptorIR = descriptor.value;
    if (value.plural !== true)
        return fail(
            "a continuous static effect over a set needs a plural subject",
            span
        );
    return staticFilterFromDescriptor(value, evaluation);
}

/** `pair`-style unique split, over a separator that may occur several times. */
function splitOnce<T>(
    span: string,
    sep: string,
    read: (left: string, right: string) => RuleResult<T> | null
): { hits: T[]; misses: string[] } {
    const hits: T[] = [];
    const misses: string[] = [];
    let at = span.indexOf(sep);
    while (at !== -1) {
        const result = read(span.slice(0, at), span.slice(at + sep.length));
        if (result !== null) {
            if (result.ok) hits.push(result.value);
            else misses.push(result.reason);
        }
        at = span.indexOf(sep, at + 1);
    }
    return { hits, misses };
}

/**
 * The `pair` combinator's unique-split guarantee, for a rule whose two sides
 * are read by hand rather than by two `Rule`s.
 *
 * `pair` itself cannot be used here: its `right` side is a `Rule` that sees
 * only its own span, and every frame below needs the split point to be chosen
 * by what the LEFT side turned out to be. The guarantee it exists to provide —
 * every occurrence tried, exactly one reading accepted — is reproduced
 * verbatim, because a frame that took the first viable separator would pick
 * the wrong "have" in a sentence with two.
 */
function uniqueSplit<T>(
    label: string,
    span: string,
    sep: string,
    read: (left: string, right: string) => RuleResult<T> | null
): RuleResult<T> {
    const { hits, misses } = splitOnce(span, sep, read);
    if (hits.length === 1) return ok(hits[0]!);
    if (hits.length === 0)
        return fail(
            misses.length > 0
                ? `${label} — ${[...new Set(misses)].join("; ")}`
                : `${label} — no "${sep}" in the span`,
            span
        );
    return fail(
        `ambiguous ${label}: ${hits.length} viable "${sep}" split points`,
        span
    );
}

// ── Frame: anthem / lord P/T (CR 613.4c) ───────────────────────────────────

const PT_MODIFIER = /^([+-]\d+)\/([+-]\d+)$/;

export const anthemRule: Rule<StaticClauseIR> = rule(
    "anthem",
    (span): RuleResult<StaticClauseIR> =>
        uniqueSplit("anthem", span, " get ", (subject, modifier) => {
            const pt = modifier.match(PT_MODIFIER);
            if (pt === null) return null;
            const filter = readSubject(subject, "recomputed");
            if (!filter.ok) return filter;
            return ok({
                kind: "pt-buff" as const,
                filter: filter.value,
                power: signedModifier(pt[1]!),
                toughness: signedModifier(pt[2]!),
            });
        })
);

// ── Frame: conditional self P/T (CR 611.3a) ────────────────────────────────

const SELF_PUMP_AS_LONG_AS =
    /^(Threshold \u2014 )?(.+) gets ([+-]\d+)\/([+-]\d+) as long as (.+)$/;

/**
 * "This creature gets +1/+1 as long as you control a blue creature." — the
 * one conditional static read: its subject is the permanent itself, and its
 * condition is the shared "you control a <descriptor>" clause every other
 * controls site reads (`condition.ts`). Any other "as long as" tail fails.
 */
export const selfConditionalPumpRule: Rule<StaticClauseIR> = rule(
    "conditional self pump",
    (span, ctx): RuleResult<StaticClauseIR> => {
        const match = span.match(SELF_PUMP_AS_LONG_AS);
        if (match === null)
            return fail('not "<self> gets +N/+N as long as …"', span);
        if (!isSelfPhrase(uncapitalise(match[2]!)))
            return fail(`"${match[2]}" is not the permanent itself`, span);
        const tail = match[5]!;
        // CR 207.2c — Threshold is an ability word naming the graveyard
        // count; it is printed only in front of that condition, so any other
        // tail behind it is a line we have misread.
        const condition: RuleResult<StaticConditionIR> = tail.startsWith(
            "you control "
        )
            ? controlsRule.run(tail, ctx)
            : tail.startsWith("an opponent controls ")
              ? opponentControlsRule.run(tail, ctx)
              : graveyardCountRule.run(tail, ctx);
        if (!condition.ok) return condition;
        if (
            match[1] !== undefined &&
            condition.value.kind !== "graveyard-count"
        )
            return fail('"Threshold" names a graveyard count', span);
        return ok({
            kind: "self-pt-buff-conditional" as const,
            power: signedModifier(match[3]!),
            toughness: signedModifier(match[4]!),
            condition: condition.value,
        });
    }
);

// ── Frame: keyword grant (CR 613.1f) ───────────────────────────────────────

const OTHER_PREFIX = "Other ";

export const keywordGrantRule: Rule<StaticClauseIR> = rule(
    "keyword grant",
    (span): RuleResult<StaticClauseIR> =>
        uniqueSplit("keyword grant", span, " have ", (subject, tail) => {
            // CR 702.1 — the granted keyword goes through the SAME registry
            // vocabulary the keyword-line slot reads, so a keyword the engine
            // does not implement is recorded as a planned mechanic rather than
            // shipped as an inert grant.
            const keyword = keywordVocabulary().get(tail.toLowerCase());
            if (keyword === undefined) return null;
            // CR 201.5 — "Other enchantments you control have shroud": the
            // set without the source itself, which is `excludeSource`. The
            // descriptor grammar has no "other" adjective, so the word is
            // read here, at the one frame that owes it.
            const other = subject.startsWith(OTHER_PREFIX);
            const filter = readSubject(
                other ? subject.slice(OTHER_PREFIX.length) : subject,
                "materialised"
            );
            if (!filter.ok) return filter;
            return ok({
                kind: "keyword-grant" as const,
                filter: other
                    ? { ...filter.value, excludeSource: true }
                    : filter.value,
                keyword,
            });
        })
);

// ── Frame: keyword grant from the graveyard (CR 113.6b) ────────────────────

const GRAVEYARD_KEYWORD_GRANT =
    /^As long as (.+?) is in your graveyard and (you control [^,]+), (.+) have ([^,]+)$/;

/**
 * "As long as this card is in your graveyard and you control a Mountain,
 * creatures you control have haste." (Anger.) CR 113.6b: the static ability
 * states the zone it functions in, so the source is the graveyard card. The
 * condition is the shared "you control a <descriptor>" clause (CR 611.3a); its
 * neighbours (another zone, another condition, a non-keyword grant) stay
 * refused by the anchored regex and the shared readers.
 */
export const graveyardKeywordGrantRule: Rule<StaticClauseIR> = rule(
    "graveyard keyword grant",
    (span, ctx): RuleResult<StaticClauseIR> => {
        const match = span.match(GRAVEYARD_KEYWORD_GRANT);
        if (match === null)
            return fail(
                'not "As long as <self> is in your graveyard and …"',
                span
            );
        if (!isSelfPhrase(uncapitalise(match[1]!)))
            return fail(`"${match[1]}" is not the card itself`, span);
        const keyword = keywordVocabulary().get(match[4]!.toLowerCase());
        if (keyword === undefined)
            return fail(`"${match[4]}" is not a keyword`, span);
        const condition = controlsRule.run(match[2]!, ctx);
        if (!condition.ok) return condition;
        const filter = readSubject(match[3]!, "materialised");
        if (!filter.ok) return filter;
        return ok({
            kind: "graveyard-keyword-grant" as const,
            filter: filter.value,
            keyword,
            condition: condition.value,
        });
    }
);

// ── Frame: full text of another object (CR 612.6) ──────────────────────────

const FULL_TEXT_EFFECT =
    /^As long as the top card of your graveyard is a creature card, (.+?) has the full text of that card and has the text "([^"]+)"$/;

/**
 * "As long as the top card of your graveyard is a creature card, this
 * creature has the full text of that card and has the text "{2}: Discard a
 * card."" (Volrath's Shapeshifter.) CR 612.6: the object whose text is taken
 * is the top card of the controller's graveyard (CR 404.1), and the quoted
 * text is the host's own ability it keeps. Other zones, other card types and a
 * bare "has the full text" with no retained ability stay refused by the
 * anchored regex.
 */
export const fullTextEffectRule: Rule<StaticClauseIR> = rule(
    "full text effect",
    (span): RuleResult<StaticClauseIR> => {
        const match = span.match(FULL_TEXT_EFFECT);
        if (match === null)
            return fail(
                'not "As long as the top card of your graveyard is a creature card, … has the full text of that card and has the text "…""',
                span
            );
        if (!isSelfPhrase(uncapitalise(match[1]!)))
            return fail(`"${match[1]}" is not the card itself`, span);
        return ok({
            kind: "full-text-effect" as const,
            from: "controller-graveyard-top" as const,
            requiresType: "Creature" as const,
            retainedAbilityText: match[2]!,
        });
    }
);

// ── Frame: cost modifier (CR 601.2f) ───────────────────────────────────────

const COST_MODIFIER = /^(.+) cost \{(\d+)\} (more|less) to cast$/;

const SPELL_NOUN = " spells";

/**
 * The spell CLASSES a phrase names, as descriptor IR — one entry per
 * alternative, empty for the bare "spells".
 *
 * Shared by both frames that talk about a class of spells (the cost modifier
 * and the cast permission), because there is exactly one way to say it in
 * Oracle text and a second reader would be a second thing to drift. What the
 * two consumers do NOT share is the vocabulary they can honour: each keeps its
 * own field whitelist and its own projection below, fail-closed, because the
 * shapes they lower to are different (`CompiledSpellFilter` has no mana-value
 * field; `EffectCardFilter` has one and no `controller`).
 *
 * Reading "<x> spells" as "<x> cards" is not a trick: CR 109.2 — a spell is a
 * CARD on the stack, and "card" is the descriptor grammar's noun for an object
 * outside the battlefield, carrying exactly the vocabulary a spell has (types,
 * subtypes, colours, mana value) and none of the vocabulary it does not
 * (tapped, attacking). The noun is replaced IN PLACE rather than stripped off
 * the end, so a trailing qualifier survives: "creature spells with mana value
 * 3 or less" is a class phrase, not a class phrase with a tail nobody read —
 * the dropped-trailing-filter defect this grammar exists to refuse.
 *
 * A UNION is read as several alternatives ("creature and enchantment spells",
 * "Dragon spells and artifact spells"). Whether a union is expressible at all
 * is the consumer's question, not this one's.
 */
function readSpellClasses(span: string): RuleResult<readonly DescriptorIR[]> {
    if (span.toLowerCase() === "spells") return ok([]);
    const parts = span.split(" and ");
    if (!parts[parts.length - 1]!.includes(SPELL_NOUN))
        return fail(`"${span}" does not describe a class of spells`, span);
    const classes: DescriptorIR[] = [];
    for (const part of parts) {
        const at = part.indexOf(SPELL_NOUN);
        const asCards =
            at === -1
                ? `${part} cards`
                : `${part.slice(0, at)} cards${part.slice(at + SPELL_NOUN.length)}`;
        const descriptor = descriptorRule.run(asCards, undefined);
        if (!descriptor.ok) return descriptor;
        if (descriptor.value.plural !== true)
            return fail(
                `"${part}" does not name a CLASS of spells (CR 109.2)`,
                part
            );
        classes.push(descriptor.value);
    }
    return ok(classes);
}

/**
 * Read the head of a cost-modifier sentence into a spell filter (CR 601.2f).
 *
 * "Goblin spells you cast" → `{ subtypes: ["Goblin"], controller: "you" }`. A
 * bare "Spells" carries no filter at all and is accepted as the empty one: a
 * modifier that taxes every spell is a real card ("Spells cost {1} more to
 * cast"), which is why the "matches everything" refusal below applies only to
 * a phrase that NAMED a class and then projected to nothing.
 */
function readSpellFilter(span: string): RuleResult<CompiledSpellFilter> {
    let head = span;
    let controller: "you" | "opponents" | undefined;
    if (head.endsWith(" you cast")) {
        controller = "you";
        head = head.slice(0, -" you cast".length);
    } else if (head.endsWith(" your opponents cast")) {
        controller = "opponents";
        head = head.slice(0, -" your opponents cast".length);
    }
    const withController = <T extends CompiledSpellFilter>(f: T): T =>
        controller === undefined ? f : { ...f, controller };

    const classes = readSpellClasses(head);
    if (!classes.ok) return classes;
    if (classes.value.length === 0) return ok(withController({}));
    // CR 601.2f — `CompiledSpellFilter` ANDs its fields and has no clause
    // list, so a UNION of two classes has no general encoding here. The one
    // union it CAN say is a union of bare card types ("Artifact and
    // enchantment spells"), because `types` is itself read as any-of
    // (`spellMatches`). Every other union is refused by name rather than
    // mis-lowered to whichever half came first.
    if (classes.value.length > 1) {
        const types = classes.value.map(bareCardType);
        if (types.some((t) => t === undefined))
            return fail(
                `a cost modifier over a UNION of spell classes is not expressible (CR 601.2f)`,
                span
            );
        return ok(withController({ types: types as CardType[] }));
    }
    const value = classes.value[0]!;
    for (const [field, present] of Object.entries(value)) {
        if (present === undefined) continue;
        if (
            [
                "types",
                "subtypes",
                "colors",
                "excludeTypes",
                "card",
                "plural",
            ].includes(field)
        )
            continue;
        return fail(
            `"${field}" is not expressible as a spell filter (CR 601.2f)`,
            field
        );
    }
    const filter: CompiledSpellFilter = {
        ...(value.types !== undefined ? { types: [...value.types] } : {}),
        ...(value.subtypes !== undefined
            ? { subtypes: [...value.subtypes] }
            : {}),
        ...(value.colors !== undefined ? { colors: [...value.colors] } : {}),
        ...(value.excludeTypes !== undefined
            ? { excludeTypes: [...value.excludeTypes] }
            : {}),
    };
    if (Object.keys(filter).length === 0)
        return fail("spell filter matches everything", span);
    return ok(withController(filter));
}

/** The ONE card type a class names when it names nothing else ("artifact"). */
function bareCardType(value: DescriptorIR): CardType | undefined {
    for (const [field, present] of Object.entries(value)) {
        if (present === undefined) continue;
        if (!["types", "card", "plural"].includes(field)) return undefined;
    }
    return value.types?.length === 1 ? value.types[0] : undefined;
}

export const costModifierRule: Rule<StaticClauseIR> = pattern(
    "cost modifier",
    COST_MODIFIER,
    (match): RuleResult<StaticClauseIR> => {
        const spells = readSpellFilter(match[1]!);
        if (!spells.ok) return spells;
        return ok({
            kind: "cost-modifier" as const,
            spells: spells.value,
            direction: match[3] as "more" | "less",
            amount: Number(match[2]),
        });
    }
);

/**
 * CR 601.2f — "Each spell costs {N} more to cast except during its
 * controller's turn" (Defense Grid). A spell's controller is its caster
 * (CR 601.2a), so the gate is "the caster is not the active player". Only the
 * gated tax is read: no printed card says the bare "Each spell costs …".
 */
export const offTurnCostModifierRule: Rule<StaticClauseIR> = pattern(
    "off-turn cost modifier",
    /^Each spell costs \{(\d+)\} more to cast except during its controller's turn$/,
    (match): RuleResult<StaticClauseIR> =>
        ok({
            kind: "cost-modifier" as const,
            spells: {},
            direction: "more" as const,
            amount: Number(match[1]),
            onlyOutsideAnnouncersTurn: true as const,
        })
);

/**
 * CR 602.2b — "Activated abilities of <permanents> cost {N} more to activate"
 * (Gloom). Activating an ability follows 601.2b–i, so 601.2f's cost increase
 * applies to its activation cost. The subject is a plural permanent class,
 * read by the same `readSubject` an anthem uses. Only "more" is read: every
 * printed "less" form either names a non-battlefield source ("creature cards
 * in your graveyard") or carries a floor sentence this frame has no reading
 * for, and the bare ones have no fixture.
 */
export const abilityCostModifierRule: Rule<StaticClauseIR> = pattern(
    "activated ability cost modifier",
    /^Activated abilities of (.+) cost \{(\d+)\} more to activate$/,
    (match): RuleResult<StaticClauseIR> => {
        const sources = readSubject(match[1]!, "materialised");
        if (!sources.ok) return sources;
        return ok({
            kind: "cost-modifier" as const,
            abilities: sources.value,
            direction: "more" as const,
            amount: Number(match[2]),
        });
    }
);

// ── Frame: attack tax (CR 508.1d / 508.1h) ─────────────────────────────────

/**
 * CR 508.1d / 508.1h — "<Creatures | Nonblack creatures> can't attack you
 * unless their controller pays {N} for each creature they control that's
 * attacking you" (Ghostly Prison, Propaganda, Windborn Muse; Elephant Grass).
 * A cost to attack, determined and paid as attackers are declared. The
 * "Nonblack" subject is a negated colour (CR 105.2), carried as
 * `excludeColors`; no other qualified subject is printed in the corpus.
 */
export const attackManaTaxRule: Rule<StaticClauseIR> = pattern(
    "attack mana tax",
    /^(Creatures|Nonblack creatures) can't attack you unless their controller pays \{(\d+)\} for each creature they control that's attacking you$/,
    (match): RuleResult<StaticClauseIR> =>
        ok({
            kind: "attack-mana-tax" as const,
            attackers:
                match[1] === "Creatures"
                    ? { types: ["Creature"] }
                    : { types: ["Creature"], excludeColors: ["B"] },
            perAttacker: Number(match[2]),
        })
);

// ── Frame: attack prohibition (CR 508.1c) ──────────────────────────────────

/**
 * CR 508.1c — "<Colour> creatures can't attack you" (Elephant Grass): a
 * restriction on the creatures the source's controller is attacked by. Only a
 * single positive colour word qualifies the bare "creatures" noun; a negated
 * colour ("Nonblack creatures") and a payment rider are other forms and stay
 * refused.
 */
export const attackProhibitionRule: Rule<StaticClauseIR> = pattern(
    "attack prohibition",
    /^(White|Blue|Black|Red|Green) creatures can't attack you$/,
    (match): RuleResult<StaticClauseIR> =>
        ok({
            kind: "attack-prohibition" as const,
            attackers: {
                types: ["Creature"],
                colors: COLOR_WORDS.get(match[1]!.toLowerCase())!,
            },
        })
);

// ── Frame: activation lock (CR 602.5 / 605.1a) ─────────────────────────────

/**
 * CR 602.5 — "Activated abilities of creatures can't be activated" (Cursed
 * Totem): a player can't begin to activate a prohibited ability. Anchored on
 * the whole sentence: no "unless they're mana abilities" exemption (CR 605.1a —
 * a mana ability is an activated ability), no other permanent noun and no
 * qualifier is read, so those neighbours refuse.
 */
export const creatureActivationLockRule: Rule<StaticClauseIR> = pattern(
    "creature activation lock",
    /^Activated abilities of creatures can't be activated$/,
    (): RuleResult<StaticClauseIR> =>
        ok({ kind: "creature-activation-lock" as const })
);

// ── Frame: board cast permission (CR 601.3 / 118.9) ────────────────────────

const CAST_PERMISSION = /^(You|Any player) may cast (.+)$/;
const FREE_TAIL = " without paying their mana costs";
const FLASH_TAIL = " as though they had flash";

/**
 * `DescriptorIR` fields a cast permission can honour.
 *
 * Fail-closed and PER-CONSUMER, like the cost modifier's own list one function
 * up: the two lower to different shapes, so a field one can feed honestly is
 * not automatically a field the other can. `mvFilter` is here and absent
 * there because `EffectCardFilter` has `manaValueAtMost` and
 * `CompiledSpellFilter` has nothing to put a ceiling in; `controller` is
 * absent from BOTH here — the grantee comes from the sentence HEAD ("You may
 * cast" / "Any player may cast"), so a "you cast" inside the class phrase
 * would be a second, contradicting answer to the same question and is refused
 * rather than quietly dropped.
 */
const CAST_PERMISSION_DESCRIPTOR_FIELDS: ReadonlySet<string> = new Set([
    "types",
    "excludeTypes",
    "subtypes",
    "supertypes",
    "colors",
    "mvFilter",
    "card",
    "plural",
]);

/** One spell class as the engine's hand-card filter (`EffectCardFilter`). */
function castPermissionClassFilter(
    value: DescriptorIR
): RuleResult<EffectCardFilter> {
    for (const [field, present] of Object.entries(value)) {
        if (present === undefined) continue;
        if (CAST_PERMISSION_DESCRIPTOR_FIELDS.has(field)) continue;
        return fail(
            `"${field}" is not expressible as a cast-permission filter (CR 601.3)`,
            field
        );
    }
    // CR 205.4a — `EffectCardFilter.supertype` holds ONE supertype, not a set.
    if (value.supertypes !== undefined && value.supertypes.length !== 1)
        return fail(
            "a cast permission over several supertypes is not expressible (CR 205.4a)",
            JSON.stringify(value.supertypes)
        );
    // CR 202.3 — the filter expresses a CEILING and nothing else, so a floor
    // ("with mana value 3 or greater") would silently widen to every card.
    if (value.mvFilter !== undefined && value.mvFilter.min !== undefined)
        return fail(
            "a mana-value FLOOR is not expressible as a cast-permission filter (CR 202.3)",
            JSON.stringify(value.mvFilter)
        );
    // CR 107.3 — "mana value X" names the announced X, which the filter has no
    // field for; dropping it would widen the permission to every card.
    if (value.mvFilter?.equals !== undefined || value.mvFilter?.max === "X")
        return fail(
            "a mana-value X is not expressible as a cast-permission filter (CR 107.3)",
            JSON.stringify(value.mvFilter)
        );
    const filter: EffectCardFilter = {
        ...(value.types !== undefined ? { type: [...value.types] } : {}),
        ...(value.excludeTypes !== undefined
            ? { excludeType: [...value.excludeTypes] }
            : {}),
        ...(value.subtypes !== undefined
            ? { subtype: [...value.subtypes] }
            : {}),
        ...(value.supertypes !== undefined
            ? { supertype: value.supertypes[0]! }
            : {}),
        ...(value.colors !== undefined ? { color: [...value.colors] } : {}),
        ...(value.mvFilter?.max !== undefined
            ? { manaValueAtMost: value.mvFilter.max }
            : {}),
    };
    if (Object.keys(filter).length === 0)
        return fail("cast-permission filter matches everything", "filter");
    return ok(filter);
}

/**
 * The whole class phrase as ONE `EffectCardFilter`.
 *
 * A union lowers to `any[]` — the one disjunctive clause list
 * `handCardMatchesFilter` supports (`gre/alternativeCost.ts`), which recurses
 * through the same matcher. Uniform on purpose: "creature and enchantment
 * spells" could also be written `type: ["Creature", "Enchantment"]`, and two
 * spellings of one filter is two ids for one permission
 * (`oracle/castPermissionId.ts`) — the split identity the derived id exists to
 * prevent.
 *
 * A union carrying a mana-value ceiling is REFUSED. "creature and enchantment
 * spells with mana value 3 or less" puts the ceiling on the last alternative
 * alone, which is a reading, not the reading; no corpus sentence combines
 * them, so the honest answer is to refuse rather than to pick one.
 */
function readCastPermissionFilter(span: string): RuleResult<EffectCardFilter> {
    const classes = readSpellClasses(span);
    if (!classes.ok) return classes;
    // "You may cast spells as though they had flash." (Vedalken Orrery) — a
    // permission over every spell is exactly what the card says, so the empty
    // filter is the right answer here rather than the "matches everything"
    // refusal a class phrase that projected to nothing earns.
    if (classes.value.length === 0) return ok({});
    const filters: EffectCardFilter[] = [];
    for (const value of classes.value) {
        if (classes.value.length > 1 && value.mvFilter !== undefined)
            return fail(
                "a mana-value ceiling on a UNION of spell classes is ambiguous (CR 202.3)",
                span
            );
        const filter = castPermissionClassFilter(value);
        if (!filter.ok) return filter;
        filters.push(filter.value);
    }
    return ok(filters.length === 1 ? filters[0]! : { any: filters });
}

/**
 * "<grantee> may cast <class> spells [without paying their mana costs]
 * [and] [as though they had flash]" — Aluren, Vedalken Orrery, Dracogenesis.
 *
 * The two terms are INDEPENDENT by contract (the Mechanics Registry says so,
 * and `StaticCastPermission` carries them as two booleans): a frame that only
 * read Aluren's combination would be Aluren-shaped, which is what the engine
 * work behind issue #2706 explicitly avoided.
 *
 * ── What this frame refuses, by name ──────────────────────────────────────
 *
 * SINGULAR permissions — "a spell with mana value 3 or less from your hand
 * without paying its mana cost" (the As Foretold / Expertise family), "the
 * first creature spell you cast each turn", "up to two … spells". They are
 * once-per-turn or counter-gated one-shots, not a standing permission over a
 * class, and `StaticCastPermission` has nowhere to put the gate — a card
 * shipped through this frame would grant the permission every turn, forever.
 *
 * NON-FREE alternative costs — "by paying {E} rather than paying their mana
 * costs" (Primal Prayers). `withoutPayingManaCost` means CR 118.9's free cast
 * and nothing else; there is no field for a cost that is merely DIFFERENT.
 *
 * DURATION tails — "spells this turn" (Borne Upon a Wind), "sorcery spells
 * this turn" (Complete the Circuit). The class reader would refuse these
 * anyway, because "this turn" is not a qualifier the descriptor grammar
 * knows — but by ACCIDENT, and an accident is not a guarantee (the same
 * argument the module header makes for the plural check). It is worth stating
 * deliberately because no static rule consults `ParseContext.typeLine`: this
 * is the whole of what keeps an INSTANT out of a slot that means "true while
 * this permanent is on the battlefield" (CR 604.1).
 *
 * ZONE phrases — "spells from your hand" (Omniscience), "from the top of your
 * library", "from among cards exiled with …". `collectCastPermissions` is
 * hand-only by contract, so the phrase is not wrong, merely unread — and a
 * permission the compiler did not finish reading is one it must not emit.
 *
 * PREDICATES the filter cannot express — "historic spells", "colorless
 * spells", "Aura spells with enchant creature". `EffectCardFilter` has no
 * historic and no colorless predicate; each is its own filter primitive, not
 * this frame's business (they surface as the descriptor grammar's own reason).
 */
export const castPermissionRule: Rule<StaticClauseIR> = pattern(
    "cast permission",
    CAST_PERMISSION,
    (match): RuleResult<StaticClauseIR> => {
        const grantee = match[1] === "You" ? "controller" : "any-player";
        const body = match[2]!;

        if (/ by paying | rather than paying /.test(body))
            return fail(
                "an alternative cost that is not free is not a cast permission (CR 118.9)",
                body
            );
        if (/^(a|an|the|up to|target) /.test(body))
            return fail(
                "a SINGULAR cast permission is a one-shot, not a standing class permission (CR 601.3)",
                body
            );
        // Every zone/source spelling, not an enumerated few: "from your hand"
        // (Omniscience), "from the top of your library", "from among cards
        // exiled with …", "from an opponent's graveyard". No sentence this
        // frame accepts contains the word at all, so the bare preposition is
        // the fail-closed test — an enumeration would leave the next spelling
        // to be refused by accident somewhere downstream.
        if (/ from /.test(body))
            return fail(
                "a cast permission naming a zone or source is not read by this frame (CR 601.3)",
                body
            );

        let rest = body;
        let asThoughFlash = false;
        let withoutPayingManaCost = false;
        let conjunction = false;
        if (rest.endsWith(FLASH_TAIL)) {
            asThoughFlash = true;
            rest = rest.slice(0, -FLASH_TAIL.length);
            if (rest.endsWith(" and")) {
                conjunction = true;
                rest = rest.slice(0, -" and".length);
            }
        }
        if (rest.endsWith(FREE_TAIL)) {
            withoutPayingManaCost = true;
            rest = rest.slice(0, -FREE_TAIL.length);
        }
        if (!asThoughFlash && !withoutPayingManaCost)
            return fail(
                "a cast permission granting neither term is inert (CR 601.3)",
                body
            );
        // The " and" above was stripped on the strength of the flash tail
        // ALONE, so whether it joined anything this frame read is only known
        // now. Recorded rather than re-tested: the strip already removed it,
        // and a later `endsWith(" and")` could therefore never fire — it would
        // read as a guard while being dead code, which is worse than no guard.
        // Both halves matter: the conjunction with no free tail
        // ("creature spells and as though they had flash"), and the reversed
        // tail order, which leaves its own " and" behind.
        if (conjunction && !withoutPayingManaCost)
            return fail("unread conjunction in a cast permission", body);
        if (rest.endsWith(" and"))
            return fail("unread conjunction in a cast permission", body);
        if (/ (this turn|this game|until )/.test(rest))
            return fail(
                "a DURATION-scoped permission is not a board static (CR 604.1)",
                rest
            );

        const filter = readCastPermissionFilter(rest);
        if (!filter.ok) return filter;
        return ok({
            kind: "cast-permission" as const,
            grantee,
            filter: filter.value,
            ...(withoutPayingManaCost
                ? { withoutPayingManaCost: true as const }
                : {}),
            ...(asThoughFlash ? { asThoughFlash: true as const } : {}),
        });
    }
);

// ── Frame: entry riders (CR 614.1c / 122.1) ────────────────────────────────

const ENTERS_TAPPED = /^(.+) enters tapped$/;
const ENTERS_TAPPED_WITH =
    /^(.+) enters tapped with (\S+) (\S+) counters? on it$/;

/**
 * "<self> enters tapped[ with N <kind> counters on it]".
 *
 * BOTH readings are `oneOf` alternatives rather than one regex with an
 * optional tail: an optional group is how "enters tapped with two depletion
 * counters on it" silently compiles to a land that enters tapped and never
 * gets its counters — the prefix-match defect this compiler exists to refuse,
 * arriving through a `?` instead of through an unanchored regex.
 */
const entersTappedPlain: Rule<StaticClauseIR> = pattern(
    "enters tapped",
    ENTERS_TAPPED,
    (match): RuleResult<StaticClauseIR> =>
        isSelfPhrase(uncapitalise(match[1]!))
            ? ok({ kind: "enters-tapped" as const })
            : fail(`"${match[1]}" is not this permanent (CR 109.2)`, match[1]!)
);

const entersTappedWithCounters: Rule<StaticClauseIR> = pattern(
    "enters tapped with counters",
    ENTERS_TAPPED_WITH,
    (match): RuleResult<StaticClauseIR> => {
        if (!isSelfPhrase(uncapitalise(match[1]!)))
            return fail(
                `"${match[1]}" is not this permanent (CR 109.2)`,
                match[1]!
            );
        const count = readNumberWord(match[2]!);
        if (count === null)
            return fail(`"${match[2]}" is not a number word`, match[2]!);
        return ok({
            kind: "enters-tapped" as const,
            counters: { type: match[3]!, count },
        });
    }
);

/**
 * CR 722.3a — "<self> enters prepared": "some spells and abilities … state
 * that a permanent enters prepared". Self only — a subject naming other
 * permanents is a different clause, refused.
 */
const entersPrepared: Rule<StaticClauseIR> = pattern(
    "enters prepared",
    /^(.+) enters prepared$/,
    (match): RuleResult<StaticClauseIR> =>
        isSelfPhrase(uncapitalise(match[1]!))
            ? ok({ kind: "enters-prepared" as const })
            : fail(`"${match[1]}" is not this permanent (CR 109.2)`, match[1]!)
);

const ENTERS_WITH = /^(.+) enters with (\S+) (\S+) counters? on it$/;

/**
 * "<self> enters with N <kind> counters on it" — the unconditional entry
 * replacement (CR 614.1c / 122.1), the plain sibling of `entersTappedWithCounters`
 * above. Anchored on "on it" with nothing after: the kicked forms below carry
 * their own gate ("If … was kicked, it enters with …", "… for each time it was
 * kicked") and are read by their own rules, so a tail here is another form and
 * refuses, never reads as this one.
 */
const entersWithCounters: Rule<StaticClauseIR> = pattern(
    "enters with counters",
    ENTERS_WITH,
    (match): RuleResult<StaticClauseIR> => {
        if (!isSelfPhrase(uncapitalise(match[1]!)))
            return fail(
                `"${match[1]}" is not this permanent (CR 109.2)`,
                match[1]!
            );
        const count = readNumberWord(match[2]!);
        if (count === null)
            return fail(`"${match[2]}" is not a number word`, match[2]!);
        // CR 122.1 — "no counters" is not a printed count, and a rider that
        // places nothing would be a silent no-op.
        if (count < 1)
            return fail(`"${match[2]}" places no counters`, match[2]!);
        return ok({
            kind: "enters-with-counters" as const,
            counters: { type: match[3]!, count },
        });
    }
);

// ── Frame: as-enters creature-type choice (CR 614.1c / 614.12a) ────────────

const AS_ENTERS_CHOOSE_CREATURE_TYPE =
    /^As (.+) enters, choose a creature type$/;

/**
 * "As <self> enters, choose a creature type" — CR 614.12a's replacement, made
 * as the permanent enters. Anchored on the WHOLE sentence: a tail ("other than
 * Wall", "that isn't …") or a different choice ("a color") is another form and
 * refuses here, never reads as the plain one.
 */
const asEntersChooseCreatureType: Rule<StaticClauseIR> = pattern(
    "as enters choose a creature type",
    AS_ENTERS_CHOOSE_CREATURE_TYPE,
    (match): RuleResult<StaticClauseIR> =>
        isSelfPhrase(uncapitalise(match[1]!))
            ? ok({ kind: "as-enters-choose-creature-type" as const })
            : fail(`"${match[1]}" is not this permanent (CR 109.2)`, match[1]!)
);

// ── Frame: as-enters card-name choice (CR 614.12a / 201.4) ─────────────────

const AS_ENTERS_CHOOSE_NONLAND_CARD_NAME =
    /^As (.+) enters, choose a nonland card name$/;

/**
 * "As <self> enters, choose a nonland card name" — anchored on the WHOLE
 * sentence: "a card name" (lands included) or an "other than …" tail is
 * another form (CR 201.4a restricts the legal names) and refuses here.
 */
const asEntersChooseNonlandCardName: Rule<StaticClauseIR> = pattern(
    "as enters choose a nonland card name",
    AS_ENTERS_CHOOSE_NONLAND_CARD_NAME,
    (match): RuleResult<StaticClauseIR> =>
        isSelfPhrase(uncapitalise(match[1]!))
            ? ok({ kind: "as-enters-choose-card-name" as const })
            : fail(`"${match[1]}" is not this permanent (CR 109.2)`, match[1]!)
);

// ── Frame: as-enters opponent choice (CR 614.1c / 614.12a) ─────────────────

const AS_ENTERS_CHOOSE_OPPONENT = /^As (.+) enters, choose an opponent$/;

/**
 * "As <self> enters, choose an opponent" — anchored on the WHOLE sentence: a
 * different chooser or object ("a player", "a card name … and an opponent")
 * is another form and refuses here.
 */
const asEntersChooseOpponent: Rule<StaticClauseIR> = pattern(
    "as enters choose an opponent",
    AS_ENTERS_CHOOSE_OPPONENT,
    (match): RuleResult<StaticClauseIR> =>
        isSelfPhrase(uncapitalise(match[1]!))
            ? ok({ kind: "as-enters-choose-opponent" as const })
            : fail(`"${match[1]}" is not this permanent (CR 109.2)`, match[1]!)
);

// ── Frame: the chosen-name cast lock (CR 601.3a) ───────────────────────────

const chosenNameSpellsCantBeCast: Rule<StaticClauseIR> = pattern(
    "chosen name spells cant be cast",
    /^Spells with the chosen name can't be cast$/,
    (): RuleResult<StaticClauseIR> =>
        ok({ kind: "chosen-name-spells-cant-be-cast" as const })
);

// ── Frame: kicked entry riders (CR 614.1c / 702.33e) ───────────────────────

const KICKED_ENTERS_WITH =
    /^If (.+?) was kicked(?: with its (\{[^ ]+\}) kicker)?, it enters with (\S+) (\S+) counters? on it(?: and with (.+))?$/;
const ENTERS_WITH_EACH_KICK =
    /^(.+) enters with (\S+) (\S+) counters? on it for each time it was kicked$/;
const QUOTED_TAIL = /^"([^"]+)"$/;

/**
 * "If this creature was kicked[ with its {A} kicker], it enters with N <kind>
 * counters on it[ and with <keyword list> | and with \"<ability>\"]."
 *
 * Every optional part is READ, never skipped: a captured "with its {A}
 * kicker" becomes the kicker the rider is linked to (CR 702.33f), and a
 * captured "and with …" tail must parse WHOLE as a keyword list or ONE quoted
 * ability, or the card fails — so no printed extension can compile to its
 * counters alone (the prefix-match defect ADR 0105 exists to refuse). Still
 * refused:
 *
 *  - "… for each nonbasic land your opponents control" — a different count;
 *  - a quoted ability the activated / mana slots do not read — "Whenever this
 *    creature deals damage, you gain that much life." (a triggered grant) and
 *    "This creature can attack as though it didn't have defender." (a static
 *    one, Prison Barricade) have no self-grant reader yet.
 *
 * The CARD-level half — which kicker "kicked" and "with its {A} kicker" name,
 * and that the tally is 0 or 1 — is checked in lowering, which sees the kicker
 * line this sentence is linked to (CR 702.33e).
 */
const kickedEntersWithRule: Rule<StaticClauseIR> = rule(
    "kicked enters with counters",
    (span, ctx): RuleResult<StaticClauseIR> => {
        const match = span.match(KICKED_ENTERS_WITH);
        if (match === null)
            return fail("not a kicked entry rider this grammar knows", span);
        const base = kickedCounters(match[1]!, match[3]!, match[4]!, "kicked");
        if (!base.ok) return base;
        let kickedWith: ManaCost | undefined;
        if (match[2] !== undefined) {
            const mana = readManaCost(match[2]);
            if (!mana.ok) return fail(mana.reason, mana.fragment);
            kickedWith = mana.cost;
        }
        let grants: readonly SelfGrantIR[] | undefined;
        if (match[5] !== undefined) {
            const tail = readSelfGrants(match[5], ctx as ParseContext);
            if (!tail.ok) return tail;
            grants = tail.value;
        }
        return ok({
            ...(base.value as Extract<
                StaticClauseIR,
                { kind: "kicked-enters-with" }
            >),
            ...(kickedWith !== undefined ? { kickedWith } : {}),
            ...(grants !== undefined ? { grants } : {}),
        });
    }
);

/**
 * The "and with …" tail of a kicked entry rider (CR 614.1c): a keyword list,
 * or ONE ability in quotation marks, read by the same readers the enchanted
 * host frame uses — the ability the permanent enters with is exactly what it
 * would be if printed on it (CR 113.1a).
 */
function readSelfGrants(
    span: string,
    ctx: ParseContext
): RuleResult<readonly SelfGrantIR[]> {
    const quoted = span.match(QUOTED_TAIL);
    if (quoted !== null) {
        const ability = readQuotedAbilityIn(quoted[1]!, ctx);
        if (!ability.ok) return ability;
        return ok([
            {
                kind:
                    ability.value.kind === "triggered"
                        ? ("triggered-grant" as const)
                        : ("activated-grant" as const),
                text: quoted[1]!,
                ability: ability.value,
            },
        ]);
    }
    const keywords = readGrantedKeywords(span);
    if (!keywords.ok) return keywords;
    return ok(
        keywords.value.map((keyword) => ({
            kind: "keyword-grant" as const,
            keyword,
        }))
    );
}

/** "This creature enters with a +1/+1 counter on it for each time it was
 *  kicked." (CR 702.33c/d — Multikicker's usual reader). */
const entersWithEachKickRule: Rule<StaticClauseIR> = pattern(
    "enters with counters for each kick",
    ENTERS_WITH_EACH_KICK,
    (match): RuleResult<StaticClauseIR> =>
        kickedCounters(match[1]!, match[2]!, match[3]!, "each-kick")
);

function kickedCounters(
    subject: string,
    countWord: string,
    type: string,
    per: "kicked" | "each-kick"
): RuleResult<StaticClauseIR> {
    if (!isSelfPhrase(uncapitalise(subject)))
        return fail(`"${subject}" is not this permanent (CR 109.2)`, subject);
    const count = readNumberWord(countWord);
    if (count === null)
        return fail(`"${countWord}" is not a number word`, countWord);
    return ok({
        kind: "kicked-enters-with" as const,
        counters: { type, count },
        per,
    });
}

// ── Frame: the untap-step marker (CR 502.3) ────────────────────────────────

const DOES_NOT_UNTAP = /^(.+) doesn't untap during your untap step$/;

/**
 * "<self> doesn't untap during your untap step" (Basalt Monolith, Mana Vault).
 *
 * "during ITS CONTROLLER's untap step" is a DIFFERENT sentence — it is what an
 * Aura says about its host — and the regex will not match it, which is the
 * intended outcome: the two differ by whose untap step is meant, and the
 * `does-not-untap` marker means the source's own.
 */
const doesNotUntapRule: Rule<StaticClauseIR> = pattern(
    "does not untap",
    DOES_NOT_UNTAP,
    (match): RuleResult<StaticClauseIR> =>
        isSelfPhrase(uncapitalise(match[1]!))
            ? ok({ kind: "does-not-untap" as const })
            : fail(`"${match[1]}" is not this permanent (CR 109.2)`, match[1]!)
);

const SELF_CANT_BLOCK = /^(.+) can't block$/;

const SELF_CANT_BLOCK_UNLESS_MORE =
    /^(.+) can't block unless you control more creatures than attacking player$/;

/**
 * "<self> can't block unless you control more creatures than attacking player"
 * (Goblin Goon, Mogg Toady) — CR 509.1b. The one conditional tail read; any
 * other "unless …" stays refused.
 */
const selfCantBlockUnlessMoreCreaturesRule: Rule<StaticClauseIR> = pattern(
    "self can't block unless more creatures",
    SELF_CANT_BLOCK_UNLESS_MORE,
    (match): RuleResult<StaticClauseIR> =>
        isSelfPhrase(uncapitalise(match[1]!))
            ? ok({
                  kind: "self-block-restriction" as const,
                  sentence: `${match[1]!} can't block unless you control more creatures than attacking player.`,
                  unlessControlMoreCreatures: true as const,
              })
            : fail(`"${match[1]}" is not this permanent (CR 109.2)`, match[1]!)
);

/**
 * "<self> can't block" (Craven Giant, Kavu Aggressor) — CR 509.1b. Only the
 * bare sentence: "can't attack or block", "can't block <set>" and a tail
 * ("… unless …") do not match, so they stay refused.
 */
const selfCantBlockRule: Rule<StaticClauseIR> = pattern(
    "self can't block",
    SELF_CANT_BLOCK,
    (match): RuleResult<StaticClauseIR> =>
        isSelfPhrase(uncapitalise(match[1]!))
            ? ok({
                  kind: "self-block-restriction" as const,
                  sentence: `${match[1]!} can't block.`,
              })
            : fail(`"${match[1]}" is not this permanent (CR 109.2)`, match[1]!)
);

const SELF_CANT_ATTACK_UNLESS_MORE_CREATURES =
    /^(.+) can't attack unless you control more creatures than defending player$/;

/**
 * "<self> can't attack unless you control more creatures than defending
 * player" (Goblin Goon, Mogg Toady) — CR 508.1c. Only this one condition: the
 * unconditional "can't attack" and every other "unless" tail do not match.
 */
const selfCantAttackUnlessMoreCreaturesRule: Rule<StaticClauseIR> = pattern(
    "self can't attack unless more creatures",
    SELF_CANT_ATTACK_UNLESS_MORE_CREATURES,
    (match): RuleResult<StaticClauseIR> =>
        isSelfPhrase(uncapitalise(match[1]!))
            ? ok({
                  kind: "self-attack-restriction" as const,
                  unless: "more-creatures-than-defender" as const,
                  sentence: `${match[1]!} can't attack unless you control more creatures than defending player.`,
              })
            : fail(`"${match[1]}" is not this permanent (CR 109.2)`, match[1]!)
);

// ── Frames: untap-step locks over a set (CR 502.3) ─────────────────────────

/**
 * The only `PermanentFilter` fields the untap and enter-tapped locks read: the
 * card types and subtypes of the permanents they name. Anything else a subject
 * can carry ("you control", "tapped", a colour, an exclusion) changes WHOSE
 * permanents or WHICH ones the lock binds, and neither engine surface reads it
 * — `untapStep` binds the active player's own permanents, and the
 * enters-tapped scan reads the filter against the entering permanent alone — so
 * a subject carrying one is refused rather than silently widened.
 */
const LOCK_SUBJECT_FIELDS: ReadonlySet<string> = new Set(["types", "subtypes"]);

function readLockSubject(span: string): RuleResult<PermanentFilter> {
    const filter = readSubject(span, "recomputed");
    if (!filter.ok) return filter;
    const extra = Object.keys(filter.value).find(
        (field) => !LOCK_SUBJECT_FIELDS.has(field)
    );
    if (extra !== undefined)
        return fail(
            `"${extra}" is not a field an untap or enters-tapped lock reads`,
            span
        );
    return filter;
}

/**
 * "Artifacts and lands" — two plural card-type nouns joined by "and", read as
 * the UNION of their types (CR 205.2a: a permanent matches if it has either).
 * The descriptor grammar reads one noun phrase, so the list is split here, and
 * each side must be a bare type (a subtype or a qualifier on one side would
 * leave the other side's meaning for the reader to guess). A span with no
 * " and " is the plain {@link readLockSubject}.
 */
function readLockSubjectUnion(span: string): RuleResult<PermanentFilter> {
    const at = span.indexOf(" and ");
    if (at === -1) return readLockSubject(span);
    const sides = [span.slice(0, at), span.slice(at + " and ".length)];
    const types: string[] = [];
    for (const side of sides) {
        const part = readLockSubject(side);
        if (!part.ok) return part;
        const keys = Object.keys(part.value);
        if (keys.length !== 1 || keys[0] !== "types")
            return fail(`"${side}" is not a bare card-type noun`, side);
        types.push(...([part.value.types ?? []].flat() as string[]));
    }
    return ok({ types } as PermanentFilter);
}

const SET_DOES_NOT_UNTAP =
    /^(.+) don't untap during their controllers' untap steps$/;

/**
 * "Islands don't untap during their controllers' untap steps" (Choke, Curse of
 * Marit Lage). CR 502.3: the active player untaps their permanents, and the
 * lock removes the named set from that. Each controller's own untap step is
 * what the engine already binds (`collectUntapRestrictions`), so "their
 * controllers'" needs no further reading.
 */
const setDoesNotUntapRule: Rule<StaticClauseIR> = pattern(
    "set does not untap",
    SET_DOES_NOT_UNTAP,
    (match): RuleResult<StaticClauseIR> => {
        const filter = readLockSubject(match[1]!);
        if (!filter.ok) return filter;
        return ok({
            kind: "untap-lock" as const,
            filter: filter.value,
            maxUntap: 0,
        });
    }
);

const LAND_UNTAP_CAP =
    /^As long as (.+) is untapped, players can't untap more than one land during their untap steps$/;

/**
 * "As long as this artifact is untapped, players can't untap more than one land
 * during their untap steps" (Winter Orb). CR 502.3 caps the lands each player
 * untaps at one; CR 611.3a gates it on the SOURCE being untapped. "land" is the
 * only noun printed in a pool this rule reads, so it is spelled out rather than
 * captured.
 */
const landUntapCapRule: Rule<StaticClauseIR> = pattern(
    "land untap cap",
    LAND_UNTAP_CAP,
    (match): RuleResult<StaticClauseIR> =>
        isSelfPhrase(match[1]!)
            ? ok({
                  kind: "untap-lock" as const,
                  filter: { types: ["Land"] },
                  maxUntap: 1,
                  whileSourceUntapped: true as const,
              })
            : fail(`"${match[1]}" is not this permanent`, match[1]!)
);

const NON_MANA_LAND_LOCK =
    /^Each land with an activated ability that isn't a mana ability doesn't untap during its controller's untap step$/;

/**
 * Tsabo's Web's one printed sentence, read WHOLE. CR 605.1a defines a mana
 * ability; the engine's `useStack` is its test (`hasNonManaActivatedAbility`),
 * which is why the clause is a named flag and not a general "with an ability"
 * qualifier — no other card prints the qualifier, so a wildcard would accept a
 * shape nobody has printed.
 */
const nonManaAbilityLandLockRule: Rule<StaticClauseIR> = pattern(
    "non-mana-ability land lock",
    NON_MANA_LAND_LOCK,
    (): RuleResult<StaticClauseIR> =>
        ok({
            kind: "untap-lock" as const,
            filter: { types: ["Land"] },
            maxUntap: 0,
            nonManaActivatedAbility: true as const,
        })
);

const SKIP_UNTAP_STEPS = /^Players skip their untap steps$/;

/**
 * "Players skip their untap steps" (Stasis). CR 614.10 makes a skipped step a
 * replacement; the engine models it as the untap lock over every permanent
 * (the hand-written Stasis's encoding), so the untap step still runs and
 * simply untaps nothing. "Skip your untap step" (singular, the controller's own)
 * is a different sentence and stays refused by the anchored regex.
 */
const skipUntapStepsRule: Rule<StaticClauseIR> = pattern(
    "skip untap steps",
    SKIP_UNTAP_STEPS,
    (): RuleResult<StaticClauseIR> => ok({ kind: "skip-untap-steps" as const })
);

const SET_ENTER_TAPPED = /^(.+) enter tapped$/;

/**
 * "Artifacts and lands enter tapped" (Root Maze). CR 614.1d: a replacement
 * effect on the matching permanents as they enter, whoever controls them. The
 * plural verb is what tells it from the self rider "<self> enters tapped"
 * (`entersTappedPlain`); a subject naming a controller ("… your opponents
 * control", Kismet) is refused by {@link readLockSubject}.
 */
const setEntersTappedRule: Rule<StaticClauseIR> = pattern(
    "set enters tapped",
    SET_ENTER_TAPPED,
    (match): RuleResult<StaticClauseIR> => {
        const filter = readLockSubjectUnion(match[1]!);
        if (!filter.ok) return filter;
        return ok({
            kind: "enters-tapped-lock" as const,
            filter: filter.value,
        });
    }
);

// ── Frame: a forced target choice (CR 601.2c) ──────────────────────────────

/**
 * The Flagbearer cycle's one printed sentence (Standard Bearer, Coalition
 * Honor Guard, Coalition Flag). Read WHOLE, with the creature type spelled as
 * the cards spell it, and nothing else: no card prints the clause about any
 * other type, so a wildcard here would accept a shape nobody has printed
 * (the axis of variation shows up with card #2 — ADR 0137). Its neighbours
 * stay refused under their own gap keys — "While choosing targets as part of
 * casting a spell or activating an ability, your opponents must choose at
 * least one Flagbearer if able" (Enroll in the Coalition) is a different
 * sentence, and a rule that read both would be a rule that read a line it had
 * no fixture for.
 *
 * The sentence itself scopes the clause to a CAST or an ABILITY ACTIVATION
 * (CR 601.2c for a spell; CR 602.2b applies the same rules to an activated
 * ability), which is what the engine's `target-choice-requirement` static
 * reads (`gre/targetChoiceRequirements.ts`); nothing here restates that scope.
 */
const OPPONENT_TARGET_CHOICE =
    /^While an opponent is choosing targets as part of casting a spell they control or activating an ability they control, that player must choose at least one (Flagbearer) on the battlefield if able$/;

const targetChoiceRequirementRule: Rule<StaticClauseIR> = pattern(
    "target choice requirement",
    OPPONENT_TARGET_CHOICE,
    (match): RuleResult<StaticClauseIR> =>
        ok({
            kind: "target-choice-requirement" as const,
            binds: "opponents" as const,
            subtype: match[1]!,
        })
);

// ── Frame: the skipped draw step (CR 614.10) ───────────────────────────────

/**
 * "Skip your draw step" (Necropotence, Yawgmoth's Bargain). CR 614.10: an
 * effect that causes a player to skip a step is a replacement effect, and this
 * one is unconditional — no "may", no "next", no other step.
 *
 * The engine's encoding (`drawStepReplacement`) suppresses the turn-based draw
 * (CR 504.1) and still runs the step, so a beginning-of-draw-step trigger
 * fires as it does for the hand-written Necropotence. That is the engine's
 * pre-existing reading of the flag, not this rule's: the flag is shared with
 * Fasting and Island Sanctuary, whose own DRAW trigger must run. The
 * whole-step skip is `docs/findings/4304-draw-step-flag-skips-draw-not-step.md`.
 * Every neighbour
 * ("Skip your untap step", "Skip your next draw step", "You may skip your draw
 * step", "Each player skips their draw step") differs from this sentence and
 * stays refused: the anchored regex reads exactly the printed one.
 *
 * `Skip` is capitalised because the clause IS the sentence — nothing precedes
 * it to have lower-cased it — and the slot has already consumed the full stop.
 */
const SKIP_DRAW_STEP = /^Skip your draw step$/;

const skipDrawStepRule: Rule<StaticClauseIR> = pattern(
    "skip draw step",
    SKIP_DRAW_STEP,
    (): RuleResult<StaticClauseIR> => ok({ kind: "skip-draw-step" as const })
);

// ── Frame: the optional draw skip (CR 614.1a) ──────────────────────────────

/**
 * "If you would draw a card during your draw step, instead you may skip that
 * draw. If you do, <body>." (Island Sanctuary.) CR 614.1a: "instead" makes the
 * skip a replacement effect of the turn-based draw (CR 504.1), and "you may"
 * leaves it optional — declining draws the card. The engine's encoding is the
 * hand-written one: `drawStepReplacement` suppresses the turn-based draw and
 * the card's own DRAW-step trigger offers the choice (see `lower.ts`).
 *
 * The anchored opening is the ONLY one read. Fasting's "If you would begin
 * your draw step, you may skip that step instead" replaces the step, not a
 * draw (CR 614.10), and stays refused. The body is the shared effect grammar:
 * what "If you do" does is not this frame's business.
 */
const OPTIONAL_DRAW_SKIP =
    /^If you would draw a card during your draw step, instead you may skip that draw\. If you do, (.+)$/;

const optionalDrawSkipRule: Rule<StaticClauseIR> = rule(
    "optional draw skip",
    (span, ctx): RuleResult<StaticClauseIR> => {
        const match = span.match(OPTIONAL_DRAW_SKIP);
        if (match === null) return fail("not the optional draw skip", span);
        const body = sentenceRule.run(capitalise(match[1]!), ctx);
        if (!body.ok) return body;
        const assembled = assembleSentences([body.value], {
            site: "optional draw skip",
            rejectRestrictions:
                'an activation restriction (CR 602.5) has no meaning after "If you do"',
        });
        if (!assembled.ok) return fail(assembled.reason, span);
        return ok({
            kind: "optional-draw-skip" as const,
            effects: assembled.effects,
        });
    }
);

// ── Frame: the self-shuffle replacement (CR 614.1a) ─────────────────────────

/**
 * "If <self> would be put into a graveyard from anywhere, reveal <self> and
 * shuffle it into its owner's library instead." (Blightsteel Colossus,
 * Darksteel Colossus, Progenitus, Legacy Weapon.) CR 614.1a: "instead" makes it
 * a replacement effect, so the card never reaches the graveyard — no
 * dies/discarded/milled event fires for it. The engine encoding is the one the
 * hand-written Blightsteel Colossus already carries
 * (`shuffleFromAnywhereReplacement`, issue #2106), including its one confessed
 * simplification: the CR 701.20a reveal is not modelled (tracked-by: #2557).
 *
 * Both self references must name THIS object (CR 201.5). Every neighbour stays
 * refused by the anchored regex: the "When <self> is put into a graveyard from
 * anywhere" TRIGGER (Emrakul, the Aeons Torn — CR 603, not a replacement), an
 * exile redirect, and a wording without "reveal". The same sentence on an
 * instant (Nexus of Fate) is a separate Grammar Gap under the spell slot.
 */
const SHUFFLE_FROM_ANYWHERE =
    /^If (.+) would be put into a graveyard from anywhere, reveal (.+) and shuffle it into its owner's library instead$/;

const shuffleFromAnywhereRule: Rule<StaticClauseIR> = pattern(
    "shuffle from anywhere",
    SHUFFLE_FROM_ANYWHERE,
    (match): RuleResult<StaticClauseIR> => {
        for (const phrase of [match[1]!, match[2]!])
            if (!isSelfPhrase(phrase))
                return fail(
                    `"${phrase}" is not this object (CR 201.5)`,
                    phrase
                );
        return ok({ kind: "shuffle-from-anywhere" as const });
    }
);

// ── Frame: the self damage-prevention shield with a counter cost (CR 615) ───

/**
 * "If damage would be dealt to <self>, prevent that damage. Remove a +1/+1
 * counter from <self>." (Phantom Centaur, Phantom Nishoba, Phantom Tiger, …)
 * CR 615.1a: the word "prevent" makes it a prevention effect; the second
 * sentence is its additional effect, one counter per damage EVENT. Both
 * subjects must name THIS object (CR 201.5). The anchored regex refuses every
 * neighbour: a damage SOURCE filter ("If a source would deal damage …"), a
 * partial prevention ("prevent 1 of that damage"), a per-point removal (Rock
 * Hydra's "for each 1 damage"), a different counter kind, and a count other
 * than one.
 */
const DAMAGE_PREVENTION_COUNTER_REMOVAL =
    /^If damage would be dealt to (.+), prevent that damage\. Remove a \+1\/\+1 counter from (.+)$/;

const damagePreventionCounterRemovalRule: Rule<StaticClauseIR> = pattern(
    "damage prevention counter removal",
    DAMAGE_PREVENTION_COUNTER_REMOVAL,
    (match): RuleResult<StaticClauseIR> => {
        for (const phrase of [match[1]!, match[2]!])
            if (!isSelfPhrase(phrase))
                return fail(
                    `"${phrase}" is not this object (CR 201.5)`,
                    phrase
                );
        return ok({ kind: "damage-prevention-counter-removal" as const });
    }
);

// ── Frame: the controller's damage-prevention shield (CR 615) ───────────────

/**
 * "Prevent all damage that would be dealt to you." (Solitary Confinement,
 * Glacial Chasm.) CR 615.1a: "prevent" makes it a prevention effect; "you" is
 * the permanent's controller. The anchored text refuses every neighbour: a
 * duration ("… this turn"), a source filter ("… by sources you don't
 * control"), and extra recipients ("… and permanents you control").
 */
const CONTROLLER_DAMAGE_PREVENTION =
    /^Prevent all damage that would be dealt to you$/;

const controllerDamagePreventionRule: Rule<StaticClauseIR> = pattern(
    "controller damage prevention",
    CONTROLLER_DAMAGE_PREVENTION,
    (): RuleResult<StaticClauseIR> =>
        ok({ kind: "controller-damage-prevention" as const })
);

// ── Frame: the conditional life floor (CR 614.1a) ───────────────────────────

/**
 * "If you control a creature, damage that would reduce your life total to less
 * than 1 reduces it to 1 instead." (Worship.) CR 614.1a: "instead" makes it a
 * replacement effect; CR 120.4c: it acts on the result of damage, the life
 * loss. Both numbers must be the same N. The anchored text refuses every
 * neighbour: an unconditional floor, another condition ("As long as you have
 * N or more life"), a duration ("Until end of turn, …"), and an emblem.
 */
const DAMAGE_LIFE_FLOOR =
    /^If you control a creature, damage that would reduce your life total to less than (\d+) reduces it to (\d+) instead$/;

const damageLifeFloorRule: Rule<StaticClauseIR> = pattern(
    "damage life floor",
    DAMAGE_LIFE_FLOOR,
    (match): RuleResult<StaticClauseIR> => {
        if (match[1] !== match[2])
            return fail(
                `floor "${match[1]}" differs from "${match[2]}"`,
                match[2]!
            );
        return ok({
            kind: "damage-life-floor" as const,
            floor: Number(match[1]),
        });
    }
);

// ── Frames: the enchanted host (CR 303.4b) ────────────────────────────────

/** The nouns "enchanted" is printed with, and the card type each names. */
const HOST_NOUNS: ReadonlyMap<string, HostNoun> = new Map<string, HostNoun>([
    ["creature", "Creature"],
    ["artifact", "Artifact"],
    ["land", "Land"],
    ["enchantment", "Enchantment"],
    ["planeswalker", "Planeswalker"],
    ["permanent", "permanent"],
]);

const HOST_NOUN_ALTERNATION = [...HOST_NOUNS.keys()].join("|");
const ENCHANTED_SUBJECT = new RegExp(
    `^Enchanted (${HOST_NOUN_ALTERNATION}) (.+)$`
);
const YOU_CONTROL_HOST = new RegExp(
    `^You control enchanted (${HOST_NOUN_ALTERNATION})$`
);
const HOST_PT = /^gets ([+-]\d+)\/([+-]\d+)(?: and (.+))?$/;
const QUOTED_GRANT = /^has "([^"]+)"$/;

/**
 * CR 702.16n — the Aura-keeping rider. Anchored at the END of the sentence and only
 * ever accepted beside a protection grant (see `enchantedHostRule`), because
 * that is the only thing it modifies.
 */
const KEEPS_THIS_AURA = ". This effect doesn't remove this Aura";

/** CR 105.1 — the five colour words protection is printed with here. */
const COLOUR_WORDS: ReadonlySet<string> = new Set([
    "white",
    "blue",
    "black",
    "red",
    "green",
]);

const PROTECTION_FROM = "protection from ";

/** "this Aura" / "this enchantment" — the granting Aura, never the host. */
const SELF_AURA_PHRASE = /\bthis (aura|enchantment)\b/i;

/**
 * "flying", "flying and first strike", "flying, first strike, and trample",
 * "protection from green and from blue" — a list of keywords a host is
 * granted.
 *
 * Every item must be a keyword the registry vocabulary names, or a
 * "protection from <colour>" (CR 702.16a) — the one parameterised keyword read
 * here, and only in its colour family, which is the family every engine
 * consult site answers (`gre/protection.ts`). "protection from green and from
 * blue" is two instances (CR 702.16a: each "from" names a quality), which is
 * exactly how the hand-written catalogue writes it — two `staticAbilities`
 * strings, never one. Anything else fails the list, never drops an item.
 */
function readGrantedKeywords(span: string): RuleResult<readonly KeywordIR[]> {
    // A serial list ends in "and" ("flying, first strike, and trample");
    // a bare comma list ("shroud, flying") is not an Oracle keyword list.
    if (span.includes(", ") && !/(, | )and [^,]+$/.test(span))
        return fail(
            'a keyword list whose last item is not joined by "and"',
            span
        );
    const items = span.split(/, and |, | and /);
    const out: KeywordIR[] = [];
    let previousWasProtection = false;
    for (const raw of items) {
        const item = raw.toLowerCase();
        let colour: string | undefined;
        if (item.startsWith(PROTECTION_FROM))
            colour = item.slice(PROTECTION_FROM.length);
        else if (previousWasProtection && item.startsWith("from "))
            colour = item.slice("from ".length);
        if (colour !== undefined) {
            if (!COLOUR_WORDS.has(colour))
                return fail(
                    `"${item}" is not a colour protection quality (CR 702.16a)`,
                    raw
                );
            const protection = keywordVocabulary().get("protection");
            if (protection === undefined)
                return fail("protection is not in the registry", raw);
            out.push({ ...protection, ability: `${PROTECTION_FROM}${colour}` });
            previousWasProtection = true;
            continue;
        }
        previousWasProtection = false;
        const keyword = keywordVocabulary().get(item);
        if (keyword === undefined)
            return fail(`"${raw}" is not a keyword ability`, raw);
        out.push(keyword);
    }
    const names = out.map((k) => k.ability);
    if (new Set(names).size !== names.length)
        return fail("a keyword granted twice in one sentence", span);
    return ok(out);
}

/**
 * The ability inside 'has "…"' — read by the SAME slots that read a printed
 * one, because a granted ability is exactly what it would be if it were
 * printed on the host (CR 113.1a).
 *
 * The parse context's TYPE LINE is the host's, not the Aura's: the ability
 * belongs to the enchanted permanent, and the activated slots ask the type
 * line whether a permanent is what they are reading. "Enchanted permanent"
 * names no single type to put there, and is refused rather than given one.
 *
 * Exactly one slot must accept it, the router's own unique-dispatch rule
 * (`router.ts`); a line both an activated and a mana reading accept is a
 * grammar defect to report, not a coin to flip.
 */
function readQuotedAbility(
    text: string,
    host: HostNoun,
    ctx: ParseContext
): RuleResult<QuotedAbilityIR> {
    if (host === "permanent")
        return fail(
            'a granted ability on "enchanted permanent" names no host type',
            text
        );
    // The Aura's own name inside the quote would be the AURA (CR 201.5a), a
    // different object from the one the ability is granted to — and so is
    // "this Aura" / "this enchantment", which modern Oracle text prints in
    // place of the name and `normalize` leaves alone. Lowered, either would
    // bind to `$source`, which for a granted ability is the HOST: "Return
    // this Aura to its owner's hand" would bounce the creature.
    if (text.includes(ctx.selfMarker) || SELF_AURA_PHRASE.test(text))
        return fail("a granted ability naming the Aura itself", text);
    return readQuotedAbilityIn(text, {
        ...ctx,
        typeLine: {
            types: [host],
            supertypes: [],
            subtypes: [],
            hostTypeOnly: true,
        },
    });
}

/**
 * The slot dispatch at the heart of {@link readQuotedAbility}, with the parse
 * context already set to the permanent the ability will BELONG to. Shared with
 * the kicked entry rider (CR 614.1c), whose quoted ability belongs to the card
 * itself — so its own type line is the right one, and "this creature" inside
 * the quote is the card, not a different object.
 */
function readQuotedAbilityIn(
    text: string,
    ctx: ParseContext
): RuleResult<QuotedAbilityIR> {
    const hits: QuotedAbilityIR[] = [];
    const misses: string[] = [];
    for (const slot of [activatedSlot, manaAbilitySlot, triggeredSlot]) {
        const r = slot.run(text, ctx);
        if (!r.ok) {
            misses.push(r.reason);
            continue;
        }
        if (
            r.value.kind !== "activated" &&
            r.value.kind !== "mana-ability" &&
            r.value.kind !== "triggered"
        )
            return fail(
                "a quoted ability that is not an activated, mana or triggered ability",
                text
            );
        hits.push(r.value);
    }
    if (hits.length === 1) return ok(hits[0]!);
    if (hits.length > 1)
        return fail("ambiguous quoted ability: two slots consumed it", text);
    return fail(`quoted ability — ${[...new Set(misses)].join("; ")}`, text);
}

// CR 113.1a + CR 205.1b — "This land becomes a … creature with \"<ability>\"":
// the quoted ability belongs to the animated SOURCE, which is a creature while
// the grant lasts, so "this creature" inside the quote names it. The effect
// clause cannot import the slots (cycle), so it reads through this reader.
registerQuotedAbilityReader((text, ctx) =>
    readQuotedAbilityIn(text, {
        ...ctx,
        typeLine: {
            types: ["Creature"],
            supertypes: [],
            subtypes: [],
            hostTypeOnly: true,
        },
    })
);

/** What follows "Enchanted <noun> gets +N/+N and" — or the whole predicate. */
function readHostPredicate(
    span: string,
    subject: string,
    host: HostNoun,
    ctx: ParseContext
): RuleResult<readonly HostEffectIR[]> {
    const sentence = `${subject} ${span}.`;
    if (span === "can't attack")
        return ok([{ kind: "attack-restriction" as const, sentence }]);
    if (span === "can't block")
        return ok([{ kind: "block-restriction" as const, sentence }]);
    if (span === "can't attack or block")
        return ok([
            { kind: "attack-restriction" as const, sentence },
            { kind: "block-restriction" as const, sentence },
        ]);
    const quoted = span.match(QUOTED_GRANT);
    if (quoted !== null) {
        const ability = readQuotedAbility(quoted[1]!, host, ctx);
        if (!ability.ok) return ability;
        return ok([
            {
                kind:
                    ability.value.kind === "triggered"
                        ? ("triggered-grant" as const)
                        : ("activated-grant" as const),
                text: quoted[1]!,
                ability: ability.value,
            },
        ]);
    }
    if (span.startsWith("has ")) {
        const keywords = readGrantedKeywords(span.slice("has ".length));
        if (!keywords.ok) return keywords;
        return ok(
            keywords.value.map((keyword) => ({
                kind: "keyword-grant" as const,
                keyword,
            }))
        );
    }
    return fail(`"${span}" is not an effect this frame reads on a host`, span);
}

/**
 * "Enchanted <noun> <predicate>[. This effect doesn't remove this Aura]".
 *
 * The predicate is an optional P/T modifier, then at most ONE of: a keyword
 * list, a quoted ability, or a combat restriction — the shapes the corpus
 * prints ("gets +2/+2 and has flying", "gets +2/+2 and can't block"). Every
 * other tail ("gets +2/+2 as long as …", "gets +X/+X, where X is …", "has
 * shroud as long as it's untapped", "is goaded", "attacks each combat if
 * able") fails the frame whole rather than compiling the half it read.
 */
const enchantedHostRule: Rule<StaticClauseIR> = rule(
    "enchanted host",
    (span, ctx): RuleResult<StaticClauseIR> => {
        let body = span;
        let keepsThisAura = false;
        if (body.endsWith(KEEPS_THIS_AURA)) {
            keepsThisAura = true;
            body = body.slice(0, -KEEPS_THIS_AURA.length);
        }
        const match = body.match(ENCHANTED_SUBJECT);
        if (match === null)
            return fail('not an "Enchanted <noun>" sentence', span);
        const host = HOST_NOUNS.get(match[1]!)!;
        let rest = match[2]!;
        const effects: HostEffectIR[] = [];
        const pt = rest.match(HOST_PT);
        if (pt !== null) {
            effects.push({
                kind: "pt-buff",
                power: signedModifier(pt[1]!),
                toughness: signedModifier(pt[2]!),
            });
            if (pt[3] === undefined) rest = "";
            else rest = pt[3];
        }
        if (rest.length > 0) {
            const more = readHostPredicate(
                rest,
                `Enchanted ${match[1]!}`,
                host,
                ctx as ParseContext
            );
            if (!more.ok) return more;
            effects.push(...more.value);
        }
        // CR 702.16n — the rider modifies a protection grant and nothing else.
        if (
            keepsThisAura &&
            !effects.some(
                (e) =>
                    e.kind === "keyword-grant" &&
                    e.keyword.ability.startsWith(PROTECTION_FROM)
            )
        )
            return fail(
                '"This effect doesn\'t remove this Aura" without a protection grant (CR 702.16n)',
                span
            );
        return ok({
            kind: "enchanted-host" as const,
            host,
            effects,
            ...(keepsThisAura ? { keepsThisAura: true as const } : {}),
        });
    }
);

/** "You control enchanted <noun>" (Control Magic, Steal Artifact). */
const youControlHostRule: Rule<StaticClauseIR> = pattern(
    "control enchanted host",
    YOU_CONTROL_HOST,
    (match): RuleResult<StaticClauseIR> =>
        ok({
            kind: "enchanted-host" as const,
            host: HOST_NOUNS.get(match[1]!)!,
            effects: [{ kind: "control-change" as const }],
        })
);

// ── Frame: an additional land play (CR 305.2) ───────────────────────────────

/**
 * "You may play an additional land on each of your turns." (Exploration.)
 * CR 305.2: a player can normally play one land per turn; effects can raise
 * the number. The sentence names exactly one more, so the count is 1 — the
 * bounded analogue of an unlimited allowance. Its neighbours ("As long as you
 * control another Elf, …", "N+ | …") add a condition the engine encoding has
 * no place for and stay refused by the anchored regex.
 */
const EXTRA_LAND_DROP =
    /^You may play an additional land on each of your turns$/;

const extraLandDropRule: Rule<StaticClauseIR> = pattern(
    "additional land play",
    EXTRA_LAND_DROP,
    (): RuleResult<StaticClauseIR> =>
        ok({ kind: "extra-land-drop" as const, count: 1 })
);

// ── Frame: the library-top reveal (CR 401.5) ──────────────────────────────

/**
 * "Play with the top card of your library revealed." (Goblin Spy, Courser of
 * Kruphix.) CR 401.5: an effect tells a player to play with the top card of
 * their library revealed. The sentence is the whole clause; the opponent
 * variants ("Your opponents play with…") and the companion "you may look at"
 * permission name a different audience or effect and stay refused by the
 * anchored match.
 */
const REVEAL_LIBRARY_TOP = "Play with the top card of your library revealed";

const revealLibraryTopRule: Rule<StaticClauseIR> = rule(
    "library top reveal",
    (span): RuleResult<StaticClauseIR> =>
        span === REVEAL_LIBRARY_TOP
            ? ok({ kind: "reveal-library-top" as const })
            : fail("not the library-top reveal template", span)
);

// ── Frame: the as-enters discard (CR 614.1a) ────────────────────────────────

/**
 * "If this artifact would enter, you may discard a land card instead. If you
 * do, put this artifact onto the battlefield. If you don't, put it into its
 * owner's graveyard." (Mox Diamond.) CR 614.1a: "instead" makes it a
 * replacement effect of the permanent entering, and CR 701.9 defines the
 * discard it offers. Both self references must name THIS object (CR 201.5).
 * The two follow-up sentences are the whole of the replacement — "If you do"
 * is the discard paid, "If you don't" its decline — and a rider other than
 * the graveyard (an exile redirect, a sacrifice) differs from the anchored
 * text and stays refused.
 */
const AS_ENTERS_DISCARD =
    /^If (.+) would enter, you may discard a land card instead\. If you do, put (.+) onto the battlefield\. If you don't, put it into its owner's graveyard$/;

const asEntersDiscardRule: Rule<StaticClauseIR> = pattern(
    "as-enters discard",
    AS_ENTERS_DISCARD,
    (match): RuleResult<StaticClauseIR> => {
        if (!isSelfPhrase(match[1]!) || !isSelfPhrase(match[2]!))
            return fail(
                "the discarding permanent is not this object",
                match[0]
            );
        return ok({
            kind: "as-enters-discard" as const,
            filter: { type: "Land" as const },
        });
    }
);

/**
 * "If this land would enter, sacrifice a Forest instead. If you do, put this
 * land onto the battlefield. If you don't, put it into its owner's
 * graveyard." (Heart of Yavimaya.) CR 614.1a makes the "instead" a
 * replacement effect of the entry and CR 701.21a defines the sacrifice. Only
 * a basic land type names the victim: that is the whole printed family, and a
 * broader noun ("a land", "a creature") differs from the anchored text and
 * stays refused. As with the discard form, a rider other than the graveyard
 * on the decline branch stays refused.
 */
const AS_ENTERS_SACRIFICE =
    /^If (.+) would enter, sacrifice an? (Plains|Island|Swamp|Mountain|Forest) instead\. If you do, put (.+) onto the battlefield\. If you don't, put it into its owner's graveyard$/;

const asEntersSacrificeRule: Rule<StaticClauseIR> = pattern(
    "as-enters sacrifice",
    AS_ENTERS_SACRIFICE,
    (match): RuleResult<StaticClauseIR> => {
        if (!isSelfPhrase(match[1]!) || !isSelfPhrase(match[3]!))
            return fail(
                "the sacrificing permanent is not this object",
                match[0]
            );
        return ok({
            kind: "as-enters-sacrifice" as const,
            filter: { subtypes: match[2]! },
        });
    }
);

// ── Frame: the as-enters graveyard exile (CR 614.12a) ──────────────────────

/**
 * "As <self> enters, exile any number of creature cards from your graveyard."
 * (Sutured Ghoul.) CR 614.12a: an "as … enters" clause is a replacement
 * effect, so the exile happens before the permanent exists and the cards it
 * exiles are the linked pile CR 607.2b lets the permanent's other abilities
 * read. Anchored on the whole sentence and on creature cards: another card
 * type, a fixed count ("two creature cards"), or an opponent's graveyard
 * differs from the anchored text and stays refused.
 */
const AS_ENTERS_EXILE_FROM_GRAVEYARD =
    /^As (.+) enters, exile any number of creature cards from your graveyard$/;

const asEntersExileFromGraveyardRule: Rule<StaticClauseIR> = pattern(
    "as enters exile from graveyard",
    AS_ENTERS_EXILE_FROM_GRAVEYARD,
    (match): RuleResult<StaticClauseIR> =>
        isSelfPhrase(uncapitalise(match[1]!))
            ? ok({
                  kind: "as-enters-exile-from-graveyard" as const,
                  filter: { type: "Creature" as const },
              })
            : fail(`"${match[1]}" is not this permanent (CR 109.2)`, match[1]!)
);

// ── Frame: player shroud (CR 702.18) ────────────────────────────────────────

/**
 * "You have shroud." (Ivory Mask, Solitary Confinement.) CR 702.18a: a player
 * with shroud can't be the target of spells or abilities (CR 115.1 — players
 * are legal targets, so the keyword reaches them). The controller only:
 * "Players have shroud" and "Target player has shroud" name other holders and
 * differ from the anchored text.
 */
const PLAYER_SHROUD = /^You have shroud$/;

const playerShroudRule: Rule<StaticClauseIR> = pattern(
    "player shroud",
    PLAYER_SHROUD,
    (): RuleResult<StaticClauseIR> => ok({ kind: "player-shroud" as const })
);

// ── Frame: play lands and cast spells from the top of the library ──────────

/**
 * "You may play lands and cast spells from the top of your library."
 * (Future Sight, Magus of the Future, Experimental Frenzy, One with the
 * Multiverse.) CR 601.3: a player can begin to cast a spell only if an effect
 * allows it, and this one allows it for the top card; CR 305.1: the same
 * permission for a land play. The two halves are ONE sentence and one
 * permission pair — the land-only wording ("play lands from the top", Courser
 * of Kruphix) and the pay-life rider (Bolas's Citadel) differ from the
 * anchored text and stay refused. Cards that print only this sentence carry
 * no reveal: the reveal/look clauses are separate lines with their own rules.
 */
const PLAY_FROM_LIBRARY_TOP =
    /^You may play lands and cast spells from the top of your library$/;

const playFromLibraryTopRule: Rule<StaticClauseIR> = pattern(
    "play from library top",
    PLAY_FROM_LIBRARY_TOP,
    (): RuleResult<StaticClauseIR> =>
        ok({ kind: "play-from-library-top" as const })
);

// ── Frame: flash permission with an off-timing sacrifice (CR 702.8a) ───────

/**
 * The Mirage/Visions template, whole: "You may cast this spell as though it
 * had flash. If you cast it any time a sorcery couldn't have been cast, the
 * controller of the permanent it becomes sacrifices it at the beginning of
 * the next cleanup step." (Spider Climb, Parapet, Necromancy.) Two sentences,
 * ONE ability: the permission (CR 702.8a's "any time you could cast an
 * instant", granted without the keyword) and the price of using it, keyed on
 * the timing USED (CR 307.1 — when a sorcery could have been cast), with a
 * CR 603.7a delayed sacrifice at the cleanup step (CR 514.3a). The first
 * sentence alone (Rout's "as though it had flash" with a surcharge) and an
 * end-step or "destroy" variant differ from the anchored text and stay
 * refused.
 */
const FLASH_CAST_CLEANUP_SACRIFICE =
    "You may cast this spell as though it had flash. If you cast it any time a sorcery couldn't have been cast, the controller of the permanent it becomes sacrifices it at the beginning of the next cleanup step";

const flashCastCleanupSacrificeRule: Rule<StaticClauseIR> = rule(
    "flash cast cleanup sacrifice",
    (span): RuleResult<StaticClauseIR> =>
        span === FLASH_CAST_CLEANUP_SACRIFICE
            ? ok({ kind: "flash-cast-cleanup-sacrifice" as const })
            : fail("not the flash-cast cleanup-sacrifice template", span)
);

// ── The clause ─────────────────────────────────────────────────────────────

export const staticClauseRule: Rule<StaticClauseIR> = subGrammar(
    STATIC_CLAUSE,
    oneOf(STATIC_CLAUSE, [
        anthemRule,
        keywordGrantRule,
        graveyardKeywordGrantRule,
        fullTextEffectRule,
        costModifierRule,
        offTurnCostModifierRule,
        abilityCostModifierRule,
        attackManaTaxRule,
        attackProhibitionRule,
        creatureActivationLockRule,
        castPermissionRule,
        entersTappedPlain,
        entersTappedWithCounters,
        entersPrepared,
        entersWithCounters,
        asEntersChooseCreatureType,
        asEntersChooseNonlandCardName,
        asEntersChooseOpponent,
        chosenNameSpellsCantBeCast,
        kickedEntersWithRule,
        entersWithEachKickRule,
        doesNotUntapRule,
        selfCantBlockRule,
        selfCantBlockUnlessMoreCreaturesRule,
        selfCantAttackUnlessMoreCreaturesRule,
        setDoesNotUntapRule,
        landUntapCapRule,
        nonManaAbilityLandLockRule,
        skipUntapStepsRule,
        setEntersTappedRule,
        targetChoiceRequirementRule,
        skipDrawStepRule,
        optionalDrawSkipRule,
        extraLandDropRule,
        revealLibraryTopRule,
        asEntersDiscardRule,
        asEntersSacrificeRule,
        asEntersExileFromGraveyardRule,
        playerShroudRule,
        playFromLibraryTopRule,
        flashCastCleanupSacrificeRule,
        shuffleFromAnywhereRule,
        damagePreventionCounterRemovalRule,
        controllerDamagePreventionRule,
        damageLifeFloorRule,
        selfConditionalPumpRule,
        abilityLossPtSetRule,
        chosenTypePumpRule,
        animateManaValueRule,
        selfPtCdaGraveyardsRule,
        selfPtCdaExiledTotalsRule,
        enchantedHostRule,
        youControlHostRule,
    ])
);
