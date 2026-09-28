/**
 * The resolved-payoff credit's CHOICE half (issue #4218).
 *
 * At an OPTIONAL pick that puts a card from the chooser's own hand onto its own
 * battlefield (Show and Tell's per-player pick — each player chooses in APNAP
 * order, CR 101.4 — Sneak Attack's, an Elvish Piper put), the empty answer is
 * the decline, and it used to win the material tie-break: pick and decline tie
 * inside `OUTCOME_EPS`, and the tie-break reads a SUBTREE-accumulated
 * `meanMargin` in which a body the rollouts trade off scores below the same
 * card held in hand at its latent worth.
 *
 * `selectRootMove` now reads the SETTLED margins at that tie, and takes a pick
 * only when it strictly beats the settled decline. Asserted here on a hand-built
 * root whose edges are the generator's own candidates in a position the real
 * engine reached (blade builder: cast + resolve), so the tie and the margins
 * that break it are pinned exactly rather than drawn from rollouts — the blade
 * entries "free put: …" carry the search-level evidence.
 */

import { describe, expect, it } from "vitest";
import { selectRootMove, type Edge, type Node } from "../../search";
import type { RootDecisionMechanism } from "../decisionTelemetry";
import { choiceCandidates } from "../choiceCandidates";
import { buildBladeState } from "../blade/build";
import type { BladeScenario } from "../blade/types";
import type { GameState } from "../../state";
import type { Move } from "../../moves";
import { tryGetDefinition } from "../../../cards";

function atPick(
    cards: BladeScenario["spec"]["cards"],
    casterPick?: string[]
): GameState {
    return buildBladeState({
        label: "optional put",
        spec: {
            cards,
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 3,
            libraryCount: 20,
        },
        setup: [
            { kind: "cast", card: "Show and Tell" },
            { kind: "resolve-top" },
            ...(casterPick
                ? [{ kind: "choose" as const, cards: casterPick }]
                : []),
        ],
        bot: casterPick ? "opp" : "me",
        budget: { iterations: 1 },
        tier: "must",
        expect: { forbidden: [] },
    });
}

/** A root whose edges are the head choice's real candidates, every one tied on
 *  reward, with the DECLINE carrying the best subtree `meanMargin` — the shape
 *  the material tie-break resolved to the decline. */
function tiedRoot(state: GameState): { root: Node; moves: Move[] } {
    const choice = state.pendingChoices![0];
    const children = new Map<string, Edge>();
    const moves: Move[] = [];
    for (const c of choiceCandidates(state, choice)) {
        const declines =
            c.move.kind === "resolution-choice" &&
            c.move.cardInstanceIds.length === 0;
        children.set(c.key, {
            move: c.move,
            key: c.key,
            mover: choice.playerId,
            node: { children: new Map() },
            visits: 100,
            totalReward: 40,
            totalMargin: declines ? -13_000 : -18_000,
            avail: 100,
        });
        moves.push(c.move);
    }
    return { root: { children }, moves };
}

function pick(state: GameState): {
    names: string[];
    mechanism: RootDecisionMechanism;
} {
    const { root, moves } = tiedRoot(state);
    const out = { mechanism: "mean-reward" as RootDecisionMechanism };
    const botId = state.pendingChoices![0].playerId;
    const move = selectRootMove(
        root,
        moves,
        state,
        botId,
        undefined,
        undefined,
        undefined,
        out
    );
    const hand = state.players.find((p) => p.id === botId)!.hand;
    const names =
        move.kind === "resolution-choice"
            ? move.cardInstanceIds.map(
                  (id) =>
                      tryGetDefinition(
                          String(hand.find((c) => c.id === id)!.card.id)
                      )!.name
              )
            : [];
    return { names, mechanism: out.mechanism };
}

describe("optional own-hand put onto the battlefield (issue #4218)", () => {
    it("takes the pick whose settled margin beats the settled decline", () => {
        const state = atPick(
            [
                { name: "Show and Tell", owner: "me", zone: "hand" },
                { name: "Shivan Dragon", owner: "me", zone: "hand" },
                { name: "Serra Angel", owner: "opp", zone: "hand" },
            ],
            ["Shivan Dragon"]
        );
        expect(pick(state)).toEqual({
            names: ["Serra Angel"],
            mechanism: "resolved-payoff",
        });
    });

    it("keeps the decline when the only pick settles worse (a clone with nothing to copy dies)", () => {
        const state = atPick([
            { name: "Show and Tell", owner: "me", zone: "hand" },
            { name: "Phantasmal Image", owner: "me", zone: "hand" },
        ]);
        expect(pick(state)).toEqual({
            names: [],
            mechanism: "material-tiebreak",
        });
    });
});
