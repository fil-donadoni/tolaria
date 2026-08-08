// Issue #2345 — a single left click on a library / graveyard / exile tile
// used to open BOTH the pile's browse dialog AND its context menu at once
// whenever the tile carried actions: the collapsed stack's own click handler
// fired the dialog open, and the same click bubbled to the ancestor
// `ContextMenuTrigger`, which synthesizes a `contextmenu` from any
// un-`preventDefault`ed left click (`src/components/ui/context-menu.tsx`).
//
// Proven here through the REAL `PlayerGraveyard` + real `CardsPile` + real
// `ContextMenu` (never a hand-built view — `.claude/rules/gre-development.md`
// § Frontend wiring analysis / Proof-of-failure): one click on a non-empty
// pile with actions opens the MENU (not the dialog), and the menu's first
// item, "Browse pile…", opens the dialog in one further click.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, cleanup, screen } from "@testing-library/react";
import type { CardInstance, Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import { PileActionsProvider } from "~/hooks/usePileActionsContext";

vi.mock("convex/react", () => ({
    useMutation: () => vi.fn(),
    useQuery: () => undefined,
}));
vi.mock("@convex/_generated/api", () => ({ api: { game: {} } }));
vi.mock("~/hooks/usePendingChoiceBuffer", () => ({
    usePendingChoiceBuffer: () => ({
        buffer: [],
        toggle: vi.fn(),
        clear: vi.fn(),
        submit: vi.fn(),
    }),
}));
vi.mock("~/hooks/useMinimizedChoice", () => ({
    useMinimizedChoice: () => ({
        isMinimized: false,
        minimize: vi.fn(),
        restore: vi.fn(),
    }),
}));
// Isolate the click-collision assertion from real card art (Scryfall URLs,
// catalogue lookups) — same stubs `cards-pile.test.tsx` uses.
vi.mock("../../cards/card-image", () => ({
    default: ({ card }: { card: { id: string } }) => (
        <div data-testid={`card-image-${card.id}`} />
    ),
}));
vi.mock("../../cards/card-back", () => ({
    default: () => <div data-testid="card-back" />,
}));
vi.mock("~/hooks/useInertialScroll", () => ({
    useInertialScroll: () => ({ current: null }),
}));

const { default: PlayerGraveyard } = await import("../player-graveyard");

function makePlayer(overrides: Partial<Player> = {}): Player {
    return {
        id: "me",
        name: "me",
        bgColor: "#000",
        life: 20,
        hand: [],
        library: { count: 0 },
        graveyard: [],
        exile: [],
        battlefield: [],
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        ...overrides,
    };
}

function makeCard(id: string): CardInstance {
    return {
        id,
        card: { id: "def-" + id },
        controllerId: "me",
        ownerId: "me",
        zone: "graveyard",
        isTapped: false,
    };
}

// `getByRole("dialog")` is NOT reliable here: when both surfaces open at
// once, Base UI's top-layer stacking marks the OLDER popup `aria-hidden`
// (inert) relative to whichever opened on top — so an accessibility-role
// query silently misses a genuinely-mounted, genuinely-open dialog sitting
// underneath the menu. Check the DOM directly for an open dialog instead.
const isBrowseDialogOpen = () =>
    document.body.querySelector('[data-slot="dialog-content"][data-open]') !==
    null;

function makeContext(me: Player): React.ContextType<typeof GameContext> {
    return {
        gameId: "game-id" as never,
        playerId: "me",
        activePlayerId: "me",
        priorityPlayerId: "me",
        phase: "PRECOMBAT_MAIN",
        turn: 1,
        engineTurn: 1,
        stackCount: 0,
        stackItems: [],
        allPlayers: [me],
        showAllCards: false,
        debugAllActions: false,
        onSwitchGame: () => {},
    } as React.ContextType<typeof GameContext>;
}

beforeEach(cleanup);

describe("pile tile click vs. context menu (#2345)", () => {
    it("a click on a non-empty pile WITH actions opens the menu, not the dialog — and 'Browse pile…' opens the dialog from there", () => {
        const me = makePlayer({ graveyard: [makeCard("c1")] });
        const onSelect = vi.fn();
        render(
            <GameContext value={makeContext(me)}>
                <PileActionsProvider
                    value={() => [
                        { key: "reanimate", label: "Reanimate", onSelect },
                    ]}
                >
                    <PlayerGraveyard player={me} />
                </PileActionsProvider>
            </GameContext>
        );

        // One left click on the collapsed pile tile.
        fireEvent.click(screen.getByTestId("card-image-c1"));

        // The menu's own verb is present alongside the browse item — proves
        // the CLICK reached the menu, not just that the trigger is mounted.
        expect(screen.getByText("Reanimate")).toBeTruthy();
        expect(screen.getByText("Browse pile…")).toBeTruthy();
        // The dialog must NOT also be open — one click opens exactly one
        // surface, never two.
        expect(isBrowseDialogOpen()).toBe(false);

        // The menu's FIRST item opens the browse dialog in one further click.
        fireEvent.click(screen.getByText("Browse pile…"));
        expect(isBrowseDialogOpen()).toBe(true);
    });

    it("a click on a non-empty pile with NO actions still opens the browse dialog directly (GRE board unchanged)", () => {
        const me = makePlayer({ graveyard: [makeCard("c1")] });
        render(
            <GameContext value={makeContext(me)}>
                <PlayerGraveyard player={me} />
            </GameContext>
        );

        expect(isBrowseDialogOpen()).toBe(false);
        fireEvent.click(screen.getByTestId("card-image-c1"));
        expect(isBrowseDialogOpen()).toBe(true);
    });
});
