// Every deck WRITE stores `definitionId` (issue #4386, ADR 0140).
//
// The schema now requires `definitionId` on every `userDecks` / `presetDecks`
// card entry, while the mutation ARGS keep it optional: a caller that sends
// none (a Full Catalogue entry, a Limited Pool card, a stale client) is served
// by `withDefinitionId` on the server. This file pins that every write path
// fills it, so the narrow cannot be defeated by a caller that omits it — a
// path that forgot `withDefinitionId` would store a row the schema rejects.
//
// `userDecks.update` builds its patch as `Record<string, unknown>`, so
// `check:ts` cannot see a missing fill there; the handlers are driven for
// real against the shared in-memory ctx (no convex-test harness, see
// `joinByCode.test.ts`). The preset write paths are pure builders.
import { describe, expect, it } from "vitest";

import type { MutationCtx } from "../_generated/server";
import { create, update } from "../userDecks";
import { buildNewPresetRow, buildPresetPatch, presetToInsert } from "../decks";
import { makeInMemoryDb } from "./fixtures/inMemoryDb.fixture";

/* eslint-disable @typescript-eslint/no-explicit-any */
const run = (fn: unknown, ctx: MutationCtx, args: unknown): Promise<any> =>
    (fn as { _handler: (c: MutationCtx, a: unknown) => Promise<any> })._handler(
        ctx,
        args
    );

// Beta's Lightning Bolt is a PRINTING of the Alpha definition, so a filled
// `definitionId` differs from the `cardId` the caller sent.
const LIGHTNING_BOLT_LEA = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a";
const LIGHTNING_BOLT_LEB = "b5d3dcab-2260-479d-9ef6-dfb92d4f6061";
const BOLT = { cardId: LIGHTNING_BOLT_LEB, cardName: "Lightning Bolt" };
const FILLED = { ...BOLT, definitionId: LIGHTNING_BOLT_LEA };

const ALICE = "user-alice";

function aliceDb() {
    return makeInMemoryDb(
        { users: [{ _id: ALICE, nickname: "Alice", email: "a@example.com" }] },
        { identitySubject: `${ALICE}|session` }
    );
}

describe("deck writes store definitionId when the caller omits it (issue #4386)", () => {
    it("userDecks.create fills Maindeck and Sideboard", async () => {
        const { ctx, tables } = aliceDb();
        await run(create, ctx, {
            name: "Burn",
            format: "freeform",
            colors: ["R"],
            cards: [BOLT],
            sideboard: [BOLT],
        });
        const [row] = tables.userDecks;
        expect(row.cards).toEqual([FILLED]);
        expect(row.sideboard).toEqual([FILLED]);
    });

    it("userDecks.update fills Maindeck and Sideboard", async () => {
        const { ctx, tables } = aliceDb();
        const id = await run(create, ctx, {
            name: "Burn",
            format: "freeform",
            colors: ["R"],
            cards: [],
        });
        await run(update, ctx, {
            id,
            patch: { cards: [BOLT], sideboard: [BOLT] },
        });
        const [row] = tables.userDecks;
        expect(row.cards).toEqual([FILLED]);
        expect(row.sideboard).toEqual([FILLED]);
    });

    it("presetDecks create, patch and seed fill Maindeck and Sideboard", () => {
        const created = buildNewPresetRow({
            name: "Burn",
            cards: [BOLT],
            sideboard: [BOLT],
        });
        expect(created.cards).toEqual([FILLED]);
        expect(created.sideboard).toEqual([FILLED]);

        const patch = buildPresetPatch({ cards: [BOLT], sideboard: [BOLT] });
        expect(patch.cards).toEqual([FILLED]);
        expect(patch.sideboard).toEqual([FILLED]);

        const seeded = presetToInsert({
            presetId: "burn",
            name: "Burn",
            format: "freeform",
            description: "",
            colors: ["R"],
            cards: [BOLT],
            sideboard: [BOLT],
        });
        expect(seeded.cards).toEqual([FILLED]);
        expect(seeded.sideboard).toEqual([FILLED]);
    });
});
