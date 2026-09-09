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
 *   "<self> doesn't untap during your untap step"   → the `does-not-untap` marker
 *   "<grantee> may cast <class> spells [without paying
 *    their mana costs] [as though they had flash]"  → CR 601.3 `cast-permission`
 *
 * The frames are combined with `oneOf`, never a cascade: they are told apart by
 * a verb in the middle of the line rather than by a first word, so "first rule
 * that matches" would be a genuine coin flip rather than a harmless one, and
 * `oneOf` turns a line two frames both accept into a failed card instead of an
 * arbitrary reading (`rule.ts`).
 *
 * ── What v1 refuses, and why each refusal is the point ────────────────────
 *
 * CONDITIONAL statics ("… as long as …", CR 611.2c) are refused whole. The
 * engine expresses them as a `condition` CLOSURE over the entire board
 * (`StaticPTBuff.condition`), and a JSON descriptor for "as long as" would be
 * a second condition vocabulary beside `CompiledTriggerCondition` — earned by
 * a fragment count, never by anticipation (`cards/compiledTriggers.ts`).
 *
 * ATTACHED-scope statics ("Enchanted creature gets +1/+1", "Equipped creature
 * gets +2/+0" — 99 corpus lines between them) are refused, and refusing them
 * costs nothing today: an Aura's "Enchant creature" line (892 lines) and an
 * Equipment's "Equip {2}" line (226) are both unparsed, so no card carrying
 * one could compile whole regardless. The frame is worth having the day one of
 * those lands, not before.
 *
 * SINGULAR "gets" is refused for the same reason from the other direction:
 * essentially every printed "<x> gets +N/+N." with a singular subject is
 * either attached-scope or carries an "as long as" clause, so a rule for it
 * would exist to accept the half of a sentence it understood.
 */

import { readNumberWord } from "./quantity";
import { isSelfPhrase } from "./cost";
import { uncapitalise } from "./effectClause";
import {
    descriptorRule,
    staticFilterFromDescriptor,
    type DescriptorIR,
    type StaticFilterEvaluation,
} from "./targetFilter";
import { keywordVocabulary } from "../slots/keywordLine";
import type { KeywordIR } from "../ir";
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
    /** CR 502.3 — "doesn't untap during your untap step". */
    | { readonly kind: "does-not-untap" };

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
                power: Number(pt[1]),
                toughness: Number(pt[2]),
            });
        })
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
 * this turn" (Complete the Circuit). This refusal is load-bearing beyond its
 * own sentence: no static rule consults `ParseContext.typeLine`, so the tail
 * is the only thing keeping an INSTANT out of a slot that means "true while
 * this permanent is on the battlefield" (CR 604.1).
 *
 * ZONE phrases — "spells from your hand" (Omniscience), "from an opponent's
 * graveyard". `collectCastPermissions` is hand-only by contract, so the
 * phrase is not wrong, merely unread — and a permission the compiler did not
 * finish reading is one it must not emit.
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
        if (/ from (your|an opponent's|a) /.test(body))
            return fail(
                "a cast permission naming a zone is not read by this frame (CR 601.3)",
                body
            );

        let rest = body;
        let asThoughFlash = false;
        let withoutPayingManaCost = false;
        if (rest.endsWith(FLASH_TAIL)) {
            asThoughFlash = true;
            rest = rest.slice(0, -FLASH_TAIL.length);
            if (rest.endsWith(" and")) rest = rest.slice(0, -" and".length);
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
        // alone; if the free tail did not follow it, the conjunction joined
        // something this frame never read.
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

// ── The clause ─────────────────────────────────────────────────────────────

export const staticClauseRule: Rule<StaticClauseIR> = oneOf(STATIC_CLAUSE, [
    anthemRule,
    keywordGrantRule,
    costModifierRule,
    castPermissionRule,
    entersTappedPlain,
    entersTappedWithCounters,
    doesNotUntapRule,
]);
