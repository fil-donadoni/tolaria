// Bot Drafter Pick Heuristic tests (PRD #1107 story 29, ADR 0054, issue
// #1113). Mirrors `draftEngine.test.ts`'s discipline: pure functions,
// deterministic, no convex-test harness needed. `scoreCandidate` reads real
// card quality through the shared `cardValueById` (`convex/gre/cardValue.ts`)
// against the actual LEA registry, so quality-ordering assertions use real
// LEA cards; color/curve assertions hold `cardId` FIXED across a synthetic
// `CardEvalMeta` so only the field under test varies — isolating each term
// from the others' contribution.
import { describe, it, expect } from "vitest";
import {
    getCardByName,
    resolveDeckCardMeta,
    tryGetDefinition,
} from "../../cards";
import { getCardColors } from "../../cards/colors";
import type { Color } from "../../cards/types";
import { manaValue } from "../../gre/constants";
import {
    chooseBotPick,
    scoreCandidate,
    type CardEvalMeta,
    type GetCardEvalMeta,
} from "../botDrafter";
import {
    runBotAutoPicks,
    startDraft,
    type ChooseBotPick,
} from "../draftEngine";
import {
    buildEmptySeats,
    fillBotSeats,
    type ResolveCardMeta,
} from "../eventLogic";
import type { DraftPackCard, LimitedPoolCard } from "../eventTypes";
import { getBoosterConfig } from "../registry";

/** Builds a real `CardEvalMeta` from a LEA card name — the card-quality
 *  fixtures below (`scoreCandidate` reads `cardValueById` off `cardId`,
 *  which only resolves against the real registry). */
function metaOf(name: string): CardEvalMeta {
    const def = getCardByName(name);
    return {
        cardId: def.id,
        colors: getCardColors(def),
        manaValue: manaValue(def.manaCost),
        rarity: def.rarity,
    };
}

// Grizzly Bears (G, 2/2 vanilla) — the fixed "quality anchor" used to
// isolate the color/curve terms: overriding `colors`/`manaValue` on a COPY of
// this fixture changes only what those terms read, never the quality term
// (`scoreCandidate` derives quality from `cardId` alone).
const bears = metaOf("Grizzly Bears");
// Craw Wurm (4G, 6/4 vanilla) — strictly bigger body, same color/rarity as
// Grizzly Bears: a real, higher latent-`cardValueById` green common.
const wurm = metaOf("Craw Wurm");
// Hill Giant (3R, 3/3 vanilla) — an off-color (red) reference card.
const hillGiant = metaOf("Hill Giant");

describe("scoreCandidate — card quality (PRD #1107 story 29: 'prefers higher-quality card at equal color fit')", () => {
    it("prefers the bigger body at equal color, rarity and empty pool", () => {
        expect(scoreCandidate(wurm, [])).toBeGreaterThan(
            scoreCandidate(bears, [])
        );
    });

    it("a higher rarity outscores the same body at a lower rarity", () => {
        const common: CardEvalMeta = { ...bears, rarity: "common" };
        const mythic: CardEvalMeta = { ...bears, rarity: "mythic" };
        expect(scoreCandidate(mythic, [])).toBeGreaterThan(
            scoreCandidate(common, [])
        );
    });
});

describe("scoreCandidate — color commitment (PRD #1107 story 29: 'prefers on-color over off-color as commitment grows')", () => {
    it("does not penalize an off-color pick within the grace window (few picks so far)", () => {
        // cardId fixed (bears) so quality is identical; only `colors` differs.
        // Pool filler cards are curve-neutral (`manaValue: 0`) so this isolates
        // the color term from the curve term's own pool-size sensitivity.
        const green: CardEvalMeta = { ...bears, colors: ["G"], manaValue: 0 };
        const red: CardEvalMeta = { ...bears, colors: ["R"] };
        const smallGreenPool = [green, green]; // 2 picks — within the grace window

        // No penalty yet: the off-color candidate scores the SAME as it would
        // against a totally empty pool (no color term applied either way).
        expect(scoreCandidate(red, smallGreenPool)).toBe(
            scoreCandidate(red, [])
        );
    });

    it("the on-color/off-color preference strictly grows as the pool commits deeper into a color", () => {
        const green: CardEvalMeta = { ...bears, colors: ["G"] };
        const red: CardEvalMeta = { ...bears, colors: ["R"] };

        const shallowPool = Array(4).fill(green); // just past the grace window
        const deepPool = Array(10).fill(green); // heavily committed to green

        const shallowGap =
            scoreCandidate(green, shallowPool) -
            scoreCandidate(red, shallowPool);
        const deepGap =
            scoreCandidate(green, deepPool) - scoreCandidate(red, deepPool);

        expect(deepGap).toBeGreaterThan(shallowGap);
        // And the on-color candidate is preferred outright once committed.
        expect(scoreCandidate(green, deepPool)).toBeGreaterThan(
            scoreCandidate(red, deepPool)
        );
    });

    it("a colorless candidate is neutral to color commitment either way", () => {
        // Pool filler is curve-neutral (`manaValue: 0`) so only the color term
        // is exercised — the colorless candidate itself keeps its own
        // (non-zero) `manaValue`, which is what makes it curve-comparable
        // across both calls below.
        const colorless: CardEvalMeta = { ...bears, colors: [] };
        const green: CardEvalMeta = { ...bears, colors: ["G"], manaValue: 0 };
        const deepGreenPool = Array(10).fill(green);
        expect(scoreCandidate(colorless, deepGreenPool)).toBe(
            scoreCandidate(colorless, [])
        );
    });
});

describe("scoreCandidate — curve gaps (PRD #1107 story 29: 'fills curve gaps')", () => {
    it("prefers filling an empty curve bucket over topping up an already-satisfied one", () => {
        // cardId fixed (bears) so quality is identical; only `manaValue` differs.
        const twoDrop: CardEvalMeta = { ...bears, manaValue: 2 }; // target bucket count: 5
        const fiveDrop: CardEvalMeta = { ...bears, manaValue: 5 }; // target bucket count: 3

        // Pool already has 5 two-drops (bucket fully satisfied) but no
        // five-drops at all (bucket empty).
        const pool = Array(5).fill({ ...bears, manaValue: 2 });

        expect(scoreCandidate(fiveDrop, pool)).toBeGreaterThan(
            scoreCandidate(twoDrop, pool)
        );
    });

    it("a 0-mana-value card (e.g. a land) never earns a curve bonus", () => {
        const land: CardEvalMeta = { ...bears, manaValue: 0, colors: [] };
        expect(scoreCandidate(land, [])).toBe(scoreCandidate(land, [land]));
    });
});

describe("chooseBotPick (PRD #1107 stories 8, 9, 27)", () => {
    const metaTable: Record<string, CardEvalMeta> = {
        bears: bears,
        wurm: wurm,
        giant: hillGiant,
    };
    const getCardEvalMeta: GetCardEvalMeta = (scryfallId) =>
        metaTable[scryfallId] ?? null;

    function packCard(scryfallId: string, pickId: string): DraftPackCard {
        return { scryfallId, cardId: scryfallId, cardName: scryfallId, pickId };
    }

    it("picks the highest-scoring card in the pack", () => {
        const pack = [
            packCard("bears", "pick-bears"),
            packCard("wurm", "pick-wurm"),
            packCard("giant", "pick-giant"),
        ];
        // Empty pool: wurm strictly outscores bears (bigger body, same
        // color/rarity) and giant is off-color-neutral (empty pool, no
        // penalty yet) but a smaller body than wurm.
        expect(chooseBotPick(pack, [], getCardEvalMeta)).toBe("pick-wurm");
    });

    it("is deterministic: the same pack + pool always yields the same pick", () => {
        const pack = [
            packCard("bears", "pick-bears"),
            packCard("wurm", "pick-wurm"),
        ];
        const pool: LimitedPoolCard[] = [];
        const first = chooseBotPick(pack, pool, getCardEvalMeta);
        const second = chooseBotPick(pack, pool, getCardEvalMeta);
        expect(first).toBe(second);
    });

    it("ties break by pack position (first wins)", () => {
        const pack = [packCard("bears", "pick-a"), packCard("bears", "pick-b")];
        expect(chooseBotPick(pack, [], getCardEvalMeta)).toBe("pick-a");
    });

    it("never crashes on an unresolvable candidate — ranks it lowest instead", () => {
        const pack = [
            packCard("unknown-card", "pick-unknown"),
            packCard("bears", "pick-bears"),
        ];
        expect(chooseBotPick(pack, [], getCardEvalMeta)).toBe("pick-bears");
    });

    it("throws when the pack is empty (same contract as applyPick's own guard)", () => {
        expect(() => chooseBotPick([], [], getCardEvalMeta)).toThrow(
            /pack is empty/
        );
    });
});

describe("scripted 8-seat all-bot draft — plausibly coherent 2-color pools (PRD #1107 story 29 acceptance)", () => {
    // Real registry wiring — the same shape `convex/limitedEvents.ts` uses.
    const resolveCardMeta: ResolveCardMeta = (scryfallId) => {
        const def = tryGetDefinition(scryfallId);
        if (!def) return null;
        const meta = resolveDeckCardMeta(scryfallId);
        return meta ? { cardId: meta.cardId, cardName: def.name } : null;
    };
    const realGetCardEvalMeta: GetCardEvalMeta = (scryfallId) => {
        const meta = resolveDeckCardMeta(scryfallId);
        if (!meta) return null;
        const def = tryGetDefinition(meta.cardId);
        if (!def) return null;
        return {
            cardId: meta.cardId,
            colors: getCardColors(def),
            manaValue: manaValue(def.manaCost),
            rarity: meta.rarity,
        };
    };
    const realBotChoosePick: ChooseBotPick = (seat, pack) =>
        chooseBotPick(pack, seat.pool ?? [], realGetCardEvalMeta);

    it("every bot seat's finished pool concentrates in (at most) two colors", () => {
        const packSlots = ["lea", "lea", "lea"];
        const seats = fillBotSeats(buildEmptySeats(8));
        const seed = 20260714;
        const dealt = startDraft(
            seats,
            packSlots,
            seed,
            getBoosterConfig,
            resolveCardMeta
        );
        const result = runBotAutoPicks(
            dealt.seats,
            dealt.draftRound,
            dealt.draftPacksRemaining,
            packSlots,
            seed,
            getBoosterConfig,
            resolveCardMeta,
            realBotChoosePick
        );

        expect(result.completed).toBe(true);
        for (const seat of result.seats) {
            expect(seat.pool).toHaveLength(15 * packSlots.length);

            const colorCounts: Partial<Record<Color, number>> = {};
            let coloredCount = 0;
            for (const card of seat.pool!) {
                const meta = realGetCardEvalMeta(card.scryfallId);
                if (!meta) continue;
                for (const c of meta.colors) {
                    colorCounts[c] = (colorCounts[c] ?? 0) + 1;
                    coloredCount += 1;
                }
            }
            const sortedCounts = Object.values(colorCounts).sort(
                (a, b) => b - a
            );
            const topTwo = sortedCounts.slice(0, 2).reduce((s, n) => s + n, 0);

            // The heuristic's color-commitment term should concentrate each
            // bot's colored picks into its top two colors — "plausibly
            // coherent 2-color pools", not a spread across all five.
            expect(coloredCount).toBeGreaterThan(0);
            expect(topTwo / coloredCount).toBeGreaterThan(0.6);
        }
    });
});
