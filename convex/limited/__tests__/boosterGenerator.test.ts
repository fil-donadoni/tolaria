// Pure Booster generator tests (ADR 0055/0056): slot-count correctness,
// weighted-sheet sampling (a light statistical sanity check on the
// distribution), and determinism under a fixed seed. `makeRng` is the same
// seeded float-stream helper `convex/gre/rng.ts` gives the GRE and AI search
// (issue #112) — reused rather than re-invented, per the PRD's "the draft
// engine, Bot Drafter, and generator share one seeded-PRNG convention".
import { describe, it, expect } from "vitest";
import leaConfigJson from "../../../data/boosters/lea.json";
import iceConfigJson from "../../../data/boosters/ice.json";
import { makeRng } from "../../gre/rng";
import { generateBooster } from "../boosterGenerator";
import { dropUnimplementedCards } from "../draftable";
import { tryGetDefinition } from "../../cards";
import type { BoosterConfig } from "../boosterTypes";

const leaConfig = leaConfigJson as BoosterConfig;
const iceConfig = iceConfigJson as BoosterConfig;

describe("generateBooster (ADR 0055/0056)", () => {
    it("draws the exact slot counts declared by the chosen variant (LEA: 11 common + 3 uncommon + 1 rare)", () => {
        const rng = makeRng(1234);
        const pack = generateBooster(leaConfig, rng);

        expect(pack).toHaveLength(15);

        const bySheet = { common: 0, uncommon: 0, rare: 0 } as Record<
            string,
            number
        >;
        for (const card of pack) {
            bySheet[card.sheet] = (bySheet[card.sheet] ?? 0) + 1;
        }

        expect(bySheet.common).toBe(11);
        expect(bySheet.uncommon).toBe(3);
        expect(bySheet.rare).toBe(1);
    });

    it("every drawn card's scryfallId is present on the sheet it was tagged with (no placeholder cards)", () => {
        const rng = makeRng(7);
        for (let i = 0; i < 50; i++) {
            const pack = generateBooster(leaConfig, rng);
            for (const card of pack) {
                expect(leaConfig.sheets[card.sheet]).toBeDefined();
                expect(leaConfig.sheets[card.sheet].cards).toHaveProperty(
                    card.scryfallId
                );
            }
        }
    });

    it("is deterministic: the same seed produces the same pack", () => {
        const packA = generateBooster(leaConfig, makeRng(42));
        const packB = generateBooster(leaConfig, makeRng(42));
        expect(packA).toEqual(packB);
    });

    it("different seeds produce different packs (sanity — not a hash collision)", () => {
        const packA = generateBooster(leaConfig, makeRng(1));
        const packB = generateBooster(leaConfig, makeRng(2));
        expect(packA).not.toEqual(packB);
    });

    it("throws on a config with no booster variants", () => {
        const empty: BoosterConfig = {
            setCode: "tst",
            boostersTotalWeight: 0,
            boosters: [],
            sheets: {},
        };
        expect(() => generateBooster(empty, makeRng(1))).toThrow(
            /no booster variants/
        );
    });

    it("throws when a variant references an unknown sheet", () => {
        const bad: BoosterConfig = {
            setCode: "tst",
            boostersTotalWeight: 1,
            boosters: [{ contents: { ghost: 1 }, weight: 1 }],
            sheets: {},
        };
        expect(() => generateBooster(bad, makeRng(1))).toThrow(
            /unknown sheet "ghost"/
        );
    });

    describe("reduced config (ADR 0059, PRD #1242 — drop-missing at runtime)", () => {
        it("produces a full, valid pack from ICE's config with unimplemented cards dropped and weights renormalized", () => {
            const { config: reduced, missingCardIds } =
                dropUnimplementedCards(iceConfig);
            // ICE isn't fully implemented — this reduced config actually
            // exercises a drop, not a no-op.
            expect(missingCardIds.length).toBeGreaterThan(0);

            const rng = makeRng(2024);
            for (let i = 0; i < 25; i++) {
                const pack = generateBooster(reduced, rng);
                expect(pack.length).toBeGreaterThan(0);
                for (const card of pack) {
                    // Every drawn card resolves to an implemented
                    // CardDefinition — no placeholder ever reaches the pack.
                    expect(tryGetDefinition(card.scryfallId)).not.toBeNull();
                    expect(missingCardIds).not.toContain(card.scryfallId);
                }
            }
        });
    });

    describe("weighted sampling (statistical sanity check)", () => {
        // A synthetic 2-card sheet where B is 3x as likely as A (weight 3 vs
        // 1, totalWeight 4) — expected frequency 25% / 75%. Draw a large
        // sample and assert the observed frequency lands in a generous
        // tolerance band, wide enough to make this test non-flaky while still
        // catching a broken weighting (e.g. uniform-random instead of
        // weighted, or an inverted weight).
        const skewedConfig: BoosterConfig = {
            setCode: "tst",
            boostersTotalWeight: 1,
            boosters: [{ contents: { sheet: 1 }, weight: 1 }],
            sheets: {
                sheet: { totalWeight: 4, cards: { A: 1, B: 3 } },
            },
        };

        it("draws B roughly 3x as often as A over many samples", () => {
            const rng = makeRng(99);
            const trials = 8000;
            let countA = 0;
            let countB = 0;
            for (let i = 0; i < trials; i++) {
                const [drawn] = generateBooster(skewedConfig, rng);
                if (drawn.scryfallId === "A") countA++;
                else if (drawn.scryfallId === "B") countB++;
                else throw new Error(`unexpected draw: ${drawn.scryfallId}`);
            }
            expect(countA + countB).toBe(trials);
            const observedRatio = countB / countA;
            // Expected ratio 3.0 — tolerance ±25% (2.25–3.75) at n=8000 keeps
            // this well within a few standard deviations of noise.
            expect(observedRatio).toBeGreaterThan(2.25);
            expect(observedRatio).toBeLessThan(3.75);
        });

        it("respects booster-variant weights across multiple variants", () => {
            const twoVariantConfig: BoosterConfig = {
                setCode: "tst",
                boostersTotalWeight: 4,
                boosters: [
                    { contents: { x: 1 }, weight: 1 },
                    { contents: { y: 1 }, weight: 3 },
                ],
                sheets: {
                    x: { totalWeight: 1, cards: { onlyX: 1 } },
                    y: { totalWeight: 1, cards: { onlyY: 1 } },
                },
            };
            const rng = makeRng(555);
            const trials = 8000;
            let countX = 0;
            let countY = 0;
            for (let i = 0; i < trials; i++) {
                const [drawn] = generateBooster(twoVariantConfig, rng);
                if (drawn.scryfallId === "onlyX") countX++;
                else countY++;
            }
            const observedRatio = countY / countX;
            expect(observedRatio).toBeGreaterThan(2.25);
            expect(observedRatio).toBeLessThan(3.75);
        });
    });
});
