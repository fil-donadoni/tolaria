/**
 * Slot: static abilities other than bare keywords (CR 113.3d, CR 604.1).
 *
 * Bare keyword LINES are the keyword-line slot's ("Flying, vigilance"); this
 * slot reads the SENTENCE forms of the same category — an anthem, a tribal
 * lord, a cost modifier, an entry rider. The frames and every refusal live in
 * the shared clause grammar (`../shared/staticClause.ts`); what is here is the
 * slot's own contract: one sentence, ended by its own full stop.
 *
 * The full stop belongs to the ability exactly as CR 113.3b makes it belong to
 * an activated one, and `terminated` consumes it structurally rather than by a
 * trailing-`.` regex that a frame could forget.
 */

import { map, rule, terminated, type Rule, type RuleResult } from "../../rule";
import { staticClauseRule } from "../shared/staticClause";
import type { SlotIR } from "../ir";

export const STATIC_SLOT = "static";

const clause: Rule<SlotIR> = map(
    staticClauseRule,
    (value): RuleResult<SlotIR> | SlotIR => ({ kind: "static", clause: value })
);

const fullStop = terminated(".", clause);

/**
 * A sentence whose last word is a QUOTED ability ends inside the quotation
 * marks — 'Enchanted creature has "{T}: Add one mana of any color."' — so its
 * full stop belongs to the quoted ability (CR 113.3b), and the whole span,
 * quotes included, goes to the clause. Only the granted-ability frame reads a
 * span that ends in a quotation mark; every other frame is anchored at a word
 * and refuses it, so this branch cannot let a sentence through unterminated.
 */
const QUOTED_FULL_STOP = '."';

export const staticSlot: Rule<SlotIR> = rule(fullStop.label, (span, ctx) =>
    span.endsWith(QUOTED_FULL_STOP)
        ? clause.run(span, ctx)
        : fullStop.run(span, ctx)
);
