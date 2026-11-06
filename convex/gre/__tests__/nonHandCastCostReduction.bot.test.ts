// "Spells you cast from anywhere other than your hand cost {2} less to cast"
// (Sage of the Beyond, issue #7642) along the whole cast path — CR 601.2f: the
// reduction is part of the total cost; CR 601.2a: the zone is the one the spell
// moves out of, and the caster becomes its controller.
//
// Each scenario asks the same board three questions: the affordance gate
// (`getLegalActions`, what the client's Cast button reads), the Bot's enumerator
// (`enumerateMoves`), and the real mutation (`announceCast`). A collector that
// only one of them reads correctly is the parked-unpayable-cast shape of
// issue #2981, so all three must agree on the price.

import { describe, expect, it } from "vitest";
import { announceCast } from "../../game";
import { enumerateMoves } from "../moves";
import { getLegalActions } from "../rules";
import { getPlayer, type CardInstanceState, type GameState } from "../state";
import { compileCard } from "../../oracle/compile";
import { withTemporaryDefinitionAsync } from "../../cards/registry";
import type { CardDefinition } from "../../cards/types";
import {
    makeMutationCtx,
    gameStateSeed,
    runMutation,
    type Handler,
} from "../../__tests__/gameMutationHarness.fixture";
import type { Id } from "../../_generated/dataModel";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";

const SAGE_ORACLE_ID = "fc74f6a6-9064-4e1b-8dc1-446192bbc448";

function sageDefinition(): CardDefinition {
    const outcome = compileCard({
        oracleId: SAGE_ORACLE_ID,
        name: "Sage of the Beyond",
        manaCost: "{5}{U}{U}",
        typeLine: "Creature — Spirit Giant",
        oracleText:
            "Flying\nSpells you cast from anywhere other than your hand cost {2} less to cast.\nForetell {4}{U} (During your turn, you may pay {2} and exile this card from your hand face down. Cast it on a later turn for its foretell cost.)",
        power: "5",
        toughness: "5",
    });
    if (outcome.state === "unparsed") throw new Error("Sage must compile");
    return { ...outcome.definition, id: SAGE_ORACLE_ID, rarity: "rare" };
}

/** {3}{R}: {2} off leaves two mana, generic-only (CR 601.2f). The flashback
 *  cost prices the same, so every zone in the table owes the same total. */
const SPELL: CardDefinition = {
    id: "non-hand-reduction-instant",
    name: "Non-Hand Reduction Instant",
    rarity: "common",
    types: ["Instant"],
    manaCost: { X: 3, R: 1 },
    flashback: { X: 3, R: 1 },
    effects: [{ op: "draw", player: "controller", count: 1 }],
};

type Scenario = {
    /** Where the spell sits, and whose pile that is. */
    zone: "hand" | "exile" | "graveyard";
    zoneOwner: "p1" | "p2";
    sageController: "p1" | "p2";
    /** Floating red mana for the caster, p1. */
    pool: number;
};

function board({ zone, zoneOwner, sageController, pool }: Scenario): GameState {
    const spell = makeInstance(SPELL.id, {
        id: "spell",
        controllerId: zoneOwner,
        ownerId: zoneOwner,
        ...(zone === "exile" ? { castableFromExileBy: "p1" } : {}),
    });
    const sage = makeInstance(SAGE_ORACLE_ID, {
        id: "sage",
        controllerId: sageController,
        ownerId: sageController,
    });
    const seat = (id: "p1" | "p2") =>
        makePlayer(id, {
            ...(zoneOwner === id ? { [zone]: [spell] } : {}),
            battlefield: sageController === id ? [sage] : [],
            ...(id === "p1"
                ? { manaPool: { W: 0, U: 0, B: 0, R: pool, G: 0, C: 0 } }
                : {}),
        });
    return makeState({ players: [seat("p1"), seat("p2")] });
}

const spellIn = (state: GameState, s: Scenario): CardInstanceState =>
    getPlayer(state, s.zoneOwner)[s.zone].find((c) => c.id === "spell")!;

const gateOffers = (state: GameState, s: Scenario) =>
    getLegalActions(
        state,
        getPlayer(state, s.zoneOwner),
        spellIn(state, s),
        false,
        "p1"
    ).includes("cast");

const botOffers = (state: GameState) =>
    enumerateMoves(state, "p1").some(
        (m) => m.kind === "cast-spell" && m.cardInstanceId === "spell"
    );

type AnnounceArgs = {
    gameId: Id<"games">;
    playerId: string;
    cardInstanceId: string;
};

const announce = (state: GameState) => {
    const harness = makeMutationCtx("p1", [gameStateSeed(state)]);
    return runMutation<AnnounceArgs, void>(
        announceCast as unknown as Handler<AnnounceArgs, void>,
        harness.ctx,
        {
            gameId: "game-1" as Id<"games">,
            playerId: "p1",
            cardInstanceId: "spell",
        }
    ).then(() => harness.state());
};

function withDefinitions<T>(fn: () => Promise<T>): Promise<T> {
    return withTemporaryDefinitionAsync(sageDefinition(), () =>
        withTemporaryDefinitionAsync(SPELL, fn)
    );
}

/** The whole path agrees the cast is payable for exactly `pool` mana: offered
 *  by the gate and the Bot, and the mutation commits it and empties the pool. */
async function castsForExactly(s: Scenario): Promise<void> {
    await withDefinitions(async () => {
        const state = board(s);
        expect(gateOffers(state, s)).toBe(true);
        expect(botOffers(state)).toBe(true);
        const after = await announce(state);
        expect(after.pendingCast).toBeUndefined();
        expect(after.stack.map((item) => item.id)).toEqual(["spell"]);
        expect(getPlayer(after, "p1").manaPool.R).toBe(0);
    });
}

/** The whole path agrees the cast costs more than `pool`: neither offered, and
 *  the mutation does not put it on the stack paid. */
async function cannotCastFor(s: Scenario): Promise<void> {
    await withDefinitions(async () => {
        const state = board(s);
        expect(gateOffers(state, s)).toBe(false);
        expect(botOffers(state)).toBe(false);
        await expect(announce(state)).rejects.toThrow();
    });
}

describe("a cast from outside the hand costs {2} less, on the whole path (CR 601.2f / 601.2a)", () => {
    it("exile: gate, Bot and payment all charge two mana", async () => {
        await castsForExactly({
            zone: "exile",
            zoneOwner: "p1",
            sageController: "p1",
            pool: 2,
        });
    });

    it("graveyard: the reduction applies to the flashback cost too (CR 118.9d)", async () => {
        await castsForExactly({
            zone: "graveyard",
            zoneOwner: "p1",
            sageController: "p1",
            pool: 2,
        });
    });

    it("an opponent's exile: the caster's Sage pays for it, at the commit as at the gate (CR 601.2a)", async () => {
        await castsForExactly({
            zone: "exile",
            zoneOwner: "p2",
            sageController: "p1",
            pool: 2,
        });
    });

    it("the hand: two mana is not enough, the full four is charged", async () => {
        const hand: Scenario = {
            zone: "hand",
            zoneOwner: "p1",
            sageController: "p1",
            pool: 2,
        };
        await cannotCastFor(hand);
        await castsForExactly({ ...hand, pool: 4 });
    });

    it("the zone owner's Sage does not pay for the caster's spell: not a spell its controller casts (CR 601.2a)", async () => {
        await cannotCastFor({
            zone: "exile",
            zoneOwner: "p2",
            sageController: "p2",
            pool: 2,
        });
    });
});
