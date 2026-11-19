import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";
import PoolDeckBuilderForm from "../pool-deck-builder-form";

const navigate = vi.fn();
const createMock = vi.fn().mockResolvedValue("deck-1");
const useMutationMock = vi.fn();
// The Pool Arrangement sink, mocked at the HOOK rather than at `useMutation`
// so it stays distinguishable from the deck-row mutations above (every
// `useMutation` call in this file returns the same stub).
const setColumnMock = vi.hoisted(() => vi.fn().mockResolvedValue(null));

const autoBuildRun = vi.hoisted(() => vi.fn());
vi.mock("~/hooks/useAutoBuildMyDeck", () => ({
    useAutoBuildMyDeck: () => ({
        run: autoBuildRun,
        pending: false,
        error: null,
    }),
}));

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

vi.mock("@tanstack/react-router", () => ({
    useNavigate: () => navigate,
}));

vi.mock("~/hooks/useLimitedEvent", () => ({
    useLimitedEventMutations: () => ({
        setPoolArrangementEntry: setColumnMock,
    }),
}));

// The print resolver's `cardPrints` rows (issue #5550): loaded by default; a
// test that needs the loading window overrides it for one render.
const useQueryLoading = vi.hoisted(() => ({ value: false }));
vi.mock("convex/react", async () => {
    const { getByPrintIdsStub } =
        await import("~/components/deckbuilder/__tests__/basicLandPrintRows");
    return {
        useMutation: (...args: unknown[]) => useMutationMock(...args),
        useQuery: (query: unknown, args: unknown) =>
            useQueryLoading.value ? undefined : getByPrintIdsStub(query, args),
    };
});

vi.mock("@convex/_generated/api", () => {
    const apiProxy: unknown = new Proxy({}, { get: () => apiProxy });
    return { api: apiProxy };
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    // Grouping/Ordering are per-USER preferences (issue #1620's
    // `deckViewPrefs` seam), so a test that drives a control leaks its choice
    // into every LATER mount in this file — which is exactly what a fresh
    // mount is supposed to pick up. Cleared file-wide so no test's seed
    // depends on which tests ran before it.
    window.localStorage.clear();
});

// Issue #9976: a draft opens on the raw Pool — flagged "not built yet" — and
// the Auto-Build button swaps in the server's suggestion.
const BOLT_ID = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a"; // Lightning Bolt
const PLAINS_ID = "b1623d57-4729-4796-b3f7-f1837a05c6ed"; // Plains

const RAW_POOL = Array.from({ length: 45 }, (_, i) => ({
    scryfallId: `s${i}`,
    cardId: BOLT_ID,
    cardName: "Lightning Bolt",
}));

function mountDraft() {
    useMutationMock.mockReturnValue(createMock);
    return render(
        <PoolDeckBuilderForm
            eventId={"event-1" as never}
            seatIndex={0}
            pool={RAW_POOL}
            existingDeck={null}
            eventType="draft"
            packSlots={["vintage-cube", "vintage-cube", "vintage-cube"]}
            poolArrangement={[]}
        />
    );
}

describe("PoolDeckBuilderForm — Auto-Build and the unbuilt flag (issue #9976)", () => {
    it("opens a 45-card, no-basics draft Maindeck flagged 'not built yet', not LEGAL", () => {
        const { getAllByText, queryByText } = mountDraft();
        expect(getAllByText(/Deck not built yet/).length).toBeGreaterThan(0);
        expect(queryByText(/^Legal$/i)).toBeNull();
    });

    it("Auto-Build applies the suggestion: Maindeck trimmed, basics in, flag gone", async () => {
        autoBuildRun.mockResolvedValue({
            cards: [
                ...Array.from({ length: 23 }, () => ({
                    cardId: BOLT_ID,
                    cardName: "Lightning Bolt",
                })),
                ...Array.from({ length: 17 }, () => ({
                    cardId: PLAINS_ID,
                    cardName: "Plains",
                })),
            ],
            sideboard: Array.from({ length: 22 }, () => ({
                cardId: BOLT_ID,
                cardName: "Lightning Bolt",
            })),
            colors: ["R", "W"],
        });
        const { getAllByRole, queryAllByText, getByText } = mountDraft();
        fireEvent.click(getAllByRole("button", { name: "Auto-Build" })[0]);
        await waitFor(() => expect(getByText(/^Maindeck 40/)).toBeTruthy());
        expect(autoBuildRun).toHaveBeenCalledTimes(1);
        expect(queryAllByText(/Deck not built yet/)).toHaveLength(0);
    });
});
