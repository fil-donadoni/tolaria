// Bot full path for an Improvise cast (CR 702.126a, issue #9909): enumerated
// Move -> `executeMove` -> the REAL `game.ts` mutations.
//
//   702.126a  For each generic mana in this spell's total cost, you may tap an
//             untapped artifact you control rather than pay that mana.
//
// Two Islands, two Ornithopters, two Memnites and Kappa Cannoneer ({5}{U}).
// The executor announces the cast, taps the four artifacts the Move names
// through `tapArtifactForImprovise` — the same mutation a human's click on an
// artifact makes mid-payment — and pays {1}{U} with the Islands through
// `tapForPayment`. What this proves that the GRE test cannot: the server
// accepts each Improvise tap in that order and commits the cast on the last
// mana tap.

import { describe, expect, it } from "vitest";
import { getCardByName } from "@convex/cards";
import {
    announceCast,
    tapArtifactForImprovise,
    tapForPayment,
} from "@convex/game";
import {
    makeMutationCtx,
    runMutation,
    gameStateSeed,
    type Handler,
} from "@convex/__tests__/gameMutationHarness.fixture";
import type { GameState } from "@convex/gre/state";
import { enumerateMoves } from "@convex/gre/moves";
import { buildPositionFromSpec } from "@convex/gre/ai/blade/build";
import { findBladeScenario } from "@convex/gre/ai/blade/registry";
import type { Id } from "@convex/_generated/dataModel";
import { executeMove, type MoveMutations } from "../executor";

const GAME_ID = "game-1" as Id<"games">;
const KAPPA_LABEL =
    "improvise: Kappa Cannoneer is cast with four artifacts paying the generic";
const KAPPA = getCardByName("Kappa Cannoneer").id;

function position(): GameState {
    const scenario = findBladeScenario(KAPPA_LABEL);
    if (!scenario) throw new Error("missing blade entry");
    return buildPositionFromSpec(scenario.spec, scenario.setup, KAPPA_LABEL);
}

type Ctx = Parameters<typeof runMutation>[1];
const real =
    (handler: unknown, ctx: Ctx, calls: string[], name: string) =>
    async (args: Record<string, unknown>) => {
        calls.push(name);
        await runMutation(
            handler as Handler<Record<string, unknown>, void>,
            ctx,
            { gameId: GAME_ID, ...args }
        );
    };

/** `MoveMutations` bound to the REGISTERED handlers this flow uses; every
 *  other mutation throws. */
function serverMutations(ctx: Ctx, calls: string[]): MoveMutations {
    return new Proxy(
        {
            announceCast: real(announceCast, ctx, calls, "announceCast"),
            tapArtifactForImprovise: real(
                tapArtifactForImprovise,
                ctx,
                calls,
                "tapArtifactForImprovise"
            ),
            tapForPayment: real(tapForPayment, ctx, calls, "tapForPayment"),
        } as Record<string, unknown>,
        {
            get(target, key: string) {
                if (key in target) return target[key];
                return () => {
                    throw new Error(`unexpected mutation ${key}`);
                };
            },
        }
    ) as unknown as MoveMutations;
}

const defIdOf = (c: { card: unknown }) => (c.card as { id?: string }).id;

describe("the Bot casts an Improvise spell through the real mutations (CR 702.126a, issue #9909)", () => {
    it("taps the four artifacts for Improvise, pays {1}{U} with the Islands, and the cast commits", async () => {
        const state = position();
        const bot = state.players[0].id;
        const calls: string[] = [];

        const cast = enumerateMoves(state, bot).find(
            (m) => m.kind === "cast-spell"
        );
        expect(
            cast?.kind === "cast-spell" && cast.improviseArtifactIds
        ).toHaveLength(4);

        const stub = makeMutationCtx(bot, [gameStateSeed(state)]);
        await executeMove(cast!, {
            gameId: GAME_ID,
            botId: bot,
            mutations: serverMutations(stub.ctx, calls),
        });
        const after = stub.state();

        expect(calls).toEqual([
            "announceCast",
            "tapArtifactForImprovise",
            "tapArtifactForImprovise",
            "tapArtifactForImprovise",
            "tapArtifactForImprovise",
            "tapForPayment",
        ]);
        expect(after.pendingCast).toBeUndefined();
        expect(after.stack.map(defIdOf)).toEqual([KAPPA]);
        expect(after.players[0].battlefield.every((c) => c.isTapped)).toBe(
            true
        );
    });
});
