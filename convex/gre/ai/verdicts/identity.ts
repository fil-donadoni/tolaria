// Verdict identity — the content-addressed verdict id and the position key
// (issue #3575, PRD #3574, ADR 0128 §3 and §6).
//
// THE VERDICT ID is the name a judgement takes in the Verdict Store:
// `v1-<sha256>` over the canonical encoding of the JUDGEMENT — the position
// (`spec`, `setup`, `seat`, `deckKnowledge`), the `candidates`, and the
// `answer`. Two deployments recording the same judgement produce one object,
// and verifying an object is re-hashing it. THE POSITION KEY is the same hash
// minus `answer`: two judgements about the same decision share it, which is
// how a contradiction becomes detectable at all.
//
// WHAT IS NOT HASHED, and why each is provenance rather than judgement:
// `id` (it is what this module computes), `author`, `note`, `createdAt`,
// `origin` (`gameId`, `seq`), `botPickIndex` (what the Bot did, not what the
// judge said), and `source` — an `authored` verdict and an `in-play` one that
// say the same thing about the same position are ONE judgement with two
// attestations (PRD #3574, user story 37). The same holds across the explicit /
// implicit axis (ADR 0128 §11): a judgement given and one inferred from play
// that say the same thing are one verdict id, and which kind each is lives on
// its attestation (`VerdictAttestation.sourceAxis`, issue #3579), never here.
//
// THE PROJECTION IS EXPLICIT, field by field, never "the verdict minus a
// deny-list". `v1-` versions the CANONICALISATION, not the payload (ADR 0128
// §8): a payload change — a `schemaVersion`, a new provenance field — is an
// upcast at read and must not rename a single object. A deny-list would hash
// every field added after today; the allow-list hashes only what a judgement
// is. `spec` and `setup` are hashed whole, because they are the position and
// they grow: a new optional scenario field is absent from every existing
// verdict, and an absent key encodes as nothing. What is NOT normalised inside
// them is a default spelled out (`passCount: 0` against no `passCount`): one
// board is one name only because the capture path (`specFromState` and the
// lowering) emits one spec for it, and a second producer must emit the same.
//
// A CANDIDATE IS ITS MOVE KEY. The `description` beside it is the move
// describer's rendering, not the judgement: hashed, a rewording of
// `describeMove` would rename a re-captured judgement on the next build, and —
// worse, under §6 — give two contradicting judgements taken on two builds two
// position keys, so the contradiction would never be quarantined. Keys are
// unique within a verdict (`verdicts.submit`, `parseCandidates`), so the key
// alone names the candidate.
//
// CANONICAL means: object keys sorted by UTF-16 code unit, no whitespace,
// numbers in ECMAScript's shortest round-trip form (so `1.0`, `1e0` and `1`
// parsed from JSON are one spelling, and `-0` is `0`), `undefined` object
// members omitted. Three normalisations say what the consumers already treat
// as equal: an empty `setup` or `deckKnowledge` is the same as none
// (`applyBladeSetupSteps` iterates `setup ?? []`, `bladeDeckKnowledge` tests
// `?.length`), and an answer's index list is a SET (`evalPairsOf` reads it
// through `new Set`), so it is encoded sorted and deduplicated. Arrays are
// otherwise kept in order — candidate order is what the indexes point into, and
// `evalPairsOf` breaks ties by it. `deckKnowledge` is kept in order too: it
// lowers to the `DeckKnowledgeBySeat` the search determinizes from and
// `deckColorsFor` reads first-match, so its order is not provably incidental,
// and the cost of not sorting it is at most a missed deduplication.
//
// Pure and dependency-free (the digest is `sha256.ts`, beside this file), so
// the Convex bundle, the browser engine and the scripts compute the same name —
// the constraint `fileSource.ts` documents for this directory.

import { sha256Hex } from "./sha256";
import type { Verdict, VerdictAnswer } from "./types";

/** The canonicalisation version every verdict id and position key carries. */
export const VERDICT_CANONICALISATION = "v1";

/** The shape of a verdict id or a position key under this canonicalisation. */
export const VERDICT_HASH_PATTERN = new RegExp(
    `^${VERDICT_CANONICALISATION}-[0-9a-f]{64}$`
);

/** The fields of a Verdict that ARE the judgement. A full `Verdict` fits. */
export type VerdictJudgement = Pick<
    Verdict,
    "spec" | "setup" | "seat" | "deckKnowledge" | "candidates" | "answer"
>;

/**
 * The canonical JSON text of a plain data value. Throws, naming the path, on
 * anything JSON cannot say exactly once: a non-finite number, a `bigint`, a
 * function, an `undefined` array slot, a non-plain object (a `Date`, a `Map`).
 */
export function canonicalJson(value: unknown): string {
    return encode(value, "$");
}

function encode(value: unknown, path: string): string {
    if (value === null) return "null";
    switch (typeof value) {
        case "string":
            return JSON.stringify(value);
        case "boolean":
            return value ? "true" : "false";
        case "number":
            if (!Number.isFinite(value)) {
                throw new Error(`${path}: ${value} has no canonical encoding`);
            }
            // ECMAScript Number::toString is the shortest round-trip form and
            // renders -0 as "0" — the same in every conforming engine.
            return JSON.stringify(value);
        case "object": {
            if (Array.isArray(value)) {
                const items: string[] = [];
                for (let i = 0; i < value.length; i++) {
                    if (value[i] === undefined) {
                        throw new Error(
                            `${path}[${i}]: an undefined array slot has no canonical encoding`
                        );
                    }
                    items.push(encode(value[i], `${path}[${i}]`));
                }
                return `[${items.join(",")}]`;
            }
            const proto = Object.getPrototypeOf(value);
            if (proto !== Object.prototype && proto !== null) {
                throw new Error(
                    `${path}: only plain objects have a canonical encoding`
                );
            }
            const record = value as Record<string, unknown>;
            const members = Object.keys(record)
                .filter((key) => record[key] !== undefined)
                .sort()
                .map(
                    (key) =>
                        `${JSON.stringify(key)}:${encode(record[key], `${path}.${key}`)}`
                );
            return `{${members.join(",")}}`;
        }
        default:
            throw new Error(
                `${path}: a ${typeof value} has no canonical encoding`
            );
    }
}

function indexSet(indexes: readonly number[]): number[] {
    return [...new Set(indexes)].sort((a, b) => a - b);
}

function answerOf(answer: VerdictAnswer): VerdictAnswer {
    if (answer.kind === "right") {
        return { kind: "right", rightIndexes: indexSet(answer.rightIndexes) };
    }
    if (answer.kind === "forbidden") {
        return {
            kind: "forbidden",
            forbiddenIndexes: indexSet(answer.forbiddenIndexes),
        };
    }
    throw new Error(
        `answer.kind ${JSON.stringify((answer as { kind?: unknown }).kind)} has no canonical encoding`
    );
}

function positionOf(verdict: VerdictJudgement) {
    return {
        spec: verdict.spec,
        ...(verdict.setup?.length ? { setup: verdict.setup } : {}),
        seat: verdict.seat,
        ...(verdict.deckKnowledge?.length
            ? { deckKnowledge: verdict.deckKnowledge }
            : {}),
        candidates: verdict.candidates.map(({ key }) => key),
    };
}

function named(encoding: string): string {
    return `${VERDICT_CANONICALISATION}-${sha256Hex(encoding)}`;
}

/** The content-addressed verdict id: position, candidates AND answer. */
export function verdictIdOf(verdict: VerdictJudgement): string {
    return named(
        canonicalJson({
            ...positionOf(verdict),
            answer: answerOf(verdict.answer),
        })
    );
}

/** The position key: the verdict id's encoding minus `answer`. Two judgements
 *  about the same decision share it (ADR 0128 §6). */
export function positionKeyOf(verdict: VerdictJudgement): string {
    return named(canonicalJson(positionOf(verdict)));
}
