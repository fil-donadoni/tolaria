// `userDecks.listMine` attaches legality to EVERY non-limited deck (issue
// #4854). The lobby renders without the card catalogue, so it can no longer
// derive a deck's legality in the browser — `validateDeck` needs the
// definitions to resolve a card's set and rarity — and a deck whose legality
// the client had to guess would read "set-unknown" for every card. The
// handler is driven for real against the shared in-memory ctx (no convex-test
// harness, see `deckDefinitionIdWrite.test.ts`).
import { describe, expect, it } from "vitest";

import type { QueryCtx } from "../_generated/server";
import { create, listMine } from "../userDecks";
import type { MutationCtx } from "../_generated/server";
import { makeInMemoryDb } from "./fixtures/inMemoryDb.fixture";

/* eslint-disable @typescript-eslint/no-explicit-any */
const run = (fn: unknown, ctx: unknown, args: unknown): Promise<any> =>
    (fn as { _handler: (c: unknown, a: unknown) => Promise<any> })._handler(
        ctx,
        args
    );

const LIGHTNING_BOLT_LEA = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a";
const BOLT = { cardId: LIGHTNING_BOLT_LEA, cardName: "Lightning Bolt" };
const ALICE = "user-alice";

describe("userDecks.listMine — server-derived legality (issue #4854)", () => {
    it("attaches isLegal and reasons to a non-limited deck, per its Format", async () => {
        const { ctx } = makeInMemoryDb(
            {
                users: [
                    { _id: ALICE, nickname: "Alice", email: "a@example.com" },
                ],
            },
            { identitySubject: `${ALICE}|session` }
        );
        for (const format of ["freeform", "premodern"]) {
            await run(create, ctx as unknown as MutationCtx, {
                name: format,
                format,
                colors: ["R"],
                cards: [BOLT],
            });
        }

        const rows = await run(listMine, ctx as unknown as QueryCtx, {});
        const byName = Object.fromEntries(rows.map((r: any) => [r.name, r]));

        expect(byName.freeform.isLegal).toBe(true);
        expect(byName.freeform.reasons).toEqual([]);
        // Premodern is set-restricted: Alpha's Bolt is outside it, and only a
        // resolved definition can say so.
        expect(byName.premodern.isLegal).toBe(false);
        expect(byName.premodern.reasons.length).toBeGreaterThan(0);
    });

    it("judges a pinned printing by its cardPrints row, not the definition's home Set (issue #5106)", async () => {
        const row = (printId: string, set: string) => ({
            printId,
            cardId: LIGHTNING_BOLT_LEA,
            set,
            rarity: "common",
            digital: false,
            promo: false,
            tokenPrints: [],
        });
        const { ctx } = makeInMemoryDb(
            {
                users: [
                    { _id: ALICE, nickname: "Alice", email: "a@example.com" },
                ],
                cardPrints: [row("p-in-pool", "lea"), row("p-out", "zzz")],
            },
            { identitySubject: `${ALICE}|session` }
        );
        for (const [name, printId] of [
            ["pinned-in", "p-in-pool"],
            ["pinned-out", "p-out"],
        ]) {
            await run(create, ctx as unknown as MutationCtx, {
                name,
                format: "old-school",
                colors: ["R"],
                cards: [{ cardId: printId, cardName: "Lightning Bolt" }],
            });
        }

        const rows = await run(listMine, ctx as unknown as QueryCtx, {});
        const byName = Object.fromEntries(rows.map((r: any) => [r.name, r]));
        const setReasons = (name: string) =>
            byName[name].reasons.filter((r: any) => /set/i.test(r.code));

        expect(setReasons("pinned-in")).toEqual([]);
        expect(setReasons("pinned-out").length).toBeGreaterThan(0);
    });
});
