// Invasion Block Pack Source (PRD #5383, issue #5404): creating a draft by the
// block's key stores INV → PLS → APC in pack order, and dealing that draft
// opens one pack of each set in that order. Runs the real `createLimitedEvent`
// handler, then the real pack-deal / Bot Drafter path over the checked-in
// Booster Configs.
import { describe, it, expect } from "vitest";
import type { MutationCtx } from "../_generated/server";
import { createLimitedEvent } from "../limitedEvents";
import { resolveCardMeta, resolveSheetCardMeta } from "../limitedCardMeta";
import { tryGetDefinition } from "../cards";
import { getCardColorIdentity, getPipCountsFromCost } from "../cards/colors";
import { getDefinitionProducibleColors, manaValue } from "../gre/constants";
import { chooseBotPick, type GetCardEvalMeta } from "../limited/botDrafter";
import { runBotAutoPicks, startDraft } from "../limited/draftEngine";
import type { ChooseBotPick } from "../limited/draftEngine";
import { buildEmptySeats, fillBotSeats } from "../limited/eventLogic";
import { getBoosterConfig, getRuntimeBoosterConfig } from "../limited/registry";

async function createBlockDraft(): Promise<{ packSlots: string[] }> {
    const docs = new Map<string, Record<string, unknown>>([
        ["user1", { _id: "user1", nickname: "Creator" }],
    ]);
    const ctx = {
        auth: {
            getUserIdentity: async () => ({ subject: "user1|session1" }),
        },
        db: {
            get: async (id: string) => docs.get(id) ?? null,
            insert: async (table: string, doc: Record<string, unknown>) => {
                const _id = `${table}-${docs.size}`;
                docs.set(_id, { ...doc, _id });
                return _id;
            },
        },
    } as unknown as MutationCtx;
    const id = await (
        createLimitedEvent as unknown as {
            _handler: (
                ctx: MutationCtx,
                args: Record<string, unknown>
            ) => Promise<string>;
        }
    )._handler(ctx, {
        type: "draft",
        seatCount: 8,
        packSource: "invasion-block",
    });
    return docs.get(id) as { packSlots: string[] };
}

const getCardEvalMeta: GetCardEvalMeta = (scryfallId) => {
    const meta = resolveSheetCardMeta(scryfallId);
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

function sheetIds(set: string): Set<string> {
    const config = getBoosterConfig(set)!;
    return new Set(
        Object.values(config.sheets).flatMap((sheet) =>
            Object.keys(sheet.cards)
        )
    );
}

describe("Invasion Block draft (issue #5404)", () => {
    it("createLimitedEvent by the block key stores INV, PLS, APC in pack order", async () => {
        const event = await createBlockDraft();
        expect(event.packSlots).toEqual(["inv", "pls", "apc"]);
    });

    it("deals one pack of each set in order: round 0 opens INV, then PLS, then APC", async () => {
        const { packSlots } = await createBlockDraft();
        const seed = 5404;
        const seats = fillBotSeats(buildEmptySeats(8));
        const dealt = startDraft(
            seats,
            packSlots,
            seed,
            getRuntimeBoosterConfig,
            resolveCardMeta
        );
        const inv = sheetIds("inv");
        for (const seat of dealt.seats) {
            expect(seat.currentPack).toBeDefined();
            for (const card of seat.currentPack!) {
                expect(inv.has(card.scryfallId)).toBe(true);
            }
        }

        const result = runBotAutoPicks(
            dealt.seats,
            dealt.draftRound,
            dealt.draftPacksRemaining,
            packSlots,
            seed,
            getRuntimeBoosterConfig,
            resolveCardMeta,
            botChoosePick
        );
        expect(result.completed).toBe(true);
        // A seat picks once per pack of a round: its pool, in pick order, is
        // round 0's picks, then round 1's, then round 2's.
        const sheets = packSlots.map(sheetIds);
        for (const seat of result.seats) {
            const pool = seat.pool!;
            const perRound = pool.length / packSlots.length;
            expect(Number.isInteger(perRound)).toBe(true);
            packSlots.forEach((set, round) => {
                const picks = pool.slice(
                    round * perRound,
                    (round + 1) * perRound
                );
                for (const card of picks) {
                    expect(
                        sheets[round].has(card.scryfallId),
                        `${card.cardName} picked in round ${round} is not on ${set}'s sheets`
                    ).toBe(true);
                }
            });
        }
    });
});
