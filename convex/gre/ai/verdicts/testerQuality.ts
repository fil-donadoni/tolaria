// Per-tester quality: what each person judged, and what became of it
// (issue #3585, PRD #3574, ADR 0128 §6 and Consequences).
//
// FOUR NUMBERS PER PERSON, each a set of positions a reader can open:
//
//   - GIVEN — positions the person judged explicitly. An implicit attestation
//     ("the move chosen", ADR 0128 §11) is not a judgement given.
//   - CONTRADICTED — positions where SOMEONE ELSE explicitly gave an answer the
//     person did not. Counted whether or not a human has since resolved it: it
//     was a disagreement. One person's two accounts disagreeing with each
//     other is not "someone else" — that is quarantined, never contradicted.
//   - QUARANTINED — positions the person judged that are contested NOW, i.e.
//     held out of the lock until a resolution (`quarantine.ts`).
//
//   The blade registry is someone else too: a store verdict at a position the
//   registry judges differently is held out of the lock as contested
//   (`validateStoreObjects`), though no two STORE verdicts disagree there, so
//   the caller names those keys and they count as both.
//   - UNSATISFIED — positions where a verdict the person gave is in the
//     committed Verdict Lock and the Weight Fit could not satisfy it.
//
// THE LAST NUMBER IS A POINTER, NEVER A VERDICT ON THE JUDGE. A pair the fit
// cannot satisfy is equally the signature of a term the evaluation lacks
// (ADR 0124 §3): the person who keeps landing there may be the one seeing
// what the Bot cannot. So it is reported as positions worth looking at, the
// text says so where the number is printed, and nothing here ranks or scores.
//
// NOTHING IS TALLIED. Every number is derived, on each run, from the
// classification of the store (`quarantineContestedPositions`), the committed
// lock and the fit report over that lock — the caller re-derives the report
// with the same pipeline the reproducibility guard runs. There is no counter
// anywhere to drift from those three.
//
// ONE PERSON, SEVERAL AUTHORS. User ids are per-deployment, so an owner with a
// dev and a production account is two `${deployment}:${userId}` authors.
// `VerdictAuthorAlias` objects join them — symmetric, and transitive through
// chains — and the person is named by the smallest author in the group, so
// the name is a function of the aliases and never of their order.
//
// Pure: no store, no clock. Output order is a function of the content.

import type { VerdictLock } from "./lockSource";
import type { AttestedVerdict, VerdictQuarantine } from "./quarantine";
import type { VerdictAuthorAlias } from "./types";

/** The fit report over the committed lock: the lock, and the ids of its
 *  verdicts with a pair the fit left unsatisfied. */
export type TesterFitReport = {
    lock: VerdictLock;
    unsatisfiedVerdictIds: readonly string[];
};

/** One position behind a number: the key, and the person's own verdicts at
 *  it — what the admin surface opens (`/admin/verdicts`). */
export type TesterPosition = {
    positionKey: string;
    verdictIds: string[];
};

export type TesterQuality = {
    /** The smallest author among `authors`. */
    person: string;
    /** Every author joined into this person, sorted. */
    authors: string[];
    given: TesterPosition[];
    contradicted: TesterPosition[];
    quarantined: TesterPosition[];
    /** Empty, not unknown, when a fit report was read; see `fitRead`. */
    unsatisfied: TesterPosition[];
};

export type TesterQualityReport = {
    /** Sorted by person. */
    testers: TesterQuality[];
    /** `false` when no lock is committed: `unsatisfied` is then unmeasured,
     *  and every row's empty list says nothing. */
    fitRead: boolean;
    /** The lock's pack hash the fit report is over, when one was read. */
    packHash: string | null;
    /** How many verdicts the lock names. */
    lockedVerdicts: number;
    /** Unsatisfied locked verdicts no explicit attestation in the store names
     *  — listed, never dropped: a pointer nobody owns is still a pointer. */
    unattributedUnsatisfied: string[];
};

const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Every author mapped to its person: the smallest author it is joined to,
 *  through any chain of aliases. */
export function personsOf(
    authors: Iterable<string>,
    aliases: readonly VerdictAuthorAlias[]
): Map<string, string> {
    const parent = new Map<string, string>();
    const find = (a: string): string => {
        if (!parent.has(a)) parent.set(a, a);
        let root = a;
        while (parent.get(root) !== root) root = parent.get(root)!;
        parent.set(a, root);
        return root;
    };
    const join = (a: string, b: string) => {
        const [ra, rb] = [find(a), find(b)];
        if (ra === rb) return;
        // The smaller root wins, so a root IS its group's smallest author.
        if (ra < rb) parent.set(rb, ra);
        else parent.set(ra, rb);
    };
    for (const author of authors) find(author);
    for (const { authors: pair } of aliases) join(pair[0], pair[1]);
    return new Map([...parent.keys()].map((author) => [author, find(author)]));
}

/** Every explicit verdict the quarantine classified, once each. */
function explicitVerdicts(q: VerdictQuarantine): AttestedVerdict[] {
    const byId = new Map<string, AttestedVerdict>();
    const add = (v: AttestedVerdict) => byId.set(v.verdictId, v);
    q.promotable.forEach(add);
    for (const c of q.contested) c.verdicts.forEach(add);
    for (const r of q.resolved) {
        if (r.accepted !== null) add(r.accepted);
        for (const { verdict } of r.rejected) add(verdict);
    }
    return [...byId.values()].sort((a, b) =>
        byString(a.verdictId, b.verdictId)
    );
}

function positionsOf(
    byKey: ReadonlyMap<string, ReadonlySet<string>>,
    keep: (positionKey: string, verdictIds: ReadonlySet<string>) => boolean
): TesterPosition[] {
    return [...byKey.keys()]
        .sort(byString)
        .filter((key) => keep(key, byKey.get(key)!))
        .map((positionKey) => ({
            positionKey,
            verdictIds: [...byKey.get(positionKey)!].sort(byString),
        }));
}

/**
 * The four numbers for every person with an explicit judgement. `fit` is the
 * report over the committed lock, or `null` when none is committed.
 *
 * `registryContested` names the position keys where the blade registry
 * judges differently from a store verdict (see the header).
 *
 * Throws on an unsatisfied id the lock does not name: that report is not over
 * this lock, and reading it would count what no fit ran over.
 */
export function testerQualityOf(
    quarantine: VerdictQuarantine,
    aliases: readonly VerdictAuthorAlias[],
    fit: TesterFitReport | null,
    registryContested: ReadonlySet<string> = new Set()
): TesterQualityReport {
    const locked = new Set(fit?.lock.verdictIds ?? []);
    const unsatisfied = new Set(fit?.unsatisfiedVerdictIds ?? []);
    for (const id of unsatisfied) {
        if (!locked.has(id)) {
            throw new Error(
                `${id}: the fit report names it unsatisfied, but the lock does not name it — the report is not over this lock`
            );
        }
    }

    const verdicts = explicitVerdicts(quarantine);
    const explicitAuthorsOf = (v: AttestedVerdict) =>
        v.attestations
            .filter((a) => a.sourceAxis === "explicit")
            .map((a) => a.author);
    const persons = personsOf(verdicts.flatMap(explicitAuthorsOf), aliases);

    // position key → every explicit verdict id at it.
    const givenAt = new Map<string, Set<string>>();
    // person → position key → the verdict ids the person gave there.
    const mine = new Map<string, Map<string, Set<string>>>();
    for (const v of verdicts) {
        const atKey = givenAt.get(v.positionKey) ?? new Set<string>();
        givenAt.set(v.positionKey, atKey);
        atKey.add(v.verdictId);
        const who = new Set(
            explicitAuthorsOf(v).map((author) => persons.get(author)!)
        );
        for (const person of who) {
            const keys = mine.get(person) ?? new Map<string, Set<string>>();
            mine.set(person, keys);
            const ids = keys.get(v.positionKey) ?? new Set<string>();
            keys.set(v.positionKey, ids);
            ids.add(v.verdictId);
        }
    }

    const contestedKeys = new Set(
        quarantine.contested.map((c) => c.positionKey)
    );
    const authorsOf = new Map<string, string[]>();
    for (const [author, person] of persons) {
        authorsOf.set(person, [...(authorsOf.get(person) ?? []), author]);
    }

    const testers = [...mine.keys()].sort(byString).map((person) => {
        const keys = mine.get(person)!;
        return {
            person,
            authors: [...authorsOf.get(person)!].sort(byString),
            given: positionsOf(keys, () => true),
            // Every explicit verdict has an explicit author, so one the person
            // did not give was given by someone else — while one person's two
            // accounts, joined, gave both answers themselves.
            contradicted: positionsOf(
                keys,
                (key, own) =>
                    registryContested.has(key) ||
                    [...givenAt.get(key)!].some(
                        (verdictId) => !own.has(verdictId)
                    )
            ),
            quarantined: positionsOf(
                keys,
                (key) => contestedKeys.has(key) || registryContested.has(key)
            ),
            unsatisfied: positionsOf(
                new Map(
                    [...keys]
                        .map(
                            ([key, ids]) =>
                                [
                                    key,
                                    new Set(
                                        [...ids].filter((id) =>
                                            unsatisfied.has(id)
                                        )
                                    ),
                                ] as const
                        )
                        .filter(([, ids]) => ids.size > 0)
                ),
                () => true
            ),
        };
    });

    const attributed = new Set(verdicts.map((v) => v.verdictId));
    return {
        testers,
        fitRead: fit !== null,
        packHash: fit?.lock.packHash ?? null,
        lockedVerdicts: locked.size,
        unattributedUnsatisfied: [...unsatisfied]
            .filter((id) => !attributed.has(id))
            .sort(byString),
    };
}

const UNSATISFIED_NOTE =
    "positions worth a look, not a score: an unsatisfied judgement is as often a term the evaluation lacks as a wrong one (ADR 0124 §3)";

/** What `bun run verdicts:testers` prints. */
export function formatTesterQuality(report: TesterQualityReport): string {
    const out = [
        `testers                : ${report.testers.length}`,
        report.fitRead
            ? `fit report             : over the lock (${report.lockedVerdicts} verdicts, pack ${report.packHash})`
            : "fit report             : no lock committed — unsatisfied is not measured",
        "open any verdict id below in /admin/verdicts",
    ];
    const drill = (label: string, positions: TesterPosition[]) => {
        if (positions.length === 0) return;
        out.push(`    ${label}:`);
        for (const p of positions) {
            out.push(`      ${p.positionKey}  ${p.verdictIds.join(", ")}`);
        }
    };
    for (const t of report.testers) {
        const unsatisfied = report.fitRead
            ? `${t.unsatisfied.length} — ${UNSATISFIED_NOTE}`
            : "not measured";
        out.push(
            "",
            `${t.person}${t.authors.length > 1 ? `  (also ${t.authors.filter((a) => a !== t.person).join(", ")})` : ""}`,
            `  given        : ${t.given.length}`,
            `  contradicted : ${t.contradicted.length}`,
            `  quarantined  : ${t.quarantined.length}`,
            `  unsatisfied  : ${unsatisfied}`
        );
        drill("given", t.given);
        drill("contradicted", t.contradicted);
        drill("quarantined", t.quarantined);
        drill("unsatisfied", t.unsatisfied);
    }
    if (report.unattributedUnsatisfied.length > 0) {
        out.push(
            "",
            `unsatisfied, attested by no one in the store: ${report.unattributedUnsatisfied.length}`
        );
        for (const id of report.unattributedUnsatisfied) out.push(`  ${id}`);
    }
    return out.join("\n");
}
