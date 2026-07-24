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
