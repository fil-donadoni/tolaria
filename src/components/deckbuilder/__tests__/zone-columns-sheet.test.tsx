// The Zone-level `Columns` sheet on coarse-pointer surfaces (issue #3677,
// ADR 0101 §2, ADR 0075 §2). Mounted through the real `DeckZoneSurface` —
// the trigger, the sheet and the Column Layout engine's verdicts
// (`canDeleteColumn`) are all real; only the surface class is driven.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, screen, within } from "@testing-library/react";
import { DragDropProvider } from "@dnd-kit/react";
import {
    addManualColumn,
    createColumnLayout,
    type ColumnLayout,
} from "@convex/deckLayout";
import type { SurfaceClass } from "~/hooks/useSurfaceClass";
import { COLUMN_DELETE_BLOCKED_REASON } from "../deck-column-actions";
import DeckZoneSurface, {
    type DeckZoneSurfaceProps,
} from "../deck-zone-surface";

const h = vi.hoisted(() => ({ surface: "roomy-fine" as SurfaceClass }));
vi.mock("~/hooks/useSurfaceClass", () => ({
    useSurfaceClass: () => h.surface,
}));

const BOLT = {
    cardId: "d573ef03-4730-45aa-93dd-e45ac1dbaf4a",
    cardName: "Lightning Bolt",
}; // MV 1, red instant (not a creature)

const withRemoval = (): ColumnLayout =>
    addManualColumn(createColumnLayout(), {
        id: "custom:removal",
        label: "Removal",
    });

function renderZone(props: Partial<DeckZoneSurfaceProps> = {}) {
    const handlers = {
        onAddColumn: vi.fn(),
        onRenameColumn: vi.fn(),
        onDeleteColumn: vi.fn(),
    };
    const base: DeckZoneSurfaceProps = {
        zone: "maindeck",
        title: "Maindeck",
        cards: [BOLT],
        layout: withRemoval(),
        onGroupingChange: () => {},
        onOrderingChange: () => {},
        dropModel: "columns",
        onCardClick: () => {},
        cardTitle: (card) => `Remove ${card.cardName} (drag to move zone)`,
        emptyMessage: "empty",
        ...handlers,
    };
    return {
        handlers,
        ...render(
            <DragDropProvider>
                <DeckZoneSurface {...base} {...props} />
            </DragDropProvider>
        ),
    };
}

const openSheet = () =>
    fireEvent.click(
        screen.getByRole("button", { name: "Manage Maindeck columns" })
    );
const sheet = () => screen.getByRole("dialog", { name: "Maindeck columns" });
const rowOf = (label: string) => {
    const row = within(sheet())
        .getAllByRole("listitem")
        .find((li) => within(li).queryByText(label) !== null);
    expect(row, `no row ${label}`).toBeTruthy();
    return row!;
};

beforeEach(() => {
    h.surface = "roomy-fine";
});

describe("DeckZoneSurface — Columns sheet (issue #3677)", () => {
    for (const surface of ["phone", "roomy-coarse"] as const) {
        describe(surface, () => {
            beforeEach(() => {
                h.surface = surface;
            });

            it("renders no Column-header glyph and no inline add control — one Columns trigger instead", () => {
                renderZone();
                expect(screen.queryByLabelText(/^Rename column/)).toBeNull();
                expect(screen.queryByLabelText(/^Delete column/)).toBeNull();
                expect(
                    screen.queryByLabelText(/^Cannot delete column/)
                ).toBeNull();
                expect(
                    screen.queryByLabelText("Add Maindeck column")
                ).toBeNull();
                const trigger = screen.getByRole("button", {
                    name: "Manage Maindeck columns",
                });
                expect(trigger.style.minHeight).toBe("var(--control-h)");
            });

            it("lists every managed Column with its count, never the Catch-All", () => {
                renderZone();
                openSheet();
                const rows = within(sheet()).getAllByRole("listitem");
                const labels = rows.map(
                    (li) => li.querySelector("span")!.textContent
                );
                expect(labels).toContain("MV 1");
                expect(labels).toContain("Removal");
                expect(labels).not.toContain("Catch-All");
                expect(within(rowOf("MV 1")).getByText("1")).toBeTruthy();
            });

            it("renames a manual Column through the same onRenameColumn seam on form submit", () => {
                const { handlers } = renderZone();
                openSheet();
                fireEvent.click(
                    within(rowOf("Removal")).getByLabelText(
                        "Rename column Removal"
                    )
                );
                const input = screen.getByLabelText("Rename column Removal");
                fireEvent.change(input, { target: { value: "Burn" } });
                fireEvent.submit(input.closest("form")!);
                expect(handlers.onRenameColumn).toHaveBeenCalledWith(
                    "custom:removal",
                    "Burn"
                );
            });

            it("only a manual Column offers Rename", () => {
                renderZone();
                openSheet();
                expect(
                    within(rowOf("MV 1")).queryByLabelText("Rename column MV 1")
                ).toBeNull();
            });

            it("Escape cancels a rename, restores the label and keeps the sheet open", () => {
                const { handlers } = renderZone();
                openSheet();
                fireEvent.click(
                    within(rowOf("Removal")).getByLabelText(
                        "Rename column Removal"
                    )
                );
                const input = screen.getByLabelText("Rename column Removal");
                fireEvent.change(input, { target: { value: "Burn" } });
                fireEvent.keyDown(input, { key: "Escape" });
                expect(handlers.onRenameColumn).not.toHaveBeenCalled();
                expect(sheet()).toBeTruthy();
                expect(
                    within(rowOf("Removal")).getByText("Removal")
                ).toBeTruthy();
            });

            it("deletes an empty Column through onDeleteColumn", () => {
                const { handlers } = renderZone();
                openSheet();
                fireEvent.click(
                    within(rowOf("Removal")).getByLabelText(
                        "Delete column Removal"
                    )
                );
                expect(handlers.onDeleteColumn).toHaveBeenCalledWith(
                    "custom:removal"
                );
            });

            it("disables Delete on a non-empty Column and shows the reason as visible text", () => {
                const { handlers } = renderZone();
                openSheet();
                const row = rowOf("MV 1");
                const del = within(row).getByLabelText(
                    "Delete column MV 1"
                ) as HTMLButtonElement;
                expect(del.disabled).toBe(true);
                expect(
                    within(row).getByText(COLUMN_DELETE_BLOCKED_REASON)
                ).toBeTruthy();
                fireEvent.click(del);
                expect(handlers.onDeleteColumn).not.toHaveBeenCalled();
                // An empty Column shows no reason.
                expect(
                    within(rowOf("Removal")).queryByText(
                        COLUMN_DELETE_BLOCKED_REASON
                    )
                ).toBeNull();
            });

            it("a Zone filter hiding a Column's cards does not enable its Delete", () => {
                renderZone();
                fireEvent.click(
                    screen.getByRole("button", { name: "Creatures" })
                );
                openSheet();
                expect(
                    (
                        within(rowOf("MV 1")).getByLabelText(
                            "Delete column MV 1"
                        ) as HTMLButtonElement
                    ).disabled
                ).toBe(true);
            });

            it("adds a Column from the footer through onAddColumn with the RAW label", () => {
                const { handlers } = renderZone();
                openSheet();
                const input = screen.getByLabelText("New Maindeck column name");
                fireEvent.change(input, { target: { value: "  Tempo " } });
                fireEvent.click(
                    screen.getByLabelText("Create Maindeck column")
                );
                expect(handlers.onAddColumn).toHaveBeenCalledWith("  Tempo ");
                expect((input as HTMLInputElement).value).toBe("");
            });

            it("renders no trigger when the Zone supplies no column handler (preset deck, draft Pool)", () => {
                renderZone({
                    onAddColumn: undefined,
                    onRenameColumn: undefined,
                    onDeleteColumn: undefined,
                });
                expect(
                    screen.queryByRole("button", { name: /columns$/ })
                ).toBeNull();
            });
        });
    }

    describe("roomy-fine", () => {
        it("keeps the glyphs and the inline add control, and has no Columns trigger", () => {
            const { handlers } = renderZone();
            expect(
                screen.queryByRole("button", {
                    name: "Manage Maindeck columns",
                })
            ).toBeNull();
            fireEvent.click(screen.getByLabelText("Delete column Removal"));
            expect(handlers.onDeleteColumn).toHaveBeenCalledWith(
                "custom:removal"
            );
            expect(screen.getByLabelText("Add Maindeck column")).toBeTruthy();
        });
    });
});
