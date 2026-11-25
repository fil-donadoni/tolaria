// Bot enumeration of a cast whose targets depend on the gift's promise
// (CR 702.174m). One variant per promise decision, each announcing exactly the
// targets `announceCast` opens for it: the promised variant may name the
// artifact, the unpromised one may not.

import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { withTemporaryDefinition } from "../../cards";
import { giftCost, giftSpellOps } from "../../cards/abilities/gift";
import type { CardDefinition } from "../../cards/types";
import { ankhOfMishra } from "../../cards/sets/lea/colorless.cards";
import { grizzlyBears } from "../../cards/sets/lea/green.cards";
import { enumerateMoves, type Move } from "../moves";

const BOUNCE: CardDefinition = {
    id: "3a0e1b52-7a66-4f2b-9d57-10348a000011",
    name: "Gift Bounce Probe",
    rarity: "uncommon",
    oracleText: "Gift a card",
    manaCost: {},
    types: ["Instant"],
    kickers: [giftCost("card")],
    targetRequirement: { type: "Creature", count: 1, controller: "opponent" },
    kickedTargetRequirement: {
        type: ["Artifact", "Creature", "Enchantment", "Planeswalker"],
        count: 1,
        excludeTypes: ["Land"],
        controller: "opponent",
    },
    effects: [
        ...giftSpellOps("card"),
        { op: "moveZone", target: { target: 0 }, to: "hand" },
    ],
};

const GATED: CardDefinition = {
    ...BOUNCE,
    id: "3a0e1b52-7a66-4f2b-9d57-10348a000012",
    targetRequirement: undefined,
    kickedTargetRequirement: undefined,
    additionalTargetRequirements: [
        { type: "Creature", count: 1, announcedOnlyIfKicked: true },
    ],
};

type CastMove = Extract<Move, { kind: "cast-spell" }>;

function castTargets(def: CardDefinition): {
    promised: string[][];
    unpromised: string[][];
} {
    const onBoard = (id: string, name: string) =>
        makeInstance(id, { id: name, controllerId: "p2", ownerId: "p2" });
    const state = makeState({
        players: [
            makePlayer("p1", {
                hand: [
                    makeInstance(def.id, {
                        id: "probe",
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "hand",
                    }),
                ],
            }),
            makePlayer("p2", {
                battlefield: [
                    onBoard(ankhOfMishra().id, "ankh"),
                    onBoard(grizzlyBears().id, "bears"),
                ],
            }),
        ],
        phase: "PRECOMBAT_MAIN",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
    const moves = enumerateMoves(state, "p1").filter(
        (m): m is CastMove =>
            m.kind === "cast-spell" && m.cardInstanceId === "probe"
    );
    const of = (paid: boolean) =>
        moves
            .filter((m) => (m.kickerPayments?.gift ?? 0) > 0 === paid)
            .map((m) => m.targets.map((t) => t.id))
            .sort();
    return { promised: of(true), unpromised: of(false) };
}

describe("Bot enumeration follows the gift's promise (CR 702.174m)", () => {
    it("swaps the requirement on the promised variant alone", () => {
        withTemporaryDefinition(BOUNCE, () => {
            expect(castTargets(BOUNCE)).toEqual({
                promised: [["ankh"], ["bears"]],
                unpromised: [["bears"]],
            });
        });
    });

    it("opens a gated group on the promised variant alone", () => {
        withTemporaryDefinition(GATED, () => {
            expect(castTargets(GATED)).toEqual({
                promised: [["bears"]],
                unpromised: [[]],
            });
        });
    });
});
