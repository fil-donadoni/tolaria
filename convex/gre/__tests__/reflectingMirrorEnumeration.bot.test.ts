// CR 107.3 (issue #3117) — Reflecting Mirror's `{X}, {T}: … X is twice the
// mana value of that spell.` prices X from the CHOSEN spell target, not from
// the player. Only `finalizeTargetSelection` (`game.ts`) derived it;
// `enumerateAbilityMoves` normalized `cost.mana` with no `chosenX`, so
// `normalizeManaCost({ X: "X" })` folded to the empty record and the Bot
// priced the ability at `{T}` alone — always "affordable", and always
// rejected at commit once the server charged 2x the target's mana value.
//
// Both sites now call the ONE shared derivation (`deriveXFromTargetSpellMv`,
// `gre/activation.ts`), and because the price depends on WHICH spell got
// targeted, `enumerateAbilityMoves` computes it per target tuple rather than
// once per ability.

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import { enumerateMoves, type Move } from "../moves";
import { activateAbilityOnState, finalizeTargetSelection } from "../../game";
import { cloneGameState } from "../clone";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup";
import type { GameState } from "../state";

const BOT = "p2";
const OPP = "p1";

const MIRROR = getCardByName("Reflecting Mirror").id;
const BOLT = getCardByName("Lightning Bolt").id;
const FIREBALL = getCardByName("Fireball").id;
const MOUNTAIN = getCardByName("Mountain").id;
const MIRROR_ABILITY = "reflecting-mirror-retarget";

/** The Bot controls Reflecting Mirror plus `mountains` untapped Mountains;
 *  the opponent casts a single Lightning Bolt (MV 1) at the Bot — a legal
 *  Mirror target whose derived cost is X = 2 (2 * MV 1). */
function board(mountains: number): {
    state: GameState;
    bolt: ReturnType<typeof pushSpell>;
} {
    const lands = Array.from({ length: mountains }, (_, i) =>
        makeInstance(MOUNTAIN, {
            id: `mtn${i}`,
            controllerId: BOT,
            ownerId: BOT,
        })
    );
    const state = makeState({
        players: [
            makePlayer(OPP),
            makePlayer(BOT, {
                battlefield: [
                    makeInstance(MIRROR, {
                        id: "mirror",
                        controllerId: BOT,
                        ownerId: BOT,
                    }),
                    ...lands,
                ],
            }),
        ],
        activePlayerId: OPP,
        priorityPlayerId: BOT,
    });
    const bolt = pushSpell(state, BOLT, OPP, [{ type: "player", id: BOT }]);
    return { state, bolt };
}

const mirrorMoves = (state: GameState) =>
    enumerateMoves(state, BOT).filter(
        (m): m is Extract<Move, { kind: "activate-ability" }> =>
            m.kind === "activate-ability" && m.cardInstanceId === "mirror"
    );

describe("Reflecting Mirror — the enumerator prices the derived X (issue #3117)", () => {
    it("enumerates NO move with zero Mountains — X=2 is unaffordable", () => {
        const { state } = board(0);
        expect(mirrorMoves(state)).toEqual([]);
    });

    it("enumerates NO move with one Mountain — still short of X=2", () => {
        const { state } = board(1);
        expect(mirrorMoves(state)).toEqual([]);
    });

    it("enumerates exactly one move with two Mountains, whose tapPlan taps both Mountains and not the Mirror", () => {
        const { state } = board(2);
        const moves = mirrorMoves(state);
        expect(moves).toHaveLength(1);
        expect(moves[0]!.tapPlan.map((t) => t.cardInstanceId).sort()).toEqual([
            "mtn0",
            "mtn1",
        ]);
        expect(
            moves[0]!.tapPlan.some((t) => t.cardInstanceId === "mirror")
        ).toBe(false);
    });
});

describe("Reflecting Mirror — X is derived PER TARGET, not per ability (issue #3117)", () => {
    it("offers the cheap spell target and skips a costlier one out of the SAME tuple set", () => {
        const { state, bolt: cheapBolt } = board(2);
        // A second single-target spell at the Bot with mana value 6 — a
        // Fireball ({X}{R}) cast for X = 5 (CR 202.3e) — so derived X = 12,
        // unaffordable with two Mountains while the cheap Bolt's X = 2 stays
        // payable.
        const priceyBolt = pushSpell(state, FIREBALL, OPP, [
            { type: "player", id: BOT },
        ]);
        priceyBolt.chosenX = 5;

        const moves = mirrorMoves(state);
        expect(moves).toHaveLength(1);
        expect(moves[0]!.targets.map((t) => t.id)).toEqual([cheapBolt.id]);
    });
});

describe("Reflecting Mirror — the enumerated move commits through the real mutation (CR 107.3)", () => {
    it("activateAbilityOnState → finalizeTargetSelection lands the ability on the stack after the tapPlan is applied", () => {
        const { state, bolt } = board(2);
        const move = mirrorMoves(state)[0];
        expect(move).toBeDefined();

        const clone = cloneGameState(state);
        const bot = clone.players.find((p) => p.id === BOT)!;
        // Apply the enumerated tapPlan exactly as the executor would: tap each
        // named Mountain and credit its mana to the pool.
        for (const tap of move!.tapPlan) {
            const land = bot.battlefield.find(
                (c) => c.id === tap.cardInstanceId
            )!;
            land.isTapped = true;
            bot.manaPool.R += 1;
        }

        activateAbilityOnState(clone, {
            playerId: BOT,
            cardInstanceId: "mirror",
            abilityId: MIRROR_ABILITY,
        });
        const pt = clone.pendingTarget!;
        expect(
            pt,
            "the server parks a pendingTarget for a targeted ability"
        ).toBeDefined();
        pt.selected = move!.targets;
        finalizeTargetSelection(clone, pt, BOT);

        expect(clone.pendingActivation).toBeUndefined();
        expect(bot.battlefield.find((c) => c.id === "mirror")!.isTapped).toBe(
            true
        );
        const abilityItem = clone.stack.find(
            (i) => i.abilityId === MIRROR_ABILITY
        );
        expect(abilityItem).toBeDefined();
        expect(abilityItem!.chosenX).toBe(2);
        expect(abilityItem!.targets?.map((t) => t?.id)).toEqual([bolt.id]);
    });
});
