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
 * see `enchantRule` below. The table itself lives in
 * `shared/keywordVocabulary.ts`.
 */

import type { TargetRequirement } from "../../../cards/types";
import {
    atom,
    fail,
    listOf,
    map,
    oneOf,
    ok,
    rule,
    type Rule,
    type RuleResult,
} from "../../rule";
import type { KeywordIR, SlotIR } from "../ir";
import { keywordVocabulary } from "../shared/keywordVocabulary";
import {
    descriptorRule,
    targetRequirementFromDescriptor,
} from "../shared/targetFilter";

const KEYWORD_VOCABULARY = keywordVocabulary();

const keyword: Rule<KeywordIR> = atom("keyword ability", KEYWORD_VOCABULARY);

/** `"Flying, vigilance"` — a comma-separated run of keywords. */
const commaRun: Rule<KeywordIR[]> = listOf("keyword run", ", ", keyword);

/** `"Flying; banding"` — semicolon groups, each a comma run. */
const semicolonGroups: Rule<KeywordIR[][]> = listOf(
    "keyword groups",
    "; ",
    commaRun
);

export const KEYWORD_LINE_SLOT = "keyword-line";

const keywordRunRule: Rule<SlotIR> = map(
    semicolonGroups,
    (groups): RuleResult<SlotIR> => {
        const keywords = groups.flat();
        const seen = new Set<string>();
        for (const k of keywords) {
            // The same keyword twice on one line is not a shape Magic prints;
            // it is a sign the line was misread, so it fails rather than being
            // silently deduped.
            if (seen.has(k.registryId)) {
                return fail(
                    `keyword "${k.ability}" named twice on one line`,
                    k.ability
                );
            }
            seen.add(k.registryId);
        }
        return ok({ kind: "keywords", keywords });
    }
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

/**
 * The keyword line: a run of registry keywords, or one `Enchant <descriptor>`.
 * The two are disjoint by construction — no registry keyword name carries a
 * trailing descriptor, and a bare "Enchant" names no object — and `oneOf`
 * enforces it rather than trusting it.
 */
export const keywordLineRule: Rule<SlotIR> = oneOf("keyword line", [
    keywordRunRule,
    enchantRule,
]);

/** Guard: keyword lines are only meaningful on an object with a text box. */
export const keywordLineSlot: Rule<SlotIR> = rule(
    KEYWORD_LINE_SLOT,
    (span, ctx) => keywordLineRule.run(span, ctx)
);
