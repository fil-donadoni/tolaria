// Transmute (CR 702.53) — the keyword's permanent test.
//
// Full path: the definition is the one the Oracle compiler produces for a
// real corpus card (`compileCard`), registered for the test's extent, and
// every assertion drives the real mutation entry point
// (`activateAbilityOnState`) and the real resolution (`resolveTopOfStack`).
//
// CR sections exercised: 702.53a (the ability, its discard cost, its from-hand
// permission, the mana-value search, "Activate only as a sorcery"), 202.3 /
// 202.3a (the searched-for mana value is the printed one; no mana cost = 0),
// 701.23b (a search may fail to find).

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { activateAbilityOnState } from "../../game";
import { resolveTopOfStack, type GameState } from "../state";
import { applyPendingChoiceSubmit } from "../pendingChoiceSubmit";
import { refreshExpectedInput } from "../expectedInput";
import { getCardByName, withTemporaryDefinition } from "../../cards";
import type { CardDefinition } from "../../cards/types";
import { compileCard } from "../../oracle/compile";
import { oracleCard } from "../../oracle/__tests__/oracle.fixture";

const DIZZY_SPELL_TEXT =
    "Target creature gets -3/-0 until end of turn.\nTransmute {1}{U}{U} ({1}{U}{U}, Discard this card: Search your library for a card with the same mana value as this card, reveal it, put it into your hand, then shuffle. Transmute only as a sorcery.)";
const TOLARIA_WEST_TEXT =
    "This land enters tapped.\n{T}: Add {U}.\nTransmute {1}{U}{U} ({1}{U}{U}, Discard this card: Search your library for a card with mana value 0, reveal it, put it into your hand, then shuffle. Transmute only as a sorcery.)";

/** The compiled definition of a corpus card, given a registry id. */
function compiledDefinition(
    id: string,
    card: Parameters<typeof oracleCard>[0]
): CardDefinition {
    const outcome = compileCard(oracleCard(card));
    if (outcome.state === "unparsed") throw new Error(`${card.name} unparsed`);
    return { ...outcome.definition, id } as CardDefinition;
}

const DIZZY_SPELL = compiledDefinition("test-dizzy-spell", {
    name: "Dizzy Spell",
    manaCost: "{U}",
    typeLine: "Instant",
    oracleText: DIZZY_SPELL_TEXT,
});
const TOLARIA_WEST = compiledDefinition("test-tolaria-west", {
    name: "Tolaria West",
    manaCost: "",
    typeLine: "Land",
    oracleText: TOLARIA_WEST_TEXT,
});

const ISLAND = getCardByName("Island").id; // mana value 0
const BEARS = getCardByName("Grizzly Bears").id; // mana value 2
const BOLT = getCardByName("Lightning Bolt").id; // mana value 1

/** `sourceId` in p1's hand, `library` in p1's library, {1}{U}{U} floating. */
function board(
    sourceId: string,
    library: { id: string; cardId: string }[]
): GameState {
    const state = makeState({
        players: [
            makePlayer("p1", {
                hand: [
                    makeInstance(sourceId, {
                        id: "transmuter",
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "hand",
                    }),
                ],
                library: library.map((c) =>
                    makeInstance(c.cardId, {
                        id: c.id,
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "library",
                    })
                ),
                manaPool: { W: 0, U: 3, B: 0, R: 0, G: 0, C: 0 },
            }),
            makePlayer("p2"),
        ],
    });
    refreshExpectedInput(state);
    return state;
}

function transmute(state: GameState) {
    activateAbilityOnState(state, {
        playerId: "p1",
        cardInstanceId: "transmuter",
        abilityId: "transmute",
    });
}

const LIBRARY = [
    { id: "island-1", cardId: ISLAND },
    { id: "bears-1", cardId: BEARS },
    { id: "bolt-1", cardId: BOLT },
];

describe("Transmute (CR 702.53a)", () => {
    it("pays the cost, discards this card, and tutors a card of the same mana value", () => {
        withTemporaryDefinition(DIZZY_SPELL, () => {
            const state = board(DIZZY_SPELL.id, LIBRARY);
            transmute(state);

            const p1 = state.players[0];
            // CR 702.53a — "Discard this card" is a cost, paid on activation.
            expect(p1.hand.some((c) => c.id === "transmuter")).toBe(false);
            expect(p1.graveyard.map((c) => c.id)).toEqual(["transmuter"]);
            expect(p1.manaPool.U).toBe(0);
            expect(state.stack).toHaveLength(1);

            expect(resolveTopOfStack(state)).toBeNull();
            const head = state.pendingChoices![0];
            expect(head.kind).toBe("search-library");
            // CR 202.3 — Dizzy Spell {U} has mana value 1: only the Bolt.
            expect(head.candidateIds).toEqual(["bolt-1"]);

            applyPendingChoiceSubmit(state, {
                playerId: "p1",
                stackItemId: head.stackItemId,
                step: head.step,
                choiceId: head.choiceId,
                cardInstanceIds: ["bolt-1"],
            });
            expect(p1.hand.map((c) => c.id)).toEqual(["bolt-1"]);
            expect(p1.library.map((c) => c.id).sort()).toEqual([
                "bears-1",
                "island-1",
            ]);
            expect(state.stack).toHaveLength(0);
        });
    });

    it("CR 202.3a — a card with no mana cost searches for mana value 0 (Tolaria West)", () => {
        withTemporaryDefinition(TOLARIA_WEST, () => {
            const state = board(TOLARIA_WEST.id, LIBRARY);
            transmute(state);
            expect(resolveTopOfStack(state)).toBeNull();
            expect(state.pendingChoices![0].candidateIds).toEqual(["island-1"]);
        });
    });

    it("CR 701.23b — no card of that mana value: the search still happens and finds nothing", () => {
        withTemporaryDefinition(DIZZY_SPELL, () => {
            const state = board(DIZZY_SPELL.id, [
                { id: "bears-1", cardId: BEARS },
            ]);
            transmute(state);
            expect(resolveTopOfStack(state)).toBeNull();
            expect(state.pendingChoices![0].candidateIds).toEqual([]);
        });
    });

    it("CR 602.5d — activate only as a sorcery: refused outside a main phase", () => {
        withTemporaryDefinition(DIZZY_SPELL, () => {
            const state = board(DIZZY_SPELL.id, LIBRARY);
            state.phase = "COMBAT";
            refreshExpectedInput(state);
            expect(() => transmute(state)).toThrow(
                "Activate only as a sorcery"
            );
            expect(state.players[0].hand.map((c) => c.id)).toEqual([
                "transmuter",
            ]);
        });
    });
});
