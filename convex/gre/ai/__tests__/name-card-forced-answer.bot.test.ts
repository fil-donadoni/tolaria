/**
 * The tree walk and the rollout answer a `name-card` window (issue #6676).
 *
 * An as-enters name choice (CR 614.1c — Meddling Mage's "As this creature
 * enters, choose a nonland card name", CR 201.4a) has no in-tree candidate
 * generator, so `decidingPlayer` returns `null` at it. The walk used to stop
 * right there and score the leaf with the creature spell spent and the
 * permanent still staged, so casting Meddling Mage always read worse than
 * passing and the Bot never cast one. `advanceToDecision` now applies the
 * forced answer (`forcedChoiceAnswer`): one legal name, picked from the cards
 * the chooser can already see.
 */

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../../cards";
import type { ScenarioSpec } from "../../../debugScenarioSpec";
import type { GameState } from "../../state";
import { resolveTopOfStack } from "../../state";
import { enumerateMoves } from "../../moves";
import {
    advanceToDecision,
    applyMoveInSearch,
    decidingPlayer,
} from "../../search";
import { forcedChoiceAnswer } from "../choiceCandidates";
import { buildPositionFromSpec } from "../blade/build";

type SpecCard = ScenarioSpec["cards"][number];

const idOf = (c: { card: unknown }) => (c.card as { id?: string }).id;

/** Cast Meddling Mage and resolve it up to its as-enters name choice: the
 *  state the walk used to score as a leaf. */
function midMeddlingMage(extra: SpecCard[]): GameState {
    const s = buildPositionFromSpec({
        cards: [
            { name: "Meddling Mage", owner: "me", zone: "hand" },
            { name: "Plains", owner: "me", zone: "battlefield" },
            { name: "Island", owner: "me", zone: "battlefield" },
            ...extra,
        ],
        phase: "PRECOMBAT_MAIN",
        turn: 3,
        libraryCount: 20,
    });
    const me = s.activePlayerId;
    const mageId = getCardByName("Meddling Mage").id;
    const mage = s.players
        .find((p) => p.id === me)!
        .hand.find((c) => idOf(c) === mageId)!;
    const cast = enumerateMoves(s, me).find(
        (m) => m.kind === "cast-spell" && m.cardInstanceId === mage.id
    );
    if (!cast) throw new Error("no Meddling Mage cast");
    applyMoveInSearch(s, me, cast);
    resolveTopOfStack(s);
    return s;
}

function battlefieldMage(s: GameState) {
    const mageId = getCardByName("Meddling Mage").id;
    return s.players
        .find((p) => p.id === s.activePlayerId)!
        .battlefield.find((c) => idOf(c) === mageId);
}

/** Cast Cabal Therapy at the opponent and resolve it up to its
 *  mid-resolution `nameCard` Op: a name-card head ON the stack. */
function midCabalTherapy(): GameState {
    const s = buildPositionFromSpec({
        cards: [
            { name: "Cabal Therapy", owner: "me", zone: "hand" },
            { name: "Swamp", owner: "me", zone: "battlefield" },
            { name: "Lightning Bolt", owner: "opp", zone: "graveyard" },
        ],
        phase: "PRECOMBAT_MAIN",
        turn: 3,
        libraryCount: 20,
    });
    const me = s.activePlayerId;
    const opp = s.players.find((p) => p.id !== me)!.id;
    const therapyId = getCardByName("Cabal Therapy").id;
    const therapy = s.players
        .find((p) => p.id === me)!
        .hand.find((c) => idOf(c) === therapyId)!;
    const cast = enumerateMoves(s, me).find(
        (m) =>
            m.kind === "cast-spell" &&
            m.cardInstanceId === therapy.id &&
            (m.targets ?? []).some((t) => t.type === "player" && t.id === opp)
    );
    if (!cast) throw new Error("no Cabal Therapy cast at the opponent");
    applyMoveInSearch(s, me, cast);
    resolveTopOfStack(s);
    return s;
}

describe("advanceToDecision — a name-card window is answered, not scored (issue #6676)", () => {
    it("the position the walk used to stop at: the as-enters name, no decider", () => {
        const mid = midMeddlingMage([]);
        expect(mid.pendingChoices?.[0]?.kind).toBe("name-card");
        expect(decidingPlayer(mid)).toBeNull();
        expect(battlefieldMage(mid)).toBeUndefined();
    });

    it("lands the permanent with a legal nonland name (CR 614.1c, CR 201.4a)", () => {
        const mid = midMeddlingMage([]);
        expect(advanceToDecision(mid)).toBe(mid.activePlayerId);
        expect(mid.pendingChoices ?? []).toHaveLength(0);
        // The only nonland name in sight is the Mage's own.
        expect(battlefieldMage(mid)?.chosenName).toBe("Meddling Mage");
    });

    it("never names a card from the opponent's hidden hand", () => {
        const mid = midMeddlingMage([
            // Sorts before "Meddling Mage": a picker reading the hidden hand
            // would name it.
            { name: "Abeyance", owner: "opp", zone: "hand" },
            { name: "Lightning Bolt", owner: "opp", zone: "graveyard" },
        ]);
        const answer = forcedChoiceAnswer(mid, mid.pendingChoices![0]!);
        // The opponent's graveyard is public: its Lightning Bolt is in sight.
        expect(answer).toEqual({
            kind: "name-card",
            cardName: "Lightning Bolt",
        });
    });

    it("never names a face-down exiled card (CR 406.3)", () => {
        const mid = midMeddlingMage([
            { name: "Abeyance", owner: "opp", zone: "graveyard" },
        ]);
        const opp = mid.players.find((p) => p.id !== mid.activePlayerId)!;
        // Exiled face down, as Hideaway does: the raw state keeps its id.
        const hidden = opp.graveyard.pop()!;
        opp.exile.push({ ...hidden, knownTo: [opp.id] });
        const answer = forcedChoiceAnswer(mid, mid.pendingChoices![0]!);
        expect(answer).toEqual({
            kind: "name-card",
            cardName: "Meddling Mage",
        });
    });

    it("leaves a mid-resolution nameCard unanswered (Cabal Therapy keeps its script valuation)", () => {
        const mid = midCabalTherapy();
        const head = mid.pendingChoices![0]!;
        expect(head.kind).toBe("name-card");
        expect(head.stackItemId).not.toBe("");
        // A public-zone name ("Lightning Bolt") is legal here, yet unanswered.
        expect(forcedChoiceAnswer(mid, head)).toBeNull();
    });

    it("never names a card in the chooser's own hand — no self-lock", () => {
        const mid = midMeddlingMage([
            { name: "Abeyance", owner: "me", zone: "hand" },
        ]);
        const answer = forcedChoiceAnswer(mid, mid.pendingChoices![0]!);
        expect(answer).toEqual({
            kind: "name-card",
            cardName: "Meddling Mage",
        });
    });
});
