// Catalogue-wide guard for the Card Preview's Engine View badge (ADR 0103 §9,
// issue #2728).
//
// The bug class this guards: the badge is a CLAIM TO THE USER about how the
// engine read a card — "DSL" means the engine interprets an Effect Script,
// "Protocol" means it calls hand-written TypeScript. `computeEngineViewBadge`
// makes that claim by walking a hand-maintained list of resolution sites on
// `CardDefinition`, and a list like that goes stale silently: the round-1
// version omitted `grantTemplates[]` / `triggeredGrantTemplates[]`, so Urza's
// Saga — whose granted chapter-II ability is a documented protocol-like
// `resolve()` (`convex/cards/sets/mh2/colorless.ts`) — rendered `DSL · 5`,
// and it omitted the `ActivatedAbility.effect` mana closure, so 164 cards
// (Black Lotus, Sol Ring, the five Moxen, every dual land) claimed a script
// they do not have. Nothing goes red when that happens: the badge still
// renders, it is just a lie.
//
// The net is an INDEPENDENTLY DERIVED expectation, not a re-run of the
// implementation. `deepVerdict` below ignores the type-level field census
// entirely and walks the definition's object graph generically, keying on
// what a body LOOKS like (a function under `resolve`/`effect`, a non-empty
// `resolveSteps`, a non-empty `effects`) wherever it sits. A future field
// that carries abilities — `grantTemplates`' successor, a new mode array —
// is reachable by the generic walk on the day it is added, and invisible to
// the typed walk until someone extends it: that divergence is exactly what
// reds this file.
import { describe, it, expect } from "vitest";
import { getAllCards, getCardByName } from "@convex/cards";
import { computeEngineViewBadge } from "~/lib/preview-body";
import type { CardDefinition } from "@convex/cards/types";

type Verdict = "protocol" | "dsl" | "none";

/** The independent oracle: a generic deep walk of the definition's object
 *  graph. Deliberately shares NO code with `computeEngineViewBadge` — not the
 *  site census, not the field list, not the traversal order.
 *
 *  Keys, and why each one means what it means:
 *  - a FUNCTION under `resolve` or `effect` → hand-written TypeScript. (On a
 *    `CardDefinition`, `effect` is the declarative `EffectShorthand` registry
 *    key and is NOT a function — the typeof test is what separates the two
 *    meanings of the overloaded name.)
 *  - a non-empty `resolveSteps[]` → hand-written TypeScript.
 *  - a non-empty `effects[]` → an Effect Script.
 *  - a non-function, defined `effect` → the `EffectShorthand` (one registered
 *    primitive, `convex/cards/effectRegistry.ts`) — declarative, so DSL-side.
 *  Two keys are skipped, and both exclusions are asserted below rather than
 *  left implicit:
 *  - `aiEffects` — an AI-only shadow script that is NEVER executed (PRD
 *    #1423) and therefore says nothing about how the engine resolves the card.
 *  - `token` — a nested `TokenSpec` is a DIFFERENT card's definition (CR
 *    111.1), registered and badged in its own right when previewed. Hullbreacher
 *    is the witness: its `drawReplacement` outcome embeds `TREASURE_TOKEN`,
 *    whose "{T}, Sacrifice: Add one mana of any color" is a mana-ability
 *    closure — the Treasure's imperative body, not Hullbreacher's. */
function deepVerdict(def: CardDefinition): Verdict {
    let imperative = false;
    let declarative = false;
    const seen = new Set<object>();
    const walk = (node: unknown): void => {
        if (!node || typeof node !== "object") return;
        if (seen.has(node)) return;
        seen.add(node);
        if (Array.isArray(node)) {
            for (const item of node) walk(item);
            return;
        }
        for (const [key, value] of Object.entries(node)) {
            if (key === "aiEffects" || key === "token") continue;
            if (
                (key === "resolve" || key === "effect") &&
                typeof value === "function"
            ) {
                imperative = true;
            } else if (
                key === "resolveSteps" &&
                Array.isArray(value) &&
                value.length > 0
            ) {
                imperative = true;
            } else if (
                key === "effects" &&
                Array.isArray(value) &&
                value.length > 0
            ) {
                declarative = true;
            } else if (key === "effect" && value !== undefined) {
                declarative = true;
            }
            walk(value);
        }
    };
    walk(def);
    if (imperative) return "protocol";
    return declarative ? "dsl" : "none";
}

const verdictOf = (def: CardDefinition): Verdict =>
    computeEngineViewBadge(def).kind;

describe("Engine View badge — catalogue-wide (issue #2728)", () => {
    const cards = getAllCards();

    it("agrees with an independently-derived verdict for EVERY registered definition", () => {
        const disagreements: string[] = [];
        for (const def of cards) {
            const expected = deepVerdict(def);
            const actual = verdictOf(def);
            if (actual !== expected) {
                disagreements.push(
                    `${def.name} (${def.id}): badge says "${actual}", deep walk says "${expected}"`
                );
            }
        }
        expect(disagreements).toEqual([]);
    });

    it("is not vacuous — the catalogue exercises all three verdicts", () => {
        const counts: Record<Verdict, number> = {
            protocol: 0,
            dsl: 0,
            none: 0,
        };
        for (const def of cards) counts[verdictOf(def)] += 1;
        expect(cards.length).toBeGreaterThan(1000);
        expect(counts.protocol).toBeGreaterThan(0);
        expect(counts.dsl).toBeGreaterThan(0);
        expect(counts.none).toBeGreaterThan(0);
    });

    it("an Op count is never claimed without a script behind it", () => {
        for (const def of cards) {
            const badge = computeEngineViewBadge(def);
            if (badge.kind === "dsl") {
                expect(badge.opCount).toBeGreaterThan(0);
            }
        }
    });

    // Named canaries — one per producer the round-1 census missed, so a
    // regression names itself instead of arriving as a bare count diff.
    it("reads Urza's Saga as protocol — its granted chapter-II ability is a hand-written resolve() in `grantTemplates[]`", () => {
        const saga = getCardByName("Urza's Saga");
        expect(verdictOf(saga)).toBe("protocol");
    });

    it("reads a mana-ability closure card as protocol (Black Lotus, Sol Ring, Birds of Paradise — `ActivatedAbility.effect`)", () => {
        for (const name of ["Black Lotus", "Sol Ring", "Birds of Paradise"]) {
            expect(verdictOf(getCardByName(name))).toBe("protocol");
        }
    });

    it("reads a card whose ONLY script sits in a granted ability as dsl (Zombie Master, `grantTemplates[0].effects`)", () => {
        expect(verdictOf(getCardByName("Zombie Master"))).toBe("dsl");
    });

    it("reads a card whose ONLY script sits in a granted TRIGGERED ability as dsl (Energy Flux, `triggeredGrantTemplates[0].effects`)", () => {
        expect(verdictOf(getCardByName("Energy Flux"))).toBe("dsl");
    });

    it("reads a vanilla creature and a pure-staticEffects anthem as none — no chip, because there is no script to claim", () => {
        expect(verdictOf(getCardByName("Grizzly Bears"))).toBe("none");
        expect(verdictOf(getCardByName("Crusade"))).toBe("none");
    });

    it('counts the EffectShorthand as one declarative primitive (Disenchant — `effect: "destroy-target"`)', () => {
        expect(computeEngineViewBadge(getCardByName("Disenchant"))).toEqual({
            kind: "dsl",
            opCount: 1,
        });
    });

    // The one deliberate exclusion, pinned so it stays deliberate: the AI-only
    // shadow script (PRD #1423) is never executed, so it must not make a
    // scriptless card claim `DSL`. Every card carrying `aiEffects` is a
    // `resolve()`/`resolveSteps` card in practice, so assert the exclusion
    // directly on a synthetic definition rather than hunting for a witness.
    it("ignores `aiEffects` — the AI-only shadow script the engine never executes", () => {
        const vanilla = getCardByName("Grizzly Bears");
        const withSketch = {
            ...vanilla,
            aiEffects: [{ op: "draw", count: 1, player: "controller" }],
        } as unknown as CardDefinition;
        expect(computeEngineViewBadge(withSketch)).toEqual({ kind: "none" });
    });

    // The other deliberate exclusion. A `TokenSpec` embedded in a replacement
    // outcome carries the TOKEN's mana-ability closure (Treasure: "{T},
    // Sacrifice this token: Add one mana of any color") — the Treasure's
    // imperative body, not Hullbreacher's, and the Treasure is badged on its
    // own when previewed.
    it("does not inherit a nested token's imperative body (Hullbreacher's Treasure — CR 111.1)", () => {
        expect(verdictOf(getCardByName("Hullbreacher"))).toBe("none");
    });
});
