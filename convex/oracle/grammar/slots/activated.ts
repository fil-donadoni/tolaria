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
    disowning,
    fail,
    listOf,
    ok,
    pair,
    rule,
    terminated,
    type Rule,
} from "../../rule";
import type { ParseContext } from "../../types";
import {
    activationCostRule,
    type ActivationCostIR,
    type CostAtomIR,
} from "../shared/cost";
import {
    assembleSentences,
    assemblyTrace,
    sentenceRule,
    sourcePronounListRule,
    type SentenceIR,
} from "../shared/effectClause";
import type { SlotIR } from "../ir";

export const ACTIVATED_SLOT = "activated";

/**
 * A sentence of the ability. One that opens "Add " is a mana ability's
 * (CR 605.1a), whose form is the mana slot's to own — refused here exactly as
 * before, but never blamed here (`disowning`, issue #3822).
 */
const activatedSentence: Rule<SentenceIR> = disowning(sentenceRule, (span) =>
    span.startsWith("Add ")
);

const activatedBody: Rule<SlotIR> = rule("activated body", (span, ctx) => {
    const parsed = pair(
        ACTIVATED_SLOT,
        ": ",
        activationCostRule,
        sourcePronounListRule(
            listOf("effect sentences", ". ", activatedSentence)
        ),
        (
            cost,
            body
        ): {
            cost: ActivationCostIR;
            sentences: SentenceIR[];
            boundPronoun: boolean;
        } => ({
            cost,
            sentences: body.value,
            boundPronoun: body.boundPronoun,
        })
    ).run(span, ctx);
    if (!parsed.ok) return parsed;
    // CR 608.2h — "Sacrifice this creature: It deals 1 damage …". The pronoun
    // opening the effect names the object the COST named; a cost that names
    // no object of its own leaves it without an antecedent here.
    if (parsed.value.boundPronoun && !parsed.value.cost.atoms.some(namesSource))
        return fail(
            '"It" opens the effect but the cost names no source to bind it to',
            span
        );
    // CR 602.5 — an activated ability is the ONE site that may carry an
    // activation restriction, so it is the one caller that accepts them.
    const assembled = assembleSentences(parsed.value.sentences, {
        site: "ability",
    });
    if (!assembled.ok)
        return fail(
            assembled.reason,
            span,
            assemblyTrace(span, parsed.value.sentences.length)
        );
    return ok({
        kind: "activated" as const,
        cost: parsed.value.cost,
        effects: assembled.effects,
        restrictions: assembled.restrictions,
    });
});

/**
 * A cost atom that names the source object itself ("Sacrifice this creature",
 * "Remove a charge counter from this artifact") — the printed antecedent of
 * an effect's leading "It". `{T}` is the source's symbol, not its name, and
 * no corpus line binds a pronoun to it.
 */
function namesSource(atom: CostAtomIR): boolean {
    switch (atom.kind) {
        case "sacrifice-self":
        case "exile-self":
        case "return-self":
        case "remove-counter":
            return true;
        default:
            return false;
    }
}

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
