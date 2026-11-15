// "Whenever you cast a multicolored spell, create a 4/4 red and white Golem
// artifact creature token" — General Ferrous Rokiric through the REGISTERED
// `game.ts` mutations (issue #2604, CR 603.2 + CR 105.2b + CR 111.3).
//
// The compiled `spell-cast` head carries `SpellFilter.colorCountAtLeast: 2`.
// Each leg casts a real spell through `announceCast`, passes priority until
// the stack is empty, and reads the outcome off the client projection:
//   - a MULTICOLORED spell (Watchwolf, G+W) fires it — a Golem lands;
//   - a MONOCOLORED spell (Grizzly Bears) does not (CR 105.2a);
//   - a COLOURLESS spell (Ornithopter) does not (CR 105.2c).

import { describe, expect, it } from "vitest";
import * as game from "../game";
import { projectPublicState } from "../gameProjections";
import { getCardByName } from "../cards";
import { matchesSpellFilter } from "../cards/filters";
import { protectionSourceCharacteristics } from "../gre/protection";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../cards/__tests__/setup.helper";
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

const id = (name: string) => getCardByName(name).id;

function board(spellName: string): GameState {
    return makeState({
        players: [
            makePlayer(ME, {
                battlefield: [
                    makeInstance(id("General Ferrous Rokiric"), {
                        id: "rokiric",
                        controllerId: ME,
                        ownerId: ME,
                    }),
                ],
                hand: [
                    makeInstance(id(spellName), {
                        id: "spell",
                        controllerId: ME,
                        ownerId: ME,
                        zone: "hand",
                    }),
                ],
                manaPool: { W: 1, U: 0, B: 0, R: 0, G: 1, C: 1 },
            }),
            makePlayer(OPP),
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

async function castAndResolve(spellName: string): Promise<GameState> {
    const harness = makeMutationCtx("u", [gameStateSeed(board(spellName))]);
    await call(harness, game.announceCast, {
        playerId: ME,
        cardInstanceId: "spell",
    });
    for (let guard = 0; guard < 8; guard++) {
        const live = harness.state();
        if (live.stack.length === 0) return live;
        await call(harness, game.passPriority, {
            playerId: live.priorityPlayerId,
        });
    }
    throw new Error("the stack never emptied");
}

function golems(state: GameState) {
    return projectPublicState(state, 1, ME).players[0].battlefield.filter(
        (c) => c.isToken && c.subtypes.includes("Golem")
    );
}

describe("SpellFilter.colorCountAtLeast (CR 105.2b)", () => {
    const spell = (colors: ("W" | "U" | "B" | "R" | "G" | "C")[]) => ({
        types: ["Creature" as const],
        subtypes: [],
        colors,
    });
    it("two or more of the five colours pass; one, none or colourless fail", () => {
        const filter = { colorCountAtLeast: 2 };
        expect(matchesSpellFilter(spell(["G", "W"]), filter)).toBe(true);
        expect(matchesSpellFilter(spell(["G"]), filter)).toBe(false);
        expect(matchesSpellFilter(spell([]), filter)).toBe(false);
        expect(matchesSpellFilter(spell(["G", "C"]), filter)).toBe(false);
    });
});

describe("General Ferrous Rokiric — whenever you cast a multicolored spell", () => {
    it("a multicolored spell creates a 4/4 red and white Golem artifact creature token", async () => {
        const state = await castAndResolve("Watchwolf");
        expect(getPlayer(state, ME).battlefield.map((c) => c.id)).toContain(
            "spell"
        );
        const made = golems(state);
        expect(made).toHaveLength(1);
        expect(made[0]!.types).toEqual(["Artifact", "Creature"]);
        expect([made[0]!.power, made[0]!.toughness]).toEqual([4, 4]);
        // CR 105.1 — red and white, read through the live-colour authority.
        const fat = getPlayer(state, ME).battlefield.find((c) => c.isToken)!;
        expect([...protectionSourceCharacteristics(fat).colors].sort()).toEqual(
            ["R", "W"]
        );
        // Token art (ADR 0140): the wire names the creating printing, which
        // the client's Token Print chain resolves the Golem art through.
        expect(made[0]!.sourcePrintId).toBe(id("General Ferrous Rokiric"));
    });

    it("must-NOT — a monocolored spell creates nothing", async () => {
        const state = await castAndResolve("Grizzly Bears");
        expect(getPlayer(state, ME).battlefield.map((c) => c.id)).toContain(
            "spell"
        );
        expect(golems(state)).toHaveLength(0);
    });

    it("must-NOT — a colourless spell creates nothing", async () => {
        const state = await castAndResolve("Ornithopter");
        expect(getPlayer(state, ME).battlefield.map((c) => c.id)).toContain(
            "spell"
        );
        expect(golems(state)).toHaveLength(0);
    });
});
