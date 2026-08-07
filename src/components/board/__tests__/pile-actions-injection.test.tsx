// Injectable pile verbs (issue #2169, seam D).
//
// `PlayerLibrary` hardcoded `api.game.drawCard` / `mill` / `exileFromLibrary`
// and the other two pile tiles carried no menu at all. Both halves are proven
// here through the REAL pile components:
//  (a) DEFAULT FALLBACK — with no provider, the library keeps exactly its own
//      gate (viewer's own non-empty library, `debugAllActions` on) and the
//      graveyard / exile tiles keep no menu at all. This half is what proves
//      the GRE board is unchanged.
//  (b) PROVIDER OVERRIDE — with a provider, the supplied verbs are what each
//      tile offers, on tiles that never had a menu before.
//
// `ActivatableAbilityMenu` and the pile tiles both render their children BARE
// when there is nothing to offer, so the presence of the shared context-menu
// TRIGGER around a tile is precisely the assertion "this tile has a menu".
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import {
    PileActionsProvider,
    type PileActionsSource,
} from "~/hooks/usePileActionsContext";

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

const { default: PlayerLibrary } = await import("../player-library");
const { default: PlayerGraveyard } = await import("../player-graveyard");
const { default: PlayerExile } = await import("../player-exile");

function makePlayer(overrides: Partial<Player> = {}): Player {
    return {
        id: "me",
        name: "me",
        bgColor: "#000",
        life: 20,
        hand: [],
        library: { count: 3 },
        graveyard: [],
        exile: [],
        battlefield: [],
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        ...overrides,
    };
}

function makeContext(
    me: Player,
    debugAllActions: boolean
): React.ContextType<typeof GameContext> {
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
        onSwitchGame: () => {},
        debugAllActions,
    } as React.ContextType<typeof GameContext>;
}

function renderPiles(args: {
    debugAllActions: boolean;
    source?: PileActionsSource;
}) {
    const me = makePlayer();
    const tree = (
        <GameContext value={makeContext(me, args.debugAllActions)}>
            <div data-testid="library">
                <PlayerLibrary player={me} />
            </div>
            <div data-testid="graveyard">
                <PlayerGraveyard player={me} />
            </div>
            <div data-testid="exile">
                <PlayerExile player={me} />
            </div>
        </GameContext>
    );
    return render(
        args.source ? (
            <PileActionsProvider value={args.source}>
                {tree}
            </PileActionsProvider>
        ) : (
            tree
        )
    );
}

const hasMenu = (container: HTMLElement, testId: string) =>
    container
        .querySelector(`[data-testid="${testId}"]`)!
        .querySelector('[data-slot="context-menu-trigger"]') !== null;

beforeEach(cleanup);

describe("injected pile verbs (#2169)", () => {
    it("absent a provider, the library keeps its own menu and the other tiles keep none", () => {
        const { container } = renderPiles({ debugAllActions: true });
        expect(hasMenu(container, "library")).toBe(true);
        expect(hasMenu(container, "graveyard")).toBe(false);
        expect(hasMenu(container, "exile")).toBe(false);
    });

    it("absent a provider, the library's own gate still suppresses its menu", () => {
        const { container } = renderPiles({ debugAllActions: false });
        expect(hasMenu(container, "library")).toBe(false);
    });

    it("a provider gives every tile the verbs it supplies", () => {
        const source = vi.fn<PileActionsSource>((_player, zone) => [
            { key: zone, label: `verb for ${zone}`, onSelect: () => {} },
        ]);
        const { container } = renderPiles({
            // `false` is the GRE-suppressed gate: a provider must be able to
            // offer verbs the default wiring would have hidden.
            debugAllActions: false,
            source,
        });
        expect(hasMenu(container, "library")).toBe(true);
        expect(hasMenu(container, "graveyard")).toBe(true);
        expect(hasMenu(container, "exile")).toBe(true);
        const zones = source.mock.calls.map(([, zone]) => zone);
        expect(zones).toContain("library");
        expect(zones).toContain("graveyard");
        expect(zones).toContain("exile");
    });

    it("a provider that offers nothing leaves a tile bare", () => {
        const { container } = renderPiles({
            debugAllActions: true,
            source: () => [],
        });
        expect(hasMenu(container, "library")).toBe(false);
        expect(hasMenu(container, "graveyard")).toBe(false);
    });
});
