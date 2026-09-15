// The Verdict review surface's readings (issue #3582, PRD #3574, ADR 0128 §6):
// how a position, its answers and a half-made decision are put into words.
// Pure, so the components only render and the rules are testable without a DOM.

import type {
    ResolutionDraft,
    ReviewAttestation,
    ReviewPosition,
    ReviewVerdict,
} from "@convex/verdictReview";
import type { VerdictJudgement } from "@convex/gre/ai/verdicts/identity";
import type { ScenarioSeat } from "@/components/debug/scenario-spec-board-model";

/** "Answer A", "Answer B"… in the order the position lists its verdicts. */
export function answerLetter(index: number): string {
    return String.fromCharCode(65 + index);
}

export type AnswerReading = {
    kind: "Right" | "Forbidden";
    /** The candidate descriptions the answer names, in index order. */
    moves: string[];
};

/** What one answer says, in the candidates' own words. */
export function answerReading(judgement: VerdictJudgement): AnswerReading {
    const { answer, candidates } = judgement;
    const indexes =
        answer.kind === "right" ? answer.rightIndexes : answer.forbiddenIndexes;
    return {
        kind: answer.kind === "right" ? "Right" : "Forbidden",
        moves: [...indexes]
            .sort((a, b) => a - b)
            .map(
                (index) =>
                    candidates[index]?.description ?? `candidate ${index}`
            ),
    };
}

/** For each candidate, which answers name it and how — `["A: right"]`. */
export function candidateMarks(verdicts: readonly ReviewVerdict[]): string[][] {
    const candidates = verdicts[0]?.judgement.candidates ?? [];
    return candidates.map((_, index) =>
        verdicts.flatMap((verdict, v) => {
            const { answer } = verdict.judgement;
            const named =
                answer.kind === "right"
                    ? answer.rightIndexes
                    : answer.forbiddenIndexes;
            return named.includes(index)
                ? [`${answerLetter(v)}: ${answer.kind}`]
                : [];
        })
    );
}

/** Who gave a judgement: the nickname when this deployment knows the
 *  account, the `${deployment}:${userId}` author otherwise. */
export function authorLabel(
    person: Pick<ReviewAttestation, "author" | "nickname">
): string {
    return person.nickname ?? person.author;
}

/** An epoch-ms instant as a short, locale-independent date. */
export function dateLabel(at: number | undefined): string | null {
    return at === undefined ? null : new Date(at).toISOString().slice(0, 10);
}

/** The board's seat names: the seat that owed the decision is named so. */
export function decidingSeatLabels(
    seat: ScenarioSeat
): Record<ScenarioSeat, string> {
    return seat === "me"
        ? { me: "Deciding seat", opp: "Other seat" }
        : { me: "Other seat", opp: "Deciding seat" };
}

/** "Turn 5 · PRECOMBAT_MAIN" — what tells two positions apart in a list. */
export function positionHeadline(position: ReviewPosition): string {
    const spec = position.verdicts[0]?.judgement.spec;
    const parts = [
        spec?.turn === undefined ? null : `Turn ${spec.turn}`,
        spec?.phase ?? null,
        `${position.verdicts.length} answers`,
    ].filter((part): part is string => part !== null);
    return parts.join(" · ");
}

/** Where a half-made decision stands. */
export type DraftState =
    | { ready: true; draft: ResolutionDraft }
    | { ready: false; missing: string };

/**
 * The resolution a form holds, or what it still lacks. `accepted` is a
 * verdict id, `null` for "none is right", `undefined` while nothing is
 * chosen. Every verdict not accepted needs a reason: a rejection without one
 * is refused by the server too, and saying so here keeps the button honest.
 */
export function draftState(
    position: ReviewPosition,
    accepted: string | null | undefined,
    reasons: Readonly<Record<string, string>>
): DraftState {
    if (accepted === undefined) {
        return { ready: false, missing: "Choose the right answer, or none." };
    }
    const rejected = position.verdicts
        .map((verdict, index) => ({ verdict, index }))
        .filter(({ verdict }) => verdict.verdictId !== accepted);
    const unexplained = rejected.find(
        ({ verdict }) => (reasons[verdict.verdictId] ?? "").trim() === ""
    );
    if (unexplained !== undefined) {
        return {
            ready: false,
            missing: `Say why Answer ${answerLetter(unexplained.index)} is wrong.`,
        };
    }
    return {
        ready: true,
        draft: {
            positionKey: position.positionKey,
            acceptedVerdictId: accepted,
            rejected: rejected.map(({ verdict }) => ({
                verdictId: verdict.verdictId,
                reason: reasons[verdict.verdictId].trim(),
            })),
        },
    };
}
