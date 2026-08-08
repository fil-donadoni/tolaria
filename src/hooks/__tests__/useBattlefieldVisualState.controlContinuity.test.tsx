// Keldon Twilight's "…that they controlled since the beginning of the turn"
// sacrifice picker, driven through the REAL `Board` context derivation (issue
// #1944 review fixup).
//
// Why this test renders `Board` rather than hand-building a `GameContext`: the
// board publishes TWO different turn numbers and only one of them is the
// engine's. `turn` is the DISPLAY counter (`activePlayer.turnsTaken`, CR 500.1
// — the active player's own turn count, so roughly half the global sequence
// number in a two-player game); `engineTurn` is `GameState.turn`, the number
// `markEnteredThisTurn` stamps into `CardInstanceState.enteredOnTurn`. Feeding
// the display counter to `hasControlledSinceTurnStart` compares two different
// scales and hides legal picks from turn 2 onward — and because the choice is
// a MANDATORY `count: 1` with no `candidateIds` allow-list, a human seat with
// nothing clickable cannot answer the prompt at all (a hard softlock).
//
// A hand-built context cannot catch that: it would supply whichever number the
// test author believed was right. So the scenario below sets
// `state.turn = 6` with `turnsTaken = 3` — the two numbers DISAGREE — and lets
// `board.tsx` derive both context fields itself.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { CardInstance, Player } from "~/types/game";
import { useBattlefieldVisualState } from "../useBattlefieldVisualState";

vi.mock("~/hooks/useElementSize", () => ({
    useElementSize: () => ({
        ref: { current: null },
        size: { width: 1000, height: 300 },
    }),
}));

// Convex data layer: `Board` consumes `getPublicState` for its render state;
// every other query tolerates the same object.
const h = vi.hoisted(() => ({ state: undefined as unknown }));
vi.mock("convex/react", () => ({
    useQuery: () => h.state,
    useMutation: () => async () => {},
    useAction: () => async () => {},
}));
vi.mock("~/lib/image-preload", () => ({ preloadCardImages: () => {} }));

// Board chrome → inert. The battlefield probe below is the system under test.
vi.mock("../../components/board/controller", () => ({ default: () => null }));
vi.mock("../../components/board/auto-pass-controller", () => ({
    default: () => null,
}));
vi.mock("../../components/board/pause-menu-dialog", () => ({
    default: () => null,
}));
vi.mock("../../components/board/error-toast", () => ({ default: () => null }));
vi.mock("../../components/board/board-background", () => ({
    default: () => null,
}));
vi.mock("../../components/board/vs-ai-driver", () => ({ default: () => null }));
vi.mock("../../components/board/game-stack", () => ({ default: () => null }));
vi.mock("../../components/board/priority-indicator", () => ({
    default: () => null,
}));
vi.mock("../../components/board/board-arrows", () => ({ default: () => null }));
vi.mock("../../components/board/board-piles", () => ({ default: () => null }));
vi.mock("../../components/board/board-player", () => ({ default: () => null }));
vi.mock("../../components/board/pending-choice-prompt", () => ({
    default: () => null,
}));
vi.mock("../../components/board/board-card", () => ({ default: () => null }));
vi.mock("../../components/board/board-hand-card", () => ({
    default: () => null,
}));

// Definitions: every synthetic card is a plain vanilla creature.
const PLAIN_DEF = { id: "plain-def", name: "Grizzly Bears", staticEffects: [] };
import {
    mockInstanceManaCost,
    type ManaCostSource,
} from "~/lib/testing/convex-cards-mock";
vi.mock("@convex/cards", () => ({
    getInstanceManaCost: (c: ManaCostSource) =>
        mockInstanceManaCost(c, () => PLAIN_DEF),
    getDefinition: () => PLAIN_DEF,
    tryGetDefinition: () => PLAIN_DEF,
}));

// The probe: the REAL `useBattlefieldVisualState`, reading the REAL context
// `Board` published, reporting each permanent's clickability as a DOM
// attribute. Replaces the heavy battlefield render tree only — the reducer
// under test runs unchanged.
function BattlefieldProbe({ player }: { player: Player }) {
    const { canInteract } = useBattlefieldVisualState(player);
    return (
        <div>
            {player.battlefield.map((c) => (
                <div
                    key={c.id}
                    data-testid="probe"
                    data-card-id={c.id}
                    data-can-interact={String(canInteract(c))}
                />
            ))}
        </div>
    );
}
vi.mock("../../components/board/board-battlefield", () => ({
    default: BattlefieldProbe,
}));

const { default: Board } = await import("../../components/board/board");

function creature(id: string, enteredOnTurn: number): CardInstance {
    return {
        id,
        card: { id: "plain-def" },
        controllerId: "me",
        ownerId: "me",
        zone: "battlefield",
        isTapped: false,
        isSummoningSick: false,
        types: ["Creature"],
        subtypes: [],
        staticAbilities: [],
        enteredOnTurn,
    } as CardInstance;
}

function makePlayer(id: string, overrides: Partial<Player> = {}): Player {
    return {
        id,
        name: id,
        bgColor: "#000",
        life: 20,
        hand: [],
        library: { count: 0 },
        graveyard: [],
        exile: [],
        battlefield: [],
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        ...overrides,
    } as Player;
}

/** Global engine turn 6 — but the active player has only TAKEN 3 turns, which
 *  is what the board displays. The three creatures span the distinctions
 *  Keldon Twilight's filter draws. */
const ENGINE_TURN = 6;
const TURNS_TAKEN = 3;

function setState(controlChangedThisTurn: string[]) {
    const me = makePlayer("me", {
        turnsTaken: TURNS_TAKEN,
        battlefield: [
            // Entered on global turn 4: BEFORE this turn began, so it has been
            // controlled since the turn started → a legal sacrifice.
            // Deliberately > `turnsTaken` (3), which is exactly the window the
            // display counter would mis-read.
            creature("long-held", 4),
            // Entered THIS turn → excluded (CR 400.7).
            creature("just-cast", ENGINE_TURN),
            // Entered long ago but stolen this turn → excluded by the ledger.
            creature("stolen", 1),
        ],
    });
    h.state = {
        players: [makePlayer("opp"), me],
        activePlayerId: "me",
        priorityPlayerId: "me",
        phase: "END_STEP",
        turn: ENGINE_TURN,
        stack: [],
        controlChangedThisTurn,
        pendingChoices: [
            {
                id: "me",
                playerId: "me",
                kind: "sacrifice-permanents",
                zone: "battlefield",
                filter: { types: "Creature", controlledSinceTurnStart: true },
                count: 1,
                prompt: "Keldon Twilight: sacrifice a creature you have controlled since the beginning of the turn.",
            },
        ],
    };
}

function renderBoard(controlChangedThisTurn: string[] = ["stolen"]) {
    setState(controlChangedThisTurn);
    return render(
        <Board
            gameId={"game-id" as never}
            playerId="me"
            solo={false}
            vsAi={false}
            showAllCards={false}
            debugAllActions={false}
            onSwitchGame={() => {}}
        />
    );
}

function clickable(id: string): boolean {
    const el = document.querySelector<HTMLElement>(
        `[data-testid='probe'][data-card-id='${id}']`
    );
    expect(el, `probe for ${id} not rendered`).toBeTruthy();
    return el!.dataset.canInteract === "true";
}

describe("useBattlefieldVisualState — controlledSinceTurnStart picker reads the ENGINE turn, not the display counter (issue #1944)", () => {
    beforeEach(() => cleanup());

    it("highlights a creature that entered on an earlier GLOBAL turn even when that turn number exceeds the displayed turnsTaken", () => {
        renderBoard();
        // Global turn 6, displayed turn 3, entered global turn 4. Comparing
        // against the display counter yields 4 >= 3 → hidden, while the server
        // (`effectivePermanentView` + `applyPendingChoiceSubmit`) accepts it.
        expect(clickable("long-held")).toBe(true);
    });

    it("still excludes a creature that entered THIS turn", () => {
        renderBoard();
        expect(clickable("just-cast")).toBe(false);
    });

    it("still excludes a creature whose control changed this turn", () => {
        renderBoard();
        expect(clickable("stolen")).toBe(false);
    });

    it("leaves at least one clickable candidate, so a mandatory count:1 choice is answerable (no softlock)", () => {
        renderBoard();
        const answerable = ["long-held", "just-cast", "stolen"].some(clickable);
        expect(answerable).toBe(true);
    });
});
