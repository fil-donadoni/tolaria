import { describe, it, expect } from "vitest";
import type { CardDefinition } from "../../convex/cards/types";
import {
    buildCardFacts,
    ownedCode,
    smokeCoverage,
} from "../lib/card-code-ownership";

/**
 * The card half of the identity-test classifier's Op-only class (issue #4489):
 * which catalogue cards are pure-DSL. A card wrongly called pure-DSL lets the
 * purge delete the only test of its own code, so every disqualifier below is
 * shown flipping the verdict on an otherwise pure card.
 */

const PURE: CardDefinition = {
    id: "t-bolt",
    name: "Test Bolt",
    rarity: "common",
    manaCost: { R: 1 },
    types: ["Instant"],
    targetRequirement: { type: "any", count: 1 },
    effects: [{ op: "dealDamage", amount: 3, to: { target: 0 } }],
} as CardDefinition;

const card = (extra: Record<string, unknown>): CardDefinition =>
    ({ ...PURE, ...extra }) as CardDefinition;

describe("card code ownership (issue #4489)", () => {
    it("a card whose whole behaviour is its Effect Script is pure-DSL", () => {
        expect(ownedCode(PURE, undefined)).toBeNull();
    });

    it.each([
        [
            "resolve()",
            { resolve: () => {} },
            /^imperative code \(card\.resolve\)/,
        ],
        [
            "an ability's imperative effect",
            { activatedAbilities: [{ id: "a", effect: () => {} }] },
            /^imperative code \(card\.activatedAbilities\[0\]\.effect\)/,
        ],
        [
            "resolveSteps",
            { resolveSteps: [() => {}] },
            /^imperative code \(card\.resolveSteps\[0\]\)/,
        ],
        ["a static effect", { staticEffects: [{}] }, /^static effect/],
        [
            "a replacement effect",
            { replacementEffects: [{}] },
            /^replacement effect/,
        ],
        ["a draw replacement", { drawStepReplacement: true }, /^replacement/],
        ["an SBA exception", { sbaMods: { x: 1 } }, /^state-based-action/],
    ])("owns code: %s", (_label, extra, reason) => {
        expect(ownedCode(card(extra), undefined)).toMatch(reason);
    });

    it("ANY function owns code — a trigger matcher runs inside resolveTopOfStack's trigger scan", () => {
        expect(
            ownedCode(
                card({
                    triggeredAbilities: [{ id: "t", matches: () => true }],
                }),
                undefined
            )
        ).toMatch(
            /^imperative code \(card\.triggeredAbilities\[0\]\.matches\)/
        );
    });

    it("modes own code — the sweep never visits modes[] scripts", () => {
        expect(ownedCode(card({ modes: [{ id: "m" }] }), undefined)).toMatch(
            /^modes/
        );
    });

    it("a card-dependent smoke skip disqualifies the card", () => {
        expect(ownedCode(PURE, "runtime-amount: …")).toBe(
            "smoke skip (runtime-amount: …)"
        );
    });

    it("records card-dependent smoke skips only, never op-covered ones", () => {
        const refSpell = card({
            id: "t-ref",
            effects: [
                {
                    op: "dealDamage",
                    amount: { ref: "$amount" },
                    to: { target: 0 },
                },
            ],
        });
        const randomDiscard = card({
            id: "t-random",
            effects: [
                {
                    op: "discardAtRandom",
                    player: { target: 0 },
                    count: 2,
                },
            ],
            targetRequirement: { type: "player", count: 1 },
        });
        const { skipped, run } = smokeCoverage([PURE, refSpell, randomDiscard]);
        expect([...skipped.keys()]).toEqual(["t-ref"]);
        expect(skipped.get("t-ref")).toMatch(/^runtime-amount: /);
        expect([...run]).toEqual(["t-bolt"]);
    });

    it("a name shared by several prints owns code if ANY print does", () => {
        const facts = buildCardFacts(
            [PURE, card({ id: "t-bolt-2", staticEffects: [{}] })],
            { skipped: new Map(), run: new Set(["t-bolt"]) }
        );
        expect(facts.byId("t-bolt")).toMatchObject({
            ownsCode: null,
            smokeRun: true,
        });
        expect(facts.byName("Test Bolt")?.ownsCode).toMatch(/^static/);
    });
});
