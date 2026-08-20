// THE unification proof for issue #1632: a Card Pin made by dragging a card
// between Columns during the DRAFT is the same datum the BUILD view renders
// from — one persisted Pool Arrangement, one Pin model, no carry-over step.
//
// Every link in the chain is real, which is the point:
//
//  1. the draft surface is the real `LimitedDraftTable` → `LimitedDraftPool` →
//     `DeckZoneSurface`, so the Columns and drop ids are the shared engine's;
//  2. the drag is a REAL dnd-kit operation driven through the REAL droppable
//     registry (`dragOnto` — jsdom has no layout, so a pointer-driven drag can
//     never resolve a target there, but everything except the pointer is real);
//  3. the mutation ARGS the surface produces are fed through the REAL
//     server-side reducer (`upsertPoolArrangementEntry`), not a hand-written
//     arrangement — a client and a server that disagree about the persisted
//     shape would surface here and nowhere else;
//  4. the build view is the real `PoolDeckBuilderForm`, asserted through the
//     real rendered DOM (`cardsIn`), never a fixture's idea of a column.
//
// Break any one of those links — the draft writing a Pin the build view reads
// under a different key, or a Column id vocabulary that forks between the two
// surfaces — and this file goes red. Two surfaces each green on their own
// tests while disagreeing across the seam is exactly the shipped bug this
// slice removes.
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, cleanup, within } from "@testing-library/react";
import { DragDropManager } from "@dnd-kit/dom";
import {
    projectLimitedEvent,
    type LimitedEventRow,
} from "@convex/limited/eventProjection";
import { upsertPoolArrangementEntry } from "@convex/limited/poolArrangement";
import type { PoolArrangementEntry } from "@convex/limited/eventTypes";
import {
    dragOnto,
    installDndJsdomShims,
} from "~/components/deckbuilder/__tests__/dragHarness";
import {
    cardsIn,
    paneOf,
} from "~/components/deckbuilder/__tests__/zoneQueries";
import PoolDeckBuilderForm from "~/components/deckbuilder/pool-deck-builder-form";
import LimitedDraftTable from "../limited-draft-table";

const navigate = vi.fn();
const useMutationMock = vi.fn();
const deckRowMock = vi.fn().mockResolvedValue("deck-1");
// The Pool Arrangement sink, mocked at the HOOK (as `pool-deck-builder-form`'s
// own tests do) so it stays distinguishable from the deck-row mutations, and
// so BOTH surfaces in this file write through the very same spy.
const setPoolArrangementEntryMock = vi.hoisted(() =>
    vi.fn().mockResolvedValue(null)
);
const submitPickMock = vi.hoisted(() => vi.fn().mockResolvedValue(null));
const selectDraftPickMock = vi.hoisted(() => vi.fn().mockResolvedValue(null));

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));

vi.mock("~/hooks/useLimitedEvent", () => ({
    useLimitedEventMutations: () => ({
        setPoolArrangementEntry: setPoolArrangementEntryMock,
        submitPick: submitPickMock,
        selectDraftPick: selectDraftPickMock,
    }),
}));

vi.mock("convex/react", () => ({
    useMutation: (...args: unknown[]) => useMutationMock(...args),
}));

vi.mock("@convex/_generated/api", () => {
    const apiProxy: unknown = new Proxy({}, { get: () => apiProxy });
    return { api: apiProxy };
});

beforeAll(() => installDndJsdomShims());

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    // Grouping/Ordering are per-USER preferences (issue #1620's
    // `deckViewPrefs` seam) and would otherwise leak between mounts.
    window.localStorage.clear();
});

// Real registry ids — the Column Layout engine resolves each card's automatic
// Column through the card registry, so synthetic ids would bucket nowhere.
const BOLT_ID = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a"; // Lightning Bolt (MV 1)
const PLAINS_ID = "b1623d57-4729-4796-b3f7-f1837a05c6ed"; // Plains (land)

const POOL = [
    { scryfallId: "s1", cardId: BOLT_ID, cardName: "Lightning Bolt" },
    { scryfallId: "s2", cardId: PLAINS_ID, cardName: "Plains" },
];

function eventRow(arrangement?: PoolArrangementEntry[]): LimitedEventRow {
    return {
        _id: "event-1",
        createdBy: "admin1",
        type: "draft",
        status: "started",
        seatCount: 2,
        packSlots: ["lea", "lea", "lea"],
        seats: [
            {
                seatIndex: 0,
                userId: "user1",
                nickname: "Alice",
                pool: POOL,
                currentPack: [],
                poolArrangement: arrangement,
            },
            { seatIndex: 1, isBot: true },
        ],
        createdAt: 0,
        updatedAt: 0,
    };
}

/** The draft table, mounted from a `limitedEvents` row through the REAL
 *  projection the client actually receives. */
function renderDraft(
    manager: DragDropManager,
    arrangement?: PoolArrangementEntry[]
) {
    const view = projectLimitedEvent(eventRow(arrangement), "user1");
    const seat = view.seats.find((s) => s.seatIndex === 0)!;
    // `autoBuiltDeck` is zipped in by `projectEventForViewer`, not by the pure
    // projection — stubbed so the fixture satisfies the prop type.
    return render(
        <LimitedDraftTable
            eventId={"event-1" as never}
            seat={{ ...seat, autoBuiltDeck: null }}
            round={0}
            manager={manager}
        />
    );
}

function renderBuild(poolArrangement: PoolArrangementEntry[]) {
    useMutationMock.mockReturnValue(deckRowMock);
    return render(
        <PoolDeckBuilderForm
            eventId={"event-1" as never}
            seatIndex={0}
            pool={POOL}
            existingDeck={null}
            eventType="draft"
            poolArrangement={poolArrangement}
        />
    );
}

/** The arrangement the SERVER would hold after the mutation calls the draft
 *  surface just made — folded through the real reducer, in call order. */
function persistedArrangement(): PoolArrangementEntry[] {
    let arrangement: PoolArrangementEntry[] = [];
    for (const [args] of setPoolArrangementEntryMock.mock.calls) {
        const { poolIndex, sideboard, column } = args as {
            eventId: string;
            poolIndex: number;
            sideboard?: boolean;
            column?: string;
        };
        arrangement = upsertPoolArrangementEntry(arrangement, {
            poolIndex,
            sideboard,
            column,
        });
    }
    return arrangement;
}

describe("draft → build Card Pin carry-over (issue #1632, ADR 0075 §6)", () => {
    it("a column drag during the draft records a Pin that is already in effect when the build view opens", async () => {
        const manager = new DragDropManager();
        const draft = renderDraft(manager);

        // The Bolt starts in its AUTOMATIC Column, so the drag below actually
        // moves it — a card already sitting in mv:6 would make the assertion
        // pass for the wrong reason.
        const pool = paneOf(draft.container, /^Pool 2/);
        expect(cardsIn(pool, "mv:1")).toEqual(["Lightning Bolt"]);
        expect(cardsIn(pool, "mv:6")).toEqual([]);

        await dragOnto(
            manager,
            within(pool).getByTitle(/Remove Lightning Bolt/),
            pool.querySelector('[data-column="mv:6"]')!
        );

        // The Pin is keyed by the Pool copy's own `poolIndex` and names the
        // Column WHOLE, in the engine's namespaced vocabulary.
        expect(setPoolArrangementEntryMock).toHaveBeenCalledWith({
            eventId: "event-1",
            poolIndex: 0,
            sideboard: false,
            column: "mv:6",
        });

        const arrangement = persistedArrangement();
        expect(arrangement).toEqual([{ poolIndex: 0, pins: { mv: "mv:6" } }]);
        draft.unmount();

        // …and the build view, seeded from nothing but that arrangement,
        // renders the Bolt in mv:6 rather than its automatic mv:1.
        const build = renderBuild(arrangement);
        const maindeck = paneOf(build.container, /^Maindeck 2/);
        expect(cardsIn(maindeck, "mv:6")).toEqual(["Lightning Bolt"]);
        expect(cardsIn(maindeck, "mv:1")).toEqual([]);
    });

    it("the carry-over runs the other way too: a Pin already on the Arrangement is what the DRAFT surface renders from", () => {
        const manager = new DragDropManager();
        const draft = renderDraft(manager, [
            { poolIndex: 0, pins: { mv: "mv:4" } },
        ]);
        const pool = paneOf(draft.container, /^Pool 2/);
        expect(cardsIn(pool, "mv:4")).toEqual(["Lightning Bolt"]);
        expect(cardsIn(pool, "mv:1")).toEqual([]);
    });

    it("dragging a pick into the Sideboard during the draft still moves it out of the working deck on both surfaces", async () => {
        const manager = new DragDropManager();
        const draft = renderDraft(manager);
        const pool = paneOf(draft.container, /^Pool 2/);
        const sideboardPane = paneOf(draft.container, /^Sideboard 0/);

        await dragOnto(
            manager,
            within(pool).getByTitle(/Remove Lightning Bolt/),
            sideboardPane
        );

        expect(setPoolArrangementEntryMock).toHaveBeenCalledWith({
            eventId: "event-1",
            poolIndex: 0,
            sideboard: true,
        });

        const arrangement = persistedArrangement();
        draft.unmount();

        const build = renderBuild(arrangement);
        expect(
            cardsIn(paneOf(build.container, /^Pool \(Sideboard\) 1/), "mv:1")
        ).toEqual(["Lightning Bolt"]);
        expect(
            cardsIn(paneOf(build.container, /^Maindeck 1/), "mv:lands")
        ).toEqual(["Plains"]);
    });
});
