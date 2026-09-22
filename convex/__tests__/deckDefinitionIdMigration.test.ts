import { describe, expect, it } from "vitest";
import { withDefinitionId } from "../cards/catalogue";

// `userDecks.migrateDefinitionIds` and `decks.migrateDefinitionIds` (issue
// #4117, ADR 0140) share this exact decision shape: no convex-test harness
// exists in this repo (see `formats.test.ts`'s `migrateLegacyFormats`
// section), so the migration's row-patch DECISION is modeled here over a
// hand-built row array, exactly as that precedent does for `format`.
const LIGHTNING_BOLT_LEA = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a";
const LIGHTNING_BOLT_LEB = "b5d3dcab-2260-479d-9ef6-dfb92d4f6061";

interface Row {
    _id: string;
    cards: { cardId: string; cardName: string; definitionId?: string }[];
    sideboard?: { cardId: string; cardName: string; definitionId?: string }[];
}

function runMigration(rows: Row[]) {
    let migrated = 0;
    let unchanged = 0;
    const patched: Row[] = [];
    for (const row of rows) {
        const cards = row.cards.map(withDefinitionId);
        const sideboard = row.sideboard?.map(withDefinitionId);
        const cardsChanged = cards.some(
            (c, i) => c.definitionId !== row.cards[i].definitionId
        );
        const sideboardChanged = sideboard?.some(
            (c, i) => c.definitionId !== row.sideboard![i].definitionId
        );
        if (!cardsChanged && !sideboardChanged) {
            unchanged++;
            patched.push(row);
            continue;
        }
        migrated++;
        patched.push({ ...row, cards, sideboard });
    }
    return { migrated, unchanged, patched };
}

describe("deck definitionId backfill (issue #4117, ADR 0140)", () => {
    it("backfills a row missing definitionId on every Maindeck and Sideboard entry", () => {
        const rows: Row[] = [
            {
                _id: "a",
                cards: [{ cardId: LIGHTNING_BOLT_LEB, cardName: "Bolt" }],
                sideboard: [{ cardId: "no-such-print", cardName: "Ghost" }],
            },
        ];
        const { migrated, unchanged, patched } = runMigration(rows);
        expect(migrated).toBe(1);
        expect(unchanged).toBe(0);
        expect(patched[0].cards[0].definitionId).toBe(LIGHTNING_BOLT_LEA);
        expect(patched[0].sideboard![0].definitionId).toBe("no-such-print");
    });

    it("leaves a row already fully backfilled untouched — idempotent re-run", () => {
        const rows: Row[] = [
            {
                _id: "b",
                cards: [
                    {
                        cardId: LIGHTNING_BOLT_LEB,
                        cardName: "Bolt",
                        definitionId: LIGHTNING_BOLT_LEA,
                    },
                ],
            },
        ];
        const { migrated, unchanged } = runMigration(rows);
        expect(migrated).toBe(0);
        expect(unchanged).toBe(1);
    });

    it("drops no card across a mixed table (migrated + unchanged rows)", () => {
        const rows: Row[] = [
            {
                _id: "a",
                cards: [{ cardId: LIGHTNING_BOLT_LEB, cardName: "Bolt" }],
            },
            {
                _id: "b",
                cards: [
                    {
                        cardId: LIGHTNING_BOLT_LEA,
                        cardName: "Bolt",
                        definitionId: LIGHTNING_BOLT_LEA,
                    },
                ],
            },
        ];
        const { migrated, unchanged, patched } = runMigration(rows);
        expect(migrated).toBe(1);
        expect(unchanged).toBe(1);
        expect(patched).toHaveLength(rows.length);
        for (const row of patched) {
            for (const card of row.cards)
                expect(card.definitionId).toBeTruthy();
        }
    });
});
