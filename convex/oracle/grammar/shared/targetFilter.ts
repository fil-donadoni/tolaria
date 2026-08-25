/**
 * Shared sub-grammar: TARGET FILTER — "target creature an opponent controls",
 * "target nonblack creature with flying" (CR 115.1, CR 115.2).
 *
 * STUB until #2697.
 *
 * This is the single highest-value sub-grammar to get RIGHT rather than early.
 * The competitor's audit (PRD #2693) lists "dropped trailing filter" as its
 * largest silent-misparse bucket, and that is exactly this rule read
 * permissively: "target creature" matches a prefix of "target creature you
 * don't control", and the difference is the whole card. So the stub fails, and
 * when it lands it will be built from the all-consuming combinators in
 * `rule.ts` like everything else — a filter phrase is consumed whole or the
 * card is `unparsed`.
 */

import type { TargetRequirement } from "../../../cards/types";
import { notYetImplemented, type Rule } from "../../rule";

export const TARGET_FILTER = "target filter";

export const targetFilterRule: Rule<TargetRequirement> =
    notYetImplemented<TargetRequirement>(TARGET_FILTER, "#2697");
