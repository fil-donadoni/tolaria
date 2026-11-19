// The predefined tokens whose specs are pure Effect Script data — Gold (CR
// 111.10c), Shard (CR 111.10e), Junk (CR 111.10t), Lander (CR 111.10u). Each
// token is created through the real `createToken` Op (a synthetic sorcery,
// the Blood token test's technique), then its own ability is activated
// through the engine's entry point: Gold's mana ability through the
// `tapUntap` mutation's choice branch, the others through the real
// `buildPendingActivation` → `tryAutoCommitPendingActivation` cost payment and
// `resolveTopOfStack`. A last block re-reads every token through
// `projectPublicState`, the view the client renders.

import { describe, expect, it } from "vitest";
import type { EffectOp, EffectTokenSpec } from "../../../types";
import {
    GOLD_TOKEN,
    JUNK_TOKEN,
    LANDER_TOKEN,
    SHARD_TOKEN,
} from "../../../sharedTokens";
import {
    normalizeManaCost,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
} from "../../../../gre/state";
import {
    getCardByName,
    getDefinition,
    registerTokenDefinition,
} from "../../../index";
import {
    buildPendingActivation,
    tapUntap,
    tryAutoCommitPendingActivation,
} from "../../../../game";
import { exileCastPermitted } from "../../../../gre/castCost";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import { projectPublicState } from "../../../../gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
    submitChoice,
} from "../../../__tests__/setup.helper";
import type { Id } from "../../../../_generated/dataModel";
import {
    gameStateSeed,
    makeMutationCtx,
    runMutation,
    type Handler,
} from "../../../../__tests__/gameMutationHarness.fixture";

const BEARS = getCardByName("Grizzly Bears").id;
const FOREST = getCardByName("Forest").id;

/** Resolves a sorcery creating one `spec` token for p1, and returns it. */
function createToken(
    state: GameState,
    spec: EffectTokenSpec
): CardInstanceState {
    const id = `test-create-${spec.name.toLowerCase()}`;
    registerTokenDefinition({
        id,
        name: id,
        rarity: "common",
        manaCost: { B: 1 },
        types: ["Sorcery"],
        effects: [
            { op: "createToken", token: spec, controller: "controller" },
        ] as EffectOp[],
    });
    pushSpell(state, id, "p1");
    resolveTopOfStack(state);
    const token = state.players[0].battlefield.find(
        (c) => c.isToken && c.subtypes.includes(spec.name)
    );
    expect(token).toBeDefined();
    return token!;
}

/** A main-phase board, p1 active with priority and an empty stack. */
function board(p1: Parameters<typeof makePlayer>[1] = {}): GameState {
    return makeState({
        players: [makePlayer("p1", p1), makePlayer("p2")],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "PRECOMBAT_MAIN",
    });
}

/** Pays the token's only ability's costs through the real activation seam;
 *  the ability is on the stack afterwards. */
function activate(state: GameState, token: CardInstanceState): void {
    const def = getDefinition((token.card as { id: string }).id);
    const ability = def.activatedAbilities![0]!;
    state.pendingActivation = buildPendingActivation({
        playerId: "p1",
        cardInstanceId: token.id,
        abilityId: ability.id,
        ability,
        manaCost: ability.cost.mana
            ? normalizeManaCost(ability.cost.mana)
            : undefined,
    });
    tryAutoCommitPendingActivation(state, "p1");
    // CR 602.2 — the sacrifice is a cost, paid on activation: the token is gone before the
    // ability resolves.
    expect(state.players[0].battlefield.some((c) => c.id === token.id)).toBe(
        false
    );
    expect(state.stack).toHaveLength(1);
}

const library = (...ids: string[]) =>
    ids.map((id) =>
        makeInstance(id.startsWith("forest") ? FOREST : BEARS, {
            id,
            ownerId: "p1",
            controllerId: "p1",
            zone: "library",
        })
    );

const POOL = (C: number) => ({ W: 0, U: 0, B: 0, R: 0, G: 0, C });

describe("Gold token (CR 111.10c) — sacrifice: add one mana of any color", () => {
    type TapUntapArgs = {
        gameId: Id<"games">;
        playerId: string;
        cardInstanceId: string;
        manaChoiceIndex?: number;
    };

    it("sacrificing it adds the chosen colour (CR 605.1a)", async () => {
        const state = board();
        const token = createToken(state, GOLD_TOKEN);
        const stub = makeMutationCtx("p1", [gameStateSeed(state)]);

        await runMutation<TapUntapArgs, void>(
            tapUntap as unknown as Handler<TapUntapArgs, void>,
            stub.ctx,
            {
                gameId: "game-1" as Id<"games">,
                playerId: "p1",
                cardInstanceId: token.id,
                manaChoiceIndex: 2,
            }
        );

        const after = stub.state().players[0];
        expect(after.manaPool.B).toBe(1);
        expect(after.manaPool.W ?? 0).toBe(0);
        expect(after.battlefield.some((c) => c.id === token.id)).toBe(false);
    });
});

describe("Shard token (CR 111.10e) — {2}, sacrifice: scry 1, then draw", () => {
    it("is an enchantment; the ability scries the top card, then draws", () => {
        const state = board({
            library: library("top", "second"),
            manaPool: POOL(2),
        });
        const token = createToken(state, SHARD_TOKEN);
        expect(token.types).toEqual(["Enchantment"]);

        activate(state, token);
        resolveTopOfStack(state);
        // CR 701.22a — scry 1: the top card, put on the bottom (the second
        // zone of the order-top choice), so the draw takes the second.
        const head = state.pendingChoices![0]!;
        expect(head.playerId).toBe("p1");
        expect(head.candidateIds).toEqual(["top"]);
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: [],
            secondZoneIds: ["top"],
        });

        const p1 = state.players[0];
        expect(p1.manaPool.C).toBe(0);
        expect(p1.hand.map((c) => c.id)).toEqual(["second"]);
        expect(p1.library.map((c) => c.id)).toEqual(["top"]);
    });
});

describe("Junk token (CR 111.10t) — {T}, sacrifice: exile the top card, play it this turn", () => {
    it("exiles the top card and lets its controller play it", () => {
        const state = board({ library: library("top", "second") });
        const token = createToken(state, JUNK_TOKEN);
        token.isSummoningSick = false;

        activate(state, token);
        resolveTopOfStack(state);

        const p1 = state.players[0];
        const exiled = p1.exile.find((c) => c.id === "top");
        expect(exiled).toBeDefined();
        expect(p1.library.map((c) => c.id)).toEqual(["second"]);
        expect(exileCastPermitted(state, exiled!, "p1")).toBe(true);
        expect(exileCastPermitted(state, exiled!, "p2")).toBe(false);
        // "this turn": the permission's upper bound is the current turn, which
        // the cleanup step revokes; no own-turn window replaces it.
        expect(exiled!.castableFromExileUntilTurn).toBe(state.turn);
        expect(exiled!.castableFromExileUntilOwnTurn).toBeUndefined();
    });
});

describe("Lander token (CR 111.10u) — {2}, {T}, sacrifice: fetch a basic land tapped", () => {
    it("puts the chosen basic land onto the battlefield tapped", () => {
        const state = board({
            library: library("bears", "forest-1"),
            manaPool: POOL(2),
        });
        const token = createToken(state, LANDER_TOKEN);

        activate(state, token);
        resolveTopOfStack(state);
        submitChoice(state, ["forest-1"]);

        const p1 = state.players[0];
        const forest = p1.battlefield.find((c) => c.id === "forest-1");
        expect(forest?.isTapped).toBe(true);
        expect(p1.library.map((c) => c.id)).toEqual(["bears"]);
        expect(p1.manaPool.C).toBe(0);
    });
});

describe("wire format — each token keeps its ability through projectPublicState", () => {
    it.each([
        ["Gold", GOLD_TOKEN, ["Artifact"]],
        ["Shard", SHARD_TOKEN, ["Enchantment"]],
        ["Junk", JUNK_TOKEN, ["Artifact"]],
        ["Lander", LANDER_TOKEN, ["Artifact"]],
    ] as const)("%s", (_name, spec, types) => {
        const state = board();
        const token = createToken(state, spec);
        const slim = projectPublicState(
            state,
            1,
            "p1"
        ).players[0].battlefield.find((c) => c.id === token.id)!;
        expect(slim.types).toEqual(types);
        expect(slim.subtypes).toEqual([spec.name]);
        const def = getDefinition((slim.card as { id: string }).id);
        expect(def.activatedAbilities?.map((a) => a.id)).toEqual(
            spec.activatedAbilities!.map((a) => a.id)
        );
    });
});
