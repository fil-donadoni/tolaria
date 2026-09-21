/**
 * Shared sub-grammar: OBJECT DESCRIPTOR and TARGET FILTER (CR 109.1, CR 115.1).
 *
 * This is the single highest-value sub-grammar to get RIGHT rather than early.
 * The competitor's audit (PRD #2693) lists "dropped trailing filter" as its
 * largest silent-misparse bucket, and that is exactly this rule read
 * permissively: "target creature" matches a prefix of "target creature you
 * don't control", and the difference is the whole card.
 *
 * ── Descriptor first, target second ────────────────────────────────────────
 *
 * The phrase this file parses is NOT "the thing after the word target". It is
 * the DESCRIPTOR — the noun phrase that names a set of objects — and Oracle
 * text puts the same descriptor in at least four places:
 *
 *     "Destroy target nonbasic land."          → a target requirement
 *     "Sacrifice a creature: ..."              → an activation cost's filter
 *     "for each Goblin you control"            → a counted set (#2698)
 *     "Creatures you control get +1/+1."       → a static effect's scope (#2700)
 *
 * Building the descriptor against the target site alone is how the four later
 * slots each end up re-cutting it. So `descriptorRule` is the primitive and
 * `targetFilterRule` is a thin wrapper that adds the word "target" and a count;
 * `permanentFilterFromDescriptor` is the second consumer today (cost.ts), and
 * #2698–#2700 get the same rule unchanged.
 *
 * ── All-consuming, with a unique split ─────────────────────────────────────
 *
 * A descriptor is `[adjective]* noun[-or-list] [qualifier]*`, which no
 * separator-splitting combinator in `rule.ts` expresses. It is parsed here by
 * peeling known qualifier SUFFIXES off the end and then choosing the split
 * between adjectives and noun — and the split is required to be UNIQUE, for the
 * same reason `oneOf` requires a unique alternative: two viable readings of a
 * noun phrase is an ambiguity in the grammar, not a coin flip to resolve by
 * position. Every token must be consumed by an adjective, the noun or a
 * qualifier; a token nothing claims fails the descriptor, which is what keeps
 * "target creature you don't control" from being read as "target creature".
 *
 * The uniqueness branch is watched, not merely asserted: no phrase in the
 * shipped vocabulary can reach it, so `descriptorRuleWith` takes the two token
 * readers as a PARAMETER and the test injects a pair that makes two readings
 * possible — the same seam, for the same reason, as `routeLineWith` in
 * `grammar/router.ts`.
 */

import {
    MATERIALISED_FILTER_FIELDS,
    STATIC_FILTER_FIELDS,
} from "../../../cards/compiledStatics";
import { PERMANENT_TYPES } from "../../../cards/types";
import type {
    CardSupertype,
    CardType,
    Color,
    EffectCardFilter,
    EffectChoiceSuperlative,
    PermanentFilter,
    TargetRequirement,
} from "../../../cards/types";
import {
    fail,
    ok,
    rule,
    type Rule,
    type RuleResult,
    subGrammar,
} from "../../rule";
import { keywordVocabulary } from "./keywordVocabulary";
import { CREATURE_SUBTYPES, LAND_SUBTYPES } from "./subtypes";

export const TARGET_FILTER = "target filter";
export const DESCRIPTOR = "object descriptor";

/**
 * What a descriptor phrase means, in terms close to the sentence.
 *
 * Deliberately NOT a `TargetRequirement`: the same phrase becomes a target
 * requirement at one site and a `PermanentFilter` at another, and the two have
 * different field names for the same idea (`subtypeFilter` vs `subtypes`). The
 * IR is the shared middle both are derived from.
 */
export interface DescriptorIR {
    /** A player descriptor ("player", "opponent") rather than an object one. */
    readonly player?: "any" | "opponent";
    /** CR 115.4 — "any target": any creature, player, planeswalker or battle. */
    readonly anyTarget?: true;
    readonly types?: readonly CardType[];
    readonly subtypes?: readonly string[];
    readonly supertypes?: readonly CardSupertype[];
    readonly excludeTypes?: readonly CardType[];
    readonly excludeSubtypes?: readonly string[];
    readonly excludeSupertypes?: readonly CardSupertype[];
    readonly colors?: readonly Color[];
    readonly excludeColors?: readonly Color[];
    readonly controller?: "you" | "opponent";
    readonly tapped?: "tapped" | "untapped";
    readonly combatRole?: readonly ("attacking" | "blocking")[];
    readonly requireAbility?: string;
    readonly excludeAbility?: string;
    readonly powerFilter?: { readonly min?: number; readonly max?: number };
    readonly toughnessFilter?: { readonly min?: number; readonly max?: number };
    readonly mvFilter?: { readonly min?: number; readonly max?: number };
    /** CR 400.1 — the zone the described objects live in. Absent = battlefield. */
    readonly zone?: "graveyard";
    /** Whose graveyard, when `zone` is set (CR 115.2 "from your graveyard"). */
    readonly zoneOwner?: "you" | "any";
    /** True when the noun was "card" — an object in a non-battlefield zone. */
    readonly card?: true;
    /** Plural noun ("creatures"); the caller decides whether that is legal. */
    readonly plural?: true;
}

// ── Vocabulary ─────────────────────────────────────────────────────────────

/** CR 105.1 — the five colour words, as the Oracle prints them. */
export const COLOR_WORDS: ReadonlyMap<string, Color> = new Map([
    ["white", "W"],
    ["blue", "U"],
    ["black", "B"],
    ["red", "R"],
    ["green", "G"],
]);

/** CR 205.2a — the noun spelling of each card type, singular/plural. */
const TYPE_NOUNS: ReadonlyMap<string, readonly CardType[]> = new Map<
    string,
    readonly CardType[]
>([
    ["creature", ["Creature"]],
    ["artifact", ["Artifact"]],
    ["enchantment", ["Enchantment"]],
    ["land", ["Land"]],
    ["planeswalker", ["Planeswalker"]],
    // CR 205.2a lists instant and sorcery beside the permanent types, and a
    // descriptor over CARDS reaches them: "sorcery spells" is read here as
    // "sorcery cards" (CR 109.2 — a spell is a card on the stack), which is
    // the only way the cast-permission and cost-modifier frames can name the
    // class Hypersonic Dragon ("You may cast sorcery spells as though they had
    // flash.") and Squeeze ("Sorcery spells cost {3} more to cast.") print. A
    // UNION of the two ("Instant and sorcery spells … cost {1} less") is still
    // refused — by name now, for having no encoding, rather than for a noun
    // the grammar did not know. On the
    // BATTLEFIELD the two nouns describe nothing, which is harmless: a filter
    // for a type no permanent can have matches nothing rather than too much.
    ["instant", ["Instant"]],
    ["sorcery", ["Sorcery"]],
    // CR 300.1 / 110.1 — "permanent" names every permanent card type, not a
    // type of its own. Read narrowly it silently shrinks a removal spell.
    ["permanent", PERMANENT_TYPES],
]);

const SUPERTYPE_WORDS: ReadonlyMap<string, CardSupertype> = new Map([
    ["basic", "Basic"],
    ["legendary", "Legendary"],
    ["snow", "Snow"],
    ["world", "World"],
]);

function plural(word: string): string | null {
    return word.endsWith("s") ? word.slice(0, -1) : null;
}

// ── Adjectives ─────────────────────────────────────────────────────────────

/**
 * The descriptor being assembled, one token at a time.
 *
 * Exported for ONE reason — `descriptorRuleWith`'s injected readers need to
 * name it. It is not part of the sub-grammar's interface: every consumer takes
 * the finished `DescriptorIR`.
 */
export interface DescriptorState {
    player?: "any" | "opponent";
    anyTarget?: true;
    types?: CardType[];
    /** Card-type words used ADJECTIVALLY ("creature card") — see `readNoun`. */
    typeAdjectives: CardType[];
    subtypes: string[];
    supertypes: CardSupertype[];
    excludeTypes: CardType[];
    excludeSubtypes: string[];
    excludeSupertypes: CardSupertype[];
    colors: Color[];
    /** `colors` came from ONE "<colour> or <colour>" adjective (CR 105.1) —
     *  an OR the filter's `colors` field already means, so no further colour
     *  adjective may join it (that would be an AND read as a wider OR). */
    colorsDisjunctive?: true;
    excludeColors: Color[];
    controller?: "you" | "opponent";
    tapped?: "tapped" | "untapped";
    combatRole?: ("attacking" | "blocking")[];
    requireAbility?: string;
    excludeAbility?: string;
    powerFilter?: { min?: number; max?: number };
    toughnessFilter?: { min?: number; max?: number };
    mvFilter?: { min?: number; max?: number };
    zone?: "graveyard";
    zoneOwner?: "you" | "any";
    card?: true;
    plural?: true;
}

function emptyState(): DescriptorState {
    return {
        typeAdjectives: [],
        subtypes: [],
        supertypes: [],
        excludeTypes: [],
        excludeSubtypes: [],
        excludeSupertypes: [],
        colors: [],
        excludeColors: [],
    };
}

/**
 * Read ONE adjective token.
 *
 * Returns an error string when the token is a known adjective used illegally
 * (the same colour twice), `null` on success, and `"unknown"` when the token is
 * not an adjective at all — which is how the caller learns the noun starts
 * here. The three outcomes are distinct on purpose: a token that is silently
 * skipped is the residue bug this module exists to prevent.
 */
function readAdjective(
    token: string,
    into: DescriptorState
): "unknown" | string | null {
    const lower = token.toLowerCase();

    // "blue or black" — one adjective token, joined by `joinColourDisjunctions`.
    const either = lower.split(" or ");
    if (either.length === 2) {
        const first = COLOR_WORDS.get(either[0]!);
        const second = COLOR_WORDS.get(either[1]!);
        if (first === undefined || second === undefined || first === second)
            return `"${token}" is not two colours`;
        if (into.colors.length > 0)
            return `"${token}" joins another colour adjective`;
        into.colors.push(first, second);
        into.colorsDisjunctive = true;
        return null;
    }
    const color = COLOR_WORDS.get(lower);
    if (color !== undefined) {
        if (into.colorsDisjunctive === true)
            return `colour "${token}" beside a colour disjunction`;
        if (into.colors.includes(color)) return `colour "${token}" twice`;
        into.colors.push(color);
        return null;
    }
    if (lower.startsWith("non")) {
        const rest = lower.slice(3);
        const excluded = COLOR_WORDS.get(rest);
        if (excluded !== undefined) {
            into.excludeColors.push(excluded);
            return null;
        }
        const excludedTypes = TYPE_NOUNS.get(rest);
        // "nonpermanent" is not a word Magic prints, and expanding it to six
        // excluded types would be an invention rather than a reading.
        if (excludedTypes !== undefined && excludedTypes.length === 1) {
            into.excludeTypes.push(excludedTypes[0]!);
            return null;
        }
        const excludedSupertype = SUPERTYPE_WORDS.get(rest);
        if (excludedSupertype !== undefined) {
            into.excludeSupertypes.push(excludedSupertype);
            return null;
        }
        // "non-Wall", "non-Swamp" — the hyphenated form Magic uses before a
        // subtype (CR 205.3).
        if (token.startsWith("non-")) {
            const subtype = token.slice(4);
            if (isSubtype(subtype)) {
                into.excludeSubtypes.push(subtype);
                return null;
            }
            return `"${subtype}" is not a subtype in CR 205.3`;
        }
        return "unknown";
    }
    const supertype = SUPERTYPE_WORDS.get(lower);
    if (supertype !== undefined) {
        into.supertypes.push(supertype);
        return null;
    }
    if (lower === "tapped" || lower === "untapped") {
        if (into.tapped !== undefined) return "two tap-state adjectives";
        into.tapped = lower;
        return null;
    }
    if (lower === "attacking" || lower === "blocking") {
        into.combatRole ??= [];
        if (into.combatRole.includes(lower)) return `"${lower}" twice`;
        into.combatRole.push(lower);
        return null;
    }
    if (isSubtype(token)) {
        into.subtypes.push(token);
        return null;
    }
    // CR 205.2a — a card-type word can modify the noun "card" ("creature card
    // from your graveyard"). Legal ONLY there: "artifact creature" is a
    // conjunction of two types, which `TargetRequirement.type` cannot express
    // (its array is OR semantics), so `readNoun` refuses it.
    const asAdjective = TYPE_NOUNS.get(lower);
    if (asAdjective !== undefined && asAdjective.length === 1) {
        into.typeAdjectives.push(asAdjective[0]!);
        return null;
    }
    return "unknown";
}

function isSubtype(token: string): boolean {
    return CREATURE_SUBTYPES.has(token) || LAND_SUBTYPES.has(token);
}

/** The card types a set of bare subtype nouns implies (CR 205.3i / 205.3m). */
function impliedTypes(
    subtypes: readonly string[] | undefined
): CardType[] | undefined {
    if (subtypes === undefined || subtypes.length === 0) return undefined;
    const types = new Set<CardType>();
    for (const subtype of subtypes) {
        const type = typeOfSubtype(subtype);
        if (type === null) return undefined;
        types.add(type);
    }
    return [...types];
}

/** The card type a bare subtype noun implies (CR 205.3i / 205.3m). */
function typeOfSubtype(token: string): CardType | null {
    if (LAND_SUBTYPES.has(token)) return "Land";
    if (CREATURE_SUBTYPES.has(token)) return "Creature";
    return null;
}

// ── Qualifiers (trailing phrases) ──────────────────────────────────────────

type Qualifier = (into: DescriptorState) => string | null;

const KEYWORDS = keywordVocabulary();

/**
 * Trailing phrases, longest first.
 *
 * Order matters only for the SEARCH (a longer phrase must be tried before a
 * shorter one it contains), never for the meaning: each entry consumes its own
 * suffix and the loop repeats until nothing matches, so the set of qualifiers a
 * descriptor carries does not depend on the order they were written in.
 */
const QUALIFIERS: readonly (readonly [string, Qualifier])[] = [
    [
        " you control",
        (into) => {
            if (into.controller !== undefined) return "two controller clauses";
            into.controller = "you";
            return null;
        },
    ],
    [
        " an opponent controls",
        (into) => {
            if (into.controller !== undefined) return "two controller clauses";
            into.controller = "opponent";
            return null;
        },
    ],
    [" from your graveyard", (into) => setGraveyard(into, "you")],
    [" from a graveyard", (into) => setGraveyard(into, "any")],
    [" in your graveyard", (into) => setGraveyard(into, "you")],
    [" in a graveyard", (into) => setGraveyard(into, "any")],
];

function setGraveyard(
    into: DescriptorState,
    owner: "you" | "any"
): string | null {
    if (into.zone !== undefined) return "two zone clauses";
    into.zone = "graveyard";
    into.zoneOwner = owner;
    return null;
}

/** `"with power 2 or less"`, `"with mana value 3 or greater"` (CR 202.3). */
const COMPARISON =
    /^ with (power|toughness|mana value) (\d+) or (less|greater)$/;

/** `"with flying"` / `"without flying"` (CR 702). */
function readKeywordQualifier(
    suffix: string,
    into: DescriptorState
): "unknown" | string | null {
    for (const [prefix, field] of [
        [" with ", "requireAbility"],
        [" without ", "excludeAbility"],
    ] as const) {
        if (!suffix.startsWith(prefix)) continue;
        const name = suffix.slice(prefix.length);
        const keyword = KEYWORDS.get(name.toLowerCase());
        if (keyword === undefined) return "unknown";
        if (into[field] !== undefined) return `two "${prefix.trim()}" clauses`;
        into[field] = keyword.ability;
        return null;
    }
    return "unknown";
}

/**
 * Peel every trailing qualifier off the span.
 *
 * Returns the residual head, or an error. A qualifier that matches is consumed
 * whole (`head + suffix === span` is an identity), so this loop cannot lose
 * text — it can only fail to recognise it, and then the token survives into the
 * head where the noun/adjective pass refuses it.
 */
function peelQualifiers(
    span: string,
    into: DescriptorState
): { head: string } | { error: string } {
    let head = span;
    for (;;) {
        let matched = false;
        for (const [suffix, apply] of QUALIFIERS) {
            if (!head.endsWith(suffix)) continue;
            const error = apply(into);
            if (error !== null) return { error };
            head = head.slice(0, head.length - suffix.length);
            matched = true;
            break;
        }
        if (matched) continue;
        const comparison = readComparison(head, into);
        if (comparison === "error") return { error: "two range clauses" };
        if (comparison !== null) {
            head = comparison;
            continue;
        }
        const keywordAt = lastKeywordQualifier(head, into);
        if (typeof keywordAt === "string") return { error: keywordAt };
        if (keywordAt !== null) {
            head = keywordAt.head;
            continue;
        }
        return { head };
    }
}

function readComparison(
    head: string,
    into: DescriptorState
): string | null | "error" {
    const at = head.lastIndexOf(" with ");
    if (at === -1) return null;
    const match = head.slice(at).match(COMPARISON);
    if (match === null) return null;
    const bound = { [match[3] === "less" ? "max" : "min"]: Number(match[2]) };
    const field =
        match[1] === "power"
            ? "powerFilter"
            : match[1] === "toughness"
              ? "toughnessFilter"
              : "mvFilter";
    if (into[field] !== undefined) return "error";
    into[field] = bound;
    return head.slice(0, at);
}

function lastKeywordQualifier(
    head: string,
    into: DescriptorState
): { head: string } | string | null {
    for (const prefix of [" without ", " with "]) {
        const at = head.lastIndexOf(prefix);
        if (at === -1) continue;
        const outcome = readKeywordQualifier(head.slice(at), into);
        if (outcome === "unknown") continue;
        if (outcome !== null) return outcome;
        return { head: head.slice(0, at) };
    }
    return null;
}

// ── The noun head ──────────────────────────────────────────────────────────

/**
 * Read the noun (or noun or-list) that ends the descriptor.
 *
 * "artifact, creature, or land" and "artifact or enchantment" are OR-lists
 * (CR 115.1 — a target may be described by several types at once). The Oxford
 * form is detected by its own marker rather than by trying both readings, for
 * the reason `manaAbility.ts` gives: `", or "` contains `" or "`, so an `oneOf`
 * over the two would report every three-way list as ambiguous.
 */
function readNoun(
    tokens: readonly string[],
    into: DescriptorState
): string | null {
    const phrase = tokens.join(" ");
    const parts = phrase.includes(", or ")
        ? phrase.replace(", or ", ", ").split(", ")
        : phrase.split(" or ");
    if (parts.length > 1 && parts.some((p) => p.includes(" "))) {
        return "an or-list element is more than one word";
    }
    const types: CardType[] = [];
    const subtypes: string[] = [];
    for (const part of parts) {
        const lower = part.toLowerCase();
        const singular = plural(lower);
        const nounTypes =
            TYPE_NOUNS.get(lower) ??
            (singular !== null ? TYPE_NOUNS.get(singular) : undefined);
        if (nounTypes !== undefined) {
            if (singular !== null && TYPE_NOUNS.get(lower) === undefined)
                into.plural = true;
            types.push(...nounTypes);
            continue;
        }
        if (lower === "card" || lower === "cards") {
            if (parts.length > 1) return '"card" cannot appear in an or-list';
            into.card = true;
            if (lower === "cards") into.plural = true;
            types.push(...into.typeAdjectives);
            into.typeAdjectives = [];
            continue;
        }
        if (lower === "player" || lower === "players") {
            if (parts.length > 1) return '"player" cannot appear in an or-list';
            into.player = "any";
            if (lower === "players") into.plural = true;
            continue;
        }
        if (lower === "opponent" || lower === "opponents") {
            if (parts.length > 1)
                return '"opponent" cannot appear in an or-list';
            into.player = "opponent";
            if (lower === "opponents") into.plural = true;
            continue;
        }
        // A BARE subtype noun ("target Wall", "Sacrifice a Forest") records
        // only the subtype. The card type it implies (CR 205.3 — subtypes are
        // type-specific) is supplied by the CONSUMER that needs one:
        // `TargetRequirement.type` is mandatory so it infers it, a
        // `PermanentFilter` is not so it does not. Pushing it here instead
        // would state in the cost filter what the subtype already implies, and
        // the hand-written catalogue does not.
        if (isSubtype(part)) {
            subtypes.push(part);
            continue;
        }
        if (part.endsWith("s") && isSubtype(part.slice(0, -1))) {
            into.plural = true;
            subtypes.push(part.slice(0, -1));
            continue;
        }
        return `"${part}" is not a card type or a CR 205.3 subtype`;
    }
    if (into.typeAdjectives.length > 0) {
        return `"${into.typeAdjectives.join(" ")}" modifies a noun that is not "card"`;
    }
    if (into.player !== undefined || into.card === true) {
        if (types.length > 0) into.types = dedupe(types);
        if (subtypes.length > 0) into.subtypes.push(...subtypes);
        return null;
    }
    if (types.length === 0 && subtypes.length === 0) return "no noun";
    if (types.length === 0) {
        into.subtypes.push(...subtypes);
        return null;
    }
    into.types = dedupe(types);
    into.subtypes.push(...subtypes);
    return null;
}

function dedupe(types: readonly CardType[]): CardType[] {
    return [...new Set(types)];
}

// ── The descriptor rule ────────────────────────────────────────────────────

/**
 * The two token readers the split loop runs, as an INJECTABLE pair.
 *
 * Same seam, same reason as `routeLineWith` in `grammar/router.ts`: the unique
 * -split guarantee is this file's headline claim, and with the real vocabulary
 * no phrase reaches the 2+ branch — a token is either an adjective or a noun
 * head, never both in a way that yields two whole readings. So deleting
 * `if (hits.length > 1) return fail(...)` turns the unique split into a
 * first-hit split and leaves every test in this directory green, which is
 * exactly the mutation ADR 0105 forbids and nothing was watching. Injecting
 * the readers makes the branch reachable today, so the regression is caught
 * now rather than when #2698–#2700 make it reachable for real.
 */
export interface DescriptorReaders {
    /** `null` = consumed, `"unknown"` = not an adjective, else an error. */
    readonly adjective: (
        token: string,
        into: DescriptorState
    ) => "unknown" | string | null;
    /** `null` = consumed, else an error. */
    readonly noun: (
        tokens: readonly string[],
        into: DescriptorState
    ) => string | null;
}

/** The vocabulary this grammar actually ships. */
export const DESCRIPTOR_READERS: DescriptorReaders = {
    adjective: readAdjective,
    noun: readNoun,
};

/**
 * `"creature"`, `"nonbasic land"`, `"black creature you control"`,
 * `"creature card from your graveyard"`, `"artifact, creature, or land"`.
 *
 * Over an INJECTED reader pair — see `DescriptorReaders`.
 */
export function descriptorRuleWith(
    readers: DescriptorReaders
): Rule<DescriptorIR> {
    return rule(DESCRIPTOR, (span) => {
        if (span.length === 0) return fail("empty descriptor", span);
        if (span === "any target") {
            return ok({ anyTarget: true as const });
        }
        const withQualifiers = emptyState();
        const peeled = peelQualifiers(span, withQualifiers);
        if ("error" in peeled) return fail(peeled.error, span);
        const tokens = joinColourDisjunctions(
            peeled.head.split(" ").filter((t) => t.length > 0)
        );
        if (tokens.length === 0) return fail("descriptor has no noun", span);

        // Every split of the head into [adjectives][noun phrase] is tried and
        // exactly one must work — see the header on why a unique split rather than
        // the first or the longest.
        const hits: DescriptorState[] = [];
        const misses: string[] = [];
        for (let at = 0; at < tokens.length; at += 1) {
            const state: DescriptorState = { ...withQualifiers };
            state.typeAdjectives = [...withQualifiers.typeAdjectives];
            state.subtypes = [...withQualifiers.subtypes];
            state.supertypes = [...withQualifiers.supertypes];
            state.excludeTypes = [...withQualifiers.excludeTypes];
            state.excludeSubtypes = [...withQualifiers.excludeSubtypes];
            state.colors = [...withQualifiers.colors];
            state.excludeColors = [...withQualifiers.excludeColors];
            state.excludeSupertypes = [...withQualifiers.excludeSupertypes];
            if (state.combatRole !== undefined)
                state.combatRole = [...state.combatRole];
            let failed: string | null = null;
            for (let i = 0; i < at; i += 1) {
                const outcome = readers.adjective(tokens[i]!, state);
                if (outcome === null) continue;
                failed =
                    outcome === "unknown"
                        ? `"${tokens[i]}" is not an adjective this grammar knows`
                        : outcome;
                break;
            }
            if (failed !== null) {
                misses.push(failed);
                continue;
            }
            const nounError = readers.noun(tokens.slice(at), state);
            if (nounError !== null) {
                misses.push(nounError);
                continue;
            }
            hits.push(state);
        }
        if (hits.length === 0)
            return fail(
                `no reading of "${span}" as a descriptor (${[...new Set(misses)].join("; ")})`,
                span
            );
        if (hits.length > 1)
            return fail(`ambiguous descriptor "${span}"`, span);
        return finish(hits[0]!, span);
    });
}

/**
 * CR 105.1 — "a blue or black permanent": a colour disjunction is ONE
 * adjective, the permanent is either colour. Joined before the split loop
 * because the loop reads a token at a time, and a bare "or" between two colour
 * words is not a token any reader could place. Only a colour-or-colour triple
 * is joined: "artifact or enchantment" stays the noun list `readNoun` reads.
 */
function joinColourDisjunctions(tokens: readonly string[]): string[] {
    const out: string[] = [];
    for (let i = 0; i < tokens.length; i += 1) {
        const [a, or, b] = [tokens[i]!, tokens[i + 1], tokens[i + 2]];
        if (
            or === "or" &&
            b !== undefined &&
            COLOR_WORDS.has(a.toLowerCase()) &&
            COLOR_WORDS.has(b.toLowerCase())
        ) {
            out.push(`${a} or ${b}`);
            i += 2;
            continue;
        }
        out.push(a);
    }
    return out;
}

/** The descriptor rule over the vocabulary this grammar ships. */
export const descriptorRule: Rule<DescriptorIR> = subGrammar(
    DESCRIPTOR,
    descriptorRuleWith(DESCRIPTOR_READERS)
);

function finish(
    state: DescriptorState,
    span: string
): RuleResult<DescriptorIR> {
    // A colour/subtype/supertype restriction on a PLAYER is a phrase we have
    // misread, not a filter the engine could honour.
    if (state.player !== undefined || state.anyTarget === true) {
        const decorated =
            state.colors.length > 0 ||
            state.subtypes.length > 0 ||
            state.supertypes.length > 0 ||
            state.tapped !== undefined ||
            state.combatRole !== undefined ||
            state.types !== undefined;
        if (decorated)
            return fail("a player descriptor carries object filters", span);
    }
    const out: Record<string, unknown> = {};
    if (state.player !== undefined) out.player = state.player;
    if (state.anyTarget === true) out.anyTarget = true;
    if (state.types !== undefined) out.types = state.types;
    if (state.subtypes.length > 0) out.subtypes = state.subtypes;
    if (state.supertypes.length > 0) out.supertypes = state.supertypes;
    if (state.excludeTypes.length > 0) out.excludeTypes = state.excludeTypes;
    if (state.excludeSubtypes.length > 0)
        out.excludeSubtypes = state.excludeSubtypes;
    if (state.excludeSupertypes.length > 0)
        out.excludeSupertypes = state.excludeSupertypes;
    if (state.colors.length > 0) out.colors = state.colors;
    if (state.excludeColors.length > 0) out.excludeColors = state.excludeColors;
    if (state.controller !== undefined) out.controller = state.controller;
    if (state.tapped !== undefined) out.tapped = state.tapped;
    if (state.combatRole !== undefined) out.combatRole = state.combatRole;
    if (state.requireAbility !== undefined)
        out.requireAbility = state.requireAbility;
    if (state.excludeAbility !== undefined)
        out.excludeAbility = state.excludeAbility;
    if (state.powerFilter !== undefined) out.powerFilter = state.powerFilter;
    if (state.toughnessFilter !== undefined)
        out.toughnessFilter = state.toughnessFilter;
    if (state.mvFilter !== undefined) out.mvFilter = state.mvFilter;
    if (state.zone !== undefined) out.zone = state.zone;
    if (state.zoneOwner !== undefined) out.zoneOwner = state.zoneOwner;
    if (state.card === true) out.card = true;
    if (state.plural === true) out.plural = true;
    return ok(out as DescriptorIR);
}

// ── Derived shapes ─────────────────────────────────────────────────────────

/**
 * CR 601.2c — how many announcement SLOTS one target requirement occupies.
 *
 * The flat positional list an Effect Script indexes (`{ target: 0 }`,
 * `{ target: 1 }`, … — `gre/moves.ts`'s "FLAT concatenation") is the
 * concatenation of every group's slots, so a group's WIDTH is what the next
 * group's first index is measured from and what a per-target fan-out iterates.
 * It is the count's MAXIMUM: "up to two" announces at most two, and an
 * unchosen slot resolves to nothing and skips its op (CR 608.2b).
 *
 * `"X"` at either position is refused by returning `null`: the width is then a
 * fact about the cast, not about the sentence, and neither the fan-out nor the
 * next group's index can be written down at compile time.
 */
export function announcedSlots(
    count: TargetRequirement["count"]
): number | null {
    if (count === "X") return null;
    if (typeof count === "number") return count;
    if (count.max === undefined || count.max === "X") return null;
    return count.max;
}

/**
 * Descriptor → `TargetRequirement` (CR 115.1).
 *
 * A descriptor naming a zone other than the battlefield only makes sense with
 * the "card" noun (CR 109.2 — "creature" alone means a creature PERMANENT), so
 * the two are checked against each other rather than trusted separately.
 */
export function targetRequirementFromDescriptor(
    descriptor: DescriptorIR,
    count: TargetRequirement["count"] = 1
): RuleResult<TargetRequirement> {
    // CR 601.2c — the descriptor's NUMBER and the head's count are one fact
    // printed twice ("up to TWO target creature CARDS"), so they are checked
    // against each other rather than trusted separately: a plural noun under a
    // one-slot head is a count the head did not print, and a singular noun
    // under a two-slot head is a head the noun did not agree with. Either way
    // the reading is wrong, and a wrong count is a spell that announces the
    // wrong number of targets — never a narrower one.
    const slots = announcedSlots(count);
    // An open-ended range ("any number of", `{ min }` with no `max`) is the
    // one variable count whose noun is still decidable: it can name more than
    // one object, so the noun must be plural. `"X"` and `max: "X"` stay
    // refused — those widths are facts about the cast.
    const openEnded = typeof count === "object" && count.max === undefined;
    if (
        (slots === null && !openEnded) ||
        (descriptor.plural === true) !== (openEnded || slots! > 1)
    )
        return fail(
            "a target descriptor's number must match its count",
            "plural"
        );
    if (descriptor.anyTarget === true) return ok({ type: "any", count });
    if (descriptor.player !== undefined) {
        const requirement: Record<string, unknown> = {
            type: "player",
            count,
        };
        if (descriptor.player === "opponent")
            requirement.controller = "opponent";
        else if (descriptor.controller !== undefined)
            requirement.controller = descriptor.controller;
        return ok(requirement as unknown as TargetRequirement);
    }
    if (descriptor.card === true && descriptor.zone === undefined)
        return fail('a "card" target needs a zone', "card");
    if (descriptor.card !== true && descriptor.zone !== undefined)
        return fail("a permanent descriptor cannot name a graveyard", "zone");
    // CR 205.3 — a bare subtype noun names no card type, so the requirement's
    // mandatory `type` is inferred from the subtype's own list.
    const types =
        descriptor.types ??
        (descriptor.card === true
            ? undefined
            : impliedTypes(descriptor.subtypes));
    if ((types === undefined || types.length === 0) && descriptor.card !== true)
        return fail("descriptor names no card type", "type");
    // CR 115.2 — "target card in a graveyard" names no card type at all;
    // `TargetRequirement`'s own `"card"` value is that case.
    const requirement: Record<string, unknown> = {
        type:
            types === undefined || types.length === 0
                ? "card"
                : types.length === 1
                  ? types[0]
                  : [...types],
        count,
    };
    if (descriptor.subtypes)
        requirement.subtypeFilter = [...descriptor.subtypes];
    if (descriptor.supertypes)
        requirement.supertypeFilter = [...descriptor.supertypes];
    if (descriptor.excludeSupertypes)
        requirement.excludeSupertypes = [...descriptor.excludeSupertypes];
    if (descriptor.excludeTypes)
        requirement.excludeTypes = [...descriptor.excludeTypes];
    if (descriptor.excludeSubtypes)
        requirement.excludeSubtypes = [...descriptor.excludeSubtypes];
    if (descriptor.colors) {
        if (descriptor.colors.length > 1)
            return fail(
                "multi-colour target filters are not in grammar v0",
                "colors"
            );
        requirement.colorFilter = descriptor.colors[0];
    }
    if (descriptor.excludeColors)
        requirement.excludeColors = [...descriptor.excludeColors];
    if (descriptor.tapped) requirement.tappedFilter = descriptor.tapped;
    if (descriptor.combatRole)
        requirement.combatRoleFilter = [...descriptor.combatRole];
    if (descriptor.requireAbility)
        requirement.requireAbility = descriptor.requireAbility;
    if (descriptor.excludeAbility)
        requirement.excludeAbility = descriptor.excludeAbility;
    if (descriptor.powerFilter)
        requirement.powerFilter = descriptor.powerFilter;
    if (descriptor.toughnessFilter)
        requirement.toughnessFilter = descriptor.toughnessFilter;
    if (descriptor.mvFilter) requirement.mvFilter = descriptor.mvFilter;
    if (descriptor.zone !== undefined) {
        requirement.zone = descriptor.zone;
        requirement.controller = descriptor.zoneOwner === "you" ? "you" : "any";
    } else if (descriptor.controller !== undefined) {
        requirement.controller = descriptor.controller;
    }
    return ok(requirement as unknown as TargetRequirement);
}

/**
 * Descriptor → `PermanentFilter` (the shape an activation cost's
 * "Sacrifice a ..." clause takes, CR 602.1 / 118.5).
 *
 * Narrower than the target shape on purpose: a cost filter that quietly ignored
 * a clause it has no field for would make an ILLEGAL activation legal, so
 * anything the filter cannot express is refused here rather than dropped.
 */
export function permanentFilterFromDescriptor(
    descriptor: DescriptorIR,
    /**
     * `colors: true` admits a colour clause (CR 105.1). Opt-in, because the
     * cost sites this converter was written for (a sacrifice filter) have no
     * colour reader on their payment path; a CONDITION site does — the trigger
     * gate and the static gate both read live colours (issue #4126).
     */
    allow: { readonly colors?: true } = {}
): RuleResult<PermanentFilter> {
    if (descriptor.player !== undefined || descriptor.anyTarget === true)
        return fail("a player cannot be sacrificed", "player");
    if (descriptor.card === true || descriptor.zone !== undefined)
        return fail("only a permanent can be sacrificed (CR 701.21a)", "zone");
    for (const [field, value] of Object.entries(descriptor)) {
        if (value === undefined) continue;
        if (
            ![
                "types",
                "subtypes",
                "supertypes",
                "excludeTypes",
                "excludeSubtypes",
                "excludeSupertypes",
                "plural",
                ...(allow.colors === true ? ["colors"] : []),
            ].includes(field)
        ) {
            return fail(
                `"${field}" is not expressible as a cost filter`,
                field
            );
        }
    }
    const filter: Record<string, unknown> = {};
    if (descriptor.types) filter.types = [...descriptor.types];
    if (descriptor.subtypes) filter.subtypes = [...descriptor.subtypes];
    if (descriptor.supertypes) filter.supertypes = [...descriptor.supertypes];
    if (descriptor.excludeTypes)
        filter.excludeTypes = [...descriptor.excludeTypes];
    if (descriptor.excludeSubtypes)
        filter.excludeSubtypes = [...descriptor.excludeSubtypes];
    if (descriptor.excludeSupertypes)
        filter.excludeSupertypes = [...descriptor.excludeSupertypes];
    if (descriptor.colors) filter.colors = [...descriptor.colors];
    if (Object.keys(filter).length === 0)
        return fail("cost filter matches everything", "filter");
    return ok(filter as PermanentFilter);
}

const SACRIFICABLE_TYPES: ReadonlySet<CardType> = new Set(PERMANENT_TYPES);

/**
 * Descriptor → the `choice` Op's battlefield filter for "<player> sacrifices a
 * <descriptor>" (CR 701.21a), the chooser being the sacrificing player.
 *
 * Accepts exactly the clauses the edict corpus prints — a card type, or an
 * or-list of them ("creature or planeswalker"), and "attacking" — and refuses
 * every other clause rather than dropping it: a dropped clause widens the set
 * of permanents the player may give up. The descriptor reader already refuses
 * stacked types ("artifact creature"), so a multi-type list here is always a
 * union, which is what `EffectCardFilter.type` reads it as.
 */
export function sacrificeFilterFromDescriptor(
    descriptor: DescriptorIR
): RuleResult<EffectCardFilter> {
    for (const [field, value] of Object.entries(descriptor)) {
        if (value === undefined) continue;
        if (!["types", "combatRole", "plural"].includes(field))
            return fail(
                `"${field}" is not expressible as a sacrifice filter`,
                field
            );
    }
    const types = descriptor.types;
    if (types === undefined)
        return fail("a sacrifice filter names a card type", "types");
    // CR 701.21a — only a permanent can be sacrificed; "an instant" would
    // lower to a filter that can never match anything.
    if (!types.every((type) => SACRIFICABLE_TYPES.has(type)))
        return fail("only a permanent can be sacrificed (CR 701.21a)", "types");
    const filter: EffectCardFilter = {
        type: types.length === 1 ? types[0]! : [...types],
    };
    const role = descriptor.combatRole;
    if (role !== undefined) {
        if (role.length !== 1 || role[0] !== "attacking")
            return fail(
                'only "attacking" is expressible as a sacrifice filter',
                "combatRole"
            );
        filter.isAttacking = true;
    }
    return ok(filter);
}

/** "creatures they control", "creatures and planeswalkers that player controls". */
const SUPERLATIVE_SET = /^(.+) (?:they control|that player controls)$/;

/**
 * "with the greatest <stat> among <set>" (CR 608.2h) → the `choice` Op's
 * superlative, for the sacrifice filter it follows.
 *
 * The stat is a parameter (`power`, `mana value`); the SET is not: the engine
 * ranks the sacrificing player's own permanents that the filter matches, so the
 * printed set is accepted only when it IS that pool — the filter's own type
 * list, controlled by the sacrificing player ("they control", "that player
 * controls"). Any other set ("creatures you control", "creatures on the
 * battlefield", "attacking creatures") would rank a different pool than the
 * engine does and is refused, as is every extreme but "greatest".
 */
export function superlativeFromClause(
    extreme: string,
    stat: string,
    set: string,
    filter: EffectCardFilter,
    ctx: unknown
): RuleResult<EffectChoiceSuperlative> {
    if (extreme !== "greatest")
        return fail(
            `"${extreme}" is not a superlative this grammar reads`,
            extreme
        );
    const statKey =
        stat === "power"
            ? "power"
            : stat === "mana value"
              ? "mana-value"
              : null;
    if (statKey === null)
        return fail(`"${stat}" is not a stat a superlative ranks by`, stat);
    const printed = SUPERLATIVE_SET.exec(set);
    if (printed === null)
        return fail(
            `"${set}" is not a set a superlative ranks over — only the sacrificing player's own permanents`,
            set
        );
    const setTypes = new Set<CardType>();
    for (const part of printed[1]!.split(" and ")) {
        const noun = descriptorRule.run(part, ctx);
        if (!noun.ok) return noun;
        const fields = Object.entries(noun.value).filter(
            ([, value]) => value !== undefined
        );
        if (
            noun.value.types === undefined ||
            noun.value.types.length !== 1 ||
            noun.value.plural !== true ||
            fields.length !== 2
        )
            return fail(`"${part}" is not a plural permanent type`, part);
        setTypes.add(noun.value.types[0]!);
    }
    const candidateTypes = new Set(
        Array.isArray(filter.type) ? filter.type : [filter.type]
    );
    if (
        Object.keys(filter).length !== 1 ||
        candidateTypes.size !== setTypes.size ||
        ![...candidateTypes].every((type) => setTypes.has(type as CardType))
    )
        return fail(
            `the set "${set}" is not the candidates' own permanent types`,
            set
        );
    // CR 208.3 — only a creature has power, so a power ranking over any other
    // pool would rank permanents with no value.
    if (statKey === "power" && filter.type !== "Creature")
        return fail("only creatures can be ranked by power", "power");
    return ok({ stat: statKey, extreme: "greatest" });
}

/**
 * CR 601.2c — the optional-count heads grammar v0 reads, head → count.
 *
 * "Up to one target creature" announces between zero and one target, so the
 * whole of its lowering is `TargetRequirement.count` — the ops downstream still
 * reference ONE positional slot (`{ target: 0 }`) and the interpreter already
 * skips an op whose slot resolved to nothing (CR 608.2b). "Up to two" is the
 * same count with a WIDTH: it occupies two positional slots, its noun is
 * plural to say so, and the verb it heads has to fan its op out over both
 * (`lowerEffects.ts` — `objectSelectors`). A verb with no fan-out refuses it
 * rather than acting on the first slot only, which is the half-a-feature this
 * grammar used to forbid by refusing the head itself.
 *
 * "Up to X target …" stays out: its width is a fact about the CAST (the
 * announced X), not about the sentence, so neither the fan-out nor a later
 * group's first index can be written down at compile time (`announcedSlots`).
 */
const OPTIONAL_COUNT_HEADS: ReadonlyMap<string, TargetRequirement["count"]> =
    new Map<string, TargetRequirement["count"]>([
        ["up to one target ", { min: 0, max: 1 }],
        ["up to two target ", { min: 0, max: 2 }],
    ]);

/**
 * `"target creature you control"`, `"any target"`, `"up to one target
 * creature or planeswalker"`, `"up to two target creature cards from your
 * graveyard"` — a descriptor introduced by the word "target" (CR 115.1),
 * optionally under a CR 601.2c "up to N" head.
 *
 * A BARE plural ("two target creatures", "each target creature") is still
 * refused: the optional heads above announce a RANGE from zero, whereas a
 * fixed plural count demands an appropriate object for EACH target the spell
 * requires (CR 601.2c) — a different announcement, not a wider spelling of
 * this one.
 */
/**
 * Does this span OPEN a target phrase (CR 115.1)?
 *
 * Exported because `subjectRule` dispatches on the same openings and must not
 * keep its own copy of them: a head added to `OPTIONAL_COUNT_HEADS` that a
 * second prefix list did not learn is a phrase this file reads and the subject
 * cascade hands to the player-reference rule instead, which is a refusal
 * attributed to the wrong span.
 */
export function opensTargetPhrase(span: string): boolean {
    if (span === "any target" || span.startsWith("target ")) return true;
    for (const head of OPTIONAL_COUNT_HEADS.keys())
        if (span.startsWith(head)) return true;
    return false;
}

export const targetFilterRule: Rule<TargetRequirement> = subGrammar(
    TARGET_FILTER,
    rule(TARGET_FILTER, (span, ctx) => {
        if (span === "any target")
            return ok({ type: "any", count: 1 } as TargetRequirement);
        // CR 109.2 / 115.1 — a SPELL on the stack is a target of its own kind,
        // not a permanent: `TargetRequirement.type: "spell"` is the whole of
        // it, and every permanent facet below (tap state, power, supertype)
        // is documented as ignored for a spell target. So the phrase is read
        // HERE, by exact spelling, rather than given a `DescriptorIR` noun
        // whose adjectives would all be silently dropped — "target creature
        // spell", "target spell with mana value 3 or less" and "target spell
        // or ability" each narrow the announced set in a way this shape
        // cannot express, and each stays refused under its own gap key.
        if (span === "target spell")
            return ok({ type: "spell", count: 1 } as TargetRequirement);
        // CR 115.2 — the two NARROWED stack phrases the lace templates print,
        // read by exact spelling for the same reason the bare one is: each
        // names a facet the engine keeps beside `type` rather than in a
        // descriptor (`spellTypeFilter`, and CR 115.2's "spell OR permanent"
        // union), and a descriptor noun would drop it silently. Every other
        // narrowing ("target creature spell", "target spell with mana value 3
        // or less") stays refused under its own gap key.
        if (span === "target instant or sorcery spell")
            return ok({
                type: "spell",
                count: 1,
                spellTypeFilter: ["Instant", "Sorcery"],
            } as TargetRequirement);
        if (span === "target spell or permanent")
            return ok({
                type: "spell-or-permanent",
                count: 1,
            } as TargetRequirement);
        for (const [head, count] of OPTIONAL_COUNT_HEADS) {
            if (!span.startsWith(head)) continue;
            const descriptor = descriptorRule.run(span.slice(head.length), ctx);
            if (!descriptor.ok) return descriptor;
            return targetRequirementFromDescriptor(descriptor.value, count);
        }
        if (!span.startsWith("target "))
            return fail('a target filter starts with "target "', span);
        const descriptor = descriptorRule.run(
            span.slice("target ".length),
            ctx
        );
        if (!descriptor.ok) return descriptor;
        return targetRequirementFromDescriptor(descriptor.value);
    })
);

/**
 * CR 601.2d — the count phrase of a "divided as you choose among …"
 * group, phrase → announced count.
 *
 * Every phrase opens at ONE target: CR 601.2d speaks of dividing an effect
 * "among one or more targets", each receiving at least 1, so a division among
 * zero targets has nothing to divide, and the engine's own announcements
 * drive a divide group from `min: 1`. "Any number of" is therefore
 * `{ min: 1 }` with no `max` — the divide budget caps it — where the variable
 * count of CR 601.2c alone would allow zero (the nine shipped divide cards all
 * print `{ min: 1 }` for the same reason). Known narrowing: a spell that
 * ALSO has a value-bearing second sentence could be cast with zero targets as
 * printed and cannot here; the catalogue makes the same choice.
 * "X target …" is not read: its width is a fact about the cast.
 */
const DIVIDED_COUNT_PHRASES: ReadonlyMap<string, TargetRequirement["count"]> =
    new Map<string, TargetRequirement["count"]>([
        ["one or two", { min: 1, max: 2 }],
        ["one, two, or three", { min: 1, max: 3 }],
        ["any number of", { min: 1 }],
    ]);

/**
 * `"one or two targets"`, `"any number of target creatures"`, `"one, two, or
 * three target creatures with flying"` — the recipient group of a divided
 * effect (CR 601.2d), read as ONE `TargetRequirement` carrying the count
 * range. The divide budget (`divideAsChosen`) is the LOWERING's to add: it is
 * the effect's magnitude, which this phrase does not print.
 *
 * The count phrase is matched as a whole and the rest is the ordinary plural
 * target descriptor, so an adjective or subtype the descriptor cannot read
 * ("attacking or blocking", "and/or") refuses the group under the
 * descriptor's own reason rather than being skipped.
 */
export const dividedTargetsRule: Rule<TargetRequirement> = subGrammar(
    TARGET_FILTER,
    rule(TARGET_FILTER, (span, ctx) => {
        for (const [phrase, count] of DIVIDED_COUNT_PHRASES) {
            if (span === `${phrase} targets`)
                return ok({ type: "any", count } as TargetRequirement);
            const head = `${phrase} target `;
            if (!span.startsWith(head)) continue;
            const descriptor = descriptorRule.run(span.slice(head.length), ctx);
            if (!descriptor.ok) return descriptor;
            return targetRequirementFromDescriptor(descriptor.value, count);
        }
        return fail(
            'a divided group opens with "one or two", "one, two, or three" or "any number of"',
            span
        );
    })
);

/**
 * Descriptor → `PermanentFilter` for a CONTINUOUS STATIC effect (CR 611.2).
 *
 * The third of this file's derived shapes, and the one with the narrowest
 * reader: a compiled static's predicate sees a `PermanentView`, which carries
 * no `staticAbilities` and no live supertype array. A field this filter could
 * not be evaluated against would fail closed INSIDE the matcher — an anthem
 * that buffs nobody, which looks exactly like an anthem nobody noticed. So the
 * accepted vocabulary is `STATIC_FILTER_FIELDS` (`cards/compiledStatics.ts`),
 * declared beside the predicate that has to feed it rather than copied here,
 * and anything outside it refuses the card.
 *
 * Wider than `permanentFilterFromDescriptor` in exactly two places, both of
 * which a cost filter refuses for reasons that do not apply here: `controller`
 * ("creatures YOU control" — CR 109.5, the effect's controller) and `colors`
 * ("WHITE creatures get +1/+1" — Crusade), which the predicate answers through
 * `StaticEffectContext.getColors`.
 *
 * A bare subtype noun gets its implied card type (CR 205.3m — "Goblins you
 * control" are creatures), matching what the hand-written catalogue writes:
 * every tribal lord's `applies` opens with `ctx.isCreature(target)` before it
 * looks at the subtype.
 */
export function staticFilterFromDescriptor(
    descriptor: DescriptorIR,
    evaluation: StaticFilterEvaluation
): RuleResult<PermanentFilter> {
    if (descriptor.player !== undefined || descriptor.anyTarget === true)
        return fail("a player has no power, toughness or keywords", "player");
    if (descriptor.card === true || descriptor.zone !== undefined)
        return fail(
            "a continuous static effect applies to permanents (CR 611.2)",
            "zone"
        );
    // CR 205.3 — `PermanentFilter.subtypes` is matched with `.some()`, i.e. OR.
    // `DescriptorIR` reaches this array from two grammatically opposite
    // sources and does not record which: an or-list noun ("Goblins or Elves",
    // genuinely OR) and STACKED ADJECTIVES ("Eldrazi Spawn creatures", which
    // is AND in English). Encoding the second as OR is a real misread —
    // Broodwarden's "Eldrazi Spawn creatures you control get +2/+1" would buff
    // every bare Eldrazi on the board. `readNoun` already refuses the same
    // conflation for TYPES ("artifact creature"); nothing refused it for
    // subtypes, so this does. Fixing it properly means teaching `DescriptorIR`
    // to carry the conjunction, which is a change to the target and cost sites
    // too — see docs/findings/2700-descriptor-subtype-conjunction.md.
    if ((descriptor.subtypes?.length ?? 0) > 1)
        return fail(
            "several subtypes at once: the filter cannot say whether they are AND or OR (CR 205.3)",
            (descriptor.subtypes ?? []).join(" ")
        );

    const filter: Record<string, unknown> = {};
    if (descriptor.types) filter.types = [...descriptor.types];
    else {
        const implied = impliedTypes(descriptor.subtypes);
        if (implied !== undefined) filter.types = implied;
    }
    if (descriptor.subtypes) filter.subtypes = [...descriptor.subtypes];
    if (descriptor.supertypes) filter.supertypes = [...descriptor.supertypes];
    if (descriptor.excludeTypes)
        filter.excludeTypes = [...descriptor.excludeTypes];
    if (descriptor.excludeSubtypes)
        filter.excludeSubtypes = [...descriptor.excludeSubtypes];
    if (descriptor.excludeSupertypes)
        filter.excludeSupertypes = [...descriptor.excludeSupertypes];
    if (descriptor.colors) filter.colors = [...descriptor.colors];
    if (descriptor.controller !== undefined)
        filter.controllerRelation =
            descriptor.controller === "you" ? "you" : "opponents";
    if (descriptor.tapped !== undefined)
        filter.tapped = descriptor.tapped === "tapped";
    for (const role of descriptor.combatRole ?? []) {
        if (role === "attacking") filter.isAttacking = true;
        else filter.isBlocking = true;
    }

    // Every field the descriptor carried and this filter did NOT read. Written
    // as a residue check rather than as an allow-list of descriptor keys for
    // the reason `rule.ts` has no `rest` field: a new `DescriptorIR` member
    // that nobody wires up here must fail the card, not be dropped.
    for (const [field, value] of Object.entries(descriptor)) {
        if (value === undefined) continue;
        if (READ_BY_STATIC_FILTER.has(field)) continue;
        return fail(
            `"${field}" is not expressible as a continuous static filter`,
            field
        );
    }
    const allowed =
        evaluation === "materialised"
            ? MATERIALISED_FILTER_FIELDS
            : STATIC_FILTER_FIELDS;
    for (const field of Object.keys(filter)) {
        // Tripwire: the mapping above must not invent a field the predicate
        // cannot feed (see `STATIC_FILTER_FIELDS`'s own doc comment), nor one
        // the effect's evaluation model cannot keep LIVE (see
        // `MATERIALISED_FILTER_FIELDS`).
        if (!allowed.has(field))
            return fail(
                evaluation === "materialised" && STATIC_FILTER_FIELDS.has(field)
                    ? `"${field}" changes during a turn, and a materialised effect is never re-read`
                    : `"${field}" is not a static filter field`,
                field
            );
    }
    if (Object.keys(filter).length === 0)
        return fail("static filter matches everything", "filter");
    return ok(filter as PermanentFilter);
}

/**
 * How the effect this filter belongs to is evaluated by the engine.
 *
 * `recomputed` — read afresh every time (`pt-buff`, `pt-cda`).
 * `materialised` — written onto the target once at apply time and never
 * re-read (`keyword-grant`). See {@link MATERIALISED_FILTER_FIELDS}.
 */
export type StaticFilterEvaluation = "recomputed" | "materialised";

/** `DescriptorIR` members {@link staticFilterFromDescriptor} consumes. */
const READ_BY_STATIC_FILTER: ReadonlySet<string> = new Set([
    "types",
    "subtypes",
    "supertypes",
    "excludeTypes",
    "excludeSubtypes",
    "excludeSupertypes",
    "colors",
    "controller",
    "tapped",
    "combatRole",
    // Carries no filtering meaning — the CALLER decides whether a plural noun
    // is required (an anthem needs one, "this creature gets" does not).
    "plural",
]);
