// The JUDGEMENT half of a stored Verdict, parsed (issue #3578, PRD #3574).
//
// The Verdict Lock's reader in `lockSource.ts` (ADR 0128 §2) turns untrusted
// JSON into a Verdict. A Verdict Store object carries no author or date —
// those live in its attestations (ADR 0128 §4) — only what IS the judgement:
// `spec`, `setup`, `seat`, `deckKnowledge`, `candidates`, `answer`, and the
// ADR 0148 `classification` / `pairOf` when present. That part is parsed
// here. It was shared with the `data/verdicts/**` file reader until issue
// #3584 retired the git corpus, which is why it has a module of its own.
//
// `spec` and `setup` are carried through UNVALIDATED beyond "is an object" /
// "is an array": the scenario vocabulary and `BladeSetupStep` both grow, and a
// structural re-check here would be those unions written a third time. They
// are checked where the check can mean something — `buildVerdictState` replays
// them through the engine, and a position that no longer builds is reported as
// a stale verdict by `collectVerdictReport`.
//
// Every rejection throws `<where>: <why>` — `where` is a file path or a
// verdict id, whichever names the thing a human has to go and look at.

import { VERDICT_HASH_PATTERN, type VerdictJudgement } from "./identity";
import {
    DISCRIMINANT_KINDS,
    type Discriminant,
    type MinimalPairLink,
    type Verdict,
    type VerdictAnswer,
    type VerdictCandidate,
    type VerdictClassification,
} from "./types";

function bad(where: string, why: string): never {
    throw new Error(`${where}: ${why}`);
}

function parseCandidates(where: string, raw: unknown): VerdictCandidate[] {
    if (!Array.isArray(raw) || raw.length === 0) {
        bad(where, `"candidates" must be a non-empty array`);
    }
    const seen = new Set<string>();
    return (raw as unknown[]).map((entry, i) => {
        const row = entry as Record<string, unknown>;
        if (
            typeof row?.key !== "string" ||
            typeof row?.description !== "string"
        ) {
            bad(where, `candidate ${i} needs a string "key" and "description"`);
        }
        // Two candidates with the same move key resolve to the SAME move on
        // the rebuilt position, so the pair built from them has `delta === 0`
        // and is permanently violated — a constraint nothing can satisfy,
        // sitting in the corpus looking like a real one. The enumerator cannot
        // produce a duplicate; a hand-authored payload can.
        if (seen.has(row.key as string)) {
            bad(where, `candidate ${i} repeats the move key of an earlier one`);
        }
        seen.add(row.key as string);
        return {
            key: row.key as string,
            description: row.description as string,
        };
    });
}

function parseIndexes(
    where: string,
    raw: unknown,
    key: string,
    bound: number
): number[] {
    if (!Array.isArray(raw) || raw.length === 0) {
        bad(where, `"answer.${key}" must name at least one candidate`);
    }
    return (raw as unknown[]).map((value) => {
        if (
            typeof value !== "number" ||
            !Number.isInteger(value) ||
            value < 0 ||
            value >= bound
        ) {
            bad(
                where,
                `"answer.${key}" holds ${JSON.stringify(value)}, which is outside the ${bound}-candidate list`
            );
        }
        return value as number;
    });
}

function parseAnswer(
    where: string,
    raw: unknown,
    bound: number
): VerdictAnswer {
    const answer = raw as Record<string, unknown>;
    if (answer?.kind === "right") {
        return {
            kind: "right",
            rightIndexes: parseIndexes(
                where,
                answer.rightIndexes,
                "rightIndexes",
                bound
            ),
        };
    }
    if (answer?.kind === "forbidden") {
        return {
            kind: "forbidden",
            forbiddenIndexes: parseIndexes(
                where,
                answer.forbiddenIndexes,
                "forbiddenIndexes",
                bound
            ),
        };
    }
    bad(where, `"answer.kind" must be "right" or "forbidden"`);
}

function parseDeckKnowledge(
    where: string,
    raw: unknown
): NonNullable<Verdict["deckKnowledge"]> {
    if (!Array.isArray(raw)) {
        bad(where, `"deckKnowledge", when present, must be an array`);
    }
    return (raw as unknown[]).map((entry, i) => {
        const row = entry as Record<string, unknown>;
        if (
            (row?.seat !== "me" && row?.seat !== "opp") ||
            !Array.isArray(row.cards) ||
            !row.cards.every((card) => typeof card === "string")
        ) {
            bad(
                where,
                `"deckKnowledge" entry ${i} needs a "seat" of "me" or "opp" and a "cards" list of names`
            );
        }
        return { seat: row.seat, cards: [...(row.cards as string[])] };
    });
}

function parseDiscriminant(
    where: string,
    raw: unknown,
    field: string
): Discriminant {
    const row = raw as Record<string, unknown>;
    if (
        !isJsonObject(raw) ||
        !(DISCRIMINANT_KINDS as readonly unknown[]).includes(row.kind)
    ) {
        bad(
            where,
            `"${field}.kind" must be one of ${DISCRIMINANT_KINDS.join(", ")}`
        );
    }
    // The detail IS the reason: a Discriminant with no words names no factor,
    // and under `other` it is the only thing the report can count.
    if (typeof row.detail !== "string" || row.detail.trim() === "") {
        bad(where, `"${field}.detail" must name the factor`);
    }
    return {
        kind: row.kind as Discriminant["kind"],
        detail: row.detail as string,
    };
}

function parseClassification(
    where: string,
    raw: unknown
): VerdictClassification {
    const row = raw as Record<string, unknown>;
    if (isJsonObject(raw) && row.kind === "absolute") {
        // An Absolute Verdict has no Discriminant by definition (ADR 0148):
        // one carrying a reason is a Conditional Verdict mislabelled.
        if (row.discriminant !== undefined) {
            bad(where, `an absolute "classification" names no Discriminant`);
        }
        return { kind: "absolute" };
    }
    if (isJsonObject(raw) && row.kind === "conditional") {
        return {
            kind: "conditional",
            discriminant: parseDiscriminant(
                where,
                row.discriminant,
                "classification.discriminant"
            ),
        };
    }
    bad(where, `"classification.kind" must be "absolute" or "conditional"`);
}

function parsePairLink(where: string, raw: unknown): MinimalPairLink {
    const row = raw as Record<string, unknown>;
    if (
        !isJsonObject(raw) ||
        typeof row.anchorId !== "string" ||
        !VERDICT_HASH_PATTERN.test(row.anchorId)
    ) {
        bad(where, `"pairOf.anchorId" must be a verdict id`);
    }
    return {
        anchorId: row.anchorId as string,
        discriminant: parseDiscriminant(
            where,
            row.discriminant,
            "pairOf.discriminant"
        ),
    };
}

/** Is `raw` a JSON object (not `null`, not an array)? */
export function isJsonObject(raw: unknown): raw is Record<string, unknown> {
    return typeof raw === "object" && raw !== null && !Array.isArray(raw);
}

/**
 * The judgement a JSON object holds. Throws `<where>: <why>` on anything it
 * cannot read as one. Fields outside the judgement are ignored, not rejected —
 * provenance is the caller's to read.
 */
export function parseVerdictJudgement(
    where: string,
    raw: Record<string, unknown>
): VerdictJudgement {
    const seat = raw.seat;
    if (seat !== "me" && seat !== "opp") {
        bad(where, `"seat" must be "me" or "opp"`);
    }
    if (!isJsonObject(raw.spec)) {
        // An ARRAY passes `typeof x === "object"`, and a bare card list is the
        // shape a hand-author reaches for first — without this it reaches the
        // builder and fails there instead of here, by name.
        bad(where, `"spec" must be an object`);
    }
    if (raw.setup !== undefined && !Array.isArray(raw.setup)) {
        bad(where, `"setup", when present, must be an array`);
    }
    const deckKnowledge =
        raw.deckKnowledge === undefined
            ? undefined
            : parseDeckKnowledge(where, raw.deckKnowledge);
    const candidates = parseCandidates(where, raw.candidates);
    const answer = parseAnswer(where, raw.answer, candidates.length);
    // ADR 0148. A record with neither field is UNCLASSIFIED — every record
    // written before the classification existed — and is read as it was
    // written: the upcast is a reading (`minimalPair.ts`), never a rewrite,
    // since a rewrite would change the judgement and so its name.
    const classification =
        raw.classification === undefined
            ? undefined
            : parseClassification(where, raw.classification);
    const pairOf =
        raw.pairOf === undefined ? undefined : parsePairLink(where, raw.pairOf);
    if (pairOf !== undefined) {
        // A right-hand half is classified by its link: it is the "right" of
        // the anchor's "wrong now", so it names a right move and carries no
        // classification of its own.
        if (classification !== undefined) {
            bad(
                where,
                `a Minimal Pair's right-hand half carries no "classification"`
            );
        }
        if (answer.kind !== "right") {
            bad(where, `a Minimal Pair's right-hand half must answer "right"`);
        }
    }
    return {
        spec: raw.spec as Verdict["spec"],
        ...(raw.setup === undefined
            ? {}
            : { setup: raw.setup as Verdict["setup"] }),
        seat,
        ...(deckKnowledge === undefined ? {} : { deckKnowledge }),
        candidates,
        answer,
        ...(classification === undefined ? {} : { classification }),
        ...(pairOf === undefined ? {} : { pairOf }),
    };
}
