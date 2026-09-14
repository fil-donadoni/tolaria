// Card Profile Admin editor surface (PRD #1607, ADR 0072, issues #1614 and
// #3597). Drives the editor through the REAL query-projection pure functions
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
import { ARCHETYPE_REGISTRY } from "@convex/limited/archetypeRegistry";
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
        fireEvent.click(
            screen.getByLabelText("Archetype control for Griselbrand")
        );
        fireEvent.click(screen.getByLabelText("Requires value-on-etb"));
        fireEvent.click(screen.getByLabelText("Reviewed for Griselbrand"));
        fireEvent.click(screen.getByRole("button", { name: "Save" }));

        await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
        expect(onSave).toHaveBeenCalledWith(cardId("Griselbrand"), {
            // The census seeds Griselbrand `["reanimator"]`; the click adds
            // `control` to it rather than replacing a typed string.
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

describe("CardProfileEditor — shaped for the review pass (issue #3597)", () => {
    it("only offers Archetype names from the closed registry — no free-text field", () => {
        render(
            <CardProfileEditor
                cards={cubeRows()}
                onSave={vi.fn()}
                onClear={vi.fn()}
            />
        );
        fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
        for (const row of ARCHETYPE_REGISTRY) {
            expect(
                screen.getByLabelText(`Archetype ${row.id} for Griselbrand`),
                row.id
            ).toBeTruthy();
        }
        // The comma-separated text field this editor shipped with is the one
        // control that could mint vocabulary by typing. It must be gone, not
        // merely supplemented.
        expect(
            screen.queryByLabelText("Archetypes for Griselbrand")
        ).toBeNull();
    });

    it("shows progress against the scope, counting the WHOLE scope, not the filtered view", () => {
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
        const bar = screen.getByRole("progressbar", {
            name: "Card Profiles reviewed",
        });
        expect(bar.getAttribute("aria-valuenow")).toBe("1");
        expect(bar.getAttribute("aria-valuemax")).toBe(String(SAMPLE.length));
        expect(screen.getByText(/1 of 4 reviewed/)).toBeTruthy();

        // Hiding the done rows must not move the denominator — that is the
        // whole point of measuring the scope rather than the list.
        fireEvent.click(screen.getByLabelText("Only unreviewed"));
        expect(
            screen
                .getByRole("progressbar", { name: "Card Profiles reviewed" })
                .getAttribute("aria-valuemax")
        ).toBe(String(SAMPLE.length));
        expect(screen.getByText(/1 of 4 reviewed/)).toBeTruthy();
    });

    it("shows each card's art, and its rules text once the row is open", () => {
        const { container } = render(
            <CardProfileEditor
                cards={cubeRows()}
                onSave={vi.fn()}
                onClear={vi.fn()}
            />
        );
        // One art slot per row, addressed by cardId — happy-dom has no layout
        // so the `<img>` inside is not asserted here; `bun run check:ui` is
        // what measures whether it actually paints.
        expect(
            container.querySelectorAll("[data-card-profile-art]").length
        ).toBe(SAMPLE.length);
        expect(
            container.querySelector(
                `[data-card-profile-art="${cardId("Griselbrand")}"]`
            )
        ).toBeTruthy();

        // Rules text is behind the expansion, where the judgement is made.
        expect(screen.queryByText(/Pay 7 life/)).toBeNull();
        fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
        expect(screen.getByText(/Pay 7 life/)).toBeTruthy();
    });

    it("states the provides/requires distinction, and that an empty Requires is normal", () => {
        render(
            <CardProfileEditor
                cards={cubeRows()}
                onSave={vi.fn()}
                onClear={vi.fn()}
            />
        );
        expect(
            screen.getByText(/what this card OFFERS a partner/)
        ).toBeTruthy();
        expect(screen.getByText(/what it NEEDS from one/)).toBeTruthy();
        expect(screen.getByText(/An empty Requires is the norm/)).toBeTruthy();
    });

    it("'Mark reviewed & next' saves the row reviewed and opens the following card", async () => {
        const onSave = vi.fn().mockResolvedValue(null);
        render(
            <CardProfileEditor
                cards={cubeRows()}
                onSave={onSave}
                onClear={vi.fn()}
            />
        );
        fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
        expect(
            screen.getByRole("group", { name: "Profile for Griselbrand" })
        ).toBeTruthy();

        fireEvent.click(
            screen.getByRole("button", { name: "Mark reviewed & next" })
        );
        await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
        expect(onSave.mock.calls[0][0]).toBe(cardId("Griselbrand"));
        expect(onSave.mock.calls[0][1].reviewed).toBe(true);

        // Name-sorted queue: Lightning Bolt is next, and it is now the open
        // row — the pass never has to point at anything.
        await waitFor(() =>
            expect(
                screen.getByRole("group", {
                    name: "Profile for Lightning Bolt",
                })
            ).toBeTruthy()
        );
        expect(
            screen.queryByRole("group", { name: "Profile for Griselbrand" })
        ).toBeNull();
    });

    it("⌘/Ctrl+Enter inside an open row does the same thing from the keyboard", async () => {
        const onSave = vi.fn().mockResolvedValue(null);
        render(
            <CardProfileEditor
                cards={cubeRows()}
                onSave={onSave}
                onClear={vi.fn()}
            />
        );
        fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
        fireEvent.keyDown(
            screen.getByRole("group", { name: "Profile for Griselbrand" }),
            { key: "Enter", metaKey: true }
        );
        await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
        expect(onSave.mock.calls[0][1].reviewed).toBe(true);
        await waitFor(() =>
            expect(
                screen.getByRole("group", {
                    name: "Profile for Lightning Bolt",
                })
            ).toBeTruthy()
        );
    });

    it("a REJECTED save leaves the reviewer on the card, with the error", async () => {
        const onSave = vi.fn().mockRejectedValue(new Error("nope"));
        render(
            <CardProfileEditor
                cards={cubeRows()}
                onSave={onSave}
                onClear={vi.fn()}
            />
        );
        fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
        fireEvent.click(
            screen.getByRole("button", { name: "Mark reviewed & next" })
        );
        await waitFor(() => expect(screen.getByText("nope")).toBeTruthy());
        expect(
            screen.getByRole("group", { name: "Profile for Griselbrand" })
        ).toBeTruthy();
        expect(
            screen.queryByRole("group", { name: "Profile for Lightning Bolt" })
        ).toBeNull();
    });

    it("is a single-open accordion — opening one row closes the other", () => {
        render(
            <CardProfileEditor
                cards={cubeRows()}
                onSave={vi.fn()}
                onClear={vi.fn()}
            />
        );
        const editButtons = screen.getAllByRole("button", { name: "Edit" });
        fireEvent.click(editButtons[0]);
        expect(
            screen.getByRole("group", { name: "Profile for Griselbrand" })
        ).toBeTruthy();
        fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
        expect(
            screen.getByRole("group", { name: "Profile for Lightning Bolt" })
        ).toBeTruthy();
        expect(
            screen.queryByRole("group", { name: "Profile for Griselbrand" })
        ).toBeNull();
    });
});
