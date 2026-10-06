// `tolaria.config.json` § verdictProposals (issue #3984, GLOSSARY.md § Verdict
// Proposal) — the ONLY reader of that block.
//
// Every bound the capture and the game-end sample obey is a number there, none
// a literal here: how many human decisions one game keeps, how many per
// Decision Class the Brain is consulted on, how many AGREEING ones still become
// proposals, and the consult's fixed budget and seed.
//
// A NAMED import, not the default one: Vite tree-shakes the JSON's other
// top-level keys, so the client bundle carries this block and nothing else
// from a file that also names accounts and machine limits.

import { verdictProposals } from "../../../tolaria.config.json";

/** `tolaria.config.json` § verdictProposals. */
export type VerdictProposalConfig = {
    /** Human-seat decisions one game keeps (a reservoir, see
     *  `human-decision-capture.ts`). */
    captureLimit: number;
    /** Decisions per Decision Class the Brain is consulted on at game end —
     *  also the most proposals one class can yield. */
    perClassQuota: number;
    /** Of those, how many the Brain AGREED with still become proposals. At
     *  most `perClassQuota`. */
    agreeingPerClass: number;
    /** The game-end consult's fixed search budget (never wall-clock). */
    iterations: number;
    /** The seed every game-end consult and the per-class sample run on. */
    seed: number;
};

const where = "tolaria.config.json § verdictProposals";

function positiveInteger(raw: Record<string, unknown>, key: string): number {
    const value = raw[key];
    if (!Number.isInteger(value) || (value as number) < 1) {
        throw new Error(
            `${where}: "${key}" must be an integer >= 1, got ${JSON.stringify(value)}`
        );
    }
    return value as number;
}

/** Parse the block. Throws, naming the field, on anything else — a quota that
 *  does not read is never a quota of zero. */
export function parseVerdictProposalConfig(
    raw: unknown
): VerdictProposalConfig {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
        throw new Error(`${where}: missing, or not an object`);
    }
    const r = raw as Record<string, unknown>;
    const seed = r.seed;
    if (!Number.isInteger(seed)) {
        throw new Error(
            `${where}: "seed" must be an integer, got ${JSON.stringify(seed)}`
        );
    }
    const config: VerdictProposalConfig = {
        captureLimit: positiveInteger(r, "captureLimit"),
        perClassQuota: positiveInteger(r, "perClassQuota"),
        agreeingPerClass: positiveInteger(r, "agreeingPerClass"),
        iterations: positiveInteger(r, "iterations"),
        seed: seed as number,
    };
    if (config.agreeingPerClass > config.perClassQuota) {
        throw new Error(
            `${where}: "agreeingPerClass" (${config.agreeingPerClass}) exceeds "perClassQuota" (${config.perClassQuota})`
        );
    }
    return config;
}

/** The shipped configuration, parsed once. */
export const VERDICT_PROPOSAL_CONFIG: VerdictProposalConfig =
    parseVerdictProposalConfig(verdictProposals);
