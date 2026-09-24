import { registerTokenDefinition } from "../../convex/cards";
import type { CardDefinition } from "../../convex/cards/types";
import {
    FILLER_CARD_DEFINITION,
    planSmokeTest,
    SMOKE_SKIP_CLASS,
} from "../../convex/gre/effects/scenarioGenerator";
import { collectDslSites } from "../../convex/cards/__tests__/smokeSites";
import type { CardFact, CardFacts } from "./identity-test-classifier";

/**
 * Which catalogue cards own code a per-card test may legitimately cover — the
 * card half of the identity-test classifier's Op-only class (issue #4489).
 *
 * A card is **pure-DSL** when everything it does runs through the Effect Script
 * interpreter and the generated smoke test actually exercises it:
 *
 *   - no function anywhere in the definition — `resolve()` and its kin, but
 *     also a trigger matcher, a `getTargetRequirement`, a `canActivate`:
 *     `resolveTopOfStack` runs the trigger scan and re-checks targets
 *     (CR 608.2b) itself, so a block that only casts and resolves CAN reach
 *     them;
 *   - no modes — the sweep does not visit `modes[]` scripts, so a modal card
 *     is never smoke-run;
 *   - no static effect (`staticEffects` / `compiledStaticEffects` — the layer
 *     system's input, card-owned by construction);
 *   - no replacement effect (`replacementEffects`, `drawReplacement`,
 *     `drawStepReplacement`);
 *   - no state-based-action exception (`sbaMods`) — the classifier lets a
 *     block run the global SBAs, which is only Op-neutral when the card does
 *     not modify them;
 *   - no DSL site the smoke planner skips as `card-dependent` (ADR 0105
 *     § 7.1) — the sweep does NOT cover it and no Op test can speak for it,
 *     so a per-card test may be its only proof. An `op-covered` skip does not
 *     count: the skip comes from the Op's own mechanism and the Op's permanent
 *     test is the evidence, which is exactly the regime a per-card block
 *     duplicates.
 *
 * Anything else returns the first reason found, so a dry-run line says WHY a
 * block was kept.
 */

const STATIC_FIELDS = ["staticEffects", "compiledStaticEffects"] as const;
const REPLACEMENT_FIELDS = [
    "replacementEffects",
    "drawReplacement",
    "drawStepReplacement",
] as const;

/** Path of the first function-valued property in a definition, or null. */
function firstFunctionPath(
    value: unknown,
    at: string,
    seen: Set<unknown>
): string | null {
    if (typeof value === "function") return at;
    if (value === null || typeof value !== "object" || seen.has(value))
        return null;
    seen.add(value);
    for (const [key, child] of Object.entries(value)) {
        const found = firstFunctionPath(
            child,
            Array.isArray(value) ? `${at}[${key}]` : `${at}.${key}`,
            seen
        );
        if (found) return found;
    }
    return null;
}

const present = (v: unknown) =>
    v !== undefined && v !== false && !(Array.isArray(v) && v.length === 0);

/** Why a card owns code beyond its Effect Script — null when it is pure-DSL. */
export function ownedCode(
    card: CardDefinition,
    smokeSkip: string | undefined
): string | null {
    const fields = card as unknown as Record<string, unknown>;
    for (const f of STATIC_FIELDS)
        if (present(fields[f])) return `static effect (${f})`;
    for (const f of REPLACEMENT_FIELDS)
        if (present(fields[f])) return `replacement effect (${f})`;
    if (present(fields.sbaMods))
        return "state-based-action exception (sbaMods)";
    if (present(fields.modes)) return "modes (not smoke-swept)";
    const fn = firstFunctionPath(card, "card", new Set());
    if (fn) return `imperative code (${fn})`;
    if (smokeSkip) return `smoke skip (${smokeSkip})`;
    return null;
}

/** What the smoke sweep does with each card's Effect Script sites. */
export interface SmokeCoverage {
    /** Card id → the first `card-dependent` skip among its DSL sites. */
    skipped: Map<string, string>;
    /** Cards with at least one DSL site the sweep actually runs. */
    run: Set<string>;
}

export function smokeCoverage(cards: readonly CardDefinition[]): SmokeCoverage {
    // The planner seeds its scenarios with this filler, exactly as the sweep
    // registers it before planning (`effectScriptSmoke.test.ts`).
    registerTokenDefinition(FILLER_CARD_DEFINITION);
    const coverage: SmokeCoverage = { skipped: new Map(), run: new Set() };
    for (const site of collectDslSites(cards)) {
        const plan = planSmokeTest(site.effects, site.host);
        if (plan.kind === "run") {
            coverage.run.add(site.cardId);
            continue;
        }
        const own = plan.skips.find(
            (s) => SMOKE_SKIP_CLASS[s.code] === "card-dependent"
        );
        if (own && !coverage.skipped.has(site.cardId))
            coverage.skipped.set(site.cardId, `${own.code}: ${own.reason}`);
    }
    return coverage;
}

/**
 * The classifier's view of the catalogue. Built from the cards the smoke sweep
 * walks (`getAllCards()`, the hand-written catalogue); a compiled card is
 * absent, and the classifier clears any block naming one.
 */
export function buildCardFacts(
    cards: readonly CardDefinition[],
    coverage: SmokeCoverage
): CardFacts {
    const byId = new Map<string, CardFact>();
    const byName = new Map<string, CardFact>();
    for (const card of cards) {
        const fact: CardFact = {
            id: card.id,
            name: card.name,
            ownsCode: ownedCode(card, coverage.skipped.get(card.id)),
            smokeRun: coverage.run.has(card.id),
        };
        byId.set(card.id, fact);
        // Same name, several prints: the name owns code if ANY print does.
        if (!byName.get(card.name)?.ownsCode) byName.set(card.name, fact);
    }
    return {
        byId: (id) => byId.get(id),
        byName: (name) => byName.get(name),
    };
}
