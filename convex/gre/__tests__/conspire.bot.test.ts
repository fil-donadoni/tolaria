// Bot reachability for Conspire (CR 702.78, issue #4012).
//
//   ENUMERATION — `enumerateKickerVariants` is keyword-blind, so the entry is
//     offered like any other, gated by the same `canPayKickerLegs` the server
//     prices (colour clause included).
//   EXECUTION — the search sandbox taps the creatures through
//     `applySacrificeSelection` and casts through `emitSpellCastEvent`, so the
//     model gets the cast-copy trigger the server would build.
//   TAP PLAN — the executor announces before it taps, and a creature spoken for
//     by the tap leg cannot also tap for mana (`tapForPayment` refuses it), so
//     no Move may plan the same creature for both.
//
// The choice surface raises nothing new: the picks answer the `selectSacrifice`
// park through `pickForOwedPayment`, and the copy's CR 707.10c offer is the
// copy-retarget the Bot already answers for Storm.
import { describe, expect, it } from "vitest";
import { enumerateMoves, type Move } from "../moves";
import { applyMoveForSearch } from "../applyMove";
import type { CardInstanceState, GameState } from "../state";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { conspireCost } from "../../cards/abilities/conspire";
import { getCardByName } from "../../cards";
import { withTemporaryDefinition } from "../../cards/registry";
import { lightningBolt } from "../../cards/sets/lea/index.cards";
import type { CardDefinition } from "../../cards/types";

const BOT = "p1";
const HILL_GIANT = getCardByName("Hill Giant").id;
const GRIZZLY_BEARS = getCardByName("Grizzly Bears").id;
const MOUNTAIN = getCardByName("Mountain").id;
const LLANOWAR_ELVES = getCardByName("Llanowar Elves").id;

const SPELL: CardDefinition = {
    ...lightningBolt(),
    id: "conspire-spell",
    name: "Conspire Spell",
    manaCost: { R: 1 },
    staticAbilities: ["conspire"],
    kickers: [conspireCost()],
};

function permanent(id: string, cardId: string): CardInstanceState {
    return makeInstance(cardId, {
        id,
        zone: "battlefield",
        controllerId: BOT,
        ownerId: BOT,
    });
}

function board(battlefield: CardInstanceState[], def = SPELL): GameState {
    return makeState({
        players: [
            makePlayer(BOT, {
                hand: [
                    makeInstance(def.id, {
                        id: "spell",
                        zone: "hand",
                        controllerId: BOT,
                        ownerId: BOT,
                    }),
                ],
                battlefield,
            }),
            makePlayer("p2"),
        ],
        activePlayerId: BOT,
        priorityPlayerId: BOT,
    });
}

function castMoves(state: GameState) {
    return enumerateMoves(state, BOT).filter(
        (m): m is Extract<Move, { kind: "cast-spell" }> =>
            m.kind === "cast-spell" && m.cardInstanceId === "spell"
    );
}
const conspired = (state: GameState) =>
    castMoves(state).filter((m) => m.kickerPayments?.conspire === 1);

describe("Conspire — the Bot can reach it (CR 702.78a)", () => {
    it("offers the conspired cast beside the plain one", () =>
        withTemporaryDefinition(SPELL, () => {
            const state = board([
                permanent("m", MOUNTAIN),
                permanent("a", HILL_GIANT),
                permanent("b", HILL_GIANT),
            ]);
            expect(conspired(state).length).toBeGreaterThan(0);
            expect(
                castMoves(state).some((m) => m.kickerPayments === undefined)
            ).toBe(true);
        }));

    it("does not offer it without two creatures sharing a colour", () =>
        withTemporaryDefinition(SPELL, () => {
            const state = board([
                permanent("m", MOUNTAIN),
                permanent("a", HILL_GIANT),
                permanent("g", GRIZZLY_BEARS),
            ]);
            expect(castMoves(state).length).toBeGreaterThan(0);
            expect(conspired(state)).toHaveLength(0);
        }));

    it("the sandbox taps both creatures and builds the copy", () =>
        withTemporaryDefinition(SPELL, () => {
            const state = board([
                permanent("m", MOUNTAIN),
                permanent("a", HILL_GIANT),
                permanent("b", HILL_GIANT),
            ]);
            // At a player, so the spell's own damage leaves the board alone.
            const move = conspired(state).find(
                (m) => m.targets?.[0]?.type === "player"
            )!;
            const after = applyMoveForSearch(state, BOT, move);
            const me = after.players[0].battlefield;
            expect(me.find((c) => c.id === "a")?.isTapped).toBe(true);
            expect(me.find((c) => c.id === "b")?.isTapped).toBe(true);
            // The sandbox drains the cast-induced segment, so the trigger has
            // already resolved: its copy is parked on the CR 707.10c offer.
            expect(after.pendingTarget?.kind).toBe("copy-retarget");
        }));

    it("never plans a creature for both the tap leg and the mana", () => {
        const greenSpell: CardDefinition = {
            ...SPELL,
            manaCost: { G: 1 },
        };
        withTemporaryDefinition(greenSpell, () => {
            // Only two green creatures, one of them the only green source: the
            // cost takes both, so nothing is left to pay {G}.
            const forced = board(
                [permanent("e", LLANOWAR_ELVES), permanent("g", GRIZZLY_BEARS)],
                greenSpell
            );
            expect(conspired(forced)).toHaveLength(0);
            expect(castMoves(forced).length).toBeGreaterThan(0);
        });
    });
});
