// The Booster grid's order (issue #5936): rarest first, name as tie-break —
// and a click still targets the card's own `pickId`, never its position.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import type { LimitedEventSeatView } from "~/hooks/useLimitedEvent";
import LimitedDraftPack from "../limited-draft-pack";

type PackCard = NonNullable<LimitedEventSeatView["currentPack"]>[number];

afterEach(cleanup);

const card = (
    cardName: string,
    pickId: string,
    rarity?: PackCard["rarity"]
): PackCard => ({
    scryfallId: `sf-${pickId}`,
    cardId: `id-${pickId}`,
    cardName,
    pickId,
    ...(rarity ? { rarity } : {}),
});

function renderPack(pack: PackCard[], onSelect = vi.fn()) {
    const view = render(
        <LimitedDraftPack
            pack={pack}
            selectedPickId={null}
            defaultPickId={null}
            onSelect={onSelect}
            pending={false}
        />
    );
    const names = () =>
        view
            .getAllByRole("button", { name: /Draft pick/ })
            .map((b) =>
                b.getAttribute("aria-label")!.replace("Draft pick: ", "")
            );
    return { ...view, names, onSelect };
}

describe("LimitedDraftPack order", () => {
    it("lists mythic, rare, uncommon, common, unresolved last", () => {
        const { names } = renderPack([
            card("Unknown", "p0"),
            card("Common", "p1", "common"),
            card("Mythic", "p2", "mythic"),
            card("Uncommon", "p3", "uncommon"),
            card("Rare", "p4", "rare"),
        ]);
        expect(names()).toEqual([
            "Mythic",
            "Rare",
            "Uncommon",
            "Common",
            "Unknown",
        ]);
    });

    it("keeps name order inside one rarity", () => {
        const { names } = renderPack([
            card("Zap", "p0", "common"),
            card("Ankh", "p1", "common"),
        ]);
        expect(names()).toEqual(["Ankh", "Zap"]);
    });

    it("selects by pickId after the re-sort", () => {
        const { getByRole, onSelect } = renderPack([
            card("Common", "p0", "common"),
            card("Mythic", "p1", "mythic"),
        ]);
        fireEvent.click(getByRole("button", { name: /Draft pick: Common/ }));
        expect(onSelect).toHaveBeenCalledWith("p0");
    });
});
