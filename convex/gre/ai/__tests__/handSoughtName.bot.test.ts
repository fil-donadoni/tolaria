/**
 * Issue #9551 — a `name-card` whose resolving script discards the named cards
 * from a player's hand (Cabal Therapy, CR 701.9 / 701.20a) is an in-tree
 * decision over the names that hand can hold: the cards a reveal has shown,
 * and the decklist's unseen remainder in the worlds that deal it.
 *
 * The positions are the blade entries' own; this file names the mechanism.
 */

import { describe, expect, it } from "vitest";
import { buildBladeState, findBladeScenario, runBladeScenario } from "../blade";
import { seatPlayerId } from "../blade/matcher";
import { choiceCandidates, isSearchableChoiceNode } from "../choiceCandidates";
import { nameSoughtInHandOf } from "../handSoughtName";
import { determinize } from "../../determinize";
import { makeRng } from "../../rng";
import { tryGetDefinition } from "../../../cards";
import { getCardByName } from "../../../cards/catalogue";
import type { GameState, PendingChoice } from "../../state";

const REVEALED =
    "Hand-sought name: Cabal Therapy names a card from the hand a reveal showed";
const DECKLIST =
    "Hand-sought name: Cabal Therapy names a nonland card of the known decklist";

function nameWindow(label: string): { state: GameState; head: PendingChoice } {
    const entry = findBladeScenario(label);
    if (!entry) throw new Error(`No blade entry "${label}"`);
    const state = buildBladeState(entry);
    const head = state.pendingChoices?.[0];
    if (!head || head.kind !== "name-card") throw new Error("no name window");
    return { state, head };
}

function namesOf(state: GameState, head: PendingChoice): string[] {
    return choiceCandidates(state, head).flatMap((c) =>
        c.move.kind === "name-card" ? [c.move.cardName] : []
    );
}

const idOf = (name: string): string => getCardByName(name).id;

describe("hand-sought name window (CR 201.4, CR 701.9)", () => {
    it("reads the discarding player off the resolving script's target", () => {
        const { state, head } = nameWindow(REVEALED);
        expect(head.nameSoughtIn).toBeUndefined();
        expect(nameSoughtInHandOf(head, state)).toBe(
            seatPlayerId(state, "opp")
        );
        expect(isSearchableChoiceNode(head, state)).toBe(true);
        // Without the board the gate cannot see the script: no node.
        expect(isSearchableChoiceNode(head)).toBe(false);
    });

    it("offers the legal names of the hand, never a land (CR 201.4a)", () => {
        const { state, head } = nameWindow(REVEALED);
        expect(namesOf(state, head).sort()).toEqual([
            "Counterspell",
            "Lightning Bolt",
        ]);
    });

    it("keeps the revealed hand in every world and samples the rest from the decklist", () => {
        const { state, head } = nameWindow(REVEALED);
        const botId = seatPlayerId(state, "me");
        const oppId = seatPlayerId(state, "opp");
        const deck = [
            {
                playerId: oppId,
                cardIds: [
                    "Counterspell",
                    "Lightning Bolt",
                    "Ancestral Recall",
                    "Island",
                ].map(idOf),
            },
        ];
        for (let seed = 0; seed < 8; seed++) {
            const world = determinize(state, botId, makeRng(seed), deck);
            expect(namesOf(world, head)).toEqual(
                expect.arrayContaining(["Counterspell", "Lightning Bolt"])
            );
            expect(namesOf(world, head)).not.toContain("Ancestral Recall");
        }
    });

    it("never offers a name whose every copy is in a public zone", () => {
        const { state, head } = nameWindow(DECKLIST);
        const botId = seatPlayerId(state, "me");
        const oppId = seatPlayerId(state, "opp");
        const opp = state.players.find((p) => p.id === oppId)!;
        // The decklist's only Counterspell already sits in the graveyard.
        const binned = opp.hand.find(
            (c) =>
                tryGetDefinition(String(c.card.id))?.name === "Lightning Bolt"
        )!;
        binned.card = { ...binned.card, id: idOf("Counterspell") };
        opp.hand = opp.hand.filter((c) => c !== binned);
        opp.graveyard = [...opp.graveyard, { ...binned, zone: "graveyard" }];
        const deck = [
            {
                playerId: oppId,
                cardIds: [
                    "Counterspell",
                    "Lightning Bolt",
                    "Lightning Bolt",
                    "Island",
                    "Island",
                ].map(idOf),
            },
        ];
        const seen = new Set<string>();
        for (let seed = 0; seed < 16; seed++) {
            const world = determinize(state, botId, makeRng(seed), deck);
            for (const name of namesOf(world, head)) seen.add(name);
        }
        expect(seen.has("Counterspell")).toBe(false);
        expect(seen.has("Lightning Bolt")).toBe(true);
    });

    it("is deterministic: same world, same candidates", () => {
        const { state, head } = nameWindow(DECKLIST);
        expect(namesOf(state, head)).toEqual(namesOf(state, head));
    });

    it.each([REVEALED, DECKLIST])("the search answers: %s", (label) => {
        const entry = findBladeScenario(label);
        if (!entry) throw new Error(`No blade entry "${label}"`);
        const result = runBladeScenario(entry);
        expect(result.failureMessage).toBe("");
    });
});
