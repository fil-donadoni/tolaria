// Issue #1762 review finding 5 — `AttackDirectionBanner`/`BandFormationPanel`
// (this component's declare-attackers dock, fixed at `top-24`) used to stay
// mounted the whole time `combat.confirmed` is false — which INCLUDES the
// window where an attack tax (`combat.pendingAttackManaTax` /
// `pendingAttackSacrifice`) is parked, since `combat.confirmed` only flips
// true in `finalizeConfirmAttackers` (convex/game.ts), AFTER any tax is paid.
// `AttackManaTaxBanner` / `SacrificeBanner` pin to that SAME portrait top
// strip (`usePromptBannerPosition`), with dragging disabled — so the two
// stacked directly on top of each other with no way for the player to
// separate them. This suite pins the fix: the dock suppresses itself the
// moment either tax takes over the prompt.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { Combat, Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";

// The dock's own BandFormationPanel calls useMutation (createBand/removeBand)
// unconditionally — stub it out, irrelevant to this positioning/gating suite.
vi.mock("convex/react", () => ({
    useMutation: () => async () => {},
}));
vi.mock("@convex/_generated/api", () => ({
    api: { game: { createBand: {}, removeBand: {} } },
}));

const { default: CombatPanels } = await import("../combat-panels");

afterEach(cleanup);

function player(over: Partial<Player> = {}): Player {
    return {
        id: "me",
        name: "Me",
        bgColor: "#000",
        life: 20,
        hand: [],
        library: { count: 0 },
        graveyard: [],
        exile: [],
        battlefield: [],
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        ...over,
    } as Player;
}

function baseCombat(over: Partial<Combat> = {}): Combat {
    return {
        attackerIds: ["atk1"],
        confirmed: false,
        blockerAssignments: {},
        blockersConfirmed: false,
        ...over,
    };
}

function renderCombatPanels(combat: Combat) {
    const me = player();
    const value = {
        gameId: "g1" as never,
        playerId: "me",
        activePlayerId: "me",
        priorityPlayerId: "me",
        phase: "DECLARE_ATTACKERS",
        turn: 1,
        stackCount: 0,
        combat,
        allPlayers: [me, player({ id: "opp", name: "Opp" })],
        showAllCards: false,
        debugAllActions: false,
        onSwitchGame: () => {},
    } as unknown as React.ContextType<typeof GameContext>;
    return render(
        <GameContext value={value}>
            <CombatPanels player={me} />
        </GameContext>
    );
}

describe("CombatPanels — declare-attackers dock vs. parked attack tax (issue #1762)", () => {
    it("shows the dock while attackers are still being selected (no tax parked)", () => {
        renderCombatPanels(baseCombat());
        expect(screen.getByText(/Declare attackers:/)).toBeTruthy();
    });

    it("suppresses the dock once a mana attack tax is parked (Propaganda-style)", () => {
        renderCombatPanels(
            baseCombat({
                pendingAttackManaTax: {
                    playerId: "me",
                    cost: { generic: 2 },
                    reason: "Propaganda",
                    tappedLandIds: [],
                },
            })
        );
        expect(screen.queryByText(/Declare attackers:/)).toBeNull();
    });

    it("suppresses the dock once a land-sacrifice attack tax is parked (Flooded Woodlands-style)", () => {
        renderCombatPanels(
            baseCombat({
                pendingAttackSacrifice: {
                    playerId: "me",
                    reason: "Flooded Woodlands",
                    requirements: [{ filter: { types: "Land" }, count: 1 }],
                    picked: [],
                },
            })
        );
        expect(screen.queryByText(/Declare attackers:/)).toBeNull();
    });

    it("keeps the dock hidden once attackers are fully confirmed (pre-existing gate, unchanged)", () => {
        renderCombatPanels(baseCombat({ confirmed: true }));
        expect(screen.queryByText(/Declare attackers:/)).toBeNull();
    });
});
