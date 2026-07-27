// Card Profile Admin editor surface (PRD #1607, ADR 0072, issue #1614).
// Drives the editor through the REAL query-projection pure functions
// (`listScopeCards` + `buildScopeCardProfiles` over the real checked-in
// census) rather than a hand-built `ScopeCardProfile` stub — the same
// discipline `pick-rating-editor.test.tsx` states: a synthetic view can't
// catch a field the projection drops.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
    buildCardProfileRow,
    buildDbProfileLookup,
    buildScopeCardProfiles,
    type GetDbProfile,
} from "@convex/limited/cardProfilesCore";
import { listScopeCards } from "@convex/limited/cardRatingsCore";
import { CUBE_SOURCE_KEY } from "@convex/limited/cube";
import { CAPABILITY_REGISTRY } from "@convex/limited/capabilityRegistry";
import { tryGetCardByName } from "@convex/cards";
import CardProfileEditor from "../card-profile-editor";
import type { ScopeCardProfile } from "~/hooks/useCardProfiles";

const SAMPLE = [
    "Worldspine Wurm",
    "Griselbrand",
    "Reanimate",
    "Lightning Bolt",
] as const;

function cardId(name: string): string {
    const def = tryGetCardByName(name);
    if (!def) throw new Error(`test fixture: no card named "${name}"`);
    return def.id;
}

/** A handful of real cube cards, projected through the REAL editor-query
 *  core against the REAL census seed. `getDbProfile` layers whatever
 *  database overrides the test wants on top. */
function cubeRows(getDbProfile: GetDbProfile = () => null): ScopeCardProfile[] {
    const wanted = new Set<string>(SAMPLE.map(cardId));
    const cards = listScopeCards(CUBE_SOURCE_KEY).filter((card) =>
        wanted.has(card.cardId)
    );
    return buildScopeCardProfiles(CUBE_SOURCE_KEY, cards, getDbProfile).sort(
        (a, b) => a.name.localeCompare(b.name)
    );
}

describe("CardProfileEditor (issue #1614)", () => {
    it("renders a loading state while the query is in flight", () => {
        render(
            <CardProfileEditor
                cards={undefined}
                onSave={vi.fn()}
                onClear={vi.fn()}
            />
        );
        expect(screen.getByText("Loading…")).toBeTruthy();
    });

    it("shows the census seed as the effective profile, flagged Unreviewed", () => {
        render(
            <CardProfileEditor
                cards={cubeRows()}
                onSave={vi.fn()}
                onClear={vi.fn()}
            />
        );
        expect(screen.getByText("Worldspine Wurm")).toBeTruthy();
        // Every census row lands unreviewed — the reviewer's whole queue.
        expect(screen.getAllByText("Unreviewed").length).toBe(SAMPLE.length);
        expect(screen.getAllByText(/Census seed/).length).toBe(SAMPLE.length);
    });

    it("surfaces the census verdict per card — Worldspine Wurm's value-on-death, and no reanimatable", () => {
        render(
            <CardProfileEditor
                cards={cubeRows()}
                onSave={vi.fn()}
                onClear={vi.fn()}
            />
        );
        const summary = screen.getByText(/provides: value-on-death/);
        expect(summary.textContent).not.toContain("reanimatable");
    });

    it("'Only unreviewed' hides a row an Admin has already reviewed", () => {
        const reviewedRow = buildCardProfileRow(
            CUBE_SOURCE_KEY,
            cardId("Griselbrand"),
            {
                archetypes: ["reanimator"],
                provides: ["reanimatable"],
                requires: [],
                reviewed: true,
            }
        );
        render(
            <CardProfileEditor
                cards={cubeRows(buildDbProfileLookup([reviewedRow]))}
                onSave={vi.fn()}
                onClear={vi.fn()}
            />
        );
        expect(screen.getByText("Griselbrand")).toBeTruthy();
        fireEvent.click(screen.getByLabelText("Only unreviewed"));
        expect(screen.queryByText("Griselbrand")).toBeNull();
        expect(screen.getByText("Worldspine Wurm")).toBeTruthy();
    });

    it("filters by card name", () => {
        render(
            <CardProfileEditor
                cards={cubeRows()}
                onSave={vi.fn()}
                onClear={vi.fn()}
            />
        );
        fireEvent.change(screen.getByLabelText("Search cards"), {
            target: { value: "grisel" },
        });
        expect(screen.getByText("Griselbrand")).toBeTruthy();
        expect(screen.queryByText("Reanimate")).toBeNull();
    });

    it("only offers Capability names from the closed registry", () => {
        render(
            <CardProfileEditor
                cards={cubeRows()}
                onSave={vi.fn()}
                onClear={vi.fn()}
            />
        );
        fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
        for (const row of CAPABILITY_REGISTRY) {
            expect(
                screen.getByLabelText(`Provides ${row.id}`),
                row.id
            ).toBeTruthy();
            expect(
                screen.getByLabelText(`Requires ${row.id}`),
                row.id
            ).toBeTruthy();
        }
    });

    it("saves an Admin's correction — archetypes, Capabilities and the review flag", async () => {
        const onSave = vi.fn().mockResolvedValue(null);
        render(
            <CardProfileEditor
                cards={cubeRows()}
                onSave={onSave}
                onClear={vi.fn()}
            />
        );
        // Rows are name-sorted; Griselbrand is the first of the four.
        fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
        fireEvent.change(screen.getByLabelText("Archetypes for Griselbrand"), {
            target: { value: "reanimator, control" },
        });
        fireEvent.click(screen.getByLabelText("Requires value-on-etb"));
        fireEvent.click(screen.getByLabelText("Reviewed for Griselbrand"));
        fireEvent.click(screen.getByRole("button", { name: "Save" }));

        await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
        expect(onSave).toHaveBeenCalledWith(cardId("Griselbrand"), {
            archetypes: ["reanimator", "control"],
            provides: ["reanimatable"],
            requires: ["value-on-etb"],
            comboEdges: undefined,
            reviewed: true,
        });
    });

    it("Clear is disabled until there is a database override to clear", () => {
        const override = buildCardProfileRow(
            CUBE_SOURCE_KEY,
            cardId("Griselbrand"),
            {
                archetypes: [],
                provides: [],
                requires: [],
                reviewed: true,
            }
        );
        const { rerender } = render(
            <CardProfileEditor
                cards={cubeRows()}
                onSave={vi.fn()}
                onClear={vi.fn()}
            />
        );
        fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
        expect(
            screen
                .getByRole("button", { name: "Clear" })
                .hasAttribute("disabled")
        ).toBe(true);

        rerender(
            <CardProfileEditor
                cards={cubeRows(buildDbProfileLookup([override]))}
                onSave={vi.fn()}
                onClear={vi.fn()}
            />
        );
        expect(
            screen
                .getByRole("button", { name: "Clear" })
                .hasAttribute("disabled")
        ).toBe(false);
    });
});
