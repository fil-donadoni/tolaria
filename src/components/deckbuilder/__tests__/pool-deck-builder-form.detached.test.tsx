// The DETACHED pool deckbuilder (ADR 0106): the form with no Seat. The shell is
// stubbed down to the props it receives, so these drive the form's real handlers
// and read the Column Layout, zones and legality it really hands over.
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import type { DeckColumnLayout } from "@convex/deckLayout";
import type { UserLobbyDeck } from "~/lib/deckTypes";
import PoolDeckBuilderForm from "../pool-deck-builder-form";

interface ShellProps {
    title: string;
    backLabel: string;
    onDone: () => void;
    mainCards: { cardId: string; pinKey?: string }[];
    sideCards: { cardId: string; pinKey?: string }[];
    layout: DeckColumnLayout;
    legality: { reasons: { code: string }[] };
    actions: {
        onPin: (cardId: string, columnId: string, pinKey: string) => void;
        onAddColumn: (label: string) => void;
        onMainCardClick: (card: { cardId: string; pinKey?: string }) => void;
        onSideCardClick: (card: { cardId: string; pinKey?: string }) => void;
    };
}

const shell = vi.hoisted(() => ({ props: null as unknown }));
const navigate = vi.fn();
const setColumnMock = vi.fn().mockResolvedValue(null);
const createMock = vi.fn().mockResolvedValue("deck-new");
const updateMock = vi.fn().mockResolvedValue(undefined);

vi.mock("~/lib/useDeckPrintResolver", async () => ({
    useDeckPrintResolver: (
        await import("~/components/deckbuilder/__tests__/basicLandPrintRows")
    ).useDeckPrintResolverStub,
}));
vi.mock("~/lib/useBasicLandPreferenceRows", async () => ({
    useBasicLandPreferenceRows: (
        await import("~/components/deckbuilder/__tests__/basicLandPrintRows")
    ).useBasicLandPreferenceRowsStub,
}));
vi.mock("@tanstack/react-router", () => ({
    useNavigate: () => navigate,
}));
vi.mock("~/hooks/useLimitedEvent", () => ({
    useLimitedEventMutations: () => ({
        setPoolArrangementEntry: setColumnMock,
    }),
}));
vi.mock("~/hooks/useUserDecks", () => ({
    useUserDeckMutations: () => ({ create: createMock, update: updateMock }),
}));
vi.mock("../deck-builder-shell", () => ({
    default: (props: unknown) => {
        shell.props = props;
        return null;
    },
}));

const BOLT_ID = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a";
const GIANT_ID = "off-pool-giant";
const bolt = { cardId: BOLT_ID, cardName: "Lightning Bolt" };
const giant = { cardId: GIANT_ID, cardName: "Hill Giant" };
const POOL = [
    { ...bolt, scryfallId: BOLT_ID },
    { ...bolt, scryfallId: BOLT_ID },
];

type RowCard = { cardId: string; cardName: string };

/** A stored row: every entry carries its `definitionId`, as the server fills. */
const stored = (cards: RowCard[]) =>
    cards.map((card) => ({ ...card, definitionId: card.cardId }));

function savedDeck(
    overrides: {
        cards?: RowCard[];
        sideboard?: RowCard[];
        layout?: UserLobbyDeck["layout"];
    } = {}
): UserLobbyDeck {
    return {
        kind: "user",
        userDeckId: "deck-1" as never,
        presetId: "deck-1",
        name: "Saved Deck",
        format: "limited",
        colors: [],
        featuredCardId: null,
        isLegal: true,
        reasons: [],
        layout: overrides.layout,
        cards: stored(overrides.cards ?? [bolt]),
        sideboard: stored(overrides.sideboard ?? [bolt]),
    } as UserLobbyDeck;
}

const props = () => shell.props as ShellProps;
const reasonCodes = () => props().legality.reasons.map((r) => r.code);

function mount(deck: UserLobbyDeck) {
    render(<PoolDeckBuilderForm detached existingDeck={deck} pool={POOL} />);
}

async function done() {
    await act(async () => {
        props().onDone();
    });
}

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.localStorage.clear();
});

describe("PoolDeckBuilderForm detached — Column Layout on the deck row (ADR 0106)", () => {
    it("persists a column drag on the row and never writes the Seat's Pool Arrangement", async () => {
        mount(savedDeck());
        const copy = props().mainCards[0];
        act(() => props().actions.onPin(BOLT_ID, "mv:6", copy.pinKey!));

        expect(props().layout.maindeck.pins[copy.pinKey!]).toEqual({
            mv: "mv:6",
        });
        await done();
        expect(updateMock.mock.calls[0][0].patch.layout).toEqual({
            maindeck: { pins: { [copy.pinKey!]: { mv: "mv:6" } } },
        });
        expect(setColumnMock).not.toHaveBeenCalled();
    });

    it("renders the Pins the row stores, on the copy they name", () => {
        mount(
            savedDeck({
                layout: { maindeck: { pins: { "1": { mv: "mv:6" } } } },
            })
        );
        expect(props().mainCards[0].pinKey).toBe("1");
        expect(props().layout.maindeck.pins["1"]).toEqual({ mv: "mv:6" });
    });

    it("keeps the row's Pins when a manual Column is added", async () => {
        mount(
            savedDeck({
                layout: { maindeck: { pins: { "1": { mv: "mv:6" } } } },
            })
        );
        act(() => props().actions.onAddColumn("Combo"));
        await done();
        const stored = updateMock.mock.calls[0][0].patch.layout.maindeck;
        expect(stored.pins).toEqual({ "1": { mv: "mv:6" } });
        expect(stored.manualColumns).toHaveLength(1);
    });
});

describe("PoolDeckBuilderForm detached — the Deck Pool is the universe (ADR 0106)", () => {
    it("judges legality against the Deck Pool", () => {
        mount(savedDeck({ sideboard: [] }));
        // The unplaced copy joined the Sideboard, so it reads as placed.
        expect(props().sideCards.map((c) => c.pinKey)).toEqual(["1"]);
        expect(reasonCodes()).not.toContain("pool-card-unplaced");
        cleanup();

        mount(savedDeck({ cards: [bolt, giant] }));
        expect(reasonCodes()).toContain("pool-not-granted");
    });

    it("writes a Pool copy the row left unplaced without waiting for an edit", async () => {
        mount(savedDeck({ sideboard: [] }));
        await done();
        const { patch } = updateMock.mock.calls[0][0];
        expect(patch.sideboard).toEqual([bolt]);
    });

    it("writes nothing on open when the row already places the whole Pool", async () => {
        mount(savedDeck());
        await done();
        expect(updateMock).not.toHaveBeenCalled();
    });

    it("a tap removes an off-Pool card and the deck is repaired", async () => {
        mount(savedDeck({ cards: [bolt, giant] }));
        act(() => props().actions.onMainCardClick(giant));
        expect(reasonCodes()).not.toContain("pool-not-granted");
        await done();
        expect(updateMock.mock.calls[0][0].patch.cards).toEqual([bolt]);
    });

    it("a tap removes an off-Pool card from the Sideboard too", () => {
        mount(savedDeck({ sideboard: [bolt, giant] }));
        act(() => props().actions.onSideCardClick(giant));
        expect(props().sideCards.map((c) => c.cardId)).toEqual([BOLT_ID]);
        expect(props().mainCards).toHaveLength(1);
    });

    it("a tap only ever moves a Pool copy: it cannot leave the Pool", () => {
        mount(savedDeck());
        act(() => props().actions.onMainCardClick(props().mainCards[0]));
        expect(props().mainCards).toEqual([]);
        expect(props().sideCards).toHaveLength(2);
    });
});

describe("PoolDeckBuilderForm detached — leaving (ADR 0106)", () => {
    it("Done returns to the deck's own page, and never creates a row", async () => {
        mount(savedDeck());
        expect(props().backLabel).toBe("← Back to Deck");
        await done();
        expect(navigate).toHaveBeenCalledWith({
            to: "/decks/$slug",
            params: { slug: "deck-1" },
        });
        expect(createMock).not.toHaveBeenCalled();
    });
});

describe("PoolDeckBuilderForm at a Seat — unchanged by the detached mode", () => {
    function mountAtSeat(existingDeck: UserLobbyDeck) {
        render(
            <PoolDeckBuilderForm
                eventId={"event-1" as never}
                seatIndex={0}
                pool={POOL}
                existingDeck={existingDeck}
                eventType="sealed"
                packSlots={["lea"]}
                poolArrangement={[{ poolIndex: 1, pins: { mv: "mv:3" } }]}
            />
        );
    }

    it("reads Pins from the Pool Arrangement and writes a drag to it, not the row", async () => {
        mountAtSeat(
            savedDeck({
                layout: { maindeck: { pins: { "0": { mv: "mv:6" } } } },
            })
        );
        expect(props().layout.maindeck.pins).toEqual({ "1": { mv: "mv:3" } });
        act(() => props().actions.onPin(BOLT_ID, "mv:6", "1"));
        expect(setColumnMock).toHaveBeenCalledWith({
            eventId: "event-1",
            poolIndex: 1,
            column: "mv:6",
        });
        await done();
        expect(updateMock).not.toHaveBeenCalled();
    });

    it("leaves an off-Pool card and an unplaced copy as they are", async () => {
        mountAtSeat(savedDeck({ cards: [bolt, giant], sideboard: [] }));
        expect(props().sideCards).toEqual([]);
        act(() => props().actions.onMainCardClick(giant));
        expect(props().sideCards.map((c) => c.cardId)).toEqual([GIANT_ID]);
    });
});
