/**
 * Golden fixtures — the evidence a Grammar Rule carries for the forms it
 * accepts (ADR 0137, ADR 0105 § 7.1).
 *
 * A fixture is a real corpus card's Oracle row and the Compiled Definition the
 * rule must produce for it. `__tests__/goldenFixtures.test.ts` compiles every
 * fixture and requires the output to equal `expected`, so a fixture is never a
 * declaration: one that stops matching the compiler is a red test, not a stale
 * claim.
 *
 * What a fixture BUYS is computed, never written down: the quarantine gate
 * (`gates.ts` — `fixtureForms`) runs the same smoke planner over `expected`,
 * and every card-dependent skip form it finds there is a form the grammar has
 * proven it emits correctly. A corpus card whose only smoke skips are such
 * forms reaches `ready` — no field here names a card, a form, or a state.
 *
 * Empty until the first Grammar Rule ticket delivers its fixtures (PRD issue
 * #3820 — `/grammar-rule`, issue #3834). Until then every card-dependent skip
 * quarantines, exactly as every smoke skip did before this registry existed.
 */

import type { CompiledDefinition, OracleCard } from "../types";

export interface GoldenFixture {
    /** The `label` of the Grammar Rule that accepts the form. */
    readonly rule: string;
    /** A real corpus card whose Oracle text exhibits the form. */
    readonly card: OracleCard;
    /** The Compiled Definition the rule must produce for `card` — the gold. */
    readonly expected: CompiledDefinition;
}

// Frozen: `fixtureForms` caches by array identity, so the registry may never
// change in place.
export const GOLDEN_FIXTURES: readonly GoldenFixture[] = Object.freeze([]);
