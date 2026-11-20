// The judge's own reading of a decision — the Plan in force, their verbatim
// words, the Verdict Grade and the alternatives they would also accept
// (PRD issue #10083). ONE field list, shared by every door an attestation
// passes: the `submit` mutation, the outbox row, the forward body and the
// Verdict Store object. A door that spelled the list out itself would drop a
// field the day one is added, and the reading would vanish silently between
// the tester's click and the store.
//
// A reading is provenance and judgement of a PERSON. It never enters the
// verdict id (`identity.ts` hashes the judgement alone), and an accepted
// alternative is never added to the answer's right moves.

import {
    VERDICT_GRADES,
    type VerdictAnswer,
    type VerdictAttestation,
} from "./types";

/** The reading's fields of an attestation. */
export type AttestedReading = Pick<
    VerdictAttestation,
    "plan" | "rationale" | "grade" | "acceptedIndexes"
>;

/** The reading's fields of `source`, field by field — a stray property never
 *  rides along, and an absent field stays absent rather than `undefined`. */
export function readingOf(source: AttestedReading): AttestedReading {
    return {
        ...(source.plan === undefined
            ? {}
            : {
                  plan: {
                      text: source.plan.text,
                      ...(source.plan.seq === undefined
                          ? {}
                          : { seq: source.plan.seq }),
                  },
              }),
        ...(source.rationale === undefined
            ? {}
            : { rationale: source.rationale }),
        ...(source.grade === undefined ? {} : { grade: source.grade }),
        ...(source.acceptedIndexes === undefined
            ? {}
            : { acceptedIndexes: source.acceptedIndexes.slice() }),
    };
}

const isIndex = (value: unknown): value is number =>
    typeof value === "number" && Number.isInteger(value) && value >= 0;

/** Why `raw`'s reading fields are malformed on their own, or `null`. Read off
 *  untyped bytes (a store object, a forward body), so every type is checked.
 *  A blank text or an empty list is refused rather than kept: it would be a
 *  second encoding of "nothing said". */
export function readingShapeProblem(
    raw: Record<string, unknown>
): string | null {
    const { plan, rationale, grade, acceptedIndexes } = raw;
    if (plan !== undefined) {
        if (typeof plan !== "object" || plan === null || Array.isArray(plan)) {
            return "the plan is not an object";
        }
        const { text, seq } = plan as Record<string, unknown>;
        if (typeof text !== "string" || text.trim() === "") {
            return "the plan states nothing";
        }
        if (seq !== undefined && !isIndex(seq)) {
            return "the plan's seq is not a sequence number";
        }
    }
    if (
        rationale !== undefined &&
        (typeof rationale !== "string" || rationale.trim() === "")
    ) {
        return "the rationale says nothing";
    }
    if (
        grade !== undefined &&
        !(VERDICT_GRADES as readonly unknown[]).includes(grade)
    ) {
        return `grade ${JSON.stringify(grade)} is not one of ${VERDICT_GRADES.join(", ")}`;
    }
    if (acceptedIndexes !== undefined) {
        if (grade !== "preferred") {
            return "accepted alternatives belong to a preferred grade only";
        }
        if (
            !Array.isArray(acceptedIndexes) ||
            acceptedIndexes.length === 0 ||
            !acceptedIndexes.every(isIndex)
        ) {
            return "accepted alternatives must name at least one candidate index";
        }
        if (new Set(acceptedIndexes).size !== acceptedIndexes.length) {
            return "an accepted alternative is named twice";
        }
    }
    return null;
}

/** Why a reading cannot be attested beside `answer` over `candidateCount`
 *  candidates, or `null`. Everything `readingShapeProblem` checks, plus what
 *  only the judgement can say: an alternative is a candidate the list holds,
 *  sits beside a move named right, and is never that move itself. */
export function readingProblem(
    reading: AttestedReading,
    answer: VerdictAnswer,
    candidateCount: number
): string | null {
    const shape = readingShapeProblem(reading);
    if (shape !== null) return shape;
    const accepted = reading.acceptedIndexes;
    if (accepted === undefined) return null;
    if (answer.kind !== "right") {
        return "accepted alternatives need an answer that names the right move";
    }
    const outside = accepted.find((index) => index >= candidateCount);
    if (outside !== undefined) {
        return `accepted alternative ${outside} is outside the ${candidateCount}-candidate list`;
    }
    const preferred = accepted.find((index) =>
        answer.rightIndexes.includes(index)
    );
    if (preferred !== undefined) {
        return `accepted alternative ${preferred} is the preferred move itself`;
    }
    return null;
}
