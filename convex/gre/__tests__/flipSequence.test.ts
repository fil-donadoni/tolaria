// The Flip Sequence primitive's permanent test (CR 705, ADR 0023 Amendment I).
//
//   705.2  Some effects that instruct a player to flip a coin care only about
//          whether the coin comes up heads or tails. No player wins or loses a
//          coin flip for this kind of effect. For all other effects … the
//          player that flips the coin calls "heads" or "tails." If the call
//          matches the result, the player wins the flip.
//
// A seed fixes the draws, W = the bit that reads as heads:
//   seed 31 → W W W L …     seed 2 → W L L W W W …     seed 7 → L L W …

import { describe, it, expect } from "vitest";
import type { SpellContext } from "../../cards/types";
import { registerTokenDefinition } from "../../cards";
import { manaClash } from "../../cards/sets/drk/red.cards";
import { manaCrypt } from "../../cards/sets/phpr/colorless.cards";
import { bottleOfSuleiman } from "../../cards/sets/arn/colorless.cards";
import { squeesRevenge } from "../../cards/sets/apc/multicolor.cards";
import { makeState, pushSpell } from "../../cards/__tests__/setup.helper";
import { buildSpellContext, resolveTopOfStack } from "../state";
import type { GameState } from "../state";
import { applyRandomRevealAck } from "../pendingChoiceSubmit";
import { compactState, expandState } from "../serialize";
import { projectPublicState } from "../../gameProjections";
import { flipOracleExcerpt, type FlipSequenceRequest } from "../flipSequence";

const ORACLE = "Flip a coin. If you win the flip, you gain 1 life.";

/** A sorcery that asks for one sequence, then gains 1 life per record: the life
 *  total is the consequence, and it lands only if the caller got the list. */
function registerSequenceCard(id: string, req: FlipSequenceRequest): string {
    registerTokenDefinition({
        id,
        name: id,
        rarity: "common",
        oracleText: ORACLE,
        manaCost: { R: 1 },
        types: ["Sorcery"],
        resolve: (ctx: SpellContext) => {
            const flips = ctx.requestFlipSequence(req);
            if (flips === undefined) return;
            ctx.gainLife(ctx.controller, flips.length);
        },
    });
    return id;
}

function ack(state: GameState): void {
    const head = state.pendingChoices![0];
    applyRandomRevealAck(state, {
        playerId: head.playerId,
        stackItemId: head.stackItemId,
        choiceId: head.choiceId,
    });
}

const lifeOf = (state: GameState) => state.players[0].life;
const outcomes = (state: GameState) =>
    state.pendingChoices![0].flips!.map((f) => f.outcome);

describe("Flip Sequence: the draw, the pause, the resume (CR 705)", () => {
    it("persists the full list, advances rngCounter once per flip, applies only after the ack", () => {
        const id = registerSequenceCard("flipseq-count", {
            choiceId: "flips",
            flippers: ["p1"],
            stop: { kind: "count", count: 3 },
        });
        const state = makeState({ rngSeed: 31 });
        const life = lifeOf(state);
        const before = state.rngCounter ?? 0;
        pushSpell(state, id, "p1");

        expect(resolveTopOfStack(state)).toBeNull();

        const head = state.pendingChoices![0];
        expect(state.pendingChoices).toHaveLength(1);
        expect(head.kind).toBe("random-reveal");
        expect(head.flips).toEqual([
            { flipperId: "p1", face: "heads", outcome: "win", round: 0 },
            { flipperId: "p1", face: "heads", outcome: "win", round: 1 },
            { flipperId: "p1", face: "heads", outcome: "win", round: 2 },
        ]);
        // A sequence of several has no single index to name.
        expect(head.result).toBeUndefined();
        expect(state.rngCounter).toBe(before + 3);
        const item = state.stack[state.stack.length - 1];
        expect(Object.values(item.collectedChoices ?? {})).toEqual([
            ["heads", "heads", "heads"],
        ]);
        // The consequence waits for the ack.
        expect(lifeOf(state)).toBe(life);

        ack(state);

        expect(state.pendingChoices ?? []).toHaveLength(0);
        // Resuming read the list back: no flip was drawn twice.
        expect(state.rngCounter).toBe(before + 3);
        expect(lifeOf(state)).toBe(life + 3);
    });

    it("resumes off a saved game mid-reveal without re-rolling", () => {
        const id = registerSequenceCard("flipseq-saved", {
            choiceId: "flips",
            flippers: ["p1"],
            stop: { kind: "untilLoss" },
        });
        const state = makeState({ rngSeed: 31 });
        const life = lifeOf(state);
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        const counter = state.rngCounter;

        const reloaded = expandState(compactState(state));
        expect(reloaded.pendingChoices![0].flips).toEqual(
            state.pendingChoices![0].flips
        );
        ack(reloaded);

        expect(reloaded.rngCounter).toBe(counter);
        expect(lifeOf(reloaded)).toBe(life + 4);
    });

    it("a sequence with no flips returns [] at once: no pause, no draw", () => {
        const id = registerSequenceCard("flipseq-zero", {
            choiceId: "flips",
            flippers: ["p1"],
            stop: { kind: "count", count: 0 },
        });
        const state = makeState({ rngSeed: 31 });
        const before = state.rngCounter ?? 0;
        pushSpell(state, id, "p1");

        resolveTopOfStack(state);

        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.rngCounter ?? 0).toBe(before);
        expect(state.stack).toHaveLength(0);
    });
});

describe("Flip Sequence: stop rules (CR 705.2)", () => {
    it("fixed count: flips that many whatever the results", () => {
        const id = registerSequenceCard("flipseq-rule-count", {
            choiceId: "flips",
            flippers: ["p1"],
            stop: { kind: "count", count: 2 },
        });
        const state = makeState({ rngSeed: 7 });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        expect(outcomes(state)).toEqual(["lose", "lose"]);
    });

    it("until the first loss: the lost flip is the last", () => {
        const id = registerSequenceCard("flipseq-rule-loss", {
            choiceId: "flips",
            flippers: ["p1"],
            stop: { kind: "untilLoss" },
        });
        const state = makeState({ rngSeed: 31 });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        expect(outcomes(state)).toEqual(["win", "win", "win", "lose"]);
    });

    it("until the first loss, capped: whichever comes first", () => {
        const id = registerSequenceCard("flipseq-rule-loss-cap", {
            choiceId: "flips",
            flippers: ["p1"],
            stop: { kind: "untilLoss", maxRounds: 2 },
        });
        const state = makeState({ rngSeed: 31 });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        expect(outcomes(state)).toEqual(["win", "win"]);
    });

    it("caller predicate over a round: two flippers until both coins are heads, face-only", () => {
        const id = registerSequenceCard("flipseq-rule-until", {
            choiceId: "flips",
            flippers: ["p1", "p2"],
            faceOnly: true,
            stop: {
                kind: "until",
                stop: (round) => round.every((f) => f.face === "heads"),
            },
        });
        const state = makeState({ rngSeed: 2 });
        const life = lifeOf(state);
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);

        expect(state.pendingChoices![0].flips).toEqual([
            { flipperId: "p1", face: "heads", outcome: "none", round: 0 },
            { flipperId: "p2", face: "tails", outcome: "none", round: 0 },
            { flipperId: "p1", face: "tails", outcome: "none", round: 1 },
            { flipperId: "p2", face: "heads", outcome: "none", round: 1 },
            { flipperId: "p1", face: "heads", outcome: "none", round: 2 },
            { flipperId: "p2", face: "heads", outcome: "none", round: 2 },
        ]);
        // The first flipper acknowledges, once, for the whole sequence.
        expect(state.pendingChoices).toHaveLength(1);
        expect(state.pendingChoices![0].playerId).toBe("p1");

        ack(state);
        expect(lifeOf(state)).toBe(life + 6);
    });
});

describe("Flip Sequence: the public envelope (CR 705)", () => {
    function suspended(): GameState {
        const id = registerSequenceCard("flipseq-wire", {
            choiceId: "flips",
            flippers: ["p1"],
            stop: { kind: "untilLoss" },
        });
        const state = makeState({ rngSeed: 31 });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        return state;
    }

    it("carries the source and the Oracle excerpt derived from the definition", () => {
        const head = suspended().pendingChoices![0];
        expect(head.source).toEqual({
            cardId: "flipseq-wire",
            controllerId: "p1",
        });
        expect(head.oracleExcerpt).toBe(ORACLE);
    });

    it.each(["p1", "p2"])(
        "projectPublicState gives seat %s the list, the source and the excerpt",
        (viewerId) => {
            const state = suspended();
            const head = state.pendingChoices![0];
            const seen = projectPublicState(state, 1, viewerId).pendingChoices;
            expect(seen?.[0].flips).toEqual(head.flips);
            expect(seen?.[0].flips).toHaveLength(4);
            expect(seen?.[0].source).toEqual(head.source);
            expect(seen?.[0].oracleExcerpt).toBe(ORACLE);
        }
    );

    it("a face-down source names only its sentinel (CR 708.5)", () => {
        const realId = registerSequenceCard("flipseq-hidden", {
            choiceId: "flips",
            flippers: ["p1"],
            stop: { kind: "count", count: 1 },
        });
        const state = makeState({ rngSeed: 31 });
        pushSpell(state, realId, "p1");
        const item = state.stack[state.stack.length - 1];
        item.faceDown = true;
        item.faceDownOf = realId;
        item.card = { ...item.card, id: "face-down" } as typeof item.card;

        buildSpellContext(state, item).requestFlipSequence({
            choiceId: "flips",
            flippers: ["p1"],
            stop: { kind: "count", count: 1 },
        });

        const head = state.pendingChoices![0];
        expect(head.source?.cardId).toBe("face-down");
        expect(head.oracleExcerpt).toBeUndefined();
    });
});

describe("flipOracleExcerpt (CR 705)", () => {
    it.each([
        [
            "a trigger: every sentence of the flip",
            manaCrypt().oracleText,
            "At the beginning of your upkeep, flip a coin. If you lose the flip, this artifact deals 3 damage to you.",
        ],
        [
            "an activated ability: the cost is not the flip's words",
            bottleOfSuleiman().oracleText,
            "Flip a coin. If you win the flip, create a 5/5 colorless Djinn artifact creature token with flying. If you lose the flip, this artifact deals 5 damage to you.",
        ],
        [
            "a sentence between two that flip stays in",
            manaClash().oracleText,
            manaClash().oracleText,
        ],
        [
            "a sentence before the flip stays out",
            squeesRevenge().oracleText,
            "Flip a coin that many times or until you lose a flip, whichever comes first. If you win all the flips, draw two cards for each flip.",
        ],
        [
            "reminder text is dropped, a later ability line ignored",
            "Trample (It can deal excess damage.)\n{T}: Flip a coin. (Flips are fair.) If you win, draw a card.\nFlying",
            "Flip a coin.",
        ],
        ["no coin flip", "Flying", undefined],
        ["flipping without a coin", "Flip this creature.", undefined],
        ["no Oracle text", undefined, undefined],
    ])("%s", (_name, text, expected) => {
        expect(flipOracleExcerpt(text)).toBe(expected);
    });
});
