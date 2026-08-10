// Integration test for issue #2423: `EffectTokenSpec.activatedAbilities`
// (the JSON-pure token ability shape a DSL `createToken` Op can carry, issue
// #1191) now accepts `manaChoices` — a runtime colour-choice mana ability,
// the Treasure shape ("{T}, Sacrifice this artifact: Add one mana of any
// color.") — not only a fixed `addMana` amount.
//
// The issue's own analysis argued the widened grammar needs NO engine
// change: `createTokenPermanents` (`gre/state.ts`) already registers
// `spec.activatedAbilities` verbatim onto the token's synthesized
// `CardDefinition`, and the mana-tap-choice machinery
// (`hasManaAbility`/`getActivatedManaAbility`, `gre/constants.ts`; the commit
// path in `game.ts`'s `tapUntap`) reads `manaChoices` off whatever
// `ActivatedAbility` it finds there, with no card-vs-token distinction. This
// test does not trust that analysis — it drives the claim through the REAL
// tap-for-mana choice path (the registered `tapUntap` mutation, same harness
// discipline as `tapUntapRestrictedManaAbility.test.ts`) and asserts the
// token's choice list is populated identically to a card-level `manaChoices`
// ability's list, including after the wire projection.
//
// Three things are proven, one `it` each:
//  1. The widened validator allowlist actually accepts the shape
//     (`isTokenActivatedAbility`, `gre/effects/validate.ts`) — the exact
//     reproduction the issue's "Empirical proof" section describes.
//  2. Tapping the DSL-created token for a chosen color through `tapUntap`
//     floats the SAME mana a card-level `manaChoices` ability would.
//  3. The tap-for-mana choice list (`getManaTapOptions`) is identical before
//     and after `projectPublicState` — the wire-format assertion the GRE
//     testing convention requires for anything visible on the board.

import { describe, it, expect } from "vitest";
import { tapUntap } from "../game";
import { makeState, makePlayer, pushSpell } from "../cards/__tests__/setup";
import { resolveTopOfStack, type CardInstanceState } from "../gre/state";
import { getManaTapOptions } from "../gre/constants";
import { projectPublicState } from "../gameProjections";
import { registerTokenDefinition } from "../cards";
import { EFFECT_TREASURE_TOKEN } from "../cards/sharedTokens";
import { validateEffectScript } from "../gre/effects/validate";
import type { GameState } from "../gre/state";
import type { CardDefinition } from "../cards/types";
import type { Id } from "../_generated/dataModel";
import {
    makeMutationCtx,
    runMutation,
    gameStateSeed,
    type Handler,
} from "./gameMutationHarness";

const GAME_ID = "game-1" as Id<"games">;

type TapUntapArgs = {
    gameId: Id<"games">;
    playerId: string;
    cardInstanceId: string;
    manaChoiceIndex?: number;
};

const runTapUntap = (
    ctx: Parameters<typeof runMutation>[1],
    args: Omit<TapUntapArgs, "gameId" | "playerId">
) =>
    runMutation<TapUntapArgs, void>(
        tapUntap as unknown as Handler<TapUntapArgs, void>,
        ctx,
        { gameId: GAME_ID, playerId: "p1", ...args }
    );

// A synthetic DSL-only sorcery whose only effect is `createToken` with the
// DSL-legal `EFFECT_TREASURE_TOKEN` spec — the same `createToken` Op
// execution path any real card (e.g. the future Generous Plunderer, #2368)
// would use. Test-only id, never entering `getAllCards()`.
const CREATE_TREASURE_SPELL_ID = "test-token-manachoices-treasure-spell";
registerTokenDefinition({
    id: CREATE_TREASURE_SPELL_ID,
    name: CREATE_TREASURE_SPELL_ID,
    rarity: "common",
    manaCost: { generic: 1 },
    types: ["Sorcery"],
    effects: [
        {
            op: "createToken",
            token: EFFECT_TREASURE_TOKEN,
            controller: "controller",
        },
    ],
});

/** Resolves the synthetic sorcery and returns the resulting state plus the
 *  created Treasure token's instance id. */
function treasureTokenState(): { state: GameState; tokenId: string } {
    const state = makeState({
        players: [makePlayer("p1"), makePlayer("p2")],
    });
    pushSpell(state, CREATE_TREASURE_SPELL_ID, "p1", []);
    resolveTopOfStack(state);
    const token = state.players[0].battlefield.find((c) => c.isToken)!;
    return { state, tokenId: token.id };
}

describe("DSL createToken token.activatedAbilities.manaChoices (issue #2423)", () => {
    it("validateEffectScript accepts a createToken script whose token ability carries manaChoices", () => {
        // Reproduces the issue's own "Empirical proof" repro: before the
        // fix, this failed with `Op "createToken" field "token" has invalid
        // value ... "manaChoices"` — `isTokenActivatedAbility`'s allowed-key
        // Set rejected the field outright.
        const def: CardDefinition = {
            id: "test-validate-treasure-manachoices",
            name: "test-validate-treasure-manachoices",
            rarity: "common",
            manaCost: { generic: 1 },
            types: ["Sorcery"],
            effects: [
                {
                    op: "createToken",
                    token: EFFECT_TREASURE_TOKEN,
                    controller: "controller",
                },
            ],
        };
        expect(validateEffectScript(def)).toEqual([]);
    });

    it("tapping the DSL-created Treasure for a chosen color floats the SAME mana a card-level manaChoices ability would (CR 605.1a)", async () => {
        const { state, tokenId } = treasureTokenState();
        const stub = makeMutationCtx("p1", [gameStateSeed(state)]);

        // manaChoices order [{W},{U},{B},{R},{G}] (EFFECT_TREASURE_TOKEN,
        // same order as the card-level TREASURE_TOKEN) — index 3 = {R}.
        await runTapUntap(stub.ctx, {
            cardInstanceId: tokenId,
            manaChoiceIndex: 3,
        });

        const after = stub.state();
        // CR 605.1a's cost is `{T}, Sacrifice this artifact` — the token
        // leaves the battlefield for the graveyard.
        expect(after.players[0].battlefield.some((c) => c.id === tokenId)).toBe(
            false
        );
        expect(after.players[0].graveyard.some((c) => c.id === tokenId)).toBe(
            true
        );
        expect(after.players[0].manaPool.R).toBe(1);
        // No other color was credited.
        expect(after.players[0].manaPool.W).toBe(0);
        expect(after.players[0].manaPool.U).toBe(0);
        expect(after.players[0].manaPool.B).toBe(0);
        expect(after.players[0].manaPool.G).toBe(0);
    });

    it("the tap-for-mana choice list is populated identically to a card-level manaChoices ability, before and after wire projection", () => {
        const { state, tokenId } = treasureTokenState();
        const token = state.players[0].battlefield.find(
            (c) => c.id === tokenId
        )!;
        const battlefields = state.players.map((p) => ({
            playerId: p.id,
            battlefield: p.battlefield,
        }));

        // Same 5-entry any-color list a card-level `manaChoices` ability
        // (TREASURE_TOKEN, `sharedTokens.ts`) produces — identical shape,
        // identical order.
        const expectedChoices = [
            { W: 1 },
            { U: 1 },
            { B: 1 },
            { R: 1 },
            { G: 1 },
        ];
        const rawOptions = getManaTapOptions(token, "p1", battlefields);
        expect(rawOptions).toEqual(expectedChoices);

        // Wire format: the projection strips `card.card` to `{ id }` and
        // reshapes the battlefield array, but the token's synthesized
        // CardDefinition — where `manaChoices` lives — is looked up by id
        // through the same registry client-side, so the SAME reader
        // (`getManaTapOptions`) must return the SAME list run over the
        // projected state.
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === tokenId
        )!;
        const projectedBattlefields = projected.players.map((p) => ({
            playerId: p.id,
            battlefield: p.battlefield as unknown as CardInstanceState[],
        }));
        const projectedOptions = getManaTapOptions(
            slim as unknown as CardInstanceState,
            "p1",
            projectedBattlefields
        );
        expect(projectedOptions).toEqual(expectedChoices);
        expect(projectedOptions).toEqual(rawOptions);
    });
});
