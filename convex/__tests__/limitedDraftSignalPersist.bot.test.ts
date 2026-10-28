// Persisted Draft Signal read of a live Limited event (PRD #1616, ADR 0134,
// issue #3737). `draftSignal.bot.test.ts` proves the pure fold; this file
// proves the live paths carry it: every seat's state survives across
// MUTATIONS (the real `startLimitedEvent` / `submitPick` handlers against the
// shared in-memory ctx), equals what one uninterrupted engine run folds from
// the same packs in the same order, reaches the three `chooseBotPick` call
// sites, stays off the client projection, and tolerates a row without it.
import { describe, it, expect, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import {
    loadEventCardProfile,
    loadEventCardResolvers,
    loadEventPickRating,
    makeBotChoosePick,
    makeObservePack,
    startLimitedEvent,
    submitPick,
} from "../limitedEvents";
import {
    makeInMemoryDb,
    type InMemoryRow,
} from "./fixtures/inMemoryDb.fixture";
import {
    applyPick,
    resolveAutoPickTimeout,
    runBotAutoPicks,
    startDraft,
    type ChooseBotPick,
} from "../limited/draftEngine";
import {
    emptyDraftSignalRead,
    foldPackIntoRead,
    type SeatSignalState,
} from "../limited/draftSignal";
import type { CardEvalMeta } from "../limited/botDrafter";
import type { DraftPackCard, LimitedEventSeat } from "../limited/eventTypes";
import {
    projectLimitedEvent,
    type LimitedEventRow,
} from "../limited/eventProjection";
import { getRuntimeBoosterConfig } from "../limited/registry";

const EVENT_ID = "event-3737" as Id<"limitedEvents">;
const PACK_SLOTS = ["lea", "lea", "lea"];
const HUMAN_PICKS = 10;

type Handler<A> = { _handler: (ctx: MutationCtx, args: A) => Promise<null> };
const runStart = (ctx: MutationCtx) =>
    (
        startLimitedEvent as unknown as Handler<{
            eventId: Id<"limitedEvents">;
        }>
    )._handler(ctx, { eventId: EVENT_ID });
const runSubmit = (ctx: MutationCtx, pickId: string) =>
    (
        submitPick as unknown as Handler<{
            eventId: Id<"limitedEvents">;
            pickId: string;
        }>
    )._handler(ctx, { eventId: EVENT_ID, pickId });

function makeCtx() {
    const base = makeInMemoryDb(
        {
            users: [{ _id: "u1", nickname: "Alice" }],
            limitedEvents: [
                {
                    _id: EVENT_ID,
                    createdBy: "u1",
                    type: "draft",
                    status: "open",
                    name: "Signal draft",
                    seatCount: 4,
                    packSlots: PACK_SLOTS,
                    timerEnabled: false,
                    seats: [
                        { seatIndex: 0, userId: "u1", nickname: "Alice" },
                        { seatIndex: 1 },
                        { seatIndex: 2 },
                        { seatIndex: 3 },
                    ],
                    createdAt: 0,
                    updatedAt: 0,
                },
            ],
            limitedSeats: [],
            cardRatings: [],
            cardProfiles: [],
        },
        { identitySubject: "u1|session1" }
    );
    const ctx = {
        ...(base.ctx as unknown as Record<string, unknown>),
        scheduler: { runAfter: async () => {} },
    } as unknown as MutationCtx;
    return { ctx, tables: base.tables };
}

/** The stored seat the way every consumer reads it: slim event-row seat merged
 *  with its `limitedSeats` payload row. */
function storedSeat(tables: Record<string, InMemoryRow[]>, seatIndex: number) {
    const slim = (tables.limitedEvents[0].seats as Record<string, unknown>[])[
        seatIndex
    ];
    const payload = (tables.limitedSeats ?? []).find(
        (r) => r.seatIndex === seatIndex
    );
    return { ...slim, ...(payload ?? {}) } as Record<string, unknown> &
        LimitedEventSeat;
}

/** Seat order is shuffled at start, so the human's index is read, not assumed. */
function humanIndex(tables: Record<string, InMemoryRow[]>): number {
    return (tables.limitedEvents[0].seats as { userId?: string }[]).findIndex(
        (s) => s.userId === "u1"
    );
}

/** One uninterrupted pure-engine run of the same draft: same seed, same seats,
 *  the human taking `currentPack[0]` each time, folding through the SAME
 *  adapters the mutations build. */
async function referenceRun(
    ctx: MutationCtx,
    tables: Record<string, InMemoryRow[]>,
    picks: number
) {
    const seed = tables.limitedEvents[0].seed as number;
    const human = humanIndex(tables);
    const getPickRating = await loadEventPickRating(ctx, PACK_SLOTS);
    const getCardProfile = await loadEventCardProfile(ctx, PACK_SLOTS);
    const resolvers = await loadEventCardResolvers(ctx, PACK_SLOTS);
    const choose = makeBotChoosePick(
        getPickRating,
        getCardProfile,
        resolvers.getCardEvalMeta
    );
    const observe = makeObservePack(
        PACK_SLOTS,
        undefined,
        getPickRating,
        getCardProfile,
        resolvers.getCardEvalMeta
    );
    const seats: LimitedEventSeat[] = (
        tables.limitedEvents[0].seats as LimitedEventSeat[]
    ).map(({ seatIndex, userId, nickname, isBot }) => ({
        seatIndex,
        userId,
        nickname,
        isBot,
    }));
    const dealt = startDraft(
        seats,
        PACK_SLOTS,
        seed,
        getRuntimeBoosterConfig,
        resolvers.resolveCardMeta,
        undefined,
        undefined,
        undefined,
        observe
    );
    let state = runBotAutoPicks(
        dealt.seats,
        dealt.draftRound,
        dealt.draftPacksRemaining,
        PACK_SLOTS,
        seed,
        getRuntimeBoosterConfig,
        resolvers.resolveCardMeta,
        choose,
        false,
        undefined,
        undefined,
        observe
    );
    for (let i = 0; i < picks; i++) {
        const applied = applyPick(
            state.seats,
            state.draftRound,
            state.draftPacksRemaining,
            PACK_SLOTS,
            human,
            state.seats[human].currentPack![0].pickId,
            seed,
            getRuntimeBoosterConfig,
            resolvers.resolveCardMeta,
            undefined,
            undefined,
            undefined,
            observe
        );
        state = runBotAutoPicks(
            applied.seats,
            applied.draftRound,
            applied.draftPacksRemaining,
            PACK_SLOTS,
            seed,
            getRuntimeBoosterConfig,
            resolvers.resolveCardMeta,
            choose,
            applied.completed,
            undefined,
            undefined,
            observe
        );
    }
    return state.seats;
}

describe("a seat's Draft Signal state across mutations (issue #3737)", () => {
    it("bot AND human seats end with the read one uninterrupted engine run folds from the same packs", async () => {
        const { ctx, tables } = makeCtx();
        await runStart(ctx);
        for (let i = 0; i < HUMAN_PICKS; i++) {
            const human = storedSeat(tables, humanIndex(tables));
            await runSubmit(ctx, human.currentPack![0].pickId);
        }
        const reference = await referenceRun(ctx, tables, HUMAN_PICKS);

        for (const seatIndex of [0, 1, 2, 3]) {
            const persisted = storedSeat(tables, seatIndex).draftSignal;
            expect(persisted).toBeDefined();
            expect(persisted).toEqual(reference[seatIndex].draftSignal);
            // It lives on the seat's `limitedSeats` row, never inline on the
            // event row every list query bills.
            const row = tables.limitedSeats.find(
                (r) => r.seatIndex === seatIndex
            );
            expect(row?.draftSignal).toEqual(persisted);
            expect(
                (tables.limitedEvents[0].seats as Record<string, unknown>[])[
                    seatIndex
                ].draftSignal
            ).toBeUndefined();
        }
        // Not vacuous: packs came back picked-over, so some axis moved.
        const moved = [0, 1, 2, 3].some((i) => {
            const read = storedSeat(tables, i).draftSignal!.read;
            return [read.left, read.right].some((axes) =>
                Object.values(axes.colour).some((n) => n !== 0)
            );
        });
        expect(moved).toBe(true);
    });

    it("row growth is bounded: numbers keyed by colour / Archetype id and round, never card ids", async () => {
        const { ctx, tables } = makeCtx();
        await runStart(ctx);
        for (let i = 0; i < HUMAN_PICKS; i++) {
            await runSubmit(
                ctx,
                storedSeat(tables, humanIndex(tables)).currentPack![0].pickId
            );
        }
        const signal = storedSeat(tables, humanIndex(tables)).draftSignal!;
        const walk = (node: unknown): void => {
            if (typeof node === "number") return;
            expect(typeof node).toBe("object");
            for (const v of Object.values(node as object)) walk(v);
        };
        walk(signal);
        // Keys are bounded by the registries, whatever the packs were.
        expect(Object.keys(signal.dealtSizeByRound).length).toBeLessThanOrEqual(
            PACK_SLOTS.length
        );
        expect(Object.keys(signal.read.left.colour).length).toBeLessThanOrEqual(
            5
        );
    });

    it("the public event projection never contains the read (proven to fail by leaking it)", async () => {
        const { ctx, tables } = makeCtx();
        await runStart(ctx);
        const row = {
            ...tables.limitedEvents[0],
            seats: [0, 1, 2, 3].map((i) => storedSeat(tables, i)),
        } as unknown as LimitedEventRow;
        expect(JSON.stringify(row.seats.map((s) => s.draftSignal))).toContain(
            "dealtSizeByRound"
        );
        const view = projectLimitedEvent(row, "u1");
        const wire = JSON.stringify(view);
        expect(wire).not.toContain("draftSignal");
        expect(wire).not.toContain("dealtSizeByRound");
    });

    it("a seat row without the field loads and picks without error", async () => {
        const { ctx, tables } = makeCtx();
        await runStart(ctx);
        // An event started before this change: strip the field from every row.
        for (const row of tables.limitedSeats) delete row.draftSignal;
        const human = storedSeat(tables, humanIndex(tables));
        expect(human.draftSignal).toBeUndefined();
        await expect(
            runSubmit(ctx, human.currentPack![0].pickId)
        ).resolves.toBeNull();
        expect(storedSeat(tables, humanIndex(tables)).pool).toHaveLength(1);
    });
});

describe("the persisted read reaches every chooseBotPick call site (issue #3737)", () => {
    const state: SeatSignalState = {
        read: foldPackIntoRead(
            emptyDraftSignalRead(),
            [card("u"), card("u"), card("u"), card("u")],
            { direction: 1, removedUpstream: 14 },
            {
                colour: { W: 0, U: 0.5, B: 0, R: 0.5, G: 0 },
                archetype: {},
            },
            (id) => ({
                power: 3,
                colours: id === "u" ? ["U"] : ["R"],
                archetypes: [],
            })
        ),
        dealtSizeByRound: { 0: 15 },
    };
    function card(id: string): DraftPackCard {
        return { scryfallId: id, cardId: id, cardName: id, pickId: `${id}-x` };
    }
    const seat = (draftSignal?: SeatSignalState): LimitedEventSeat => ({
        seatIndex: 0,
        userId: "u1",
        pool: colourless,
        pickSeq: 1,
        currentPack: [
            { ...card("r"), pickId: "r0-p0-c0" },
            { ...card("u"), pickId: "r0-p0-c1" },
        ],
        draftSignal,
    });
    const metaFor = (id: string): CardEvalMeta => ({
        cardId: id,
        colors: id === "u" ? ["U"] : id === "r" ? ["R"] : [],
        manaValue: 2,
        rarity: "common",
        pips: id === "u" ? { U: 1 } : id === "r" ? { R: 1 } : {},
        producedColors: [],
    });
    const colourless = Array.from({ length: 8 }, () => ({
        scryfallId: "c",
        cardId: "c",
        cardName: "c",
    }));
    const chooser = makeBotChoosePick(
        () => null,
        () => null,
        metaFor
    );

    it("Auto-Pick: the read steers the pick a seat without it would not make", () => {
        const without = resolveAutoPickTimeout([seat()], 0, 1, chooser);
        const withRead = resolveAutoPickTimeout([seat(state)], 0, 1, chooser);
        expect(without?.pickId).toBe("r0-p0-c0");
        expect(withRead?.pickId).toBe("r0-p0-c1");
    });

    it("Auto-Pick and Default Pick receive the seat, with its read, and the round", () => {
        const spy = vi.fn<ChooseBotPick>(() => "r0-p0-c0");
        resolveAutoPickTimeout([seat(state)], 0, 1, spy, 2);
        expect(spy.mock.calls[0][0].draftSignal).toEqual(state);
        expect(spy.mock.calls[0][3]).toBe(2);

        const defaults = vi.fn<ChooseBotPick>(() => "r0-p0-c0");
        const dealt = startDraft(
            [
                { seatIndex: 0, userId: "u1" },
                { seatIndex: 1, isBot: true },
            ],
            ["lea"],
            1,
            getRuntimeBoosterConfig,
            () => null,
            { now: 0 },
            undefined,
            defaults,
            (s) => ({ ...s, dealtSizeByRound: { 0: 99 } })
        );
        // The Default Pick is computed AFTER the pack is folded into the seat.
        expect(defaults.mock.calls[0][0].draftSignal).toEqual({
            read: emptyDraftSignalRead(),
            dealtSizeByRound: { 0: 99 },
        });
        expect(dealt.seats[0].draftSignal?.dealtSizeByRound).toEqual({
            0: 99,
        });
    });
});
