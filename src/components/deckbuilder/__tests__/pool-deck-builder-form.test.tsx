// Continuous draft→build seeding tests (ADR 0060, issue #1247): "the
// Arrangement built during the draft carries unchanged into deckbuild."
// Drives `PoolDeckBuilderForm`'s initial working-deck seed for both the
// Sealed path (no Arrangement — the pre-#1247 all-Sideboard default) and the
// Draft path (an Arrangement present, even empty — the continuous
// main-by-default seed via `splitPoolByArrangement`).
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import PoolDeckBuilderForm from "../pool-deck-builder-form";

const navigate = vi.fn();
const createMock = vi.fn().mockResolvedValue("deck-1");
const useMutationMock = vi.fn();

vi.mock("@tanstack/react-router", () => ({
    useNavigate: () => navigate,
}));

vi.mock("convex/react", () => ({
    useMutation: (...args: unknown[]) => useMutationMock(...args),
}));

vi.mock("@convex/_generated/api", () => {
    const apiProxy: unknown = new Proxy({}, { get: () => apiProxy });
    return { api: apiProxy };
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

// Real registry ids — the shared surface groups via the card registry.
const BOLT_ID = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a"; // Lightning Bolt (MV 1)
const PLAINS_ID = "b1623d57-4729-4796-b3f7-f1837a05c6ed"; // Plains (land)

const POOL = [
    { scryfallId: "s1", cardId: BOLT_ID, cardName: "Lightning Bolt" },
    { scryfallId: "s2", cardId: PLAINS_ID, cardName: "Plains" },
];

function setup() {
    // Neither `create` nor `update` fires during initial render — the exact
    // function returned doesn't matter for these seeding assertions.
    useMutationMock.mockReturnValue(createMock);
}

describe("PoolDeckBuilderForm — continuous draft→build seed (ADR 0060, issue #1247)", () => {
    it("Sealed (poolArrangement: null): every Pool card still starts in the Sideboard — the pre-#1247 default, unchanged", () => {
        setup();
        const { getByText } = render(
            <PoolDeckBuilderForm
                eventId={"event-1" as never}
                seatIndex={0}
                pool={POOL}
                existingDeck={null}
                poolArrangement={null}
            />
        );
        expect(getByText(/^Maindeck 0/)).toBeTruthy();
        expect(getByText(/^Pool \(Sideboard\) 2/)).toBeTruthy();
    });

    it("Draft with an untouched (empty) Arrangement: every Pool card is ALREADY in the Maindeck — the continuous 'Pool IS the working deck' seed", () => {
        setup();
        const { getByText } = render(
            <PoolDeckBuilderForm
                eventId={"event-1" as never}
                seatIndex={0}
                pool={POOL}
                existingDeck={null}
                poolArrangement={[]}
            />
        );
        expect(getByText(/^Maindeck 2/)).toBeTruthy();
        expect(getByText(/^Pool \(Sideboard\) 0/)).toBeTruthy();
    });

    it("Draft with a recorded sideboard move: the Arrangement's split carries over exactly", () => {
        setup();
        const { getByText } = render(
            <PoolDeckBuilderForm
                eventId={"event-1" as never}
                seatIndex={0}
                pool={POOL}
                existingDeck={null}
                poolArrangement={[{ poolIndex: 1, sideboard: true }]}
            />
        );
        expect(getByText(/^Maindeck 1/)).toBeTruthy();
        expect(getByText(/^Pool \(Sideboard\) 1/)).toBeTruthy();
    });

    it("an existingDeck always wins regardless of poolArrangement", () => {
        setup();
        const { getByText } = render(
            <PoolDeckBuilderForm
                eventId={"event-1" as never}
                seatIndex={0}
                pool={POOL}
                existingDeck={{
                    kind: "user",
                    userDeckId: "deck-1" as never,
                    presetId: "deck-1",
                    name: "Saved Deck",
                    format: "limited",
                    colors: ["R"],
                    cards: [{ cardId: BOLT_ID, cardName: "Lightning Bolt" }],
                    sideboard: [{ cardId: PLAINS_ID, cardName: "Plains" }],
                    featuredCardId: null,
                    isLegal: true,
                    reasons: [],
                }}
                poolArrangement={[]}
            />
        );
        expect(getByText(/^Maindeck 1/)).toBeTruthy();
        expect(getByText(/^Pool \(Sideboard\) 1/)).toBeTruthy();
    });
});

// All-five-basics-always-offered + autosave wiring (issue #1576).
const MOUNTAIN_ID = "eace2c85-976c-425e-9800-5a6ccbd91b56"; // catalogue Mountain

describe("PoolDeckBuilderForm — Add Basic bar (issue #1576)", () => {
    it("offers all five basics for a Pool with no basics at all (Vintage-Cube-style seat), adds to the Maindeck, and persists through the autosave path", async () => {
        setup();
        const { getByText } = render(
            <PoolDeckBuilderForm
                eventId={"event-1" as never}
                seatIndex={0}
                pool={[
                    { scryfallId: "s1", cardId: BOLT_ID, cardName: "Lightning Bolt" },
                ]}
                existingDeck={null}
                poolArrangement={null}
            />
        );

        // All five buttons render even though the Pool opened no basics.
        for (const subtype of [
            "Plains",
            "Island",
            "Swamp",
            "Mountain",
            "Forest",
        ]) {
            expect(getByText(`+ ${subtype}`)).toBeTruthy();
        }

        expect(getByText(/^Maindeck 0/)).toBeTruthy();
        fireEvent.click(getByText("+ Mountain"));
        expect(getByText(/^Maindeck 1/)).toBeTruthy();

        // Unmount triggers the flush-on-unmount effect cleanup, driving the
        // debounced autosave immediately rather than waiting out the timer.
        cleanup();

        expect(createMock).toHaveBeenCalledTimes(1);
        const payload = createMock.mock.calls[0][0] as {
            cards: { cardId: string; cardName: string }[];
        };
        expect(payload.cards).toEqual([
            { cardId: MOUNTAIN_ID, cardName: "Mountain" },
        ]);
    });
});
