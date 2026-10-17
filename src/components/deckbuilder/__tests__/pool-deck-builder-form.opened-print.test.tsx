// Issue #5473, ADR 0140 §5: the Limited builder works on CANONICAL Card IDs
// (every registry lookup — columns, filters, stats — reads `cardId`) and
// carries the printing each booster contained beside them as `printId`. The
// SAVED deck mints the entry per §5: `cardId` = the opened Print ID,
// `definitionId` = the canonical Card ID. Reopening re-attaches every entry to
// its Pool copy, so the Pins recorded per copy survive and the face comes from
// the copy. The shell is a stub that exposes the form's REAL working zones.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import type { LimitedPoolCard } from "@convex/limited/eventTypes";
import PoolDeckBuilderForm from "../pool-deck-builder-form";

interface WorkingCard {
    cardId: string;
    printId?: string;
    pinKey?: string;
}
interface ShellStubProps {
    actions: { onMoveToMaindeck: (cardId: string, pinKey?: string) => void };
    mainCards: WorkingCard[];
    sideCards: WorkingCard[];
}

const createMock = vi.fn().mockResolvedValue("deck-1");

vi.mock("~/lib/useCardPrintings", async () => ({
    useCardPrintings: (
        await import("~/components/deckbuilder/__tests__/basicLandPrintRows")
    ).useCardPrintingsStub,
}));
vi.mock("~/lib/useScryfallSetNames", async () => ({
    useScryfallSetNames: (
        await import("~/components/deckbuilder/__tests__/basicLandPrintRows")
    ).useScryfallSetNamesStub,
}));
vi.mock("~/lib/useBasicLandPreferenceRows", async () => ({
    useBasicLandPreferenceRows: (
        await import("~/components/deckbuilder/__tests__/basicLandPrintRows")
    ).useBasicLandPreferenceRowsStub,
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("~/hooks/useLimitedEvent", () => ({
    useLimitedEventMutations: () => ({
        setPoolArrangementEntry: vi.fn().mockResolvedValue(null),
    }),
}));
vi.mock("~/hooks/useUserDecks", () => ({
    useUserDeckMutations: () => ({
        create: createMock,
        update: vi.fn().mockResolvedValue(undefined),
    }),
}));

const BOLT_ID = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a"; // Lightning Bolt
const MOUNTAIN_ID = "eace2c85-976c-425e-9800-5a6ccbd91b56"; // a Basic

vi.mock("../deck-builder-shell", () => ({
    default: (props: ShellStubProps) => (
        <div>
            <pre data-testid="main">{JSON.stringify(props.mainCards)}</pre>
            <pre data-testid="side">{JSON.stringify(props.sideCards)}</pre>
            <button
                type="button"
                onClick={() => props.actions.onMoveToMaindeck(BOLT_ID)}
            >
                bolt-to-main
            </button>
        </div>
    ),
}));

const POOL: LimitedPoolCard[] = [
    { scryfallId: "tmp-bolt", cardId: BOLT_ID, cardName: "Lightning Bolt" },
    { scryfallId: "usg-bolt", cardId: BOLT_ID, cardName: "Lightning Bolt" },
    // A Basic keeps today's behaviour; an unresolvable id is its own identity.
    { scryfallId: "other-mtn", cardId: MOUNTAIN_ID, cardName: "Mountain" },
    { scryfallId: "unknown", cardId: "unknown", cardName: "Mystery" },
];

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

const zone = (getByTestId: (id: string) => HTMLElement, id: string) =>
    JSON.parse(getByTestId(id).textContent!) as WorkingCard[];

describe("PoolDeckBuilderForm — the opened print (issue #5473)", () => {
    it("seeds the working zones with canonical ids and the opened print per copy", () => {
        const { getByTestId } = render(
            <PoolDeckBuilderForm
                eventId={"event-1" as never}
                seatIndex={0}
                pool={POOL}
                existingDeck={null}
                eventType="sealed"
                packSlots={["lea"]}
                poolArrangement={[]}
            />
        );
        const side = zone(getByTestId, "side");
        expect(side.map((c) => [c.cardId, c.printId])).toEqual([
            [BOLT_ID, "tmp-bolt"],
            [BOLT_ID, "usg-bolt"],
            [MOUNTAIN_ID, undefined],
            ["unknown", undefined],
        ]);
    });

    it("mints the saved entry as cardId = opened Print ID, definitionId = canonical Card ID", () => {
        const { getByText } = render(
            <PoolDeckBuilderForm
                eventId={"event-1" as never}
                seatIndex={0}
                pool={POOL}
                existingDeck={null}
                eventType="sealed"
                packSlots={["lea"]}
                poolArrangement={[]}
            />
        );
        fireEvent.click(getByText("bolt-to-main"));
        cleanup(); // flushes the debounced autosave through the real sink
        expect(createMock).toHaveBeenCalledTimes(1);
        const payload = createMock.mock.calls[0][0] as {
            cards: Record<string, unknown>[];
            sideboard: Record<string, unknown>[];
        };
        expect(payload.cards).toEqual([
            {
                cardId: "tmp-bolt",
                cardName: "Lightning Bolt",
                definitionId: BOLT_ID,
            },
        ]);
        expect(payload.sideboard).toEqual([
            {
                cardId: "usg-bolt",
                cardName: "Lightning Bolt",
                definitionId: BOLT_ID,
            },
            { cardId: MOUNTAIN_ID, cardName: "Mountain" },
            { cardId: "unknown", cardName: "Mystery" },
        ]);
    });

    it("reopening a saved deck re-attaches each print-keyed entry to its Pool copy: the Pin survives and the face is the copy's", () => {
        const { getByTestId } = render(
            <PoolDeckBuilderForm
                eventId={"event-1" as never}
                seatIndex={0}
                pool={POOL}
                existingDeck={
                    {
                        userDeckId: "deck-1",
                        name: "Saved",
                        format: "limited",
                        cards: [
                            {
                                cardId: "usg-bolt",
                                cardName: "Lightning Bolt",
                                definitionId: BOLT_ID,
                            },
                        ],
                        sideboard: [
                            {
                                cardId: "tmp-bolt",
                                cardName: "Lightning Bolt",
                                definitionId: BOLT_ID,
                            },
                        ],
                    } as never
                }
                eventType="draft"
                packSlots={["lea"]}
                poolArrangement={
                    [{ poolIndex: 1, pins: { mv: "mv:6" } }] as never
                }
            />
        );
        const main = zone(getByTestId, "main");
        expect(main).toHaveLength(1);
        // The pinned copy (poolIndex 1) is in the Maindeck, with its Pin key
        // and its own print.
        expect(main[0]).toMatchObject({
            cardId: BOLT_ID,
            printId: "usg-bolt",
            pinKey: "1",
        });
        expect(zone(getByTestId, "side")[0]).toMatchObject({
            cardId: BOLT_ID,
            printId: "tmp-bolt",
            pinKey: "0",
        });
    });
});
