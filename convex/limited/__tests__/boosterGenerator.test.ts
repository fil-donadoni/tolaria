// Pure Booster generator tests (ADR 0055/0056): slot-count correctness,
// weighted-sheet sampling (a light statistical sanity check on the
// distribution), and determinism under a fixed seed. `makeRng` is the same
// seeded float-stream helper `convex/gre/rng.ts` gives the GRE and AI search
// (issue #112) — reused rather than re-invented, per the PRD's "the draft
// engine, Bot Drafter, and generator share one seeded-PRNG convention".
import { describe, it, expect } from "vitest";
import leaConfigJson from "../../../data/boosters/lea.json";
import iceConfigJson from "../../../data/boosters/ice.json";
import plsConfigJson from "../../../data/boosters/pls.json";
import { makeRng } from "../../gre/rng";
import { generateBooster } from "../boosterGenerator";
import { dropUnimplementedCards } from "../draftable";
import { tryGetDefinition } from "../../cards";
import { getSheetPrintCardId } from "../registry";
import type { BoosterConfig } from "../boosterTypes";

const leaConfig = leaConfigJson as BoosterConfig;
const iceConfig = iceConfigJson as BoosterConfig;
const plsConfig = plsConfigJson as BoosterConfig;

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

    describe("sheet duplicate rule (MTGJSON allowDuplicates, issue #5474)", () => {
        /** One sheet drawn `count` times; `allowDuplicates` as given. */
        function singleSheetConfig(
            cards: Record<string, number>,
            count: number,
            allowDuplicates?: true
        ): BoosterConfig {
            const totalWeight = Object.values(cards).reduce((a, b) => a + b, 0);
            return {
                setCode: "tst",
                boostersTotalWeight: 1,
                boosters: [{ contents: { sheet: count }, weight: 1 }],
                sheets: {
                    sheet: {
                        cards,
                        totalWeight,
                        ...(allowDuplicates ? { allowDuplicates } : {}),
                    },
                },
            };
        }

        it("a duplicate-free sheet never yields the same Scryfall id twice in one pack (Planeshift, 500 seeded packs)", () => {
            // 11 commons from a 55-card sheet: with replacement, ~1 duplicate
            // pair per pack — 500 packs cannot all come out clean by chance.
            const rng = makeRng(5474);
            let sameSheetDuplicates = 0;
            for (let i = 0; i < 500; i++) {
                const seen = new Set<string>();
                for (const card of generateBooster(plsConfig, rng)) {
                    const key = `${card.sheet}\u0000${card.scryfallId}`;
                    if (seen.has(key)) sameSheetDuplicates++;
                    seen.add(key);
                }
            }
            expect(sameSheetDuplicates).toBe(0);
        });

        it("a sheet with allowDuplicates: true still yields the same id twice in one pack", () => {
            // Two distinct ids, three draws: pigeonhole forces a repeat.
            const config = singleSheetConfig({ A: 1, B: 1 }, 3, true);
            const pack = generateBooster(config, makeRng(3));
            expect(pack).toHaveLength(3);
            expect(new Set(pack.map((c) => c.scryfallId)).size).toBeLessThan(3);
        });

        it("two different sheets sharing an id can both yield it in one pack", () => {
            const config: BoosterConfig = {
                setCode: "tst",
                boostersTotalWeight: 1,
                boosters: [{ contents: { a: 1, b: 1 }, weight: 1 }],
                sheets: {
                    a: { cards: { shared: 1 }, totalWeight: 1 },
                    b: { cards: { shared: 1 }, totalWeight: 1 },
                },
            };
            expect(generateBooster(config, makeRng(1))).toEqual([
                { scryfallId: "shared", sheet: "a" },
                { scryfallId: "shared", sheet: "b" },
            ]);
        });

        it("a duplicate-free sheet drawn past its distinct ids falls back to with-replacement for the overflow", () => {
            const config = singleSheetConfig({ A: 1, B: 1 }, 3);
            const pack = generateBooster(config, makeRng(11));
            expect(pack).toHaveLength(3);
            // The first two draws exhaust the sheet without repeating.
            expect(new Set([pack[0].scryfallId, pack[1].scryfallId])).toEqual(
                new Set(["A", "B"])
            );
        });

        it("renormalises over the remaining entries: the second draw from a two-card sheet is always the other card", () => {
            const config = singleSheetConfig({ A: 1, B: 99 }, 2);
            const rng = makeRng(77);
            for (let i = 0; i < 200; i++) {
                const ids = generateBooster(config, rng).map(
                    (c) => c.scryfallId
                );
                expect(ids.sort()).toEqual(["A", "B"]);
            }
        });

        it("is deterministic: the same (config, seed) produces the same Planeshift pack", () => {
            expect(generateBooster(plsConfig, makeRng(9))).toEqual(
                generateBooster(plsConfig, makeRng(9))
            );
        });
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
                    expect(
                        tryGetDefinition(
                            getSheetPrintCardId(card.scryfallId) ??
                                card.scryfallId
                        )
                    ).not.toBeNull();
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
