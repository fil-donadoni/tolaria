// Shared fixtures for the Manual Board swap suites (PRD #2162, issue #2169).
// One place builds a projected manual state and a spy dispatcher, so the drop
// tests, the interaction tests and the container test all assert against the
// SAME shape the server actually projects.
import { vi } from "vitest";
import type {
    ProjectedManualCard,
    ProjectedManualGameState,
    ProjectedManualPlayer,
} from "@convex/manual";
import type {
    ManualDispatch,
    ManualRuntime,
    RequestVerbInput,
} from "~/lib/manual-runtime";
import { indexManualCards } from "~/lib/manual-runtime";

export function manualCard(
    id: string,
    overrides: Partial<ProjectedManualCard> = {}
): ProjectedManualCard {
    return {
        id,
        card: { id: `def-${id}` },
        zone: "battlefield",
        controllerId: "me",
        ownerId: "me",
        isTapped: false,
        ...overrides,
    };
}

export function manualSeat(
    id: string,
    overrides: Partial<ProjectedManualPlayer> = {}
): ProjectedManualPlayer {
    return {
        id,
        name: `${id}-name`,
        bgColor: "#000",
        life: 20,
        hand: [],
        library: { count: 10 },
        graveyard: [],
        exile: [],
        battlefield: [],
        ...overrides,
    };
}

export function manualState(
    players: ProjectedManualPlayer[],
    overrides: Partial<ProjectedManualGameState> = {}
): ProjectedManualGameState {
    return {
        players,
        turn: 1,
        activePlayerId: players[0]?.id ?? "me",
        ...overrides,
    };
}

/** Every manual verb as a spy, so a test asserts WHICH verb fired and with
 *  what — the same discipline the GRE board tests use for their mutations. */
export function spyDispatch(): ManualDispatch {
    return {
        moveCard: vi.fn(),
        setTapped: vi.fn(),
        untapAll: vi.fn(),
        adjustLife: vi.fn(),
        adjustCounter: vi.fn(),
        setFaceDown: vi.fn(),
        setLane: vi.fn(),
        attach: vi.fn(),
        setArrow: vi.fn(),
        clearArrow: vi.fn(),
        draw: vi.fn(),
        mill: vi.fn(),
        exileTop: vi.fn(),
        peek: vi.fn(),
        shuffle: vi.fn(),
        setNote: vi.fn(),
        endTurn: vi.fn(),
        concede: vi.fn(),
    };
}

/** A spy `requestVerbInput` — issue #2170's popover-request seam. Tests that
 *  care WHICH request a verb opened pass their own spy via `manualRuntime`'s
 *  fourth argument; this default just records nothing and lets a verb's
 *  `onSelect` run without throwing. */
export function spyRequestVerbInput(): RequestVerbInput {
    return vi.fn();
}

export function manualRuntime(
    state: ProjectedManualGameState,
    dispatch: ManualDispatch,
    viewerId = "me",
    requestVerbInput: RequestVerbInput = spyRequestVerbInput()
): ManualRuntime {
    return {
        viewerId,
        state,
        cardById: indexManualCards(state),
        dispatch,
        requestVerbInput,
    };
}
