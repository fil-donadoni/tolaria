// Full path for issue #8687 (CR 112.2, CR 115.7d, CR 118.9): the REGISTERED
// `game.ts` mutations play Commandeer, paid by exiling two blue cards, on the
// opponent's Lightning Bolt, on the stub `MutationCtx`. The Bolt resolves as
// mine, at the target I chose or the one it had, and the client sees it
// through `projectPublicState`.
import { describe, expect, it } from "vitest";
import {
    announceCast,
    cancelTarget,
    passPriority,
    selectCastAlternativeHandCost,
    selectTargets,
} from "../game";
import { projectPublicState } from "../gameProjections";
import { getCardByName, registerTokenDefinition } from "../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../cards/__tests__/setup.helper";
import { compileCard } from "../oracle/compile";
import { oracleCard } from "../oracle/__tests__/oracle.fixture";
import { getPlayer, type GameState } from "../gre/state";
import type { Id } from "../_generated/dataModel";
import {
    gameStateSeed,
    makeMutationCtx,
    runMutation,
    type MutationStub,
} from "./gameMutationHarness.fixture";

const GAME = "game-1" as Id<"games">;
const ME = "u-p1";
const OPP = "u-p2";

// The card as the compiler reads it, whatever the tree's catalogue holds.
const COMMANDEER = "test-commandeer";
const compiled = compileCard(
    oracleCard({
        name: "Commandeer",
        manaCost: "{5}{U}{U}",
        typeLine: "Instant",
        oracleText:
            "You may exile two blue cards from your hand rather than pay this spell's mana cost.\nGain control of target noncreature spell. You may choose new targets for it. (If that spell is an artifact, enchantment, or planeswalker, the permanent enters under your control.)",
        power: undefined,
        toughness: undefined,
    })
);
if (compiled.state === "unparsed") throw new Error("Commandeer unparsed");
registerTokenDefinition({
    ...compiled.definition,
    id: COMMANDEER,
    rarity: "rare",
});

const card = (
    cardId: string,
    instanceId: string,
    owner: string,
    zone: "hand" | "battlefield" | "library"
) =>
    makeInstance(cardId, {
        id: instanceId,
        controllerId: owner,
        ownerId: owner,
        zone,
    });
const named = (name: string) => getCardByName(name).id;

/** The opponent's turn, the opponent holding priority with a Lightning Bolt
 *  and {R}; I hold Commandeer and three Counterspells, so the pitch is a
 *  choice, and control the Bears. */
function board(): GameState {
    return makeState({
        players: [
            makePlayer(ME, {
                hand: [
                    card(COMMANDEER, "commandeer", ME, "hand"),
                    card(named("Counterspell"), "blue1", ME, "hand"),
                    card(named("Counterspell"), "blue2", ME, "hand"),
                    card(named("Counterspell"), "blue3", ME, "hand"),
                ],
                battlefield: [
                    card(named("Grizzly Bears"), "bears", ME, "battlefield"),
                ],
                library: [card(named("Forest"), "my-lib-0", ME, "library")],
            }),
            makePlayer(OPP, {
                hand: [card(named("Lightning Bolt"), "bolt", OPP, "hand")],
                library: [card(named("Mountain"), "opp-lib-0", OPP, "library")],
                manaPool: { W: 0, U: 0, B: 0, R: 1, G: 0, C: 0 },
            }),
        ],
        activePlayerId: OPP,
        priorityPlayerId: OPP,
    });
}

async function call(
    harness: MutationStub,
    fn: unknown,
    args: Record<string, unknown>
): Promise<void> {
    await runMutation<Record<string, unknown>, unknown>(fn, harness.ctx, {
        gameId: GAME,
        ...args,
    });
}

/** Up to the point Commandeer has resolved and offers me the Bolt's targets. */
async function commandeerTheBolt(): Promise<MutationStub> {
    const harness = makeMutationCtx("u", [gameStateSeed(board())]);
    await call(harness, announceCast, {
        playerId: OPP,
        cardInstanceId: "bolt",
    });
    await call(harness, selectTargets, {
        playerId: OPP,
        targets: [{ targetType: "permanent", targetId: "bears" }],
    });
    if (harness.state().priorityPlayerId === OPP)
        await call(harness, passPriority, { playerId: OPP });
    expect(harness.state().priorityPlayerId).toBe(ME);

    await call(harness, announceCast, {
        playerId: ME,
        cardInstanceId: "commandeer",
        alternativeCostId: "pitch-exile-two-blue",
    });
    await call(harness, selectTargets, {
        playerId: ME,
        targets: [{ targetType: "spell", targetId: "bolt" }],
    });
    await call(harness, selectCastAlternativeHandCost, {
        playerId: ME,
        cardInstanceIds: ["blue1", "blue2"],
    });
    expect(harness.state().stack.map((s) => s.id)).toEqual([
        "bolt",
        "commandeer",
    ]);
    expect(
        getPlayer(harness.state(), ME)
            .exile.map((c) => c.id)
            .sort()
    ).toEqual(["blue1", "blue2"]);

    for (let guard = 0; guard < 4; guard++) {
        const live = harness.state();
        if (live.pendingTarget) break;
        await call(harness, passPriority, {
            playerId: live.priorityPlayerId,
        });
    }
    expect(harness.state().stack.map((s) => s.id)).toEqual(["bolt"]);
    return harness;
}

async function resolveTheStack(harness: MutationStub): Promise<void> {
    for (let guard = 0; guard < 8; guard++) {
        const live = harness.state();
        if (live.stack.length === 0) return;
        await call(harness, passPriority, {
            playerId: live.priorityPlayerId,
        });
    }
}

describe("Commandeer through the game mutations (CR 112.2, CR 115.7d)", () => {
    it("the client sees the Bolt become mine and the offer raised at me", async () => {
        const harness = await commandeerTheBolt();
        const view = projectPublicState(harness.state(), 1, OPP);
        const bolt = view.stack.find((s) => s.id === "bolt")!;
        expect(bolt.castById).toBe(ME);
        expect(bolt.ownerId).toBe(OPP);
        expect(view.pendingTarget).toMatchObject({
            kind: "retarget",
            playerId: ME,
            cardInstanceId: "bolt",
        });
    });

    it("choosing a new target points the stolen Bolt at it, and the card goes home", async () => {
        const harness = await commandeerTheBolt();
        const before = getPlayer(harness.state(), OPP).life;
        await call(harness, selectTargets, {
            playerId: ME,
            targets: [{ targetType: "player", targetId: OPP }],
        });
        await resolveTheStack(harness);

        const state = harness.state();
        expect(getPlayer(state, OPP).life).toBe(before - 3);
        expect(
            getPlayer(state, ME).battlefield.find((c) => c.id === "bears")!
                .damageMarked ?? 0
        ).toBe(0);
        expect(getPlayer(state, OPP).graveyard.map((c) => c.id)).toEqual([
            "bolt",
        ]);
        expect(getPlayer(state, ME).graveyard.map((c) => c.id)).toEqual([
            "commandeer",
        ]);
    });

    it("declining leaves the target unchanged, and the Bolt still resolves as mine", async () => {
        const harness = await commandeerTheBolt();
        await call(harness, cancelTarget, { playerId: ME });

        const live = harness.state();
        expect(live.pendingTarget).toBeUndefined();
        const bolt = live.stack.find((s) => s.id === "bolt")!;
        expect(bolt.castById).toBe(ME);
        expect(bolt.targets).toEqual([{ type: "permanent", id: "bears" }]);
    });
});
