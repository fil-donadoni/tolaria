import { registerTokenDefinition } from "../../convex/cards";
import type { CardDefinition } from "../../convex/cards/types";
import {
    FILLER_CARD_DEFINITION,
    planSmokeTest,
    SMOKE_SKIP_CLASS,
} from "../../convex/gre/effects/scenarioGenerator";
import { collectDslSites } from "../../convex/gre/effects/smokeSites";
import type { CardFact, CardFacts } from "./identity-test-classifier";

/**
 * Which catalogue cards own code a per-card test may legitimately cover — the
 * card half of the identity-test classifier's Op-only class (issue #4489).
 *
 * A card is **pure-DSL** when everything it does runs through the Effect Script
 * interpreter and the generated smoke test actually exercises it:
 *
 *   - no `resolve()` — no function under a `resolve` / `resolveSteps` /
 *     `effect` key anywhere in the definition (card, mode, ability or face):
 *     the imperative escape hatch. Other function-valued fields (a trigger
 *     matcher, a filter, a condition) are card-owned code too, but a block
 *     only exercises them through a surface the classifier's call rule
 *     already refuses (a trigger scan, a legality query), so they do not
 *     disqualify the CARD;
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

/** Keys under which a function is the imperative effect escape hatch. */
const IMPERATIVE_KEYS = new Set(["resolve", "resolveSteps", "effect"]);

/** Path of the first imperative effect function in a definition, or null. */
function firstImperativePath(
    value: unknown,
    at: string,
    seen: Set<unknown>,
    underImperativeKey = false
): string | null {
    if (typeof value === "function") return underImperativeKey ? at : null;
    if (value === null || typeof value !== "object" || seen.has(value))
        return null;
    seen.add(value);
    for (const [key, child] of Object.entries(value)) {
        const found = firstImperativePath(
            child,
            Array.isArray(value) ? `${at}[${key}]` : `${at}.${key}`,
            seen,
            Array.isArray(value) ? underImperativeKey : IMPERATIVE_KEYS.has(key)
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
    const fn = firstImperativePath(card, "card", new Set());
    if (fn) return `resolve() (${fn})`;
    if (smokeSkip) return `smoke skip (${smokeSkip})`;
    return null;
}

/** Card id → the first `card-dependent` smoke-planner skip among its DSL sites. */
export function smokeSkippedCards(
    cards: readonly CardDefinition[]
): Map<string, string> {
    // The planner seeds its scenarios with this filler, exactly as the sweep
    // registers it before planning (`effectScriptSmoke.test.ts`).
    registerTokenDefinition(FILLER_CARD_DEFINITION);
    const skipped = new Map<string, string>();
    for (const site of collectDslSites(cards)) {
        if (skipped.has(site.cardId)) continue;
        const plan = planSmokeTest(site.effects, site.host);
        if (plan.kind !== "skip") continue;
        const own = plan.skips.find(
            (s) => SMOKE_SKIP_CLASS[s.code] === "card-dependent"
        );
        if (own) skipped.set(site.cardId, `${own.code}: ${own.reason}`);
    }
    return skipped;
}

/** The classifier's view of the catalogue. */
export function buildCardFacts(
    cards: readonly CardDefinition[],
    smokeSkipped: ReadonlyMap<string, string>
): CardFacts {
    const byId = new Map<string, CardFact>();
    const byName = new Map<string, CardFact>();
    for (const card of cards) {
        const fact: CardFact = {
            id: card.id,
            name: card.name,
            ownsCode: ownedCode(card, smokeSkipped.get(card.id)),
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
