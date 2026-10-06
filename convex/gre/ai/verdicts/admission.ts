// Admission Candidates: the locked Verdicts tooling proposes for a human's
// Admission look (issue #3985, PRD #3980, ADR 0138; CONTEXT.md § Admission).
//
// TOOLING PROPOSES, A HUMAN ADMITS. A candidate is a locked Verdict that has
// cleared four bars, each a number in `tolaria.config.json` § admission and
// none a literal here:
//
//   1. PERSONS — attested explicitly by at least `minPersons` distinct
//      people (`personsOf`: one human's dev and prod accounts are one
//      person), or by one of `ownerPersons` alone;
//   2. STREAK — satisfied by the Weight Fit across at least
//      `minConsecutivePromotions` consecutive Promotions (the ledger,
//      `promotionStreak.ts`);
//   3. NEVER CONTESTED — no other explicit answer at its position, in the
//      store or in the blade registry, now or before a resolution accepted
//      it (the caller names the keys);
//   4. SEEDS — the whole Bot, through `searchVerdict`, picks an allowed
//      candidate on every one of `seeds` at `iterations`.
//
// What no tool can judge is the forced-loss criterion — the wrong move loses
// something forced by the rules, a creature or the game, never "worse on
// average" — so the report says "eligible for an Admission look", never
// "admit", and names that check as the reviewer's.
//
// THE UNIT IS A MINIMAL PAIR. A Conditional Verdict is proposed only with the
// right-hand halves that complete it (ADR 0148), as one unit every member of
// which clears every bar; a half alone is never a candidate, nor is an anchor
// with no half beside it.
//
// WRITES NOTHING. Pure over its inputs: the search is a port, and the
// caller's only write is the report text. The ledger it reads is advanced by
// the promotion, never here.
//
// Not to be confused with `candidates.ts`, which is a Verdict's candidate MOVE
// set.

import { minimalPairStandings } from "./minimalPair";
import type { AttestedVerdict } from "./quarantine";
import type { VerdictSearchBudget } from "./searchAgreement";
import { personsOf } from "./testerQuality";
import type { VerdictAuthorAlias } from "./types";

/** `tolaria.config.json` § admission. */
export type AdmissionConfig = {
    minPersons: number;
    /** Authors (`${deployment}:${userId}`) whose person's attestation alone
     *  suffices; any one of a person's aliased accounts names them. */
    ownerPersons: string[];
    minConsecutivePromotions: number;
    seeds: number[];
    iterations: number;
};

const positiveInteger = (value: unknown): value is number =>
    Number.isInteger(value) && (value as number) >= 1;

/** The `admission` block of `tolaria.config.json`. Throws, naming the field,
 *  on anything else — a bar that does not read is never a bar of zero. */
export function parseAdmissionConfig(raw: unknown): AdmissionConfig {
    const where = "tolaria.config.json § admission";
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
        throw new Error(`${where}: missing, or not an object`);
    }
    const r = raw as Record<string, unknown>;
    for (const key of [
        "minPersons",
        "minConsecutivePromotions",
        "iterations",
    ] as const) {
        if (!positiveInteger(r[key])) {
            throw new Error(
                `${where}: "${key}" must be an integer >= 1, got ${JSON.stringify(r[key])}`
            );
        }
    }
    if (
        !Array.isArray(r.ownerPersons) ||
        !r.ownerPersons.every((a) => typeof a === "string")
    ) {
        throw new Error(`${where}: "ownerPersons" must be an array of authors`);
    }
    if (
        !Array.isArray(r.seeds) ||
        r.seeds.length === 0 ||
        !r.seeds.every((s) => Number.isInteger(s))
    ) {
        throw new Error(
            `${where}: "seeds" must be a non-empty array of integers`
        );
    }
    return {
        minPersons: r.minPersons as number,
        ownerPersons: [...(r.ownerPersons as string[])],
        minConsecutivePromotions: r.minConsecutivePromotions as number,
        seeds: [...(r.seeds as number[])],
        iterations: r.iterations as number,
    };
}

/** What the proposer needs of a search: `agreed` of `seeds` picked an
 *  allowed candidate, or why it could not be searched. */
export type AdmissionSearchResult = {
    agreed: number;
    seeds: number;
    error?: string;
};

export type AdmissionSearch = (
    verdictId: string,
    budget: VerdictSearchBudget
) => AdmissionSearchResult;

/** The first bar a unit failed. */
export type AdmissionRefusal =
    | "incomplete-pair"
    | "contested"
    | "persons"
    | "streak"
    | "seeds";

export type AdmissionMember = {
    verdictId: string;
    positionKey: string;
    /** Distinct persons who attested it explicitly, sorted. */
    persons: string[];
    /** Whether one of them is an owner. */
    owner: boolean;
    streak: number;
    /** Set once the unit reached the seed check. */
    search?: AdmissionSearchResult;
};

export type AdmissionUnit = {
    /** The anchor first, then its halves sorted — or one verdict. */
    members: AdmissionMember[];
    /** `null` for a candidate. */
    refusal: AdmissionRefusal | null;
};

export type AdmissionProposal = {
    config: AdmissionConfig;
    /** Every unit, in the order of its first member's id. */
    units: AdmissionUnit[];
    candidates: AdmissionUnit[];
    /** The ledger's own reset reason, printed beside the streaks. */
    streakReset: string | null;
};

export type AdmissionInput = {
    /** The locked store Verdicts, with their attestations. */
    verdicts: readonly AttestedVerdict[];
    /** Every position key a disagreement stands at — store and registry. */
    contestedPositionKeys: ReadonlySet<string>;
    aliases: readonly VerdictAuthorAlias[];
    streaks: ReadonlyMap<string, number>;
    streakReset: string | null;
    config: AdmissionConfig;
    search: AdmissionSearch;
};

const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The units the locked set falls into: each complete Minimal Pair whole,
 *  every other verdict alone. */
function unitsOf(
    verdicts: readonly AttestedVerdict[]
): { ids: string[]; incomplete: boolean }[] {
    const standings = minimalPairStandings(
        verdicts.map((v) => ({
            verdictId: v.verdictId,
            judgement: v.judgement,
            stored: true,
        }))
    );
    const units: { ids: string[]; incomplete: boolean }[] = [];
    for (const v of [...verdicts].sort((a, b) =>
        byString(a.verdictId, b.verdictId)
    )) {
        const standing = standings.get(v.verdictId);
        if (standing?.kind === "paired") {
            // A half travels with its anchor's unit.
            if (standing.role === "anchor") {
                units.push({
                    ids: [v.verdictId, ...standing.partnerIds],
                    incomplete: false,
                });
            }
        } else {
            units.push({
                ids: [v.verdictId],
                incomplete: standing?.kind === "incomplete",
            });
        }
    }
    return units;
}

/**
 * The Admission Candidates among `input.verdicts`. Every unit is judged bar by
 * bar, cheapest first, and stops at the first it fails; only a unit that
 * cleared the other three is searched.
 */
export function proposeAdmissionCandidates(
    input: AdmissionInput
): AdmissionProposal {
    const { config } = input;
    const byId = new Map(input.verdicts.map((v) => [v.verdictId, v]));
    const explicitAuthors = (v: AttestedVerdict) =>
        v.attestations
            .filter((a) => a.sourceAxis === "explicit")
            .map((a) => a.author);
    const persons = personsOf(
        [...input.verdicts.flatMap(explicitAuthors), ...config.ownerPersons],
        input.aliases
    );
    const owners = new Set(config.ownerPersons.map((a) => persons.get(a)!));
    const budget: VerdictSearchBudget = {
        iterations: config.iterations,
        seeds: [...config.seeds],
    };

    const units: AdmissionUnit[] = unitsOf(input.verdicts).map(
        ({ ids, incomplete }) => {
            const members: AdmissionMember[] = ids.map((id) => {
                const v = byId.get(id)!;
                const who = [
                    ...new Set(explicitAuthors(v).map((a) => persons.get(a)!)),
                ].sort(byString);
                return {
                    verdictId: id,
                    positionKey: v.positionKey,
                    persons: who,
                    owner: who.some((p) => owners.has(p)),
                    streak: input.streaks.get(id) ?? 0,
                };
            });
            const refusal: AdmissionRefusal | null = incomplete
                ? "incomplete-pair"
                : members.some((m) =>
                        input.contestedPositionKeys.has(m.positionKey)
                    )
                  ? "contested"
                  : members.some(
                          (m) =>
                              !m.owner && m.persons.length < config.minPersons
                      )
                    ? "persons"
                    : members.some(
                            (m) => m.streak < config.minConsecutivePromotions
                        )
                      ? "streak"
                      : null;
            if (refusal !== null) return { members, refusal };
            for (const m of members) {
                m.search = input.search(m.verdictId, budget);
            }
            const allAgreed = members.every(
                (m) =>
                    m.search!.error === undefined &&
                    m.search!.seeds === config.seeds.length &&
                    m.search!.agreed === m.search!.seeds
            );
            return { members, refusal: allAgreed ? null : "seeds" };
        }
    );
    return {
        config,
        units,
        candidates: units.filter((u) => u.refusal === null),
        streakReset: input.streakReset,
    };
}

const REFUSALS: AdmissionRefusal[] = [
    "incomplete-pair",
    "contested",
    "persons",
    "streak",
    "seeds",
];

/** The section `verdicts:promote` appends. */
export function formatAdmissionProposal(proposal: AdmissionProposal): string {
    const c = proposal.config;
    const count = (refusal: AdmissionRefusal) =>
        proposal.units.filter((u) => u.refusal === refusal).length;
    const out = [
        `== Admission Candidates (issue #3985) — eligible for an Admission look, never admitted`,
        `  bar                    : >= ${c.minPersons} distinct persons (or one owner), satisfied >= ${c.minConsecutivePromotions} consecutive Promotions, never Contested, an allowed pick on every one of ${c.seeds.length} seeds at ${c.iterations} iterations (the committed Bot)`,
        `  streak ledger          : ${proposal.streakReset ?? "read over the committed lock"}`,
        `  locked units           : ${proposal.units.length} (a Minimal Pair is one unit)`,
        ...REFUSALS.map((r) => `  refused — ${r.padEnd(16)}: ${count(r)}`),
        `  candidates             : ${proposal.candidates.length}`,
        `  the forced-loss check is the reviewer's: admit only a position whose wrong move loses something forced by the rules — a creature, the game — never "worse on average" (CONTEXT.md § Admission)`,
    ];
    for (const unit of proposal.candidates) {
        out.push("");
        for (const m of unit.members) {
            out.push(
                `  ${m.verdictId}`,
                `      persons  : ${m.persons.join(", ")}${m.owner ? "  (owner)" : ""}`,
                `      streak   : ${m.streak}`,
                `      seeds    : ${m.search!.agreed}/${m.search!.seeds}`
            );
        }
    }
    return out.join("\n");
}
