/**
 * Slot: non-mana activated abilities (CR 113.3b, CR 602.1a).
 *
 * "[Cost]: [Effect.]" — the cost half is the shared activation-cost
 * sub-grammar, the effect half is one or more shared effect SENTENCES, and the
 * full stop belongs to the ability rather than to the last sentence.
 *
 * ── The boundary with the mana-ability slot ────────────────────────────────
 *
 * `{T}: Add {G}.` is BOTH a "cost: effect" line and a mana ability, and the
 * router requires exactly one slot to consume a line (`grammar/router.ts`) — so
 * a grammar here that accepted "Add" would turn every mana ability in the
 * corpus into an AMBIGUITY and lose 1,000+ already-compiling cards. The
 * boundary is therefore structural, not a priority: the effect sentence grammar
 * has no "Add" verb at all, so this slot cannot accept a line whose effect is
 * adding mana, and the mana slot's `addEffect` cannot accept anything else.
 * Both directions are asserted in `grammar.test.ts`.
 *
 * A line that adds mana AND does something else ("Add {C}{C}. Draw a card.")
 * is accepted by NEITHER — the mana slot's production rule cannot consume the
 * second sentence and this slot has no verb for the first. That is the correct
 * outcome for grammar v0: CR 605.1a would still make it a mana ability, and a
 * mana ability lowered here would get `useStack: true` and start using the
 * stack (CR 605.3a).
 *
 * ── Restrictions are sentences, not riders ─────────────────────────────────
 *
 * "Activate only as a sorcery." is a sentence of the ability's text (CR 602.5),
 * so it is parsed as one and lowered onto the ability's own restriction fields.
 * Reading it as prose to be ignored is how an ability that may only be
 * activated at sorcery speed ships activatable at instant speed — a rules
 * error with no visible symptom until an opponent does it.
 */

import { PERMANENT_TYPES } from "../../../cards/types";
import {
    fail,
    listOf,
    ok,
    pair,
    rule,
    terminated,
    type Rule,
} from "../../rule";
import type { ParseContext } from "../../types";
import { activationCostRule, type ActivationCostIR } from "../shared/cost";
import {
    sentenceRule,
    type EffectSentenceIR,
    type RestrictionIR,
    type SentenceIR,
} from "../shared/effectClause";
import type { SlotIR } from "../ir";

export const ACTIVATED_SLOT = "activated";

/**
 * Assemble a sentence list into effects + restrictions.
 *
 * Two orderings are enforced because both encode a real rule: a restriction
 * (CR 602.5) applies to the whole ability and is printed last, and a modifier
 * ("It can't be regenerated.", CR 701.19c on regenerate) attaches to the one before it.
 * A restriction followed by an effect, or a modifier with nothing in front of
 * it, is a sentence sequence we have misread.
 */
function assemble(sentences: readonly SentenceIR[]):
    | {
          readonly ok: true;
          readonly effects: EffectSentenceIR[];
          readonly restrictions: RestrictionIR[];
      }
    | { readonly ok: false; readonly reason: string } {
    const effects: EffectSentenceIR[] = [];
    const restrictions: RestrictionIR[] = [];
    for (const sentence of sentences) {
        if (sentence.role === "restriction") {
            restrictions.push(sentence.restriction);
            continue;
        }
        if (restrictions.length > 0)
            return {
                ok: false,
                reason: "an effect sentence follows an activation restriction",
            };
        if (sentence.role === "modifier") {
            const previous = effects[effects.length - 1];
            if (previous === undefined || previous.kind !== "destroy")
                return {
                    ok: false,
                    reason: '"It can\'t be regenerated." follows no destroy',
                };
            effects[effects.length - 1] = {
                ...previous,
                cantBeRegenerated: true,
            };
            continue;
        }
        effects.push(sentence.effect);
    }
    if (effects.length === 0)
        return { ok: false, reason: "the ability has no effect sentence" };
    return { ok: true, effects, restrictions };
}

const activatedBody: Rule<SlotIR> = rule("activated body", (span, ctx) => {
    const parsed = pair(
        ACTIVATED_SLOT,
        ": ",
        activationCostRule,
        listOf("effect sentences", ". ", sentenceRule),
        (
            cost,
            sentences
        ): { cost: ActivationCostIR; sentences: SentenceIR[] } => ({
            cost,
            sentences,
        })
    ).run(span, ctx);
    if (!parsed.ok) return parsed;
    const assembled = assemble(parsed.value.sentences);
    if (!assembled.ok) return fail(assembled.reason, span);
    return ok({
        kind: "activated" as const,
        cost: parsed.value.cost,
        effects: assembled.effects,
        restrictions: assembled.restrictions,
    });
});

const PERMANENT_TYPE_SET = new Set<string>(PERMANENT_TYPES);

/**
 * CR 113.3b — the sentence ends in a full stop, which belongs to the ability.
 *
 * Restricted to permanents for the same reason the mana slot is: grammar v0
 * has no vocabulary for an ability activated from hand or graveyard (cycling,
 * flashback), and a cost that taps or sacrifices the source has no meaning on
 * an instant or sorcery.
 */
export const activatedSlot: Rule<SlotIR> = rule(ACTIVATED_SLOT, (span, ctx) => {
    const context = ctx as ParseContext;
    if (!context.typeLine.types.some((t) => PERMANENT_TYPE_SET.has(t))) {
        return fail(
            "an activated ability on a non-permanent is not in grammar v0 (CR 602.1a)",
            span
        );
    }
    return terminated(".", activatedBody).run(span, ctx);
});
