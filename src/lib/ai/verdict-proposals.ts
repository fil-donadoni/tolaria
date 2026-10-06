// A game's Verdict Proposal list, built once the game is over (issue #3984,
// GLOSSARY.md § Verdict Proposal, PRD #3980).
//
// RECORD NOW, JUDGE AT GAME END. `human-decision-capture.ts` kept the human
// seat's decisions during play; this is the one place the Brain is asked about
// them, and only after the last move:
//
//   1. IDENTIFY — each decision's submitted mutations become the `Move` the
//      player made (`identifyHumanMove`); a decision no legal move realises is
//      dropped and counted, never guessed.
//   2. SAMPLE — group by Decision Class (`decisionClassOfMove`, the class
//      table the coverage census uses) and keep up to `perClassQuota` per
//      class, chosen by a seeded shuffle so the sample is reproducible.
//   3. JUDGE — one Brain consult per sampled decision, on the seat's own view,
//      at a FIXED iteration budget and seed (the blade's discipline: same
//      position, same answer). The pick either agrees with the player's move —
//      same structural key, or an interchangeable copy — or it does not.
//   4. SELECT — per class, every disagreement first, then agreements up to
//      `agreeingPerClass`: a corpus made only of disagreements cannot see a
//      change that breaks what the Brain already gets right.
//
// The result is a list of QUESTIONS. Nothing here labels, confirms or stores a
// judgement: no Verdict Store write exists on this path, and a proposal nobody
// answers simply goes away with the game (`verdict-proposal-store.ts`).
// Rendering and answering them is issue #3986.

import type { Move } from "@convex/gre";
import { moveKey } from "@convex/gre/search";
import { makeRng } from "@convex/gre/rng";
import { makeInterchangeableKeyer } from "@convex/gre/ai/interchangeable";
import {
    DECISION_CLASSES,
    decisionClassOfMove,
    type DecisionClass,
} from "@convex/gre/ai/verdicts/coverage";
import type { GameState } from "@convex/gre/state";
import { projectedToGameState } from "./state-adapter";
import { identifyHumanMove } from "./human-move-match";
import type { CapturedDecision } from "./human-decision-capture";
import type { AiTraceSource } from "./trace-store";
import type { VerdictProposalConfig } from "./verdict-proposal-config";

/** One question for the player: "you played this — was it right?". */
export type VerdictProposal = {
    /** The seat's own view the decision was made on (the quiz's input). */
    source: AiTraceSource;
    decisionClass: DecisionClass;
    /** The move the player made, in the Brain's vocabulary. */
    humanMove: Move;
    /** The move the Brain picked on the same view. */
    brainMove: Move;
    /** Whether the two are the same decision. NOT a judgement — an agreeing
     *  proposal is as unconfirmed as a disagreeing one. */
    agrees: boolean;
};

/** A game's proposals, plus what fell out on the way — each a count a reader
 *  can hold the sample against. */
export type VerdictProposalList = {
    proposals: VerdictProposal[];
    /** Decisions the game kept. */
    captured: number;
    /** Decisions no legal move realised (a cancel, a shortcut, …). */
    unidentified: number;
    /** Sampled decisions the Brain could not answer (timeout, no move). */
    unjudged: number;
};

/** The game-end Brain consult: the move picked on `source` at `iterations`
 *  with `seed`, or `null` when there is no answer to compare against. */
export type BrainJudge = (
    source: AiTraceSource,
    budget: { iterations: number },
    seed: number
) => Promise<Move | null>;

type Identified = {
    source: AiTraceSource;
    position: GameState;
    humanMove: Move;
    decisionClass: DecisionClass;
};

/** Up to `quota` items per class, by a seeded shuffle, returned in their
 *  original order. Deterministic: same items, same seed, same sample. */
export function sampleByDecisionClass<
    T extends { decisionClass: DecisionClass },
>(items: readonly T[], quota: number, seed: number): T[] {
    const rng = makeRng(seed);
    const keep = new Set<number>();
    for (const cls of DECISION_CLASSES) {
        const indexes = items.flatMap((item, i) =>
            item.decisionClass === cls ? [i] : []
        );
        for (let i = indexes.length - 1; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            [indexes[i], indexes[j]] = [indexes[j], indexes[i]];
        }
        for (const index of indexes.slice(0, quota)) keep.add(index);
    }
    return items.filter((_, i) => keep.has(i));
}

/** Per class: every disagreement, then at most `agreeingPerClass`
 *  agreements — in class order, game order within a class. */
export function selectProposals(
    judged: readonly VerdictProposal[],
    agreeingPerClass: number
): VerdictProposal[] {
    const out: VerdictProposal[] = [];
    for (const cls of DECISION_CLASSES) {
        const ofClass = judged.filter((p) => p.decisionClass === cls);
        out.push(...ofClass.filter((p) => !p.agrees));
        out.push(...ofClass.filter((p) => p.agrees).slice(0, agreeingPerClass));
    }
    return out;
}

/** Whether the Brain's pick is the player's decision: the same structural
 *  key, or an interchangeable copy of it — the two steps a verdict's
 *  candidates are resolved by (`searchAgreement.ts`). */
export function sameDecision(
    position: GameState,
    human: Move,
    brain: Move
): boolean {
    if (moveKey(human) === moveKey(brain)) return true;
    const collapse = makeInterchangeableKeyer(position);
    return collapse(human) === collapse(brain);
}

/** Build the game's proposal list from its captured decisions. */
export async function proposeVerdicts(
    decisions: readonly CapturedDecision[],
    config: VerdictProposalConfig,
    judge: BrainJudge
): Promise<VerdictProposalList> {
    const identified: Identified[] = [];
    let unidentified = 0;
    for (const { source, calls } of decisions) {
        const position = projectedToGameState(
            source.state,
            source.knowledge,
            source.botId
        );
        const humanMove = await identifyHumanMove(
            position,
            source.botId,
            calls
        );
        if (!humanMove) {
            unidentified++;
            continue;
        }
        identified.push({
            source,
            position,
            humanMove,
            decisionClass: decisionClassOfMove(humanMove),
        });
    }

    const judged: VerdictProposal[] = [];
    let unjudged = 0;
    const sampled = sampleByDecisionClass(
        identified,
        config.perClassQuota,
        config.seed
    );
    for (const decision of sampled) {
        const brainMove = await judge(
            decision.source,
            { iterations: config.iterations },
            config.seed
        );
        if (!brainMove) {
            unjudged++;
            continue;
        }
        judged.push({
            source: decision.source,
            decisionClass: decision.decisionClass,
            humanMove: decision.humanMove,
            brainMove,
            agrees: sameDecision(
                decision.position,
                decision.humanMove,
                brainMove
            ),
        });
    }

    return {
        proposals: selectProposals(judged, config.agreeingPerClass),
        captured: decisions.length,
        unidentified,
        unjudged,
    };
}
