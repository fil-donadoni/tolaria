// `data/verdicts/**` as a Verdict source (issue #3402, PRD #3397, ADR 0124 §1).
//
// The second source beside the blade registry, and the one that grows: a
// tester judges a real Bot decision in the browser, the row lands in the
// `verdicts` table, and `bun run verdicts:pull` writes it here as one JSON
// file per verdict. Hand-authored files live in the same directory and are
// read the same way — a counter-example cut by hand is exactly as much a
// verdict as one given in play, which is why `VerdictSource` has an
// `authored` arm.
//
// WHY THE FIT READS GIT AND NOT THE TABLE. ADR 0124 §3 requires a fit to be
// reproducible from a checkout — same verdicts, same weights, to the bit. A
// corpus that lived in a Convex deployment would make every fit depend on a
// database nobody else has, and a weight set nobody can re-derive is a weight
// set nobody can review. So the table is intake only, and the directory is the
// corpus.
//
// NO FILESYSTEM HERE. This module is pure: it takes file CONTENTS and returns
// verdicts. The read itself belongs to whoever has a filesystem — the export
// script, a test, a future fit runner — and keeping it out means this module
// stays in the Convex bundle and in the browser-importable engine, like every
// other module under `gre/`.
//
// A MALFORMED FILE THROWS. Everywhere else in this subsystem an input that
// yields no verdict is REPORTED as a gap rather than dropped, because the
// blade registry is a hundred entries written for another purpose and a third
// of them legitimately produce nothing. A file under `data/verdicts/` is the
// opposite: it exists for exactly this, it is repo state, and it went through
// review. There is no "legitimately unreadable" case to keep reporting — so
// the file name goes in an exception, loudly, once.

import { verdictsFromRegistry, type RegistryVerdicts } from "./registrySource";
import type { BladeScenario } from "../blade/types";
import { parseVerdictJudgement } from "./judgement";
import type { Verdict, VerdictSource } from "./types";

/** The directory the corpus lives in, relative to the repo root. */
export const VERDICT_DIR = "data/verdicts";

/** One file, as whoever did the reading found it. */
export type VerdictFile = {
    /** For error messages only — never part of the verdict. */
    path: string;
    contents: string;
};

const SOURCES: readonly VerdictSource[] = ["registry", "in-play", "authored"];

function bad(path: string, why: string): never {
    throw new Error(`${path}: ${why}`);
}

function requireString(
    path: string,
    raw: Record<string, unknown>,
    key: string
): string {
    const value = raw[key];
    if (typeof value !== "string" || value.trim() === "") {
        bad(path, `"${key}" must be a non-empty string`);
    }
    return value as string;
}

/**
 * One file's contents as a `Verdict`. Throws, naming the file, on anything it
 * cannot read as one. The judgement itself — position, candidates, answer —
 * is parsed by `parseVerdictJudgement`, which the Verdict Lock's reader shares.
 */
export function parseVerdictFile(file: VerdictFile): Verdict {
    let raw: Record<string, unknown>;
    try {
        raw = JSON.parse(file.contents) as Record<string, unknown>;
    } catch (error) {
        bad(
            file.path,
            `not valid JSON (${error instanceof Error ? error.message : `${error}`})`
        );
    }
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        bad(file.path, "must be a JSON object");
    }

    const id = requireString(file.path, raw, "id");
    const source = raw.source as VerdictSource;
    if (!SOURCES.includes(source)) {
        bad(file.path, `"source" must be one of ${SOURCES.join(" / ")}`);
    }
    const judgement = parseVerdictJudgement(file.path, raw);
    const candidates = judgement.candidates;
    if (
        raw.botPickIndex !== undefined &&
        (typeof raw.botPickIndex !== "number" ||
            !Number.isInteger(raw.botPickIndex) ||
            raw.botPickIndex < 0 ||
            raw.botPickIndex >= candidates.length)
    ) {
        bad(
            file.path,
            `"botPickIndex" is outside the ${candidates.length}-candidate list`
        );
    }

    return {
        id,
        ...judgement,
        ...(raw.botPickIndex === undefined
            ? {}
            : { botPickIndex: raw.botPickIndex as number }),
        author: requireString(file.path, raw, "author"),
        createdAt: requireString(file.path, raw, "createdAt"),
        source,
        ...(raw.origin === undefined
            ? {}
            : { origin: raw.origin as Verdict["origin"] }),
        ...(raw.note === undefined ? {} : { note: raw.note as string }),
    };
}

/**
 * Every verdict the given files hold, ordered by verdict id.
 *
 * ORDERED BY ID, not by the order the caller happened to read the directory
 * in: a fit consuming this must be reproducible (ADR 0124 §3), and directory
 * iteration order is a property of a filesystem, not of the corpus.
 *
 * A DUPLICATE ID THROWS. Two files naming the same verdict would state the
 * same constraint twice and weight it double in any fit — silently, since
 * nothing downstream compares ids. It is also exactly what a botched
 * hand-edit of an exported file produces.
 */
export function verdictsFromFiles(files: readonly VerdictFile[]): Verdict[] {
    const byId = new Map<string, string>();
    const verdicts: Verdict[] = [];
    for (const file of files) {
        const verdict = parseVerdictFile(file);
        const seen = byId.get(verdict.id);
        if (seen !== undefined) {
            bad(
                file.path,
                `verdict id "${verdict.id}" is already used by ${seen}`
            );
        }
        byId.set(verdict.id, file.path);
        verdicts.push(verdict);
    }
    return verdicts.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * The whole corpus: the blade registry's derived verdicts first, then the
 * files, with the registry's gaps carried through so one report still answers
 * "what was in, and what was left out".
 *
 * `files` has NO DEFAULT, deliberately: a caller that forgot to read the
 * directory would otherwise get a silent registry-only corpus, indistinguishable
 * from one where nobody has judged anything — and a fit is the last place that
 * difference should be invisible. Pass `[]` to mean it.
 *
 * Registry first because those verdicts are DERIVED and their ids are
 * `registry:<label>` — keeping them as one contiguous, registry-ordered block
 * makes a report readable against the registry it came from, while the file
 * verdicts sort among themselves by id.
 */
export function verdictCorpus(
    files: readonly VerdictFile[],
    scenarios?: readonly BladeScenario[]
): RegistryVerdicts {
    const registry = verdictsFromRegistry(scenarios);
    const fromFiles = verdictsFromFiles(files);
    const ids = new Set(registry.verdicts.map((v) => v.id));
    for (const verdict of fromFiles) {
        if (ids.has(verdict.id)) {
            throw new Error(
                `${VERDICT_DIR}: verdict id "${verdict.id}" collides with a registry-derived verdict`
            );
        }
    }
    return {
        verdicts: [...registry.verdicts, ...fromFiles],
        gaps: registry.gaps,
    };
}
