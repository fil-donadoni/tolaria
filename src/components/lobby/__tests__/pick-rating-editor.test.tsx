// Pick Rating editor surface (PRD #1296 Slice C, issue #1300). Drives the
// SURFACE through the REAL query projection: `listScopeCards` +
// `buildScopeCardRatings` are the exact pure functions
// `convex/limited/cardRatings.ts`'s `listScopeCardRatings` query wraps
// (`assertIsAdmin` + a `ctx.db` scan, both already covered by the
// mutation-testing-pattern unit tests in `cardRatings.test.ts` — this file
// covers the FRONTEND side of the same wire shape) — run here against the
// REAL checked-in LEA Booster Config / card registry, not a hand-built view.
// Prior art: `create-limited-event-dialog.test.tsx` (dumb, props-driven
// component; real `DraftableSetInfo[]` shape fed in as props).
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
    listScopeCards,
    buildScopeCardRatings,
    type GetDbRating,
} from "@convex/limited/cardRatings";
import { CUBE_SOURCE_KEY } from "@convex/limited/cube";
import PickRatingEditor from "../pick-rating-editor";
import type { ScopeCardRating } from "~/hooks/useCardRatings";

function fakeDb(rows: Record<string, number>): GetDbRating {
    return (_scope, cardId) => rows[cardId] ?? null;
}

/** Real LEA scope cards, annotated through the REAL layering core — mirrors
 *  exactly what the `listScopeCardRatings` query returns over the wire for
 *  scope `"lea"`, given an in-memory stand-in for the `cardRatings` table
 *  scan (the only piece that needs `ctx.db`, mirrored here as a plain map —
 *  same "no convex-test harness" discipline the backend suite uses). */
function leaCards(dbRows: Record<string, number> = {}): ScopeCardRating[] {
    const cards = listScopeCards("lea");
    return buildScopeCardRatings("lea", cards, fakeDb(dbRows)).sort((a, b) =>
        a.name.localeCompare(b.name)
    );
}

function findCardWithSeedRating(): ScopeCardRating {
    const cards = leaCards();
    const found = cards.find((c) => c.seedRating !== null);
    expect(found).toBeTruthy();
    return found!;
}

function findCardWithNoRating(): ScopeCardRating {
    const cards = leaCards();
    const found = cards.find((c) => c.seedRating === null);
    expect(found).toBeTruthy();
    return found!;
}

describe("PickRatingEditor — renders the real query projection (PRD #1296 Slice C, issue #1300)", () => {
    it("shows Loading while cards is undefined", () => {
        render(
            <PickRatingEditor
                cards={undefined}
                onSave={vi.fn()}
                onClear={vi.fn()}
            />
        );
        expect(screen.getByText("Loading…")).toBeTruthy();
    });

    it("shows a card's SEED default when it has no database override", () => {
        const seeded = findCardWithSeedRating();
        render(
            <PickRatingEditor
                cards={[seeded]}
                onSave={vi.fn()}
                onClear={vi.fn()}
            />
        );
        expect(screen.getByText(seeded.name)).toBeTruthy();
        expect(
            screen.getByText(`Seed default: ${seeded.seedRating}`)
        ).toBeTruthy();
        // The Clear button is disabled — nothing to clear (no DB override).
        expect(
            (screen.getByText("Clear") as HTMLElement).closest("button")
        ).toHaveProperty("disabled", true);
    });

    it("shows Unrated for a card with neither a database nor a seed rating", () => {
        const unrated = findCardWithNoRating();
        render(
            <PickRatingEditor
                cards={[unrated]}
                onSave={vi.fn()}
                onClear={vi.fn()}
            />
        );
        expect(screen.getByText("Unrated (Pick Heuristic only)")).toBeTruthy();
    });

    it("shows a card's DATABASE OVERRIDE distinctly from its seed default, and enables Clear", () => {
        const seeded = findCardWithSeedRating();
        const override = seeded.seedRating === 1 ? 2 : 1;
        const cards = leaCards({ [seeded.cardId]: override });
        const row = cards.find((c) => c.cardId === seeded.cardId)!;
        expect(row.dbRating).toBe(override);
        expect(row.seedRating).toBe(seeded.seedRating);

        render(
            <PickRatingEditor
                cards={[row]}
                onSave={vi.fn()}
                onClear={vi.fn()}
            />
        );
        expect(screen.getByText(`Override: ${override}`)).toBeTruthy();
        expect(
            (screen.getByText("Clear") as HTMLElement).closest("button")
        ).toHaveProperty("disabled", false);
    });

    it("filters the card list by name via the search box", () => {
        const cards = leaCards().slice(0, 25);
        render(
            <PickRatingEditor
                cards={cards}
                onSave={vi.fn()}
                onClear={vi.fn()}
            />
        );
        const target = cards[0];
        fireEvent.change(screen.getByLabelText("Search cards"), {
            target: { value: target.name },
        });
        expect(screen.getByText(target.name)).toBeTruthy();
        // A different card's name should no longer be present, unless it
        // happens to share the query substring (practically never for a
        // distinct card name in the LEA pool).
        const others = cards.filter(
            (c) =>
                c.cardId !== target.cardId &&
                !c.name.toLowerCase().includes(target.name.toLowerCase())
        );
        for (const other of others) {
            expect(screen.queryByText(other.name)).toBeNull();
        }
    });

    it("shows a 'no cards' message for an empty scope (e.g. an unimplemented set)", () => {
        render(
            <PickRatingEditor cards={[]} onSave={vi.fn()} onClear={vi.fn()} />
        );
        expect(screen.getByText("No cards for this scope yet.")).toBeTruthy();
    });
});

describe("PickRatingEditor — inline edit submits setCardRating (PRD #1296 Slice C, issue #1300)", () => {
    it("submits onSave(cardId, rating) with the typed value, and disables Save while pending", async () => {
        const seeded = findCardWithSeedRating();
        let resolveSave: () => void = () => {};
        const onSave = vi.fn(
            () =>
                new Promise<void>((resolve) => {
                    resolveSave = resolve;
                })
        );
        render(
            <PickRatingEditor
                cards={[seeded]}
                onSave={onSave}
                onClear={vi.fn()}
            />
        );

        const input = screen.getByLabelText(`Rating for ${seeded.name}`);
        fireEvent.change(input, { target: { value: "3.5" } });
        fireEvent.click(screen.getByText("Save"));

        expect(onSave).toHaveBeenCalledWith(seeded.cardId, 3.5);
        await waitFor(() =>
            expect(
                (screen.getByText("Saving…") as HTMLElement).closest("button")
            ).toHaveProperty("disabled", true)
        );

        resolveSave();
        await waitFor(() => expect(screen.getByText("Save")).toBeTruthy());
    });

    it("rejects an out-of-range typed value (Save stays disabled, no submit)", () => {
        const seeded = findCardWithSeedRating();
        const onSave = vi.fn();
        render(
            <PickRatingEditor
                cards={[seeded]}
                onSave={onSave}
                onClear={vi.fn()}
            />
        );
        const input = screen.getByLabelText(`Rating for ${seeded.name}`);
        fireEvent.change(input, { target: { value: "9" } });

        const saveButton = screen.getByText("Save").closest("button")!;
        expect(saveButton.disabled).toBe(true);
        fireEvent.click(saveButton);
        expect(onSave).not.toHaveBeenCalled();
    });

    it("submits onClear(cardId) when Clear is clicked on an overridden card", async () => {
        const seeded = findCardWithSeedRating();
        const override = seeded.seedRating === 1 ? 2 : 1;
        const cards = leaCards({ [seeded.cardId]: override });
        const row = cards.find((c) => c.cardId === seeded.cardId)!;
        const onClear = vi.fn().mockResolvedValue(undefined);

        render(
            <PickRatingEditor
                cards={[row]}
                onSave={vi.fn()}
                onClear={onClear}
            />
        );
        fireEvent.click(screen.getByText("Clear"));
        expect(onClear).toHaveBeenCalledWith(row.cardId);
        // After clearing, the input reverts to the seed rating.
        await waitFor(() => {
            const input = screen.getByLabelText(
                `Rating for ${row.name}`
            ) as HTMLInputElement;
            expect(input.value).toBe(String(row.seedRating));
        });
    });

    it("surfaces a rejected save as an inline error without crashing", async () => {
        const seeded = findCardWithSeedRating();
        const onSave = vi.fn().mockRejectedValue(new Error("Forbidden"));
        render(
            <PickRatingEditor
                cards={[seeded]}
                onSave={onSave}
                onClear={vi.fn()}
            />
        );
        fireEvent.click(screen.getByText("Save"));
        expect(await screen.findByText("Forbidden")).toBeTruthy();
    });
});

// The Vintage Cube scope (ADR 0062) reuses the SAME `listScopeCards` +
// `buildScopeCardRatings` core, no cube-specific branch on the frontend
// either — a regression guard proving the editor renders the cube's pool
// through the identical component path as a set scope.
describe("PickRatingEditor — Vintage Cube scope (ADR 0062, PRD #1296 Slice C)", () => {
    it("renders the cube's real pool cards", () => {
        const cards = listScopeCards(CUBE_SOURCE_KEY);
        expect(cards.length).toBeGreaterThan(0);
        const annotated = buildScopeCardRatings(
            CUBE_SOURCE_KEY,
            cards.slice(0, 5),
            fakeDb({})
        );
        render(
            <PickRatingEditor
                cards={annotated}
                onSave={vi.fn()}
                onClear={vi.fn()}
            />
        );
        for (const card of annotated) {
            expect(screen.getByText(card.name)).toBeTruthy();
        }
    });
});
