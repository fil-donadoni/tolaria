// CR 702.185a (issue #3294) — a WARPED card is exiled with its recast grant
// already stamped, but the grant does not open until the following turn ("its
// owner may cast this card after the current turn has ended"). The render gate
// upstream (`player-exile.tsx` / `board-battlefield-card.tsx`) reads the raw
// `castableFromExileBy`, so the Cast button appears during that closed window;
// the enable gate reads the PROJECTED `legalActions`, which the projection
// withholds entirely while the window is closed. The button was therefore
// disabled with the generic affordability tooltip — it blamed the mana for a
// wait.
//
// SURFACE test per `.claude/rules/gre-development.md` § Frontend wiring
// analysis: every case pushes a real GameState through `projectPublicState`,
// the exact wire shape `<ExileCastButton>` reads, so a projection that stopped
// forwarding `castableFromExileFromTurn` would show up here. A hand-built
// `CardInstance` would mask that class of bug and does not count.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import {
    PendingChoiceBufferContext,
    type PendingChoiceBuffer,
} from "~/hooks/usePendingChoiceBuffer";
import { projectPublicState } from "@convex/gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup";

// Quantum Riddler (EOE) — the first shipping card with Warp {1}{U}.
const QUANTUM_RIDDLER = "120be808-ff3b-4fca-96a1-4db6b9825856";

const playCard = vi.fn();
const announceCast = vi.fn();
vi.mock("convex/react", () => ({
    useMutation: (ref: { _name: string }) =>
        ref._name === "playCard" ? playCard : announceCast,
}));
vi.mock("@convex/_generated/api", () => ({
    api: {
        game: {
            playCard: { _name: "playCard" },
            announceCast: { _name: "announceCast" },
        },
    },
}));

import ExileCastButton from "../exile-cast-button";

const noopBuffer: PendingChoiceBuffer = {
    buffer: [],
    toggle: () => {},
    clear: () => {},
    submit: () => Promise.resolve(),
    isPending: false,
    lastError: null,
    reportError: () => {},
    dismissError: () => {},
};

/** The Sphinx warped out on turn 3 — exiled, grant stamped, window opening on
 *  turn 4 — projected for its owner at `turn`, with `mana` blue floating. */
function projectedWarpExile(turn: number, mana: number) {
    const exiled = makeInstance(QUANTUM_RIDDLER, {
        id: "warped-riddler",
        controllerId: "p1",
        ownerId: "p1",
        zone: "exile",
        knownTo: ["p1"],
        warpExiled: true,
        castableFromExileBy: "p1",
        castableFromExileFromTurn: 4,
    });
    const state = makeState({
        players: [makePlayer("p1", { exile: [exiled] }), makePlayer("p2")],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        turn,
    });
    state.players[0].manaPool.U = mana;
    const projected = projectPublicState(state, 1, "p1");
    return projected.players[0].exile.find((c) => c.id === "warped-riddler")!;
}

function renderButton(
    card: ReturnType<typeof projectedWarpExile>,
    engineTurn: number
) {
    const value = {
        gameId: "game-id" as never,
        playerId: "p1",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "PRECOMBAT_MAIN",
        turn: engineTurn,
        engineTurn,
        stackCount: 0,
        stackItems: [],
        allPlayers: [] as Player[],
        showAllCards: false,
        debugAllActions: false,
        onSwitchGame: () => {},
    } as React.ContextType<typeof GameContext>;
    return render(
        <GameContext value={value}>
            <PendingChoiceBufferContext value={noopBuffer}>
                <ExileCastButton card={card as never} />
            </PendingChoiceBufferContext>
        </GameContext>
    );
}

describe("ExileCastButton during a CLOSED warp window (CR 702.185a, issue #3294)", () => {
    beforeEach(() => {
        announceCast.mockClear();
        playCard.mockClear();
        cleanup();
    });

    it("the projection withholds legalActions, so the button renders disabled", () => {
        const card = projectedWarpExile(3, 5);
        expect(card.castableFromExileBy).toBe("p1");
        expect(card.legalActions).toBeUndefined();
        renderButton(card, 3);
        expect(
            screen
                .getByRole("button", { name: "Cast" })
                .hasAttribute("disabled")
        ).toBe(true);
    });

    it("names the WINDOW, not the mana — even with the cast fully paid for", () => {
        // Five blue floating covers {3}{U}{U} outright: if the tooltip still
        // blamed the mana it would be saying something provably false.
        renderButton(projectedWarpExile(3, 5), 3);
        const title = screen
            .getByRole("button", { name: "Cast" })
            .getAttribute("title");
        expect(title).toBe(
            "Can't cast yet — not available from exile until turn 4."
        );
        expect(title).not.toContain("mana");
    });

    it("the lower bound reaches the client through the projection", () => {
        // The reason is derived from the wire field, so a projection that
        // dropped it would silently fall back to the mana tooltip.
        expect(projectedWarpExile(3, 5).castableFromExileFromTurn).toBe(4);
    });
});

describe("ExileCastButton once the warp window is OPEN (CR 702.185a, issue #3294)", () => {
    beforeEach(() => {
        announceCast.mockClear();
        playCard.mockClear();
        cleanup();
    });

    it("an affordable cast is enabled and carries no tooltip at all", () => {
        const card = projectedWarpExile(4, 5);
        expect(card.legalActions).toContain("cast");
        renderButton(card, 4);
        const button = screen.getByRole("button", { name: "Cast" });
        expect(button.hasAttribute("disabled")).toBe(false);
        expect(button.getAttribute("title")).toBeNull();
    });

    it("an UNAFFORDABLE cast in the open window blames the mana, as it should", () => {
        const card = projectedWarpExile(4, 0);
        expect(card.legalActions).not.toContain("cast");
        renderButton(card, 4);
        expect(
            screen.getByRole("button", { name: "Cast" }).getAttribute("title")
        ).toBe(
            "Can't cast yet — not enough usable mana (the noted mana must match this card's cost)."
        );
    });
});
