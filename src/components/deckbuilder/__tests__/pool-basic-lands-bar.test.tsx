// The Add-Basic bar must always render all five basic land buttons,
// independent of Pool contents (issue #1576) — a Vintage Cube Pool has no
// basics at all, yet the bar must still offer every subtype.
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

describe("PoolBasicLandsBar (issue #1576: always render all five basics)", () => {
    it("renders all five buttons even when every subtype resolves to null (never renders null)", () => {
        const onAdd = vi.fn();
        const { container, getByText } = render(
            <PoolBasicLandsBar
                cardIdsBySubtype={idsFor({
                    Plains: null,
                    Island: null,
                    Swamp: null,
                    Mountain: null,
                    Forest: null,
                })}
                onAdd={onAdd}
                disabled={false}
            />
        );
        expect(container.firstChild).not.toBeNull();
        for (const subtype of BASIC_LAND_SUBTYPES) {
            expect(getByText(`+ ${subtype}`)).toBeTruthy();
        }
    });

    it("renders all five buttons for a fully-resolved (pool or catalogue) set and clicking calls onAdd with the resolved cardId", () => {
        const onAdd = vi.fn();
        const { getByText } = render(
            <PoolBasicLandsBar
                cardIdsBySubtype={idsFor()}
                onAdd={onAdd}
                disabled={false}
            />
        );
        for (const subtype of BASIC_LAND_SUBTYPES) {
            expect(getByText(`+ ${subtype}`)).toBeTruthy();
        }
        fireEvent.click(getByText("+ Mountain"));
        expect(onAdd).toHaveBeenCalledWith("mountain-id", "Mountain");
    });

    it("disables a button whose subtype resolved to null but still renders it", () => {
        const onAdd = vi.fn();
        const { getByText } = render(
            <PoolBasicLandsBar
                cardIdsBySubtype={idsFor({ Swamp: null })}
                onAdd={onAdd}
                disabled={false}
            />
        );
        const swampButton = getByText("+ Swamp").closest(
            "button"
        ) as HTMLButtonElement;
        expect(swampButton.disabled).toBe(true);
        fireEvent.click(swampButton);
        expect(onAdd).not.toHaveBeenCalled();
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
                onAdd={vi.fn()}
                disabled={false}
            />
        );
        const root = container.firstElementChild as HTMLElement;
        expect(root.className.split(/\s+/)).toContain("short-viewport:py-0.5");
    });

    // Issue #2056 defect 3 amplification: the bar's own padding alone
    // (`short-viewport:py-0.5`, asserted above) wasn't enough — measured at
    // ~35px against a ~28px target — because `size="sm"` buttons carry their
    // OWN padding independent of the bar's. This pins that the buttons
    // themselves shrink under short-viewport too.
    it("shrinks each Add-Basic button's own padding under short-viewport", () => {
        const { getByText } = render(
            <PoolBasicLandsBar
                cardIdsBySubtype={idsFor()}
                onAdd={vi.fn()}
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
