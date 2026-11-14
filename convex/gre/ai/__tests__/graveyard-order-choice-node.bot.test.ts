// The `graveyard-order` choice (CR 404.3) as an in-tree ISMCTS decision node
// (issue #9555) — the self-mill × graveyard-position reader class.
//
// Before this the arrangement was answered by `forcedChoiceAnswer` with the
// engine order and nothing in the Bot could prefer one top card over another,
// so a reveal that put a whole library into the graveyard (Hermit Druid) was
// only ever self-harm: the permanent reading the graveyard's top creature card
// (Volrath's Shapeshifter, CR 612.6) saw whatever card the reveal happened to
// put there last.
//
// What this file pins:
//   - the node OPENS only under a reader the batch's owner controls — with no
//     reader the generator is empty, the client gate says "not searchable" and
//     the forced engine order still stands (a simultaneous death never stops a
//     settle);
//   - the gate reads the BOARD, so it is decided only with the state beside
//     the choice;
//   - every candidate is a permutation of the batch (what the resolver
//     demands), one per distinct readable card on top plus the engine order
//     as the baseline, best worth first with the prior following;
//   - the top candidate survives the REAL submit path, after which the reader
//     presents the card put on top.
//
// The position is the blade entry's own; this file names the mechanism.

import { describe, expect, it } from "vitest";
import { buildBladeState, findBladeScenario } from "../blade";
import { instanceIdsForName, seatPlayerId } from "../blade/matcher";
import {
    choiceCandidates,
    forcedChoiceAnswer,
    isSearchableChoiceNode,
} from "../choiceCandidates";
import { getCardByName } from "../../../cards";
import { getEffectivePower } from "../../layers";
import { applyPendingChoiceSubmit } from "../../pendingChoiceSubmit";
import { getPlayer } from "../../state";
import type { GameState, PendingChoice } from "../../state";

const CHOICE_ENTRY =
    "graveyard order: puts the creature its graveyard-top reader wants on top of the batch";

function arrangementWindow(): {
    state: GameState;
    head: PendingChoice;
    me: string;
} {
    const entry = findBladeScenario(CHOICE_ENTRY);
    if (!entry) throw new Error(`No blade entry "${CHOICE_ENTRY}"`);
    const state = buildBladeState(entry);
    const head = state.pendingChoices?.[0];
    if (!head || head.kind !== "graveyard-order")
        throw new Error("no graveyard-order window");
    return { state, head, me: seatPlayerId(state, "me") };
}

/** The same window with the reader gone: the one card removed from the
 *  battlefield, nothing else touched. */
function withoutReader(state: GameState, me: string): GameState {
    // The reader PRESENTS the batch's top card (CR 612.6), so its presented
    // id is a Grizzly Bears' — the anchor is what still names it.
    const readerId = getCardByName("Volrath's Shapeshifter").id;
    const player = getPlayer(state, me);
    player.battlefield = player.battlefield.filter(
        (c) =>
            (c.fullTextAnchor?.underlyingDefId ??
                (c.card as { id?: string }).id) !== readerId
    );
    return state;
}

function sortedIds(ids: readonly string[]): string[] {
    return [...ids].sort();
}

describe("graveyard-order choice node (CR 404.3, issue #9555)", () => {
    it("opens under a graveyard-top reader, with the state beside the choice", () => {
        const { state, head } = arrangementWindow();
        expect(isSearchableChoiceNode(head, state)).toBe(true);
        // The gate reads the board: without the state it cannot say yes.
        expect(isSearchableChoiceNode(head)).toBe(false);
    });

    it("offers one top per distinct readable card plus the engine order, best worth first", () => {
        const { state, head } = arrangementWindow();
        const batch = head.candidateIds ?? [];
        expect(batch).toHaveLength(5);
        const candidates = choiceCandidates(state, head);
        // Two distinct creature cards (Dreadnought, Bears) + the engine order
        // — and the engine order already has a Bears on top, so the Bears
        // candidate IS the baseline, emitted once under its stable
        // `top=<card>` key (the same answer in every world): two branches.
        expect(candidates).toHaveLength(2);
        for (const c of candidates) {
            if (c.move.kind !== "resolution-choice") throw new Error("kind");
            expect(sortedIds(c.move.cardInstanceIds)).toEqual(sortedIds(batch));
        }
        const dreadnought = instanceIdsForName(state, "Phyrexian Dreadnought");
        const [best, baseline] = candidates;
        if (
            best.move.kind !== "resolution-choice" ||
            baseline.move.kind !== "resolution-choice"
        )
            throw new Error("kind");
        expect(dreadnought.has(best.move.cardInstanceIds[0] ?? "")).toBe(true);
        expect(best.key).toBe("graveyard-order:top=Phyrexian Dreadnought");
        expect(baseline.key).toBe("graveyard-order:top=Grizzly Bears");
        expect(baseline.move.cardInstanceIds).toEqual(batch);
        // The prior follows the worth of the card put on top: the 12/12
        // opens before the 2/2.
        expect(best.prior).toBeGreaterThan(baseline.prior);
    });

    it("the top candidate survives the real submit path and the reader presents it", () => {
        const { state, head, me } = arrangementWindow();
        const best = choiceCandidates(state, head)[0];
        if (best.move.kind !== "resolution-choice") throw new Error("kind");
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: best.move.cardInstanceIds,
        });
        expect(state.pendingChoices).toBeUndefined();
        const player = getPlayer(state, me);
        const top = player.graveyard[player.graveyard.length - 1];
        expect(
            instanceIdsForName(state, "Phyrexian Dreadnought").has(top.id)
        ).toBe(true);
        const readerLayer1 = getCardByName("Volrath's Shapeshifter").id;
        const reader = player.battlefield.find(
            (c) => c.fullTextAnchor?.underlyingDefId === readerLayer1
        );
        if (!reader) throw new Error("reader presents nothing");
        expect(getEffectivePower(state, reader)).toBe(12);
    });

    it("with no reader the node stays closed and the forced engine order stands", () => {
        const { state, head, me } = arrangementWindow();
        withoutReader(state, me);
        expect(isSearchableChoiceNode(head, state)).toBe(false);
        expect(choiceCandidates(state, head)).toEqual([]);
        const forced = forcedChoiceAnswer(state, head);
        expect(forced).toMatchObject({
            kind: "resolution-choice",
            choiceId: head.choiceId,
            cardInstanceIds: head.candidateIds,
        });
    });
});
