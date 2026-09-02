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

import { map, terminated, type Rule, type RuleResult } from "../../rule";
import { staticClauseRule } from "../shared/staticClause";
import type { SlotIR } from "../ir";

export const STATIC_SLOT = "static";

export const staticSlot: Rule<SlotIR> = terminated(
    ".",
    map(staticClauseRule, (clause): RuleResult<SlotIR> | SlotIR => ({
        kind: "static",
        clause,
    }))
);
