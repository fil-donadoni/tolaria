// The Verdict Grade as the corpus reads it (PRD issue #10083, GLOSSARY.md
// § Verdict Grade): how agreement, the Weight Fit and Tester Quality honour a
// judge's "clear", "preferred" or "indifferent".
//
// ONE GRADE PER VERDICT. A grade is said by a PERSON, on an attestation
// (`reading.ts`), so one Verdict may carry several. The one the corpus reads
// is the Reference Judge's when any of their attestations is on it; otherwise
// the least committal grade present (indifferent over preferred over clear) —
// a disagreement about how clear-cut a decision is resolves toward the doubt.
// An attestation with no grade, every one written before grades existed, is
// read as `clear`, so no recorded number moves.
//
// THE LOCK CARRIES IT. The Weight Fit is re-derivable from the committed lock
// and its pack alone (`lockSource.ts`), and attestations are in neither. So a
// promotion reads the grade off the attestations ONCE and writes it into the
// lock beside the ids (`VerdictLock.readings`, non-clear readings only), and
// every reader takes it from `Verdict.reading`, which the lock reader fills.
// A store change that regrades a locked Verdict reaches the fit by the next
// promotion, never silently between two.
//
// WHAT EACH GRADE DOES:
//   - clear: as before every grade existed.
//   - preferred: the Bot AGREES when it plays the preferred move or any
//     accepted alternative. The fit still reads every pair — the judge does
//     prefer that move — but agreement counts an accepted alternative as
//     agreed.
//   - indifferent: carries no weight. Absent from the fit input and from every
//     agreement denominator, and counted on its own line where it is left out.
//
// The Reference Judge is a ROLE (`tolaria.config.json` § referenceJudge), a
// list of authors whose people hold it; never a name in code.
//
// Pure: no store, no config file read here.

import { isJsonObject } from "./judgement";
import {
    VERDICT_GRADES,
    type Verdict,
    type VerdictAttestation,
    type VerdictGrade,
    type VerdictReading,
} from "./types";

/** Least committal last: the order a disagreement resolves along. */
const COMMITMENT: Record<VerdictGrade, number> = {
    clear: 0,
    preferred: 1,
    indifferent: 2,
};

/** The grade an attestation says — `clear` when it says none. */
export const attestedGradeOf = (
    attestation: Pick<VerdictAttestation, "grade">
): VerdictGrade => attestation.grade ?? "clear";

/** The least committal of `grades`, `clear` when there are none. */
export function leastCommittalGrade(
    grades: Iterable<VerdictGrade>
): VerdictGrade {
    let out: VerdictGrade = "clear";
    // eslint-disable-next-line no-restricted-syntax -- an iterable or generator, not an array (issue #10126)
    for (const grade of grades) {
        if (COMMITMENT[grade] > COMMITMENT[out]) out = grade;
    }
    return out;
}

/**
 * The reading of one Verdict from its attestations: the Reference Judge's
 * grade when any attestation is theirs, else the least committal present. On
 * `preferred`, the accepted alternatives are the union of those the read
 * attestations name. `null` for a Clear reading — the lock writes nothing for
 * it, and a Verdict with no reading is read as Clear.
 */
export function readingOfAttestations(
    attestations: readonly Pick<
        VerdictAttestation,
        "author" | "grade" | "acceptedIndexes"
    >[],
    isReferenceJudge: (author: string) => boolean
): VerdictReading | null {
    const judged = attestations.filter((a) => isReferenceJudge(a.author));
    const read = judged.length > 0 ? judged : attestations;
    const grade = leastCommittalGrade(read.map(attestedGradeOf));
    if (grade === "clear") return null;
    if (grade === "indifferent") return { grade };
    const accepted = new Set(
        read
            .filter((a) => attestedGradeOf(a) === "preferred")
            .flatMap((a) => a.acceptedIndexes ?? [])
    );
    return accepted.size === 0
        ? { grade }
        : { grade, acceptedIndexes: [...accepted].sort((a, b) => a - b) };
}

/** The grade `verdict` is read with — `clear` when it carries no reading. */
export const verdictGradeOf = (verdict: Pick<Verdict, "reading">) =>
    verdict.reading?.grade ?? "clear";

/** Whether `verdict` carries no weight: left out of the fit input and of
 *  every agreement denominator. */
export const isIndifferent = (verdict: Pick<Verdict, "reading">): boolean =>
    verdictGradeOf(verdict) === "indifferent";

/** Whether playing candidate `index` of `verdict` is agreement: an allowed
 *  candidate of the answer, or an alternative its Preferred grade accepts. */
export function agreesWithVerdict(
    verdict: Pick<Verdict, "answer" | "reading">,
    index: number
): boolean {
    const { answer } = verdict;
    const allowed =
        answer.kind === "right"
            ? answer.rightIndexes.includes(index)
            : !answer.forbiddenIndexes.includes(index);
    return allowed || isAcceptedAlternative(verdict, index);
}

/** Whether candidate `index` is an alternative `verdict`'s Preferred grade
 *  accepts. */
export const isAcceptedAlternative = (
    verdict: Pick<Verdict, "reading">,
    index: number
): boolean =>
    verdict.reading?.grade === "preferred" &&
    (verdict.reading.acceptedIndexes ?? []).includes(index);

/** Why `raw` is not a non-clear reading a lock may carry, or `null`. */
export function lockReadingProblem(raw: unknown): string | null {
    if (!isJsonObject(raw)) return "a reading must be a JSON object";
    const { grade, acceptedIndexes, ...rest } = raw;
    const stray = Object.keys(rest)[0];
    if (stray !== undefined) return `unknown reading field "${stray}"`;
    if (!(VERDICT_GRADES as readonly unknown[]).includes(grade)) {
        return `grade ${JSON.stringify(grade)} is not one of ${VERDICT_GRADES.join(", ")}`;
    }
    // A Clear reading is the absence of one: written, it would be a second
    // encoding of the default.
    if (grade === "clear") return "a clear reading is written as no reading";
    if (acceptedIndexes === undefined) return null;
    if (grade !== "preferred") {
        return "accepted alternatives belong to a preferred grade only";
    }
    if (
        !Array.isArray(acceptedIndexes) ||
        acceptedIndexes.length === 0 ||
        !acceptedIndexes.every(
            (i, n) =>
                typeof i === "number" &&
                Number.isInteger(i) &&
                i >= 0 &&
                (n === 0 || i > (acceptedIndexes[n - 1] as number))
        )
    ) {
        return "accepted alternatives must be candidate indexes, ascending, none twice";
    }
    return null;
}

/** A copy of `reading`, field by field. */
export const copyReading = (reading: VerdictReading): VerdictReading =>
    reading.acceptedIndexes === undefined
        ? { grade: reading.grade }
        : {
              grade: reading.grade,
              acceptedIndexes: reading.acceptedIndexes.slice(),
          };

/** The Reference Judge's configured authors — `tolaria.config.json`
 *  § referenceJudge.authors, as read. Absent → no one holds the role, and
 *  every Verdict is read by the least committal rule. Throws on a malformed
 *  block. */
export function parseReferenceJudgeConfig(raw: unknown): string[] {
    if (raw === undefined) return [];
    if (!isJsonObject(raw)) {
        throw new Error("tolaria.config.json § referenceJudge: not an object");
    }
    const { authors } = raw;
    if (
        !Array.isArray(authors) ||
        !authors.every((a) => typeof a === "string" && a.includes(":"))
    ) {
        throw new Error(
            'tolaria.config.json § referenceJudge: "authors" must list `${deployment}:${userId}` authors'
        );
    }
    return authors.slice();
}

/** Who holds the Reference Judge role: an author whose PERSON is one a
 *  configured author belongs to (`personOf` joins one person's accounts, the
 *  aliases `testerQuality.ts` reads). */
export function referenceJudgeOf(
    configured: readonly string[],
    personOf: (author: string) => string
): (author: string) => boolean {
    const persons = new Set(configured.map(personOf));
    return (author) => persons.has(personOf(author));
}

/** The grades a lock reads, as one report line block. */
export function formatLockReadings(
    readings: Readonly<Record<string, VerdictReading>> | undefined,
    referenceJudge: readonly string[]
): string {
    const all = Object.values(readings ?? {});
    const count = (grade: VerdictGrade) =>
        all.filter((r) => r.grade === grade).length;
    return [
        "== Verdict Grades the lock reads (PRD issue #10083) — every verdict not listed is read as clear",
        `  reference judge    : ${referenceJudge.length === 0 ? "none configured — the least committal grade is read" : referenceJudge.join(", ")}`,
        `  preferred          : ${count("preferred")} (an accepted alternative counts as agreement)`,
        `  indifferent        : ${count("indifferent")} (left out of the fit and of every agreement count)`,
    ].join("\n");
}
