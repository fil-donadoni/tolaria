// What the Verdict review surface reads (issue #3582, PRD #3574, ADR 0128 §6):
// every contested and resolved position, rebuilt from BOTH places a judgement
// can be — the Verdict Store and the outbox rows not yet stored in it.
//
// WHY BOTH. A row leaves the outbox only after its object is confirmed in the
// store, so the union of the two is every judgement this deployment knows,
// whenever it is read. A local backend holds no write key and never drains:
// for it the outbox IS the corpus, which is also what lets the browser lane
// walk this surface. Duplicates across the two collapse by construction — a
// verdict is its content, an attestation is (verdict, author), a resolution is
// its decision — so nothing here de-duplicates by hand.
//
// ONE SURFACE, THREE USES (ADR 0128): the contested list resolves conflicts
// and re-judges what quarantine holds; `openVerdictOf` opens any single
// verdict for cold judging. Resolving goes through `resolutionAgainst`, which
// refuses a decision about a set of verdicts the position no longer holds — a
// third answer arriving while the admin was reading reopens the question
// rather than being swept into a decision nobody made about it.
//
// Pure: the `"use node"` action binds it to the store and the tables.

import type { VerdictJudgement } from "./gre/ai/verdicts/identity";
import {
    quarantineContestedPositions,
    type AttestedVerdict,
    type IdentifiedResolution,
} from "./gre/ai/verdicts/quarantine";
import { decidedVerdictIds } from "./gre/ai/verdicts/resolution";
import type {
    VerdictAttestation,
    VerdictResolution,
} from "./gre/ai/verdicts/types";
import type { StoredVerdictCorpus } from "./verdictStore";
import {
    attestationOfRow,
    attributionOfRow,
    judgementOfRow,
    verdictStampOf,
    type OutboxRow,
    type VerdictDeployment,
} from "./verdictsOutbox";
import {
    resolutionOfRow,
    type ResolutionOutboxRow,
} from "./verdictResolutionsOutbox";

/** Everything a classification reads, from wherever it was found. */
export type ReviewSources = StoredVerdictCorpus & {
    /** Outbox rows that could not be read as a judgement, and why. */
    unreadable: { rowId: string; reason: string }[];
};

/** Merge the store's objects with the outbox rows not yet stored. `stored` is
 *  `null` on a deployment that cannot read the store. */
export function reviewSourcesOf(args: {
    stored: StoredVerdictCorpus | null;
    verdictRows: readonly OutboxRow[];
    resolutionRows: readonly ResolutionOutboxRow[];
    here: VerdictDeployment;
}): ReviewSources {
    const sources: ReviewSources = {
        verdicts: [...(args.stored?.verdicts ?? [])],
        attestations: [...(args.stored?.attestations ?? [])],
        resolutions: [...(args.stored?.resolutions ?? [])],
        unreadable: [],
    };
    for (const row of args.verdictRows) {
        const judgement = judgementOfRow(row);
        if (judgement === null) continue;
        try {
            const { verdictHash } = verdictStampOf(judgement);
            sources.verdicts.push(judgement);
            sources.attestations.push(
                attestationOfRow(
                    row,
                    verdictHash,
                    attributionOfRow(row, args.here)
                )
            );
        } catch (error) {
            sources.unreadable.push({
                rowId: row._id,
                reason: error instanceof Error ? error.message : String(error),
            });
        }
    }
    for (const row of args.resolutionRows) {
        sources.resolutions.push(resolutionOfRow(row));
    }
    return sources;
}

/** One author's word as the surface shows it. */
export type ReviewAttestation = {
    author: string;
    /** The account's nickname, when the author is a user of THIS deployment. */
    nickname?: string;
    createdAt?: number;
    note?: string;
    botPickIndex?: number;
    deploymentKind?: "cloud" | "local";
};

export type ReviewVerdict = {
    verdictId: string;
    positionKey: string;
    judgement: VerdictJudgement;
    /** Explicit attestations first, each author once, sorted. */
    attestations: ReviewAttestation[];
};

export type ReviewResolution = {
    resolutionId: string;
    author: string;
    nickname?: string;
    createdAt?: number;
    note?: string;
    acceptedVerdictId: string | null;
    rejected: { verdictId: string; reason: string }[];
};

export type ReviewPosition = {
    positionKey: string;
    status: "contested" | "resolved";
    /** Every explicit verdict at the key, sorted by id. */
    verdicts: ReviewVerdict[];
    /** The resolution that applies — `null` while contested. */
    resolution: ReviewResolution | null;
    /** The newest resolution that no longer applies, when a contested
     *  position was resolved before its latest answer arrived. */
    staleResolution: ReviewResolution | null;
};

export type VerdictReview = {
    /** Contested first, then resolved; each group by position key. */
    positions: ReviewPosition[];
    promotable: number;
    /** Whether the Verdict Store was read, or only this deployment's outbox. */
    storeRead: boolean;
    unreadable: { rowId: string; reason: string }[];
};

/** Resolves an author to a nickname, when it can. */
export type NicknameOf = (author: string) => string | undefined;

/** The user id of an author on `here`, or `null` for another deployment's. */
export function localUserIdOf(
    author: string,
    here: VerdictDeployment
): string | null {
    const prefix = `${here.name}:`;
    return author.startsWith(prefix) ? author.slice(prefix.length) : null;
}

function attestationKey(verdictId: string, author: string): string {
    return `${verdictId}\n${author}`;
}

function projectVerdict(
    verdict: AttestedVerdict,
    full: ReadonlyMap<string, VerdictAttestation>,
    nicknameOf: NicknameOf
): ReviewVerdict {
    return {
        verdictId: verdict.verdictId,
        positionKey: verdict.positionKey,
        judgement: verdict.judgement,
        attestations: verdict.attestations
            .filter((a) => a.sourceAxis === "explicit")
            .map(({ author }) => {
                const given = full.get(
                    attestationKey(verdict.verdictId, author)
                );
                const nickname = nicknameOf(author);
                return {
                    author,
                    ...(nickname === undefined ? {} : { nickname }),
                    ...(given?.createdAt === undefined
                        ? {}
                        : { createdAt: given.createdAt }),
                    ...(given?.note === undefined ? {} : { note: given.note }),
                    ...(given?.botPickIndex === undefined
                        ? {}
                        : { botPickIndex: given.botPickIndex }),
                    ...(given?.deploymentKind === undefined
                        ? {}
                        : { deploymentKind: given.deploymentKind }),
                };
            }),
    };
}

function projectResolution(
    { resolutionId, resolution }: IdentifiedResolution,
    nicknameOf: NicknameOf
): ReviewResolution {
    const nickname = nicknameOf(resolution.author);
    return {
        resolutionId,
        author: resolution.author,
        ...(nickname === undefined ? {} : { nickname }),
        ...(resolution.createdAt === undefined
            ? {}
            : { createdAt: resolution.createdAt }),
        ...(resolution.note === undefined ? {} : { note: resolution.note }),
        acceptedVerdictId: resolution.acceptedVerdictId,
        rejected: resolution.rejected,
    };
}

/** The first record of each (verdict, author) — the provenance to show. */
function attestationsByKey(
    attestations: readonly VerdictAttestation[]
): Map<string, VerdictAttestation> {
    const byKey = new Map<string, VerdictAttestation>();
    for (const a of attestations) {
        const key = attestationKey(a.verdictId, a.author);
        if (!byKey.has(key)) byKey.set(key, a);
    }
    return byKey;
}

/** Every contested and resolved position, projected for the surface. */
export function verdictReviewOf(
    sources: ReviewSources,
    nicknameOf: NicknameOf,
    storeRead: boolean
): VerdictReview {
    const q = quarantineContestedPositions(
        sources.verdicts,
        sources.attestations,
        sources.resolutions
    );
    const full = attestationsByKey(sources.attestations);
    const contested: ReviewPosition[] = q.contested.map((position) => ({
        positionKey: position.positionKey,
        status: "contested",
        verdicts: position.verdicts.map((v) =>
            projectVerdict(v, full, nicknameOf)
        ),
        resolution: null,
        staleResolution:
            position.staleResolutions.length === 0
                ? null
                : projectResolution(position.staleResolutions[0], nicknameOf),
    }));
    const resolved: ReviewPosition[] = q.resolved.map((position) => ({
        positionKey: position.positionKey,
        status: "resolved",
        verdicts: [
            ...(position.accepted === null ? [] : [position.accepted]),
            ...position.rejected.map((r) => r.verdict),
        ]
            .sort((a, b) => (a.verdictId < b.verdictId ? -1 : 1))
            .map((v) => projectVerdict(v, full, nicknameOf)),
        resolution: projectResolution(position.applied, nicknameOf),
        staleResolution: null,
    }));
    return {
        positions: [...contested, ...resolved],
        promotable: q.promotable.length,
        storeRead,
        unreadable: sources.unreadable,
    };
}

/** One verdict, opened for cold judging, or `null` when none has that id. */
export function openVerdictOf(
    sources: ReviewSources,
    verdictId: string,
    nicknameOf: NicknameOf
): ReviewVerdict | null {
    const q = quarantineContestedPositions(
        sources.verdicts,
        sources.attestations
    );
    const verdict = [
        ...q.promotable,
        ...q.contested.flatMap((c) => c.verdicts),
        ...q.implicitOnly,
        ...q.unattested,
    ].find((v) => v.verdictId === verdictId);
    return verdict === undefined
        ? null
        : projectVerdict(
              verdict,
              attestationsByKey(sources.attestations),
              nicknameOf
          );
}

/** A decision as the surface submits it — the resolver is stamped later. */
export type ResolutionDraft = Pick<
    VerdictResolution,
    "positionKey" | "acceptedVerdictId" | "rejected"
>;

/**
 * Whether `draft` decides over exactly the verdicts its position holds now.
 * `null` when it does; otherwise the reason to show the admin. Whether it is a
 * decision at all (reasons present, two or more verdicts) is the record
 * door's check, not this one.
 */
export function resolutionAgainst(
    sources: ReviewSources,
    draft: ResolutionDraft
): string | null {
    const q = quarantineContestedPositions(
        sources.verdicts,
        sources.attestations
    );
    const position = q.contested.find(
        (c) => c.positionKey === draft.positionKey
    );
    if (position === undefined) {
        return `no contested position has the key ${draft.positionKey}`;
    }
    const held = position.verdicts.map((v) => v.verdictId).join("\n");
    const decided = decidedVerdictIds({ ...draft, author: "" }).join("\n");
    if (held !== decided) {
        return "the position's verdicts changed since it was opened — reload it and decide again";
    }
    return null;
}
