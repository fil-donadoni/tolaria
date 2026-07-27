// Auto-Build tests (PRD #1107 stories 24-25, ADR 0054/0055, issue #1115):
// deterministic unit tests for 2-color selection, curve-aware spell fill, and
// "no foreign cards" against the REAL LEA card registry + Booster Config —
// mirrors `botDrafter.test.ts`'s discipline (pure functions, no convex-test
// harness needed). A separate property test below asserts EVERY bot seat's
// Auto-Built deck validates as `limited`-legal against its own Pool, over
// many seeded Sealed AND Draft events.
import { describe, it, expect } from "vitest";
import {
    getCardByName,
    getPrintingsForCard,
    resolveDeckCardMeta,
    tryGetDefinition,
} from "../../cards";
import { getCardColorIdentity, getPipCountsFromCost } from "../../cards/colors";
import { getDefinitionProducibleColors, manaValue } from "../../gre/constants";
import { makeRng } from "../../gre/rng";
import { validateDeck, type Pool, type ResolvePool } from "../../formats";
import {
    autoBuildDeck,
    chooseTwoColors,
    computeBotAutoBuiltDeck,
    isEventPoolFinal,
    type AutoBuildCardMeta,
    type AutoBuildEventContext,
    type GetAutoBuildCardMeta,
    type ResolveBasicLand,
    type TrueColor,
} from "../autoBuild";
import {
    runBotAutoPicks,
    startDraft,
    type ChooseBotPick,
} from "../draftEngine";
import { chooseBotPick, type GetCardEvalMeta } from "../botDrafter";
import {
    buildEmptySeats,
    fillBotSeats,
    generateSealedPools,
    type ResolveCardMeta,
} from "../eventLogic";
import { poolFromLimitedPoolCards } from "../poolResolution";
import { getBoosterConfig } from "../registry";
import type { LimitedPoolCard } from "../eventTypes";

// --- Shared registry-backed resolvers (mirrors convex/limitedEvents.ts) ---

const resolveCardMeta: ResolveCardMeta = (scryfallId) => {
    const def = tryGetDefinition(scryfallId);
    if (!def) return null;
    const meta = resolveDeckCardMeta(scryfallId);
    return meta ? { cardId: meta.cardId, cardName: def.name } : null;
};

const getCardEvalMeta: GetCardEvalMeta = (scryfallId) => {
    const meta = resolveDeckCardMeta(scryfallId);
    if (!meta) return null;
    const def = tryGetDefinition(meta.cardId);
    if (!def) return null;
    return {
        cardId: meta.cardId,
        colors: getCardColorIdentity(def),
        manaValue: manaValue(def.manaCost),
        rarity: meta.rarity,
        pips: getPipCountsFromCost(def.manaCost),
        producedColors: [...getDefinitionProducibleColors(def)],
    };
};

const botChoosePick: ChooseBotPick = (seat, pack, packsSeen) =>
    chooseBotPick(pack, seat.pool ?? [], getCardEvalMeta, { packsSeen });

const getAutoBuildCardMeta: GetAutoBuildCardMeta = (scryfallId) => {
    const meta = resolveDeckCardMeta(scryfallId);
    if (!meta) return null;
    const def = tryGetDefinition(meta.cardId);
    if (!def) return null;
    return {
        cardId: meta.cardId,
        colors: getCardColorIdentity(def),
        manaValue: manaValue(def.manaCost),
        rarity: meta.rarity,
        isLand: def.types.includes("Land"),
    };
};

function resolveBasicLandFor(setCode: string): ResolveBasicLand {
    return (color: TrueColor) => {
        const name = {
            W: "Plains",
            U: "Island",
            B: "Swamp",
            R: "Mountain",
            G: "Forest",
        }[color];
        const def = getCardByName(name);
        const printing = getPrintingsForCard(def.id).find(
            (p) => p.setCode === setCode
        );
        return { cardId: printing?.printId ?? def.id, cardName: name };
    };
}
const resolveBasicLand = resolveBasicLandFor("lea");

/** Builds a real `AutoBuildCardMeta` from a LEA card name (mirrors
 *  `botDrafter.test.ts`'s `metaOf`). */
function metaOf(name: string): AutoBuildCardMeta {
    const def = getCardByName(name);
    return {
        cardId: def.id,
        colors: getCardColorIdentity(def),
        manaValue: manaValue(def.manaCost),
        rarity: def.rarity,
        isLand: def.types.includes("Land"),
    };
}

function poolCard(
    scryfallId: string,
    meta: AutoBuildCardMeta
): LimitedPoolCard {
    return { scryfallId, cardId: meta.cardId, cardName: scryfallId };
}

function metaLookup(
    entries: Record<string, AutoBuildCardMeta>
): GetAutoBuildCardMeta {
    return (scryfallId) => entries[scryfallId] ?? null;
}

// --- chooseTwoColors (PRD #1107 story 24: "pick the two strongest colors") -

describe("chooseTwoColors (issue #1115)", () => {
    it("picks the two colors with the highest summed card quality", () => {
        // The SAME underlying card (identical `cardId`/`rarity`, hence
        // identical per-copy `cardValueById` quality) attributed to two
        // different colors via an overridden `colors` field — isolates the
        // COUNT signal from any real quality difference between distinct
        // cards (a genuinely different pair of cards would require guessing
        // `cardValueById`'s exact relative magnitudes, which this test
        // deliberately doesn't depend on).
        const bolt = metaOf("Lightning Bolt");
        const asRed: AutoBuildCardMeta = { ...bolt, colors: ["R"] };
        const asGreen: AutoBuildCardMeta = { ...bolt, colors: ["G"] };
        const plains = metaOf("Plains"); // colorless land — never contributes
        const entries = {
            r1: asRed,
            g1: asGreen,
            g2: asGreen,
            g3: asGreen,
            plains,
        };
        const pool: LimitedPoolCard[] = [
            poolCard("r1", asRed),
            poolCard("g1", asGreen),
            poolCard("g2", asGreen),
            poolCard("g3", asGreen),
            poolCard("plains", plains),
        ];
        const [c1, c2] = chooseTwoColors(pool, metaLookup(entries));
        // 3 Green copies strictly outscore 1 Red copy; a colorless land
        // never outranks either.
        expect(c1).toBe("G");
        expect(c2).toBe("R");
    });

    it("ties break by WUBRG order, deterministically", () => {
        // The SAME underlying card (identical `cardId`/`rarity`, hence
        // identical `cardValueById` quality) attributed to two DIFFERENT
        // colors via an overridden `colors` field — a genuine score tie
        // between Red and Green, isolating the tie-break from any real
        // quality difference between two distinct cards.
        const bolt = metaOf("Lightning Bolt");
        const asRed: AutoBuildCardMeta = { ...bolt, colors: ["R"] };
        const asGreen: AutoBuildCardMeta = { ...bolt, colors: ["G"] };
        const entries = { r1: asRed, g1: asGreen };
        const pool: LimitedPoolCard[] = [
            poolCard("r1", asRed),
            poolCard("g1", asGreen),
        ];
        const [c1, c2] = chooseTwoColors(pool, metaLookup(entries));
        // WUBRG order: Red (position 4) precedes Green (position 5) — R wins
        // the tie for first place; every 0-scoring color (W/U/B) loses to
        // both.
        expect(c1).toBe("R");
        expect(c2).toBe("G");
    });

    it("falls back to W/U (first two WUBRG colors) for a pool with no colored cards", () => {
        const plains = metaOf("Plains");
        const entries = { p1: plains };
        const pool: LimitedPoolCard[] = [poolCard("p1", plains)];
        expect(chooseTwoColors(pool, metaLookup(entries))).toEqual(["W", "U"]);
    });
});

// --- autoBuildDeck: size, split, curve, no-foreign-cards --------------------

describe("autoBuildDeck (issue #1115)", () => {
    it("builds a legal-sized (>=40), curve-aware, on-color deck with basics of the drafted set, from a full LEA Sealed pool", () => {
        const packSlots = ["lea"];
        let seats = buildEmptySeats(2);
        seats = fillBotSeats(seats);
        seats = generateSealedPools(
            seats,
            packSlots,
            6,
            getBoosterConfig,
            resolveCardMeta,
            makeRng(4242)
        );
        const pool = seats[0].pool!;
        expect(pool.length).toBeGreaterThan(60); // 6 boosters, ~90 cards

        const built = autoBuildDeck(
            pool,
            getAutoBuildCardMeta,
            resolveBasicLand
        );

        // Size: always at least the format's legality floor (real Limited
        // practice, not the issue's literal "~17 spells + 17 lands" — see
        // `autoBuild.ts`'s module comment for why).
        expect(built.cards.length).toBeGreaterThanOrEqual(40);
        expect(built.colors).toHaveLength(2);
        expect(built.colors[0]).not.toBe(built.colors[1]);

        // "~17" land count (issue AC: "~17/17 split") — a healthy Sealed
        // pool builds close to the classic 17, never far below it.
        const basicNames = new Set([
            "Plains",
            "Island",
            "Swamp",
            "Mountain",
            "Forest",
        ]);
        const landCards = built.cards.filter((c) => basicNames.has(c.cardName));
        expect(landCards.length).toBeGreaterThanOrEqual(17);
        expect(landCards.length).toBeLessThanOrEqual(20);
        // Every land is a basic of one of the two chosen colors.
        const colorLandNames = new Set(
            built.colors.map(
                (c) =>
                    ({
                        W: "Plains",
                        U: "Island",
                        B: "Swamp",
                        R: "Mountain",
                        G: "Forest",
                    })[c]
            )
        );
        for (const land of landCards) {
            expect(colorLandNames.has(land.cardName)).toBe(true);
        }

        // "no foreign cards": every non-land Maindeck card AND every
        // Sideboard card traces back to a real Pool entry (basics are the
        // ONLY cards Auto-Build ever invents, and they're never counted
        // against the Pool by `checkPoolMembership`'s basic exemption).
        const poolCardIds = new Set(pool.map((c) => c.cardId));
        const nonLandMain = built.cards.filter(
            (c) => !basicNames.has(c.cardName)
        );
        for (const c of [...nonLandMain, ...built.sideboard]) {
            expect(poolCardIds.has(c.cardId)).toBe(true);
        }

        // "every Pool card placed somewhere": the non-land Maindeck +
        // Sideboard together account for every Pool entry exactly once
        // (this is exactly `checkPoolMembership`'s invariant — asserted
        // directly via `validateDeck` in the property test below, and
        // spot-checked here by raw count).
        expect(nonLandMain.length + built.sideboard.length).toBe(pool.length);
    });

    it("curve-fills: the built spell base isn't clustered at one mana value", () => {
        const packSlots = ["lea"];
        let seats = buildEmptySeats(2);
        seats = fillBotSeats(seats);
        seats = generateSealedPools(
            seats,
            packSlots,
            6,
            getBoosterConfig,
            resolveCardMeta,
            makeRng(99)
        );
        const pool = seats[0].pool!;
        const built = autoBuildDeck(
            pool,
            getAutoBuildCardMeta,
            resolveBasicLand
        );

        const basicNames = new Set([
            "Plains",
            "Island",
            "Swamp",
            "Mountain",
            "Forest",
        ]);
        const spells = built.cards.filter((c) => !basicNames.has(c.cardName));
        const buckets = new Map<number, number>();
        for (const c of spells) {
            const def = tryGetDefinition(c.cardId)!;
            const mv = Math.max(
                1,
                Math.min(6, Math.round(manaValue(def.manaCost)))
            );
            buckets.set(mv, (buckets.get(mv) ?? 0) + 1);
        }
        // Curve-aware: no single mana-value bucket holds every spell — a
        // non-curve-aware "just take the N best cards" build on a real LEA
        // pool would very plausibly cluster (LEA has a deep 2-3 drop
        // common slot). This is a coarse, non-brittle curve-shape check.
        const maxBucketShare = Math.max(...buckets.values()) / spells.length;
        expect(maxBucketShare).toBeLessThan(0.6);
        // At least 3 distinct buckets populated — real curve spread, not a
        // single-cost pile.
        expect(buckets.size).toBeGreaterThanOrEqual(3);
    });

    it("still reaches the 40-card floor from a thin/foreign-light synthetic pool by growing the land count", () => {
        // A tiny synthetic pool (well under 23 on-color spells) — Auto-Build
        // must still ship a >=40 Maindeck by adding MORE basics, never a
        // short deck.
        const bolt = metaOf("Lightning Bolt");
        const shock = metaOf("Lightning Bolt"); // reuse id, distinct pool entry
        const entries = { r1: bolt, r2: shock };
        const pool: LimitedPoolCard[] = [
            poolCard("r1", bolt),
            poolCard("r2", shock),
        ];
        const built = autoBuildDeck(
            pool,
            metaLookup(entries),
            resolveBasicLandFor("lea")
        );
        expect(built.cards.length).toBeGreaterThanOrEqual(40);
        // Both tiny pool entries are placed somewhere (never dropped), and
        // never duplicated: nonland Maindeck + Sideboard together equal the
        // Pool's own size exactly.
        const basicNames = new Set([
            "Plains",
            "Island",
            "Swamp",
            "Mountain",
            "Forest",
        ]);
        const nonLandMain = built.cards.filter(
            (c) => !basicNames.has(c.cardName)
        );
        expect(nonLandMain.length + built.sideboard.length).toBe(pool.length);
    });
});

// --- Event-completion gating -----------------------------------------------

describe("isEventPoolFinal / computeBotAutoBuiltDeck (issue #1115)", () => {
    const bolt = metaOf("Lightning Bolt");
    const pool: LimitedPoolCard[] = [poolCard("r1", bolt)];
    const meta = metaLookup({ r1: bolt });
    const land = resolveBasicLandFor("lea");

    it("a Sealed event's Pool is final the instant it's started", () => {
        const open: AutoBuildEventContext = { type: "sealed", status: "open" };
        const started: AutoBuildEventContext = {
            type: "sealed",
            status: "started",
        };
        expect(isEventPoolFinal(open)).toBe(false);
        expect(isEventPoolFinal(started)).toBe(true);
    });

    it("a Draft event's Pool is final only once draftCompletedAt is set", () => {
        const midDraft: AutoBuildEventContext = {
            type: "draft",
            status: "started",
        };
        const completed: AutoBuildEventContext = {
            type: "draft",
            status: "started",
            draftCompletedAt: 12345,
        };
        expect(isEventPoolFinal(midDraft)).toBe(false);
        expect(isEventPoolFinal(completed)).toBe(true);
    });

    // The regression the play phase introduced (ADR 0076, issue #1640): this
    // gate used to read `status !== "started"`, so the instant `playing`
    // existed EVERY bot seat's Auto-Built deck — the deck its round pairings
    // are played and evaluated against — would have vanished mid-event. A
    // Pool is never un-dealt, so `arePoolsDealt` must keep it final through
    // the rounds and past the event's end. Asserted HERE, at the consumer
    // that was actually broken: `eventStatus.test.ts` pins
    // `arePoolsDealt("playing")` but never reaches this gate.
    it("a Pool stays final through the play phase and past the event's end", () => {
        const sealedPlaying: AutoBuildEventContext = {
            type: "sealed",
            status: "playing",
        };
        const sealedFinished: AutoBuildEventContext = {
            type: "sealed",
            status: "finished",
        };
        const draftPlaying: AutoBuildEventContext = {
            type: "draft",
            status: "playing",
            draftCompletedAt: 12345,
        };
        const draftFinished: AutoBuildEventContext = {
            type: "draft",
            status: "finished",
            draftCompletedAt: 12345,
        };

        expect(isEventPoolFinal(sealedPlaying)).toBe(true);
        expect(isEventPoolFinal(sealedFinished)).toBe(true);
        expect(isEventPoolFinal(draftPlaying)).toBe(true);
        expect(isEventPoolFinal(draftFinished)).toBe(true);

        // …and the consequence that matters: the bot seat still HAS its deck
        // once the rounds are running and after they end.
        expect(
            computeBotAutoBuiltDeck(
                { isBot: true, pool },
                sealedPlaying,
                meta,
                land
            )
        ).not.toBeNull();
        expect(
            computeBotAutoBuiltDeck(
                { isBot: true, pool },
                draftFinished,
                meta,
                land
            )
        ).not.toBeNull();
    });

    it("computeBotAutoBuiltDeck is null for a human seat, null before the Pool is final, and a deck once it is", () => {
        const started: AutoBuildEventContext = {
            type: "sealed",
            status: "started",
        };
        const open: AutoBuildEventContext = { type: "sealed", status: "open" };

        expect(
            computeBotAutoBuiltDeck({ isBot: false, pool }, started, meta, land)
        ).toBeNull();
        expect(
            computeBotAutoBuiltDeck({ isBot: true, pool }, open, meta, land)
        ).toBeNull();
        expect(
            computeBotAutoBuiltDeck(
                { isBot: true, pool: [] },
                started,
                meta,
                land
            )
        ).toBeNull();
        expect(
            computeBotAutoBuiltDeck({ isBot: true, pool }, started, meta, land)
        ).not.toBeNull();
    });
});

// --- Property test: every bot seat's Auto-Built deck is limited-legal ------
//
// PRD #1107 acceptance: "each is limited-legal against its own Pool" —
// asserted over MANY seeded drafts (both Sealed and Draft event types), via
// the SAME `validateDeck`/`checkPoolMembership` seam `convex/formats.ts`'s
// authoritative game-start gate uses. This is the hard requirement driving
// `autoBuild.ts`'s size/color/curve choices (see its module comment).

function resolvePoolFor(pool: readonly LimitedPoolCard[]): ResolvePool {
    const grouped: Pool = poolFromLimitedPoolCards(pool, resolveDeckCardMeta);
    return () => grouped;
}

describe("property: Auto-Built decks are always limited-legal against their own Pool (issue #1115)", () => {
    it("every bot seat, across 25 seeded Sealed events of varying seat counts, builds a limited-legal deck", () => {
        const packSlots = ["lea"];
        let checked = 0;
        for (let seed = 1; seed <= 25; seed++) {
            const seatCount = 2 + (seed % 7); // 2..8
            let seats = buildEmptySeats(seatCount);
            seats = fillBotSeats(seats); // every seat is a bot — solo-drafter shape
            seats = generateSealedPools(
                seats,
                packSlots,
                6,
                getBoosterConfig,
                resolveCardMeta,
                makeRng(seed * 1000 + 7)
            );
            const eventContext: AutoBuildEventContext = {
                type: "sealed",
                status: "started",
            };
            for (const seat of seats) {
                const built = computeBotAutoBuiltDeck(
                    seat,
                    eventContext,
                    getAutoBuildCardMeta,
                    resolveBasicLand
                );
                expect(built).not.toBeNull();
                const legality = validateDeck(
                    { cards: built!.cards, sideboard: built!.sideboard },
                    "limited",
                    resolveDeckCardMeta,
                    undefined,
                    resolvePoolFor(seat.pool!)
                );
                expect(legality.reasons).toEqual([]);
                expect(legality.isLegal).toBe(true);
                checked++;
            }
        }
        expect(checked).toBeGreaterThan(50); // sanity: the loop actually ran
    });

    it("every bot seat, across 10 seeded ALL-BOT Draft events (solo-drafter shape), builds a limited-legal deck", () => {
        const packSlots = ["lea", "lea", "lea"];
        let checked = 0;
        for (let seed = 1; seed <= 10; seed++) {
            const seatCount = 2 + (seed % 7); // 2..8
            const seats = fillBotSeats(buildEmptySeats(seatCount));
            const eventSeed = seed * 777 + 3;

            const dealt = startDraft(
                seats,
                packSlots,
                eventSeed,
                getBoosterConfig,
                resolveCardMeta
            );
            const result = runBotAutoPicks(
                dealt.seats,
                dealt.draftRound,
                dealt.draftPacksRemaining,
                packSlots,
                eventSeed,
                getBoosterConfig,
                resolveCardMeta,
                botChoosePick
            );
            expect(result.completed).toBe(true);

            const eventContext: AutoBuildEventContext = {
                type: "draft",
                status: "started",
                draftCompletedAt: 999,
            };
            for (const seat of result.seats) {
                const built = computeBotAutoBuiltDeck(
                    seat,
                    eventContext,
                    getAutoBuildCardMeta,
                    resolveBasicLand
                );
                expect(built).not.toBeNull();
                const legality = validateDeck(
                    { cards: built!.cards, sideboard: built!.sideboard },
                    "limited",
                    resolveDeckCardMeta,
                    undefined,
                    resolvePoolFor(seat.pool!)
                );
                expect(legality.reasons).toEqual([]);
                expect(legality.isLegal).toBe(true);
                checked++;
            }
        }
        expect(checked).toBeGreaterThan(20);
    });
});
