// The Add-Basic bar must always render all five basic land buttons,
// independent of Pool contents (issue #1576) — a Vintage Cube Pool has no
// basics at all, yet the bar must still offer every subtype. Issue #1627
// generalises the bar to both builders and adds the per-subtype Maindeck
// counter, the shift-click/right-click/`−`-button remove gesture (floored at
// zero, visibly unavailable), and the `+5` step.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import PoolBasicLandsBar from "../pool-basic-lands-bar";
import { BASIC_LAND_SUBTYPES, type BasicLandSubtype } from "../basicLands";

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

function idsFor(
    overrides: Partial<Record<BasicLandSubtype, string | null>> = {}
): Record<BasicLandSubtype, string | null> {
    return {
        Plains: "plains-id",
        Island: "island-id",
        Swamp: "swamp-id",
        Mountain: "mountain-id",
        Forest: "forest-id",
        ...overrides,
    };
}

function countsFor(
    overrides: Partial<Record<BasicLandSubtype, number>> = {}
): Record<BasicLandSubtype, number> {
    return {
        Plains: 0,
        Island: 0,
        Swamp: 0,
        Mountain: 0,
        Forest: 0,
        ...overrides,
    };
}

describe("PoolBasicLandsBar (issue #1576: always render all five basics)", () => {
    it("renders all five buttons even when every subtype resolves to null (never renders null)", () => {
        const onAdd = vi.fn();
        const onRemove = vi.fn();
        const { container, getByText } = render(
            <PoolBasicLandsBar
                cardIdsBySubtype={idsFor({
                    Plains: null,
                    Island: null,
                    Swamp: null,
                    Mountain: null,
                    Forest: null,
                })}
                counts={countsFor()}
                onAdd={onAdd}
                onRemove={onRemove}
                allowedSets={null}
                onPickArt={vi.fn()}
                disabled={false}
            />
        );
        expect(container.firstChild).not.toBeNull();
        for (const subtype of BASIC_LAND_SUBTYPES) {
            expect(getByText(`+ ${subtype}`)).toBeTruthy();
        }
    });

    it("renders all five buttons for a fully-resolved (pool or catalogue) set and clicking calls onAdd with the resolved cardId and count 1", () => {
        const onAdd = vi.fn();
        const { getByText } = render(
            <PoolBasicLandsBar
                cardIdsBySubtype={idsFor()}
                counts={countsFor()}
                onAdd={onAdd}
                onRemove={vi.fn()}
                allowedSets={null}
                onPickArt={vi.fn()}
                disabled={false}
            />
        );
        for (const subtype of BASIC_LAND_SUBTYPES) {
            expect(getByText(`+ ${subtype}`)).toBeTruthy();
        }
        fireEvent.click(getByText("+ Mountain"));
        expect(onAdd).toHaveBeenCalledWith("mountain-id", "Mountain", 1);
    });

    it("disables the add pill and the +5 button for a subtype that resolved to null, but still renders them", () => {
        const onAdd = vi.fn();
        const { getByText, getByLabelText } = render(
            <PoolBasicLandsBar
                cardIdsBySubtype={idsFor({ Swamp: null })}
                counts={countsFor()}
                onAdd={onAdd}
                onRemove={vi.fn()}
                allowedSets={null}
                onPickArt={vi.fn()}
                disabled={false}
            />
        );
        const swampButton = getByText("+ Swamp").closest(
            "button"
        ) as HTMLButtonElement;
        expect(swampButton.disabled).toBe(true);
        fireEvent.click(swampButton);
        expect(onAdd).not.toHaveBeenCalled();

        const swampFive = getByLabelText("Add five Swamp") as HTMLButtonElement;
        expect(swampFive.disabled).toBe(true);
    });

    // The add controls need a resolved cardId (there is nothing to append
    // without one); the remove control does not — the copies are already in
    // the Maindeck and are named by SUBTYPE (PR #2320 review B1). Gating
    // removal on the add's id is how a Maindeck can hold copies nobody can
    // take out.
    it("still offers REMOVE for a subtype that resolved to null while the Maindeck holds copies of it", () => {
        const onRemove = vi.fn();
        const { getByLabelText } = render(
            <PoolBasicLandsBar
                cardIdsBySubtype={idsFor({ Swamp: null })}
                counts={countsFor({ Swamp: 2 })}
                onAdd={vi.fn()}
                onRemove={onRemove}
                allowedSets={null}
                onPickArt={vi.fn()}
                disabled={false}
            />
        );
        const minus = getByLabelText("Remove one Swamp") as HTMLButtonElement;
        expect(minus.disabled).toBe(false);
        fireEvent.click(minus);
        expect(onRemove).toHaveBeenCalledWith("Swamp");
    });
});

describe("PoolBasicLandsBar — per-subtype Maindeck counter (issue #1627)", () => {
    it("shows the passed-in count for each subtype", () => {
        const { getByTestId } = render(
            <PoolBasicLandsBar
                cardIdsBySubtype={idsFor()}
                counts={countsFor({ Mountain: 4, Forest: 1 })}
                onAdd={vi.fn()}
                onRemove={vi.fn()}
                allowedSets={null}
                onPickArt={vi.fn()}
                disabled={false}
            />
        );
        expect(getByTestId("basic-count-Mountain").textContent).toBe("4");
        expect(getByTestId("basic-count-Forest").textContent).toBe("1");
        expect(getByTestId("basic-count-Plains").textContent).toBe("0");
    });
});

describe("PoolBasicLandsBar — add (issue #1627)", () => {
    it("a plain click on the pill adds exactly one copy", () => {
        const onAdd = vi.fn();
        const { getByText } = render(
            <PoolBasicLandsBar
                cardIdsBySubtype={idsFor()}
                counts={countsFor({ Island: 2 })}
                onAdd={onAdd}
                onRemove={vi.fn()}
                allowedSets={null}
                onPickArt={vi.fn()}
                disabled={false}
            />
        );
        fireEvent.click(getByText("+ Island"));
        expect(onAdd).toHaveBeenCalledTimes(1);
        expect(onAdd).toHaveBeenCalledWith("island-id", "Island", 1);
    });

    it("the +5 button adds five copies in one action", () => {
        const onAdd = vi.fn();
        const { getByLabelText } = render(
            <PoolBasicLandsBar
                cardIdsBySubtype={idsFor()}
                counts={countsFor()}
                onAdd={onAdd}
                onRemove={vi.fn()}
                allowedSets={null}
                onPickArt={vi.fn()}
                disabled={false}
            />
        );
        fireEvent.click(getByLabelText("Add five Mountain"));
        expect(onAdd).toHaveBeenCalledTimes(1);
        expect(onAdd).toHaveBeenCalledWith("mountain-id", "Mountain", 5);
    });
});

describe("PoolBasicLandsBar — remove, floored at zero and visibly unavailable (issue #1627)", () => {
    it("shift-click on the pill removes one copy instead of adding", () => {
        const onAdd = vi.fn();
        const onRemove = vi.fn();
        const { getByText } = render(
            <PoolBasicLandsBar
                cardIdsBySubtype={idsFor()}
                counts={countsFor({ Swamp: 3 })}
                onAdd={onAdd}
                onRemove={onRemove}
                allowedSets={null}
                onPickArt={vi.fn()}
                disabled={false}
            />
        );
        fireEvent.click(getByText("+ Swamp"), { shiftKey: true });
        expect(onRemove).toHaveBeenCalledWith("Swamp");
        expect(onAdd).not.toHaveBeenCalled();
    });

    it("right-click (contextmenu) on the pill removes one copy and suppresses the native menu", () => {
        const onRemove = vi.fn();
        const { getByText } = render(
            <PoolBasicLandsBar
                cardIdsBySubtype={idsFor()}
                counts={countsFor({ Forest: 2 })}
                onAdd={vi.fn()}
                onRemove={onRemove}
                allowedSets={null}
                onPickArt={vi.fn()}
                disabled={false}
            />
        );
        const event = fireEvent.contextMenu(getByText("+ Forest"));
        expect(onRemove).toHaveBeenCalledWith("Forest");
        // fireEvent returns `false` when the dispatched event's default was
        // prevented — the native context menu must never appear.
        expect(event).toBe(false);
    });

    it("the dedicated − button removes one copy on click", () => {
        const onRemove = vi.fn();
        const { getByLabelText } = render(
            <PoolBasicLandsBar
                cardIdsBySubtype={idsFor()}
                counts={countsFor({ Plains: 2 })}
                onAdd={vi.fn()}
                onRemove={onRemove}
                allowedSets={null}
                onPickArt={vi.fn()}
                disabled={false}
            />
        );
        fireEvent.click(getByLabelText("Remove one Plains"));
        expect(onRemove).toHaveBeenCalledWith("Plains");
    });

    it("at zero copies the − button is disabled (visibly unavailable) and a click is a no-op", () => {
        const onRemove = vi.fn();
        const { getByLabelText } = render(
            <PoolBasicLandsBar
                cardIdsBySubtype={idsFor()}
                counts={countsFor({ Plains: 0 })}
                onAdd={vi.fn()}
                onRemove={onRemove}
                allowedSets={null}
                onPickArt={vi.fn()}
                disabled={false}
            />
        );
        const minus = getByLabelText("Remove one Plains") as HTMLButtonElement;
        expect(minus.disabled).toBe(true);
        fireEvent.click(minus);
        expect(onRemove).not.toHaveBeenCalled();
    });

    it("at zero copies shift-click and right-click on the pill are also no-ops", () => {
        const onAdd = vi.fn();
        const onRemove = vi.fn();
        const { getByText } = render(
            <PoolBasicLandsBar
                cardIdsBySubtype={idsFor()}
                counts={countsFor({ Island: 0 })}
                onAdd={onAdd}
                onRemove={onRemove}
                allowedSets={null}
                onPickArt={vi.fn()}
                disabled={false}
            />
        );
        fireEvent.click(getByText("+ Island"), { shiftKey: true });
        fireEvent.contextMenu(getByText("+ Island"));
        expect(onRemove).not.toHaveBeenCalled();
        // Neither gesture is a disguised add either.
        expect(onAdd).not.toHaveBeenCalled();
    });
});

describe("PoolBasicLandsBar — disabled while a save is in flight (project-wide in-flight-mutation rule)", () => {
    it("disables every add/remove control, including a subtype with copies already in the Maindeck", () => {
        const { getByText, getByLabelText } = render(
            <PoolBasicLandsBar
                cardIdsBySubtype={idsFor()}
                counts={countsFor({ Mountain: 3 })}
                onAdd={vi.fn()}
                onRemove={vi.fn()}
                allowedSets={null}
                onPickArt={vi.fn()}
                disabled={true}
            />
        );
        expect(
            (getByText("+ Mountain").closest("button") as HTMLButtonElement)
                .disabled
        ).toBe(true);
        expect(
            (getByLabelText("Remove one Mountain") as HTMLButtonElement)
                .disabled
        ).toBe(true);
        expect(
            (getByLabelText("Add five Mountain") as HTMLButtonElement).disabled
        ).toBe(true);
    });
});

// Issue #2056 defect 2: short-viewport chrome treatment — the bar's own
// padding shrinks under `short-viewport:` (`max-height: 500px`) so it stops
// eating a fixed share of an already-scarce landscape-phone viewport.
describe("PoolBasicLandsBar — short-viewport chrome treatment (issue #2056)", () => {
    it("carries a short-viewport padding override on its root", () => {
        const { container } = render(
            <PoolBasicLandsBar
                cardIdsBySubtype={idsFor()}
                counts={countsFor()}
                onAdd={vi.fn()}
                onRemove={vi.fn()}
                allowedSets={null}
                onPickArt={vi.fn()}
                disabled={false}
            />
        );
        const root = container.firstElementChild as HTMLElement;
        expect(root.className.split(/\s+/)).toContain("short-viewport:py-0.5");
    });

    // Issue #2056 defect 3 amplification: the bar's own padding alone
    // (`short-viewport:py-0.5`, asserted above) wasn't enough — measured at
    // ~35px against a ~28px target — because `size="sm"` buttons carry their
    // OWN padding independent of the bar's. This pins that the pill button
    // itself shrinks under short-viewport too.
    it("shrinks the Add-Basic pill's own padding under short-viewport", () => {
        const { getByText } = render(
            <PoolBasicLandsBar
                cardIdsBySubtype={idsFor()}
                counts={countsFor()}
                onAdd={vi.fn()}
                onRemove={vi.fn()}
                allowedSets={null}
                onPickArt={vi.fn()}
                disabled={false}
            />
        );
        const button = getByText("+ Mountain").closest(
            "button"
        ) as HTMLButtonElement;
        const classes = button.className.split(/\s+/);
        expect(classes).toContain("short-viewport:px-1.5");
        expect(classes).toContain("short-viewport:py-0");
    });
});
