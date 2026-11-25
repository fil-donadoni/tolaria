// A game's Verdict Proposal list, built once the game is over (GLOSSARY.md
// § Verdict Proposal, PRD #3980).
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
//   3. JUDGE — one Brain consult per sampled decision, all asked at once, on
//      the seat's own view, at a FIXED iteration budget and seed (the blade's discipline: same
//      position, same answer). The pick either agrees with the player's move —
//      same structural key, or an interchangeable copy — or it does not.
//   4. SELECT — per class, every disagreement first, then agreements up to
//      `agreeingPerClass`: a corpus made only of disagreements cannot see a
//      change that breaks what the Brain already gets right.
//
// COMMENTED DECISIONS ARE NEVER SAMPLED AWAY. A decision the
// player commented while playing skips step 2 — it is always judged — and
// step 4 — it is always proposed, agreeing or not; the quota then fills the
// rest of its class as before. Every proposal carries the Plan its seat had
// in force at the decision's `seq` and the player's words, which the review
// submits with the Attestation (`verdicts.submit`).
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
import type { AttestedPlan } from "@convex/gre/ai/verdicts/types";
import {
    planInForce,
    type CapturedDecision,
    type PlanStatement,
} from "./human-decision-capture";
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
    /** The Plan the deciding seat had in force at this decision's `seq`
     *  (issue #10088), as the Attestation carries it. */
    plan?: AttestedPlan;
    /** The player's comment on this decision, verbatim — set exactly when
     *  the decision was commented, which is what made it always proposed. */
    rationale?: string;
    /** The player marked this decision obvious while playing. */
    obvious?: true;
};

/** Whether the player commented this decision — such a proposal is never
 *  sampled or selected away. */
export function isCommented(p: { rationale?: string }): boolean {
    return p.rationale !== undefined;
}

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
 *  with `seed`, or `null` when there is no answer to compare against. Called
 *  for every sampled decision at once: how many searches run in parallel is
 *  the judge's own business. */
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
    /** The player's own reading of the decision, carried to its proposal. */
    said: Pick<VerdictProposal, "plan" | "rationale" | "obvious">;
};

/** Up to `quota` items per class (`quotaOf(cls)` when given), by a seeded
 *  shuffle, returned in their original order. Deterministic: same items,
 *  same seed, same sample. */
export function sampleByDecisionClass<
    T extends { decisionClass: DecisionClass },
>(
    items: readonly T[],
    quota: number,
    seed: number,
    quotaOf: (cls: DecisionClass) => number = () => quota
): T[] {
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
        const room = Math.max(0, quotaOf(cls));
        for (const index of indexes.slice(0, room)) keep.add(index);
    }
    return items.filter((_, i) => keep.has(i));
}

/** The commented decisions, plus a seeded sample of the others that fills
 *  each class's quota around them — in original order. */
export function sampleAroundCommented<
    T extends { decisionClass: DecisionClass; said: { rationale?: string } },
>(items: readonly T[], quota: number, seed: number): T[] {
    const commented = items.filter((item) => isCommented(item.said));
    const rest = items.filter((item) => !isCommented(item.said));
    const taken = (cls: DecisionClass) =>
        commented.filter((item) => item.decisionClass === cls).length;
    const sampled = new Set<T>([
        ...commented,
        ...sampleByDecisionClass(
            rest,
            quota,
            seed,
            (cls) => quota - taken(cls)
        ),
    ]);
    return items.filter((item) => sampled.has(item));
}

/** Per class: every disagreement, then the agreements — every commented
 *  one, and uncommented ones up to what `agreeingPerClass` leaves — in class
 *  order, game order within a class. */
export function selectProposals(
    judged: readonly VerdictProposal[],
    agreeingPerClass: number
): VerdictProposal[] {
    const out: VerdictProposal[] = [];
    for (const cls of DECISION_CLASSES) {
        const ofClass = judged.filter((p) => p.decisionClass === cls);
        out.push(...ofClass.filter((p) => !p.agrees));
        const agreeing = ofClass.filter((p) => p.agrees);
        const commented = agreeing.filter(isCommented).length;
        let room = Math.max(0, agreeingPerClass - commented);
        out.push(
            ...agreeing.filter((p) => {
                if (isCommented(p)) return true;
                if (room === 0) return false;
                room--;
                return true;
            })
        );
    }
    return out;
}

/** What the player said about `decision` while playing, as its proposal
 *  carries it: the Plan in force at its `seq`, its comment or mark. */
export function saidAbout(
    decision: CapturedDecision,
    plans: readonly PlanStatement[]
): Identified["said"] {
    const plan = planInForce(
        plans,
        decision.source.botId,
        decision.source.state.seq
    );
    const note = decision.annotation;
    return {
        ...(plan ? { plan: { text: plan.text, seq: plan.seq } } : {}),
        ...(note?.kind === "comment" ? { rationale: note.text } : {}),
        ...(note?.kind === "obvious" ? { obvious: true as const } : {}),
    };
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
    judge: BrainJudge,
    /** Called once the sample is drawn (`done` 0) and after each consult —
     *  what the game-over dialog shows while the judge runs (issue #10229). */
    onProgress?: (done: number, total: number) => void,
    /** Every Plan statement of the game (issue #10088). */
    plans: readonly PlanStatement[] = []
): Promise<VerdictProposalList> {
    const identified: Identified[] = [];
    let unidentified = 0;
    for (const decision of decisions) {
        const { source, calls } = decision;
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
            said: saidAbout(decision, plans),
        });
    }

    const sampled = sampleAroundCommented(
        identified,
        config.perClassQuota,
        config.seed
    );
    onProgress?.(0, sampled.length);
    // Every consult is asked at once; the answers are read back in SAMPLE order,
    // so the list does not depend on which search ended first.
    let done = 0;
    const answers = await Promise.all(
        sampled.map(async (decision) => {
            const brainMove = await judge(
                decision.source,
                { iterations: config.iterations },
                config.seed
            );
            onProgress?.(++done, sampled.length);
            return brainMove;
        })
    );
    const judged: VerdictProposal[] = [];
    let unjudged = 0;
    for (const [index, decision] of sampled.entries()) {
        const brainMove = answers[index];
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
            ...decision.said,
        });
    }

    return {
        proposals: selectProposals(judged, config.agreeingPerClass),
        captured: decisions.length,
        unidentified,
        unjudged,
    };
}
