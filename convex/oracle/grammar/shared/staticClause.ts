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
 * (issue #4126). Its condition is not a second vocabulary — it IS the
 * `CompiledTriggerCondition` a trigger's intervening-if carries, read by the
 * shared `controlsRule`, and the descriptor rebuilds it into
 * `StaticPTBuff.condition`. Every other "as long as" tail ("an opponent
 * controls", "it's untapped", "you have …") still fails the line.
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
import { controlsRule, type ConditionIR } from "./condition";
import { signedModifier, uncapitalise } from "./effectClause";
import {
    descriptorRule,
    staticFilterFromDescriptor,
    type DescriptorIR,
    type StaticFilterEvaluation,
} from "./targetFilter";
import { keywordVocabulary } from "./keywordVocabulary";
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
    /** CR 601.2f — a cost modifier on a class of spells. */
    | {
          readonly kind: "cost-modifier";
          readonly spells: CompiledSpellFilter;
          readonly direction: "more" | "less";
          readonly amount: number;
      }
    /** CR 601.3 / 118.9 — a board permission to cast a CLASS of spells. */
    | {
          readonly kind: "cast-permission";
          readonly grantee: "any-player" | "controller";
          readonly filter: EffectCardFilter;
          readonly withoutPayingManaCost?: true;
          readonly asThoughFlash?: true;
      }
    /** CR 614.1c / 122.1 — how this permanent enters. */
    | {
          readonly kind: "enters-tapped";
          readonly counters?: { readonly type: string; readonly count: number };
      }
    /**
     * CR 614.1c / 614.12a / 205.3m — "As this creature enters, choose a
     * creature type": a choice made BEFORE the permanent enters, over the
     * whole CR 205.3m creature-type list, kept on the permanent for the
     * abilities that read "the chosen type" (CR 607.2d).
     */
    | { readonly kind: "as-enters-choose-creature-type" }
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
    /** CR 614.10 / 504.1 — "Skip your draw step": an unconditional
     *  replacement of the controller's own turn-based draw. Lowered to
     *  `drawStepReplacement`, which suppresses the draw but not the step. */
    | { readonly kind: "skip-draw-step" }
    /** CR 614.1a — "If <self> would be put into a graveyard from anywhere,
     *  reveal <self> and shuffle it into its owner's library instead".
     *  Lowered to `shuffleFromAnywhere`. */
    | { readonly kind: "shuffle-from-anywhere" }
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
     * <descriptor>": the permanent's own layer-7c buff, present only while
     * the condition holds (re-checked at every layer read).
     */
    | {
          readonly kind: "self-pt-buff-if-controls";
          readonly power: number;
          readonly toughness: number;
          readonly condition: ConditionIR;
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
    /^(.+) gets ([+-]\d+)\/([+-]\d+) as long as (you control .+)$/;

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
            return fail(
                'not "<self> gets +N/+N as long as you control …"',
                span
            );
        if (!isSelfPhrase(uncapitalise(match[1]!)))
            return fail(`"${match[1]}" is not the permanent itself`, span);
        const condition = controlsRule.run(match[4]!, ctx);
        if (!condition.ok) return condition;
        return ok({
            kind: "self-pt-buff-if-controls" as const,
            power: signedModifier(match[2]!),
            toughness: signedModifier(match[3]!),
            condition: condition.value,
        });
    }
);

// ── Frame: keyword grant (CR 613.1f) ───────────────────────────────────────

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
            const filter = readSubject(subject, "materialised");
            if (!filter.ok) return filter;
            return ok({
                kind: "keyword-grant" as const,
                filter: filter.value,
                keyword,
            });
        })
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
    // list, so a UNION of two classes has no encoding here. Refused by name
    // rather than mis-lowered to whichever half came first.
    if (classes.value.length > 1)
        return fail(
            `a cost modifier over a UNION of spell classes is not expressible (CR 601.2f)`,
            span
        );
    const value = classes.value[0]!;
    for (const [field, present] of Object.entries(value)) {
        if (present === undefined) continue;
        if (["types", "subtypes", "colors", "card", "plural"].includes(field))
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
    };
    if (Object.keys(filter).length === 0)
        return fail("spell filter matches everything", span);
    return ok(withController(filter));
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

// ── The clause ─────────────────────────────────────────────────────────────

export const staticClauseRule: Rule<StaticClauseIR> = subGrammar(
    STATIC_CLAUSE,
    oneOf(STATIC_CLAUSE, [
        anthemRule,
        keywordGrantRule,
        costModifierRule,
        castPermissionRule,
        entersTappedPlain,
        entersTappedWithCounters,
        asEntersChooseCreatureType,
        kickedEntersWithRule,
        entersWithEachKickRule,
        doesNotUntapRule,
        targetChoiceRequirementRule,
        skipDrawStepRule,
        shuffleFromAnywhereRule,
        selfConditionalPumpRule,
        enchantedHostRule,
        youControlHostRule,
    ])
);
