/**
 * Slot router — decides which grammar reads a line, and refuses to guess.
 *
 * ── Unique dispatch, not a priority ladder ─────────────────────────────────
 *
 * The obvious design (and the one PRD #2693 sketches) is a priority order:
 * keyword line, then activated, then triggered, then static, then spell text.
 * A ladder is a first-branch fallback wearing a different hat — an early broad
 * rule shadows a later precise one, and the card compiles to the shadowing
 * reading with no diagnostic anywhere. That is the same failure `oneOf` in
 * `rule.ts` exists to forbid, one level up.
 *
 * So this router runs EVERY slot and requires EXACTLY ONE to consume the line:
 *
 *   0 slots  → `unparsed`, with each slot's reason recorded (this is the
 *              backlog signal that ranks the next grammar rule by corpus count)
 *   1 slot   → that slot's IR, the whole line consumed
 *   2+ slots → `unparsed` with an AMBIGUITY reason. Two grammars that both
 *              accept a line is a defect in the GRAMMAR, and the only honest
 *              output is to say so. Picking one would be a coin flip recorded
 *              as a fact.
 *
 * Slot order in `SLOTS` is therefore presentational only — nothing about the
 * result depends on it, which is exactly the property being bought.
 *
 * The four card-ability categories are CR 113.3a–d; the slots below are those
 * categories plus keyword lines split out of the static category (CR 702.1)
 * and mana abilities split out of the activated category (CR 605.1a), because
 * both have their own lowering and their own gate.
 */

import type { Rule, RuleResult } from "../rule";
import { fail, ok } from "../rule";
import type { ParseContext } from "../types";
import type { LineParse, SlotIR } from "./ir";
import { ACTIVATED_SLOT, activatedSlot } from "./slots/activated";
import { KEYWORD_LINE_SLOT, keywordLineSlot } from "./slots/keywordLine";
import { MANA_ABILITY_SLOT, manaAbilitySlot } from "./slots/manaAbility";
import { SPELL_SLOT, spellSlot } from "./slots/spell";
import { STATIC_SLOT, staticSlot } from "./slots/staticSlot";
import { TRIGGERED_SLOT, triggeredSlot } from "./slots/triggered";

export interface Slot {
    readonly name: string;
    readonly rule: Rule<SlotIR>;
}

/** Every slot the compiler knows. Order is presentational — see the header. */
export const SLOTS: readonly Slot[] = [
    { name: KEYWORD_LINE_SLOT, rule: keywordLineSlot },
    { name: MANA_ABILITY_SLOT, rule: manaAbilitySlot },
    { name: ACTIVATED_SLOT, rule: activatedSlot },
    { name: TRIGGERED_SLOT, rule: triggeredSlot },
    { name: STATIC_SLOT, rule: staticSlot },
    { name: SPELL_SLOT, rule: spellSlot },
];

/**
 * The router proper, over an INJECTED slot list.
 *
 * The slot list is a parameter and not a closed-over constant for one reason:
 * the 2+ branch below is the PR's headline guarantee and, with four of six
 * slots still stubs, no real line can reach it. A guarantee whose branch no
 * test can enter is a guarantee nobody has watched hold — the mutation
 * `hits.length === 1` → `hits.length >= 1` turns this router into exactly the
 * priority ladder the header rejects, and left every test in this directory
 * green. Synthetic slots make the branch reachable today, so the regression is
 * caught now rather than when #2697–#2700 make it reachable for real.
 */
export function routeLineWith(
    slots: readonly Slot[],
    line: string,
    ctx: ParseContext
): RuleResult<LineParse> {
    const hits: LineParse[] = [];
    for (const slot of slots) {
        const r = slot.rule.run(line, ctx);
        if (r.ok) hits.push({ line, slot: slot.name, ir: r.value });
    }
    if (hits.length === 1) return ok(hits[0]!);
    if (hits.length === 0) return fail("no slot consumed the line", line);
    // Sorted for the same reason `oneOf` sorts: slot order is presentational,
    // so it must not reach the lockfile.
    return fail(
        `ambiguous line: slots ${hits
            .map((h) => h.slot)
            .sort()
            .join(" and ")} both consumed it`,
        line
    );
}

/** Route a line through every slot the compiler knows. */
export function routeLine(
    line: string,
    ctx: ParseContext
): RuleResult<LineParse> {
    return routeLineWith(SLOTS, line, ctx);
}

/**
 * Every slot's verdict on a line, for humans and tests.
 *
 * The per-slot reasons are deliberately NOT in `routeLine`'s failure text: the
 * lockfile records a gap per unconsumed line, and six "not a known keyword
 * ability" messages per gap would triple the file while adding nothing to the
 * backlog — the signal that ranks the next grammar rule is the FRAGMENT and
 * its corpus count, not the near-misses.
 */
export function explainLine(
    line: string,
    ctx: ParseContext
): { slot: string; verdict: string }[] {
    return SLOTS.map((slot) => {
        const r = slot.rule.run(line, ctx);
        return { slot: slot.name, verdict: r.ok ? "consumed" : r.reason };
    });
}
