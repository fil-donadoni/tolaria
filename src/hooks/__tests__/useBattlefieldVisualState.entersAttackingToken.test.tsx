// Frontend wiring for CR 508.4 `entersAttacking` tokens (issue #1195 review
// finding, fix 2). Satya, Aetherflux Genius's attack trigger creates a
// tapped-and-attacking token COPY mid-combat via `TokenSpec.entersAttacking`
// (`gre/state.ts` `createTokenPermanents`, routed through the shared
// `markAttacking` helper, `gre/combat.ts`). The reviewer found the token was
// a real attacker server-side (it dealt combat damage) yet rendered as a
// non-attacker client-side, because `isBlockerTarget`/combat-ring gating
// (`useBattlefieldVisualState.ts` lines 366/474/506/534) and the blocker-
// assignment click gate (`useBattlefieldInteraction.tsx:514`) all read
// `card.isAttacking`, not `combat.attackerIds` membership.
//
// This test drives the affordance THROUGH the real reducers — a REAL GRE
// GameState creates the token via `ctx.createToken({ entersAttacking: true
// })` (the exact mechanism Satya's `createTokenCopy` Op uses), the state is
// projected via `projectPublicState` (the real wire boundary), and the
// PROJECTED card is fed into `useBattlefieldVisualState`. A hand-built
// `CardInstance` with `isAttacking: true` typed in by hand would NOT catch a
// regression where `markAttacking`/the projection drops the flag — only the
// real reducer path does (`.claude/rules/gre-development.md` § Frontend
// wiring analysis).
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import type { CardInstance, Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import { useBattlefieldVisualState } from "../useBattlefieldVisualState";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../convex/cards/__tests__/setup";
import { buildSpellContext } from "../../../convex/gre/state";
import { grizzlyBears } from "../../../convex/cards/sets/lea/green";
import { projectPublicState } from "../../../convex/gameProjections";
import { pushSpell } from "../../../convex/cards/__tests__/setup";

vi.mock("~/hooks/usePendingChoiceBuffer", () => ({
    usePendingChoiceBuffer: () => ({
        buffer: [],
        toggle: vi.fn(),
        clear: vi.fn(),
        submit: vi.fn(),
        isPending: false,
        lastError: null,
        dismissError: vi.fn(),
    }),
}));

// No `@convex/cards` mock here (unlike sibling attack-target tests): the
// token is a REAL registered token definition (`registerTokenDefinition`,
// `gre/state.ts` `createTokenPermanents`), so the real `getDefinition` /
// `tryGetDefinition` resolve it without a stub.

function player(id: string, battlefield: CardInstance[]): Player {
    return {
        id,
        name: id,
        bgColor: "#000",
        life: 20,
        hand: [],
        library: { count: 0 },
        graveyard: [],
        exile: [],
        battlefield,
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    } as Player;
}

type Ctx = React.ContextType<typeof GameContext>;

/** Builds a REAL fat GameState (p1 attacking with `atk1`, p2 defending),
 *  creates an `entersAttacking` token via `ctx.createToken` — the same
 *  primitive Satya's `createTokenCopy` Op drives — and projects it for the
 *  DEFENDER (p2), who is the viewer picking blockers. Returns the projected
 *  token `CardInstance` as the frontend actually receives it. */
function buildProjectedAttackingToken(): CardInstance {
    const attacker = makeInstance(grizzlyBears.id, {
        id: "atk1",
        controllerId: "p1",
        ownerId: "p1",
    });
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [attacker] }),
            makePlayer("p2"),
        ],
        combat: {
            attackerIds: ["atk1"],
            confirmed: true,
            blockerAssignments: {},
            blockersConfirmed: false,
        },
    });
    const item = pushSpell(state, grizzlyBears.id, "p1");
    const ctx = buildSpellContext(state, item);
    const [tokenId] = ctx.createToken(
        {
            name: "Satya Copy Token",
            types: ["Creature"],
            power: 2,
            toughness: 2,
            entersTapped: true,
            entersAttacking: true,
        },
        "p1"
    );
    // Viewer is p2 — the defender about to assign a blocker to this token.
    const projected = projectPublicState(state, 1, "p2");
    const slim = projected.players[0].battlefield.find(
        (c) => c.id === tokenId
    )!;
    return slim as unknown as CardInstance;
}

function renderForDefender(
    me: Player,
    opp: Player,
    combatOverrides: Record<string, unknown> = {}
) {
    const ctx = {
        gameId: "game-id" as never,
        playerId: "me",
        activePlayerId: "opp",
        priorityPlayerId: "me",
        phase: "DECLARE_BLOCKERS",
        turn: 1,
        stackCount: 0,
        allPlayers: [me, opp],
        showAllCards: false,
        debugAllActions: false,
        combat: {
            attackerIds: ["atk1"],
            confirmed: true,
            blockerAssignments: {},
            blockersConfirmed: false,
            pendingBlockerId: "myBlocker1",
            ...combatOverrides,
        },
    } as unknown as NonNullable<Ctx>;
    const wrapper = ({ children }: { children: ReactNode }) => (
        <GameContext value={ctx}>{children}</GameContext>
    );
    // The token sits on the ATTACKER's ("opp") board, so drive the hook for opp.
    return renderHook(() => useBattlefieldVisualState(opp), { wrapper });
}

describe("entersAttacking token — blocker-assignment affordance through the real reducer (issue #1195 fix 2)", () => {
    it("a token that entered the battlefield already attacking is a legal block-assignment target for the defender", () => {
        const token = buildProjectedAttackingToken();
        // Sanity: the projection preserved BOTH attacking representations —
        // this is what fix 1 (the shared `markAttacking` helper) guarantees.
        expect(token.isAttacking).toBe(true);

        const me = player("me", []);
        const opp = player("opp", [token]);
        const { result } = renderForDefender(me, opp);

        expect(result.current.canInteract(token)).toBe(true);
        expect(result.current.getVisualState(token).interactive).toBe(true);
    });

    it("regression guard: with isAttacking stripped (simulating the pre-fix bug), the SAME token is NOT a legal block-assignment target", () => {
        const token = buildProjectedAttackingToken();
        const halfAttackingToken: CardInstance = {
            ...token,
            isAttacking: undefined,
        };

        const me = player("me", []);
        const opp = player("opp", [halfAttackingToken]);
        const { result } = renderForDefender(me, opp);

        expect(result.current.canInteract(halfAttackingToken)).toBe(false);
    });
});
