/**
 * The `ready` gates (PRD #2693).
 *
 * A parse that consumed every line is necessary but nowhere near sufficient:
 * "we understood the sentence" says nothing about whether the DEFINITION we
 * emitted does anything. `ready` therefore means five things, all of which are
 * computed here and none of which is ever set by hand:
 *
 *  1. the parse consumed the whole card (upstream — see `compile.ts`)
 *  2. every Effect Script Op it uses is `implemented` in the Mechanics Registry
 *  3. every keyword it names is `implemented` there too
 *  4. `validateEffectScript` returns no errors
 *  5. the definition is JSON — it survives a serialise/parse round trip
 *     unchanged, which is the property the lockfile and the wire both rely on
 *
 * Anything short of all five is `quarantine` WITH A REASON. Quarantine is not a
 * soft pass: a quarantined row is not playable, exactly like an unparsed one.
 * The distinction it buys is diagnostic — "we read this card correctly and the
 * engine cannot run it yet" is a different backlog from "we cannot read it".
 *
 * ── `ready` is COMPILER fidelity, not an engine-capability claim ───────────
 *
 * All five gates read the emitted DEFINITION. None of them consults an engine
 * ACTIVATION path, and this module imports none — so `ready` means "the Oracle
 * text was read whole and the definition we emitted is well-formed and
 * implemented", never "a live mutation can run it today". The two can diverge,
 * and #2697 is where they first visibly do: the shared cost grammar emits the
 * CR-605.1a-faithful `{ sacrificeFilter, useStack: false }` for eight cards
 * (Ashnod's Altar, Skirk Prospector, …) and no non-stack engine path pays a
 * filter cost — `docs/findings/2697-mana-ability-filter-cost-engine-gap.md`
 * has the sites and the two ways out. Read the lockfile accordingly: a `ready`
 * row is a statement about the COMPILER, and closing the gap means either
 * teaching the engine the shape or adding a sixth, engine-capability gate here.
 *
 * ── What this module deliberately does NOT do ──────────────────────────────
 *
 * The PRD also lists a generated smoke scenario and a wire-projection round
 * trip. The smoke gate runs here when there is an Effect Script to smoke;
 * grammar v0 emits none (keywords are `staticAbilities[]`, mana abilities are
 * `manaProduced`/`manaChoices`), so it is a no-op today and is wired up so
 * #2697 inherits it rather than inventing it.
 *
 * The REAL wire-projection round trip needs a `GameState` holding an instance
 * of the card, which needs the card in the registry — that is #2702's
 * hydration seam and does not exist yet. Rather than fake it, gate 5 proves the
 * narrower thing that is actually provable offline (the definition is pure
 * JSON), and the full projection is proven catalogue-wide against gold in
 * `__tests__/wireProjection.test.ts`, where the registry IS available.
 */

import { isRegisteredEffectOp } from "../cards/mechanicsRegistry";
import { registerTokenDefinition } from "../cards/registry";
import {
    FILLER_CARD_DEFINITION,
    planSmokeTest,
} from "../gre/effects/scenarioGenerator";
import { validateEffectScript } from "../gre/effects/validate";
import type { EffectOp } from "../cards/types";
import type { CompiledDefinition, QuarantineReason } from "./types";

/** Every `op` name anywhere in the definition, sorted and deduplicated. */
export function collectOps(definition: CompiledDefinition): string[] {
    const found = new Set<string>();
    const walk = (node: unknown): void => {
        if (Array.isArray(node)) {
            for (const child of node) walk(child);
            return;
        }
        if (node === null || typeof node !== "object") return;
        const record = node as Record<string, unknown>;
        if (typeof record.op === "string") found.add(record.op);
        for (const value of Object.values(record)) walk(value);
    };
    walk(definition);
    return [...found].sort();
}

/** Every `effects[]` script in the definition, wherever it hangs. */
function collectScripts(definition: CompiledDefinition): EffectOp[][] {
    const scripts: EffectOp[][] = [];
    if (definition.effects) scripts.push(definition.effects);
    for (const ability of definition.activatedAbilities ?? []) {
        if (ability.effects) scripts.push(ability.effects);
    }
    for (const ability of definition.triggeredAbilities ?? []) {
        if (ability.effects) scripts.push(ability.effects);
    }
    return scripts;
}

export interface GateInput {
    readonly oracleId: string;
    readonly definition: CompiledDefinition;
    /** Keyword abilities whose registry row is not `implemented` (from lowering). */
    readonly plannedMechanics: readonly string[];
}

export interface GateResult {
    readonly opsUsed: readonly string[];
    readonly reasons: readonly QuarantineReason[];
}

export function runGates(input: GateInput): GateResult {
    const { definition, plannedMechanics, oracleId } = input;
    const reasons: QuarantineReason[] = [];
    const opsUsed = collectOps(definition);

    for (const op of opsUsed) {
        if (!isRegisteredEffectOp(op)) {
            reasons.push({
                kind: "planned-op",
                detail: `Op "${op}" is not implemented in the Mechanics Registry`,
            });
        }
    }

    for (const keyword of plannedMechanics) {
        reasons.push({
            kind: "planned-mechanic",
            detail: `keyword "${keyword}" is not implemented in the Mechanics Registry`,
        });
    }

    const errors = validateEffectScript({ ...definition, id: oracleId });
    for (const error of errors) {
        reasons.push({ kind: "validate-effect-script", detail: error });
    }

    // The smoke planner is written for scripts that have already passed static
    // validation and THROWS on ones that have not (a `draw` with no `player`
    // reaches `resolveScenarioPlayer(undefined)`). Two consequences, both
    // fail-closed:
    //   - skip it entirely when validation already found errors; there is
    //     nothing to prove about a script that is not well-formed, and the card
    //     is quarantined either way;
    //   - catch a throw and record it as a quarantine reason. A gate that can
    //     throw does not fail one card, it aborts a 35,000-card run, and the
    //     visible symptom would be a lockfile that simply stops.
    if (errors.length === 0) {
        // The generator only REFERENCES the filler card's id; every caller
        // registers the definition itself (see `FILLER_CARD_DEFINITION`), and
        // the catalogue sweeps do it at module load. Skipping it here made the
        // planner throw `Card not found: gen-scenario-filler` for every script
        // that needs a target, which the catch below then recorded as a
        // quarantine reason — so a correctly compiled card was quarantined for
        // a missing fixture rather than for anything about the card.
        // `registerTokenDefinition` is idempotent (`cards/registry.ts`).
        registerTokenDefinition(FILLER_CARD_DEFINITION);
        for (const script of collectScripts(definition)) {
            try {
                const plan = planSmokeTest(script);
                if (plan.kind === "skip") {
                    reasons.push({
                        kind: "smoke-scenario",
                        detail: plan.reason,
                    });
                }
            } catch (error) {
                reasons.push({
                    kind: "smoke-scenario",
                    detail: `smoke planner threw: ${error instanceof Error ? error.message : String(error)}`,
                });
            }
        }
    }

    const roundTripped = JSON.parse(
        JSON.stringify(definition)
    ) as CompiledDefinition;
    if (
        JSON.stringify(sortKeys(roundTripped)) !==
        JSON.stringify(sortKeys(definition))
    ) {
        reasons.push({
            kind: "not-json",
            detail: "definition does not survive a JSON round trip unchanged",
        });
    }

    return { opsUsed, reasons };
}

/**
 * Deep key-sorted clone — makes the JSON round-trip comparison order-blind.
 *
 * A FUNCTION is rendered as the sentinel `"[closure]"` rather than left to
 * disappear. `JSON.stringify` drops function-valued fields silently, so a
 * comparison built on it reports "equal" for a definition that has a closure
 * and one that does not — the exact blind spot that would let the gold harness
 * bless a compiled card as matching a hand-written card whose behaviour lives
 * in a `resolve()` body. Making it visible turns that into a loud difference.
 */
export function sortKeys(value: unknown): unknown {
    if (typeof value === "function") return "[closure]";
    if (Array.isArray(value)) return value.map(sortKeys);
    if (value === null || typeof value !== "object") return value;
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
        if (record[key] === undefined) continue;
        out[key] = sortKeys(record[key]);
    }
    return out;
}
