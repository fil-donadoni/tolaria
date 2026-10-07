/**
 * Slot: keyword line (CR 113.3d static abilities named as keywords, CR 702.1).
 *
 * A keyword line is a line whose entire content is keyword ability names,
 * separated by `"; "` or `", "` — "Flying", "Flying, vigilance",
 * "Flying; banding".
 *
 * The vocabulary is DERIVED from the Mechanics Registry, never hand-listed
 * here: the registry is this repo's single authority on mechanic names
 * (CLAUDE.md § Card Definition System), and a hand-copied list would be a
 * second authority that drifts. A name the registry does not carry is not a
 * keyword as far as this compiler is concerned, and the card fails — which is
 * also, for free, how PARAMETERISED keywords stay out of grammar v0: "Rampage
 * 1", "Protection from white" and "Ward {4}" are not registry names, so they do
 * not match, so the card is `unparsed` rather than compiled with the parameter
 * dropped. Dropping a parameter is precisely the misparse class this compiler
 * exists to refuse.
 *
 * The one parameterised keyword read here is Enchant (CR 702.5a), whose
 * parameter is an object descriptor and becomes the Aura's whole restriction —
 * see `enchantRule` below. The other is Kicker (CR 702.33), whose parameter
 * is a COST read by the shared cost sub-grammar — see `kickerRule`. The table
 * itself lives in `shared/keywordVocabulary.ts`.
 */

import type {
    ManaCost,
    PermanentFilter,
    TargetRequirement,
} from "../../../cards/types";
import { readManaCost } from "../../manaCost";
import {
    atom,
    fail,
    listOf,
    map,
    oneOf,
    ok,
    rule,
    subGrammar,
    terminated,
    type Rule,
    type RuleResult,
} from "../../rule";
import type { KeywordIR, KickerIR, SlotIR } from "../ir";
import { activationCostRule } from "../shared/cost";
import { keywordVocabulary } from "../shared/keywordVocabulary";
import {
    protectionKeywordsRule,
    protectionListRule,
} from "../shared/protectionKeyword";
import {
    descriptorRule,
    targetRequirementFromDescriptor,
} from "../shared/targetFilter";

const KEYWORD_VOCABULARY = keywordVocabulary();

/** The sub-grammar the attribution diagnostic names for this slot. */
export const KEYWORD_ABILITY = "keyword ability";

/**
 * Does the span open with a keyword's name — "Equip {2}", "Protection from
 * white", "Enchant creature"? Only then is a refusal this slot's to own: a
 * parameterised keyword the vocabulary cannot read. Any other span reached
 * the atom because `listOf` split a sentence at its commas, and blaming the
 * keyword vocabulary for "Destroy target creature" would rank a gap nobody
 * can close (issue #3822).
 */
function opensWithKeyword(span: string): boolean {
    const probe = span.toLowerCase();
    for (const name of KEYWORD_VOCABULARY.keys()) {
        if (!probe.startsWith(name)) continue;
        const next = probe.charAt(name.length);
        if (next === " " || next === "\u2014") return true;
    }
    return false;
}

/**
 * One keyword span: a registry name, or the parameterised "Protection from
 * [quality]" (CR 702.16a) — which may name two qualities (CR 702.16g) and so
 * yields a list.
 */
const keyword: Rule<readonly KeywordIR[]> = subGrammar(
    KEYWORD_ABILITY,
    oneOf(KEYWORD_ABILITY, [
        map(
            atom(KEYWORD_ABILITY, KEYWORD_VOCABULARY),
            (k): RuleResult<readonly KeywordIR[]> => ok([k])
        ),
        protectionKeywordsRule,
    ]),
    opensWithKeyword
);

/** `"Flying, vigilance"` — a comma-separated run of keywords. */
const commaRun: Rule<KeywordIR[]> = map(
    listOf("keyword run", ", ", keyword),
    (runs): RuleResult<KeywordIR[]> => ok(runs.flat())
);

/** `"Flying; banding"` — semicolon groups, each a comma run. */
const semicolonGroups: Rule<KeywordIR[][]> = listOf(
    "keyword groups",
    "; ",
    commaRun
);

export const KEYWORD_LINE_SLOT = "keyword-line";

/** One `keywords` slot, refusing a keyword named twice on the line. */
function keywordsSlot(keywords: readonly KeywordIR[]): RuleResult<SlotIR> {
    const seen = new Set<string>();
    for (const k of keywords) {
        // The same keyword twice on one line is not a shape Magic prints;
        // it is a sign the line was misread, so it fails rather than being
        // silently deduped.
        if (seen.has(k.ability)) {
            return fail(
                `keyword "${k.ability}" named twice on one line`,
                k.ability
            );
        }
        seen.add(k.ability);
    }
    return ok({ kind: "keywords", keywords });
}

const keywordRunRule: Rule<SlotIR> = map(semicolonGroups, (groups) =>
    keywordsSlot(groups.flat())
);

// ── Enchant <descriptor> (CR 702.5a) ───────────────────────────────────────

const ENCHANT_HEAD = "Enchant ";

/**
 * CR 702.5a — "Enchant is a static ability, written 'Enchant [object or
 * player].' The enchant ability restricts what an Aura spell can target and
 * what an Aura can enchant."
 *
 * The one PARAMETERISED keyword the keyword line reads, and the reason the
 * header's rule still holds: the parameter is not dropped, it is the whole
 * output. The object after the keyword is an ordinary object descriptor, read
 * by the SAME sub-grammar as "target creature you control" — "Enchant creature
 * you control" and "target creature you control" name one set of objects, and
 * a second reader for it here would be a second place the trailing filter can
 * go missing.
 *
 * The engine's printed enchant restriction IS the Aura's cast-time
 * `targetRequirement` (`resolveEnchantRestriction`, `gre/state.ts`) — every
 * hand-written Aura writes "Enchant creature" as `{ type: "Creature", count: 1
 * }` — so this rule emits exactly that, and lowering hangs it on the card.
 *
 * Refused, each for a reason the filter cannot carry:
 *
 *  - a PLAYER ("Enchant player", "Enchant opponent") — CR 702.5d makes such an
 *    Aura one that "can't target permanents and can't be attached to
 *    permanents", a different attachment branch (`auraEnchantsPlayers`) that
 *    no hand-written Aura exercises through this seam yet;
 *  - a CARD in a zone ("Enchant creature card in a graveyard") — the Aura's
 *    host is not a permanent at all, and what it enchants after it resolves is
 *    the card's own text (Animate Dead), not this restriction;
 *  - a PLURAL noun — "Enchant creatures" is not a printed shape, so reading
 *    one means the line was misread.
 *  - a COMBAT ROLE ("attacking creature") — likewise not a printed shape.
 */
export const enchantRule: Rule<SlotIR> = rule("enchant", (span, ctx) => {
    if (!span.startsWith(ENCHANT_HEAD))
        return fail(`an enchant line starts with "${ENCHANT_HEAD}"`, span);
    const phrase = span.slice(ENCHANT_HEAD.length);
    const descriptor = descriptorRule.run(phrase, ctx);
    if (!descriptor.ok) return descriptor;
    const d = descriptor.value;
    if (d.player !== undefined || d.anyTarget === true)
        return fail(
            "an Aura that enchants a player is not a permanent filter (CR 702.5d)",
            phrase
        );
    // "Enchant attacking creature" is not a printed shape: the Aura would be
    // legal to cast only mid-combat and fall off at end of combat, which no
    // card means. Reading one means the line was misread.
    if (d.combatRole !== undefined)
        return fail("an enchant filter never names a combat role", phrase);
    if (d.card === true || d.zone !== undefined)
        return fail(
            "an Aura that enchants a card outside the battlefield is not a permanent filter",
            phrase
        );
    const requirement: RuleResult<TargetRequirement> =
        targetRequirementFromDescriptor(d);
    if (!requirement.ok) return requirement;
    return ok({ kind: "enchant" as const, requirement: requirement.value });
});

// ── Kicker <cost> (CR 702.33) ──────────────────────────────────────────────

const KICKER_HEAD = "Kicker ";
const MULTIKICKER_HEAD = "Multikicker ";
const KICKER_DASH_HEAD = "Kicker—";
const AND_OR = " and/or ";

/**
 * A kicker's MANA cost, read by the shared mana reader.
 *
 * Narrower than a printed mana cost in one place, an engine fact rather than
 * a grammar one: neither Phyrexian nor hybrid pips are exercised on the kicker
 * payment path by any hand-written kicker. A variable {X} is read as-is: the
 * caster announces one X shared by the mana cost and the kicker (CR 107.3a,
 * `paidKickersAnnounceX`). A cost the path might mis-pay is refused rather
 * than compiled into a kicker that is free, or unpayable, in play.
 */
function kickerMana(
    printed: string,
    allowVariableX = false
): RuleResult<ManaCost> {
    if (!printed.startsWith("{"))
        return fail("a kicker mana cost is a run of mana symbols", printed);
    const read = readManaCost(printed);
    if (!read.ok) return fail(read.reason, read.fragment);
    return payableKickerMana(read.cost, printed, allowVariableX);
}

/** The engine-side half of {@link kickerMana}, for an already-read cost. */
function payableKickerMana(
    cost: ManaCost,
    fragment: string,
    allowVariableX: boolean
): RuleResult<ManaCost> {
    if (cost.X === "X" && !allowVariableX)
        return fail(
            "a variable {X} is read only on a single plain kicker cost (CR 107.3a)",
            fragment
        );
    if (cost.xFactor !== undefined)
        return fail(
            "a kicker cost repeating {X} is not exercised on the kicker payment path",
            fragment
        );
    if (cost.phyrexian !== undefined || cost.hybrid !== undefined)
        return fail(
            "a Phyrexian or hybrid kicker cost is not exercised on the kicker payment path",
            fragment
        );
    return ok(cost);
}

/**
 * "Kicker—<cost>." — a kicker cost with a non-mana component (CR 702.33a:
 * "an additional [cost]", of any kind). Read by the SAME cost sub-grammar an
 * activation cost is (`shared/cost.ts`), so "Sacrifice a land" means one thing
 * everywhere; what differs is only which atoms have a `KickerCost` leg to land
 * in. Every other atom is REFUSED, not dropped: an unpaid kicker leg is a
 * kicked spell for less than its printed price, the unbounded failure the cost
 * grammar's own header describes.
 */
function dashKicker(body: string, ctx: unknown): RuleResult<KickerIR> {
    const parsed = terminated(".", activationCostRule).run(body, ctx);
    if (!parsed.ok) return parsed;
    const legs: {
        mana?: ManaCost;
        life?: number;
        sacrifice?: { filter: PermanentFilter; count: number };
    } = {};
    for (const atom of parsed.value.atoms) {
        switch (atom.kind) {
            case "mana": {
                const mana = payableKickerMana(atom.mana, body, false);
                if (!mana.ok) return mana;
                legs.mana = mana.value;
                break;
            }
            case "pay-life":
                legs.life = atom.amount;
                break;
            case "sacrifice-other":
                legs.sacrifice = { filter: atom.filter, count: atom.count };
                break;
            default:
                return fail(
                    `"${atom.kind}" is not a kicker cost leg this grammar can encode (CR 702.33a)`,
                    body
                );
        }
    }
    return ok({
        // Without the stop, as the catalogue writes it ("Kicker—Pay 3 life").
        description: `${KICKER_DASH_HEAD}${body.slice(0, -1)}`,
        ...legs,
        multi: false,
    });
}

/**
 * CR 702.33a / 702.33b / 702.33c — the kicker line.
 *
 *   "Kicker {2}{U}"                 → one kicker
 *   "Kicker {1}{U} and/or {B}"      → two kickers (CR 702.33b: "the same thing
 *                                     as 'Kicker [cost 1], kicker [cost 2]'")
 *   "Kicker—Sacrifice a land."      → one kicker with a non-mana leg
 *   "Multikicker {2}"               → one kicker payable any number of times
 *
 * Why the keyword-line slot: kicker is a keyword ability (CR 702.33a) printed
 * on its own line with its parameter, exactly as Enchant is, and a registry
 * table lookup cannot read the parameter — which is the refusal the header
 * describes working as designed. Printed on permanents and spells alike, so
 * the slot guard below (none) is the right one.
 *
 * Refused: an "and/or" with other than two costs, a non-mana cost on either
 * side of "and/or" (not a printed shape), a Multikicker with a non-mana cost
 * (likewise), and every cost the helpers above refuse.
 */
export const kickerRule: Rule<SlotIR> = rule("kicker", (span, ctx) => {
    if (span.startsWith(KICKER_DASH_HEAD)) {
        const kicker = dashKicker(span.slice(KICKER_DASH_HEAD.length), ctx);
        if (!kicker.ok) return kicker;
        return ok({ kind: "kicker" as const, kickers: [kicker.value] });
    }
    if (span.startsWith(MULTIKICKER_HEAD)) {
        const printed = span.slice(MULTIKICKER_HEAD.length);
        const mana = kickerMana(printed);
        if (!mana.ok) return mana;
        return ok({
            kind: "kicker" as const,
            kickers: [
                {
                    description: `Multikicker ${printed}`,
                    mana: mana.value,
                    multi: true,
                },
            ],
        });
    }
    if (!span.startsWith(KICKER_HEAD))
        return fail(`a kicker line starts with "${KICKER_HEAD}"`, span);
    const costs = span.slice(KICKER_HEAD.length).split(AND_OR);
    if (costs.length > 2)
        return fail(
            '"and/or" joins exactly two kicker costs (CR 702.33b)',
            span
        );
    const kickers: KickerIR[] = [];
    for (const printed of costs) {
        const mana = kickerMana(printed, costs.length === 1);
        if (!mana.ok) return mana;
        kickers.push({
            description: `Kicker ${printed}`,
            mana: mana.value,
            multi: false,
        });
    }
    return ok({ kind: "kicker" as const, kickers });
});

// ── Cycling / Madness / Morph <mana cost> (CR 702.29a, 702.35a, 702.37) ────

/**
 * The mana cost parameter of a keyword line — "Cycling {B}", "Madness {0}",
 * "Morph {2}{W}{W}" — or a refusal.
 *
 * Narrower than a printed mana cost in one place, an engine fact rather than
 * a grammar one: the cycling label renderer, the madness cast and the morph
 * turn-up payment are exercised on plain generic and coloured pips only — no
 * variable {X}, hybrid or Phyrexian pip. A cost they might mis-pay (or
 * mis-print) is refused rather than compiled into a keyword that is free, or
 * unpayable, in play. A non-mana cost ("Morph—Reveal a card…", "Cycling—Pay 2
 * life") does not start with a mana symbol and is refused by the same test.
 */
function costParameter(head: string, span: string): RuleResult<ManaCost> {
    if (!span.startsWith(head))
        return fail(`a line starts with "${head}"`, span);
    const printed = span.slice(head.length);
    if (!printed.startsWith("{"))
        return fail(`a ${head.trim()} cost is a run of mana symbols`, printed);
    const read = readManaCost(printed);
    if (!read.ok) return fail(read.reason, read.fragment);
    const cost = read.cost;
    if (cost.X === "X" || cost.xFactor !== undefined)
        return fail(
            `a variable {X} ${head.trim()} cost is not exercised on its payment path`,
            printed
        );
    if (cost.phyrexian !== undefined || cost.hybrid !== undefined)
        return fail(
            `a Phyrexian or hybrid ${head.trim()} cost is not exercised on its payment path`,
            printed
        );
    return ok(cost);
}

const CYCLING_HEAD = "Cycling ";
const MADNESS_HEAD = "Madness ";
const MORPH_HEAD = "Morph ";

/**
 * CR 702.29a — "Cycling [cost]" means "[Cost], Discard this card: Draw a
 * card." An activated ability that functions only in the hand, built by the
 * SAME factory the catalogue uses (`cyclingAbility`), so a compiled cycling
 * card carries the hand-written ability field for field.
 *
 * Refused: a typecycling line ("Plainscycling {1}" — CR 702.29e, another
 * keyword with a search body, not this rule's draw), every cost
 * {@link costParameter} refuses.
 */
export const cyclingRule: Rule<SlotIR> = rule("cycling", (span) => {
    const cost = costParameter(CYCLING_HEAD, span);
    if (!cost.ok) return cost;
    return ok({ kind: "cycling" as const, cost: cost.value });
});

/**
 * CR 702.35a — "Madness [cost]": the cost its owner may pay to cast the card
 * when it is discarded. The engine reads it off `CardDefinition.madness`
 * (`gre/madness.ts`); "Madness {0}" is the empty cost.
 */
export const madnessRule: Rule<SlotIR> = rule("madness", (span) => {
    const cost = costParameter(MADNESS_HEAD, span);
    if (!cost.ok) return cost;
    return ok({ kind: "madness" as const, cost: cost.value });
});

/**
 * CR 702.37a / 702.37e — "Morph [cost]": the cost to turn the face-down
 * permanent face up. The engine reads it off `CardDefinition.morph`; the
 * face-down cast's own {3} (CR 702.37a) is the keyword's, not the line's.
 */
export const morphRule: Rule<SlotIR> = rule("morph", (span) => {
    const cost = costParameter(MORPH_HEAD, span);
    if (!cost.ok) return cost;
    return ok({ kind: "morph" as const, cost: cost.value });
});

// ── Fading N (CR 702.32a) ──────────────────────────────────────────────────

const FADING = /^Fading (\d+)$/;

/**
 * CR 702.32a — "Fading N" means "This permanent enters with N fade counters on
 * it" and "At the beginning of your upkeep, remove a fade counter from this
 * permanent. If you can't, sacrifice the permanent." Both halves are expanded
 * from the one `staticAbilities` string "fading N" at the `getDefinition`
 * seam (ADR 0054), so the rule emits that string and nothing else — N lives
 * in exactly one place, the keyword, as in every hand-written fading card.
 *
 * Refused: "Fading 0" (a permanent that enters with no counter is a different
 * printed shape this grammar has no card for).
 */
export const fadingRule: Rule<SlotIR> = rule("fading", (span) => {
    const match = FADING.exec(span);
    if (match === null) return fail('a fading line is "Fading N"', span);
    const count = Number(match[1]);
    if (count < 1) return fail("fading counts from 1", span);
    const row = KEYWORD_VOCABULARY.get("fading");
    if (row === undefined)
        return fail("the Mechanics Registry names no fading row", span);
    return ok({
        kind: "keywords" as const,
        keywords: [{ ...row, ability: `fading ${count}` }],
    });
});

/**
 * The keyword line: a run of registry keywords, one `Enchant <descriptor>`,
 * one kicker line, or one cost-parameter keyword (cycling, madness, morph,
 * fading). They are disjoint by construction — no registry keyword name
 * carries a trailing descriptor, cost or number, a bare "Enchant" names no
 * object, and each parameterised rule reads only its own head — and `oneOf`
 * enforces it rather than trusting it.
 */
export const keywordLineRule: Rule<SlotIR> = oneOf("keyword line", [
    keywordRunRule,
    map(protectionListRule, keywordsSlot),
    enchantRule,
    kickerRule,
    cyclingRule,
    madnessRule,
    morphRule,
    fadingRule,
]);

/** Guard: keyword lines are only meaningful on an object with a text box. */
export const keywordLineSlot: Rule<SlotIR> = rule(
    KEYWORD_LINE_SLOT,
    (span, ctx) => keywordLineRule.run(span, ctx)
);
