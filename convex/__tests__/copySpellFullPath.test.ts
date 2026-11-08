// Full path for the `copySpell` Op (CR 707.10, CR 707.10c, issue #8580): the
// REGISTERED `game.ts` mutations play Nivix Guildmage's compiled
// "{2}{U}{R}: Copy target instant or sorcery spell you control. You may choose
// new targets for the copy." on my own Lightning Bolt, on the stub
// `MutationCtx`. The copy is mine, the client sees the copy-retarget offer
// through `projectPublicState`, and both Bolts resolve at their targets.
import { describe, expect, it } from "vitest";
import {
    activateAbility,
    announceCast,
    cancelTarget,
    passPriority,
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
const NIVIX = "test-nivix-guildmage";
const compiled = compileCard(
    oracleCard({
        name: "Nivix Guildmage",
        manaCost: "{U}{R}",
        typeLine: "Creature — Human Wizard",
        oracleText:
            "{1}{U}{R}: Draw a card, then discard a card.\n{2}{U}{R}: Copy target instant or sorcery spell you control. You may choose new targets for the copy.",
        power: "2",
        toughness: "2",
    })
);
if (compiled.state === "unparsed") throw new Error("Nivix Guildmage unparsed");
registerTokenDefinition({
    ...compiled.definition,
    id: NIVIX,
    rarity: "uncommon",
});
const COPY_ABILITY = compiled.definition.activatedAbilities![1]!.id;

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

/** My main phase: I hold a Lightning Bolt and {R} + {2}{U}{R} floating, and
 *  control Nivix; the opponent controls the Bears. */
function board(): GameState {
    return makeState({
        players: [
            makePlayer(ME, {
                hand: [card(named("Lightning Bolt"), "bolt", ME, "hand")],
                battlefield: [card(NIVIX, "nivix", ME, "battlefield")],
                library: [card(named("Forest"), "my-lib-0", ME, "library")],
                manaPool: { W: 0, U: 1, B: 0, R: 2, G: 0, C: 2 },
            }),
            makePlayer(OPP, {
                battlefield: [
                    card(named("Grizzly Bears"), "bears", OPP, "battlefield"),
                ],
                library: [card(named("Mountain"), "opp-lib-0", OPP, "library")],
            }),
        ],
        activePlayerId: ME,
        priorityPlayerId: ME,
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

/** Up to the point Nivix's ability has resolved and offers me the copy's
 *  targets. */
async function copyTheBolt(): Promise<MutationStub> {
    const harness = makeMutationCtx("u", [gameStateSeed(board())]);
    await call(harness, announceCast, {
        playerId: ME,
        cardInstanceId: "bolt",
        keepPriority: true,
    });
    await call(harness, selectTargets, {
        playerId: ME,
        targets: [{ targetType: "permanent", targetId: "bears" }],
    });
    // The engine hands priority across after a cast; `keepPriority` brings it
    // back to me once the opponent passes, the Bolt still on the stack.
    if (harness.state().priorityPlayerId === OPP)
        await call(harness, passPriority, { playerId: OPP });
    expect(harness.state().priorityPlayerId).toBe(ME);
    expect(harness.state().stack.map((s) => s.id)).toEqual(["bolt"]);

    await call(harness, activateAbility, {
        playerId: ME,
        cardInstanceId: "nivix",
        abilityId: COPY_ABILITY,
    });
    await call(harness, selectTargets, {
        playerId: ME,
        targets: [{ targetType: "spell", targetId: "bolt" }],
    });
    expect(harness.state().stack).toHaveLength(2);

    for (let guard = 0; guard < 4; guard++) {
        const live = harness.state();
        if (live.pendingTarget) break;
        await call(harness, passPriority, {
            playerId: live.priorityPlayerId,
        });
    }
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

describe("Nivix Guildmage's copy through the game mutations (CR 707.10, CR 707.10c)", () => {
    it("the client sees my copy of the Bolt and the offer raised at me", async () => {
        const harness = await copyTheBolt();
        const view = projectPublicState(harness.state(), 1, OPP);
        const copy = view.stack.find((s) => s.isCopy === true)!;
        expect(copy).toBeDefined();
        expect(copy.controllerId).toBe(ME);
        expect(view.stack.map((s) => s.id)).toEqual(["bolt", copy.id]);
        expect(view.pendingTarget).toMatchObject({
            kind: "copy-retarget",
            playerId: ME,
            cardInstanceId: copy.id,
        });
    });

    it("pointing the copy at the opponent: the Bears die and the opponent takes 3", async () => {
        const harness = await copyTheBolt();
        const before = getPlayer(harness.state(), OPP).life;
        await call(harness, selectTargets, {
            playerId: ME,
            targets: [{ targetType: "player", targetId: OPP }],
        });
        await resolveTheStack(harness);

        const state = harness.state();
        expect(getPlayer(state, OPP).life).toBe(before - 3);
        expect(getPlayer(state, OPP).graveyard.map((c) => c.id)).toEqual([
            "bears",
        ]);
        // CR 707.10a — the copy ceases to exist; only the card goes to the
        // graveyard.
        expect(getPlayer(state, ME).graveyard.map((c) => c.id)).toEqual([
            "bolt",
        ]);
    });

    it("declining keeps the copy's inherited target (CR 707.10c)", async () => {
        const harness = await copyTheBolt();
        await call(harness, cancelTarget, { playerId: ME });
        const live = harness.state();
        expect(live.pendingTarget).toBeUndefined();
        const copy = live.stack.find((s) => s.isCopy === true)!;
        expect(copy.targets).toEqual([{ type: "permanent", id: "bears" }]);
    });
});
