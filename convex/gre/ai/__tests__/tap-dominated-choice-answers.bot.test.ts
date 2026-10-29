/**
 * Tap-status dominance between `choose-permanents` answers (issue #6935,
 * CR 110.5 / 701.26 / 502.3).
 *
 * "Untap up to two lands" was declined, or spent on the opponent's lands: the
 * rollout scores after the bot's own untap step, so every answer's leaf ties
 * and the pick was rollout noise. `pruneTapDominatedAnswers` drops, before the
 * node opens, every answer whose settled position differs from a sibling's
 * ONLY in tap status and is worse for the chooser on every flipped permanent.
 *
 * These tests read the node through `choiceCandidates` — the set the search
 * actually opens — on positions reached by really casting the spell.
 */

import { describe, expect, it } from "vitest";
import {
    CHOICE_CANDIDATE_GENERATORS,
    choiceCandidates,
} from "../choiceCandidates";
import { buildBladeState } from "../blade/runner";
import type { BladeScenario } from "../blade/types";
import type { GameState } from "../../state";
import { tryGetDefinition } from "../../../cards";
import {
    beginDominanceDecision,
    endDominanceDecision,
    pruneTapDominatedAnswers,
} from "../dominance";

type SpecCard = BladeScenario["spec"]["cards"][number];

/** The opponent's lands: two tapped (untapping them is the wrong answer the
 *  pool offers) and two untapped (naming them changes nothing). */
const OPPONENT_LANDS: SpecCard[] = [
    {
        name: "Mountain",
        owner: "opp",
        zone: "battlefield",
        count: 2,
        tapped: true,
    },
    { name: "Mountain", owner: "opp", zone: "battlefield", count: 2 },
];

function position(cards: SpecCard[], setup: BladeScenario["setup"]): GameState {
    return buildBladeState({
        label: "issue #6935 tap dominance",
        spec: {
            cards: [...cards, ...OPPONENT_LANDS],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 0,
            libraryCount: 20,
        },
        setup,
        bot: "me",
        budget: { iterations: 1 },
        seeds: [0],
        tier: "must",
        expect: { forbidden: [] },
    } as unknown as BladeScenario);
}

/** The node's opened answers, each as the names and sides of its picks. */
function openedAnswers(state: GameState): string[][] {
    const head = state.pendingChoices![0];
    expect(head.kind).toBe("choose-permanents");
    const chooser = head.playerId;
    const board = state.players.flatMap((p) => p.battlefield);
    return choiceCandidates(state, head).map((c) =>
        c.move.kind === "resolution-choice"
            ? c.move.cardInstanceIds.map((id) => {
                  const card = board.find((x) => x.id === id)!;
                  const side =
                      card.controllerId === chooser ? "mine" : "theirs";
                  const name = tryGetDefinition(
                      (card.card as { id: string }).id
                  )?.name;
                  return `${side} ${card.isTapped ? "tapped " : ""}${name}`;
              })
            : []
    );
}

const castCloud: BladeScenario["setup"] = [
    { kind: "cast", card: "Cloud of Faeries", by: "me" },
    { kind: "resolve-top" },
    { kind: "resolve-top" },
];

describe("tap-dominated choose-permanents answers are pruned (issue #6935)", () => {
    it("Cloud of Faeries with two own tapped lands opens only 'untap both of mine'", () => {
        const state = position(
            [
                { name: "Cloud of Faeries", owner: "me", zone: "hand" },
                { name: "Island", owner: "me", zone: "battlefield", count: 2 },
            ],
            castCloud
        );
        // The generator still emits the decline and the opponent-side sets —
        // it is sign-agnostic; the pruning is what removes them.
        const head = state.pendingChoices![0];
        expect(
            CHOICE_CANDIDATE_GENERATORS["choose-permanents"]!(state, head)
                .length
        ).toBeGreaterThan(1);
        expect(openedAnswers(state)).toEqual([
            ["mine tapped Island", "mine tapped Island"],
        ]);
    });

    it("an 'untap up to three' pick with three own tapped lands opens only all three", () => {
        const state = position(
            [
                { name: "Frantic Search", owner: "me", zone: "hand" },
                { name: "Grizzly Bears", owner: "me", zone: "hand", count: 2 },
                { name: "Island", owner: "me", zone: "battlefield", count: 3 },
            ],
            [
                { kind: "cast", card: "Frantic Search", by: "me" },
                { kind: "resolve-top" },
                { kind: "choose", cards: ["Grizzly Bears", "Grizzly Bears"] },
            ]
        );
        expect(openedAnswers(state)).toEqual([
            ["mine tapped Island", "mine tapped Island", "mine tapped Island"],
        ]);
    });

    it("with one own tapped land, opens only that land — never one padded with an opponent's land", () => {
        // Mox Sapphire pays half the cast, so only one land is tapped. "My
        // Island and their UNTAPPED Mountain" settles to the same position as
        // "my Island" — the equal pair keeps the answer naming fewer picks.
        const state = position(
            [
                { name: "Cloud of Faeries", owner: "me", zone: "hand" },
                { name: "Mox Sapphire", owner: "me", zone: "battlefield" },
                { name: "Island", owner: "me", zone: "battlefield" },
            ],
            castCloud
        );
        expect(openedAnswers(state)).toEqual([["mine tapped Island"]]);
    });

    it("leaves a trade-off node alone: a per-pick payment never settles to a tap-only difference", () => {
        // Magnetic Mountain's "choose any number of tapped blue creatures …
        // pay {4} for each": every acting answer raises a `may-pay`, so no
        // answer settles cleanly and nothing is compared — the decline stays.
        const state = buildBladeState({
            label: "issue #6935 trade-off",
            spec: {
                cards: [
                    {
                        name: "Magnetic Mountain",
                        owner: "opp",
                        zone: "battlefield",
                    },
                    {
                        name: "Phantom Monster",
                        owner: "me",
                        zone: "battlefield",
                        tapped: true,
                        summoningSick: false,
                    },
                    {
                        name: "Air Elemental",
                        owner: "me",
                        zone: "battlefield",
                        tapped: true,
                        summoningSick: false,
                    },
                ],
                phase: "UPKEEP",
                turn: 5,
                landCount: 4,
                libraryCount: 20,
            },
            setup: [{ kind: "phase-trigger" }, { kind: "resolve-top" }],
            bot: "me",
            budget: { iterations: 1 },
            seeds: [0],
            tier: "must",
            expect: { forbidden: [] },
        } as unknown as BladeScenario);
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("choose-permanents");
        const generated = CHOICE_CANDIDATE_GENERATORS["choose-permanents"]!(
            state,
            head
        );
        expect(choiceCandidates(state, head)).toHaveLength(generated.length);
        expect(openedAnswers(state)).toContainEqual([]);
    });

    it("never orders a land something else names: an aura on the tapped land keeps its answers incomparable", () => {
        // Wild Growth's `attachedTo` names the Island it enchants, so the
        // id-reference gate refuses to rank that land's tap status — the
        // fail-closed side of CR 110.5a. The plain Island still orders.
        const state = position(
            [
                { name: "Cloud of Faeries", owner: "me", zone: "hand" },
                { name: "Island", owner: "me", zone: "battlefield", count: 2 },
                {
                    name: "Wild Growth",
                    owner: "me",
                    zone: "battlefield",
                    attachedTo: "Island",
                },
            ],
            castCloud
        );
        const opened = openedAnswers(state);
        expect(opened.length).toBeGreaterThan(1);
        expect(opened).toContainEqual([
            "mine tapped Island",
            "mine tapped Island",
        ]);
    });

    it("the per-decision memo never drops an answer whose dominator the later call does not offer", () => {
        const state = position(
            [
                { name: "Cloud of Faeries", owner: "me", zone: "hand" },
                { name: "Mox Sapphire", owner: "me", zone: "battlefield" },
                { name: "Island", owner: "me", zone: "battlefield" },
            ],
            castCloud
        );
        const head = state.pendingChoices![0];
        const generated = CHOICE_CANDIDATE_GENERATORS["choose-permanents"]!(
            state,
            head
        );
        const isMine = (id: string) =>
            state.players
                .find((p) => p.id === head.playerId)!
                .battlefield.some((c) => c.id === id);
        const mineOnly = (c: (typeof generated)[number]) =>
            c.move.kind === "resolution-choice" &&
            c.move.cardInstanceIds.length > 0 &&
            c.move.cardInstanceIds.every(isMine);
        // A second visit offering everything EXCEPT "untap my Island" alone:
        // the decline and the sets reaching the opponent's side. Its best
        // answer is then "my Island padded with their untapped Mountain" —
        // a cached verdict that dropped it (its dominator is absent here)
        // would leave the fallback to reopen every answer.
        const withoutBest = generated.filter((c) => !mineOnly(c));
        expect(withoutBest.length).toBeGreaterThan(1);
        beginDominanceDecision();
        try {
            expect(
                pruneTapDominatedAnswers(state, head, generated).map((c) =>
                    mineOnly(c)
                )
            ).toEqual([true]);
            const second = pruneTapDominatedAnswers(state, head, withoutBest);
            expect(second.length).toBeLessThan(withoutBest.length);
            expect(second.length).toBeGreaterThan(0);
            expect(
                second.every(
                    (c) =>
                        c.move.kind === "resolution-choice" &&
                        c.move.cardInstanceIds.some(isMine)
                )
            ).toBe(true);
        } finally {
            endDominanceDecision();
        }
    });
});
