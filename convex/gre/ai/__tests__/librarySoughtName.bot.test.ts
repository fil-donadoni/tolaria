/**
 * Issue #8709 — a `name-card` whose effect seeks the name in the chooser's own
 * library (`nameSoughtIn: "chooser-library"`, CR 201.4) is an in-tree decision:
 * a name still in that library digs it out, a name that is not exiles the
 * whole library (Demonic Consultation under a Thassa's Oracle trigger).
 *
 * The position is the blade entry's own; this file names the mechanism.
 */

import { describe, expect, it } from "vitest";
import { buildBladeState, findBladeScenario } from "../blade";
import { seatPlayerId } from "../blade/matcher";
import { choiceCandidates, isSearchableChoiceNode } from "../choiceCandidates";
import { tryGetDefinition } from "../../../cards";
import type { GameState, PendingChoice } from "../../state";

const NAME_WINDOW =
    "Oracle combo: Demonic Consultation names a card its library does not hold";

function nameWindow(): { state: GameState; head: PendingChoice } {
    const entry = findBladeScenario(NAME_WINDOW);
    if (!entry) throw new Error(`No blade entry "${NAME_WINDOW}"`);
    const state = buildBladeState(entry);
    const head = state.pendingChoices?.[0];
    if (!head || head.kind !== "name-card") throw new Error("no name window");
    return { state, head };
}

function libraryNames(state: GameState): Set<string> {
    const me = state.players.find((p) => p.id === seatPlayerId(state, "me"));
    return new Set(
        (me?.library ?? []).flatMap((c) => {
            const name = tryGetDefinition(String(c.card.id ?? ""))?.name;
            return name === undefined ? [] : [name];
        })
    );
}

describe("library-sought name window (CR 201.4, issue #8709)", () => {
    it("is a search node offering a name absent from the chooser's library", () => {
        const { state, head } = nameWindow();
        expect(head.nameSoughtIn).toBe("chooser-library");
        expect(isSearchableChoiceNode(head)).toBe(true);
        const library = libraryNames(state);
        const names = choiceCandidates(state, head).map((c) =>
            c.move.kind === "name-card" ? c.move.cardName : null
        );
        // One branch empties the library, the others dig a card out of it.
        expect(names.filter((n) => n !== null && !library.has(n))).toHaveLength(
            1
        );
        expect(names.some((n) => n !== null && library.has(n))).toBe(true);
    });

    it("leaves a name window that does not say where it seeks off the tree", () => {
        const { state, head } = nameWindow();
        const unsaid: PendingChoice = { ...head, nameSoughtIn: undefined };
        expect(isSearchableChoiceNode(unsaid)).toBe(false);
        expect(choiceCandidates(state, unsaid)).toEqual([]);
    });
});
