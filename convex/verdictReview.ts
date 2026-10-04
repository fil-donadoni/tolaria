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

import { verdictIdOf, type VerdictJudgement } from "./gre/ai/verdicts/identity";
import { minimalPairStandings } from "./gre/ai/verdicts/minimalPair";
import {
    quarantineContestedPositions,
    type AttestedVerdict,
    type IdentifiedResolution,
} from "./gre/ai/verdicts/quarantine";
import { decidedVerdictIds } from "./gre/ai/verdicts/resolution";
import type {
    Discriminant,
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
    /** The Minimal Pair this verdict belongs to — set only on a verdict
     *  opened for cold judging (`openVerdictOf`), where the pair is shown
     *  beside it (ADR 0148, issue #4801). */
    pair?: ReviewPairContext;
};

/** The other side of a Minimal Pair, as the surface shows it beside a verdict:
 *  an anchor lists the right-hand halves written so far (none while the half
 *  is owed), a half names its anchor. */
export type ReviewPairContext = {
    role: "anchor" | "half";
    discriminant: Discriminant;
    anchor: ReviewVerdict | null;
    halves: ReviewVerdict[];
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
    if (verdict === undefined) return null;
    const projected = projectVerdict(
        verdict,
        attestationsByKey(sources.attestations),
        nicknameOf
    );
    const pair = pairContextOf(
        sources,
        verdict.verdictId,
        verdict.judgement,
        nicknameOf
    );
    return pair === undefined ? projected : { ...projected, pair };
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
        return "the position's verdicts changed since the list was loaded — go back, reload the list and decide again";
    }
    return null;
}

// ── Minimal Pairs on the surface (ADR 0148, issue #4801) ─────────────────────

/** Every distinct verdict the sources hold, by id. The store and the outbox
 *  overlap for a row mid-drain, and a verdict is its content, so the id
 *  collapses the two. */
function distinctVerdicts(
    sources: ReviewSources
): Map<string, VerdictJudgement> {
    const byId = new Map<string, VerdictJudgement>();
    for (const judgement of sources.verdicts) {
        const id = verdictIdOf(judgement);
        if (!byId.has(id)) byId.set(id, judgement);
    }
    return byId;
}

/** A verdict as the surface shows it, projected from the raw sources — for a
 *  verdict the quarantine does not hand back (a pair's partner). */
function reviewVerdictOf(
    sources: ReviewSources,
    verdictId: string,
    judgement: VerdictJudgement,
    nicknameOf: NicknameOf
): ReviewVerdict {
    const authors = new Map<string, VerdictAttestation>();
    for (const a of sources.attestations) {
        if (a.verdictId === verdictId && !authors.has(a.author)) {
            authors.set(a.author, a);
        }
    }
    return projectVerdict(
        {
            verdictId,
            positionKey: verdictStampOf(judgement).positionKey,
            judgement,
            attestations: [...authors.values()].sort((a, b) =>
                a.author < b.author ? -1 : 1
            ),
        },
        attestationsByKey(sources.attestations),
        nicknameOf
    );
}

/** The Discriminant a verdict's pair is about, or `null` for one with none. */
function discriminantOfJudgement(
    judgement: VerdictJudgement
): Discriminant | null {
    if (judgement.pairOf !== undefined) return judgement.pairOf.discriminant;
    return judgement.classification?.kind === "conditional"
        ? judgement.classification.discriminant
        : null;
}

/** The pair beside a verdict, or `undefined` when it is in none (an Absolute
 *  Verdict, an unclassified one). */
function pairContextOf(
    sources: ReviewSources,
    verdictId: string,
    judgement: VerdictJudgement,
    nicknameOf: NicknameOf
): ReviewPairContext | undefined {
    const discriminant = discriminantOfJudgement(judgement);
    if (discriminant === null) return undefined;
    const all = distinctVerdicts(sources);
    if (judgement.pairOf !== undefined) {
        const anchor = all.get(judgement.pairOf.anchorId);
        return {
            role: "half",
            discriminant,
            anchor:
                anchor === undefined
                    ? null
                    : reviewVerdictOf(
                          sources,
                          judgement.pairOf.anchorId,
                          anchor,
                          nicknameOf
                      ),
            halves: [],
        };
    }
    const halves = [...all.entries()]
        .filter(([, other]) => other.pairOf?.anchorId === verdictId)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([id, half]) => reviewVerdictOf(sources, id, half, nicknameOf));
    return { role: "anchor", discriminant, anchor: null, halves };
}

const sameDiscriminant = (a: Discriminant, b: Discriminant): boolean =>
    a.kind === b.kind && a.detail === b.detail;

/** The verdict ids a Verdict Resolution rejected. Kept in the store as
 *  evidence, but never a live member of a pair: a rejected half completes no
 *  anchor, and a rejected anchor is owed no half. */
function rejectedIdsOf(sources: ReviewSources): Set<string> {
    const q = quarantineContestedPositions(
        sources.verdicts,
        sources.attestations,
        sources.resolutions
    );
    return new Set(
        q.resolved.flatMap((r) => r.rejected.map((x) => x.verdict.verdictId))
    );
}

/** A Conditional Verdict whose right-hand half nobody has written. */
export type MissingHalf = {
    /** The anchor's verdict id — what the half's `pairOf` will name. */
    anchorId: string;
    positionKey: string;
    judgement: VerdictJudgement;
};

/** A right-hand half somebody wrote, offered to any tester to check. */
export type HalfToReview = {
    halfId: string;
    positionKey: string;
    /** The half's own judgement: its position, candidates and right move. */
    judgement: VerdictJudgement;
    /** The move the anchor ruled out — the one the half says is right. */
    anchorMove: string | null;
};

/** The two lists a tester's pair queue shows. */
export type PairQueue = {
    missing: MissingHalf[];
    halves: HalfToReview[];
};

/**
 * The tester's pair queue (ADR 0148, issue #4801, user stories 10, 11, 13).
 *
 * MISSING: every Conditional Verdict that no LIVE half completes. A half is
 * live when a Verdict Resolution has not rejected it and it names the anchor's
 * own Discriminant — `minimalPair.ts` refuses one that names another, so it
 * completes nothing and the anchor stays owed. A half that exists but is
 * contested is live: someone wrote it, and the contested list is where a
 * dispute is settled. An anchor a resolution rejected is owed nothing.
 *
 * HALVES: every live half whose anchor is beside it, so a tester who disagrees
 * can say so. Their answer lands at the half's position as an ordinary Contested
 * Position.
 *
 * Authors are deliberately absent: a tester sees no one else's name (ADR 0128
 * §12).
 */
export function pairQueueOf(sources: ReviewSources): PairQueue {
    const all = distinctVerdicts(sources);
    const rejected = rejectedIdsOf(sources);
    const anchorDiscriminant = (id: string): Discriminant | null => {
        const j = all.get(id);
        return j?.classification?.kind === "conditional"
            ? j.classification.discriminant
            : null;
    };
    const liveHalves = [...all.entries()].filter(([id, j]) => {
        if (j.pairOf === undefined || rejected.has(id)) return false;
        const anchor = anchorDiscriminant(j.pairOf.anchorId);
        return (
            anchor !== null &&
            !rejected.has(j.pairOf.anchorId) &&
            sameDiscriminant(anchor, j.pairOf.discriminant)
        );
    });
    const completed = new Set(liveHalves.map(([, j]) => j.pairOf!.anchorId));
    const missing = [...all.entries()]
        .filter(
            ([id, j]) =>
                j.classification?.kind === "conditional" &&
                j.pairOf === undefined &&
                !rejected.has(id) &&
                !completed.has(id)
        )
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([anchorId, judgement]) => ({
            anchorId,
            positionKey: verdictStampOf(judgement).positionKey,
            judgement,
        }));
    const halves = liveHalves
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([halfId, judgement]) => {
            const anchor = all.get(judgement.pairOf!.anchorId)!;
            const ruledOut =
                anchor.answer.kind === "forbidden"
                    ? anchor.candidates[anchor.answer.forbiddenIndexes[0]]
                    : undefined;
            return {
                halfId,
                positionKey: verdictStampOf(judgement).positionKey,
                judgement,
                anchorMove: ruledOut?.description ?? null,
            };
        });
    return { missing, halves };
}

/** What the admin's pair filter sorts by. */
export type PairFilterKind = "complete-pair" | "incomplete" | "absolute";

/** One classified verdict in the admin's pair list. Light by design — the
 *  verdict is opened by id for the board. */
export type PairListEntry = {
    verdictId: string;
    positionKey: string;
    kind: PairFilterKind;
    /** `anchor` / `half` of a Minimal Pair; absent for an Absolute Verdict. */
    role?: "anchor" | "half";
    discriminant?: Discriminant;
    /** Why a verdict is incomplete, in the standing's own words. */
    why?: string;
    answerKind: "right" | "forbidden";
    /** The candidate descriptions the answer names, in index order. */
    moves: string[];
};

/**
 * Every classified verdict, sorted into the three groups the admin filters by
 * (user story 35): complete pairs (both halves), incomplete Conditional
 * Verdicts (an anchor owed its half, a half whose anchor is not beside it, a
 * stored unclassified `forbidden`), and Absolute Verdicts.
 *
 * The standing is `minimalPairStandings`' over the verdicts PROMOTION would
 * read — attested and uncontested, or accepted by a resolution — so a pair the
 * fit would not see as complete is not listed as one. A classified verdict that
 * is not among them (contested, rejected, unattested) is listed incomplete,
 * with the reason; an Absolute Verdict stays in its own group, since that is a
 * claim about the judgement and not about the pair.
 */
export function pairListOf(sources: ReviewSources): PairListEntry[] {
    const all = distinctVerdicts(sources);
    const q = quarantineContestedPositions(
        sources.verdicts,
        sources.attestations,
        sources.resolutions
    );
    const live = new Set(q.promotable.map((v) => v.verdictId));
    const contested = new Set(
        q.contested.flatMap((c) => c.verdicts.map((v) => v.verdictId))
    );
    const rejected = rejectedIdsOf(sources);
    const standings = minimalPairStandings(
        [...all.entries()]
            .filter(([verdictId]) => live.has(verdictId))
            .map(([verdictId, judgement]) => ({
                verdictId,
                judgement,
                stored: true,
            }))
    );
    const out: PairListEntry[] = [];
    for (const [verdictId, judgement] of all) {
        const standing = standings.get(verdictId);
        const classified =
            judgement.classification !== undefined ||
            judgement.pairOf !== undefined;
        if (standing === undefined && !classified) continue;
        if (standing?.kind === "unclassified") continue;
        const indexes =
            judgement.answer.kind === "right"
                ? judgement.answer.rightIndexes
                : judgement.answer.forbiddenIndexes;
        const discriminant = discriminantOfJudgement(judgement);
        const absolute = judgement.classification?.kind === "absolute";
        const outOfFit =
            standing === undefined
                ? contested.has(verdictId)
                    ? "held out of the fit while its position is contested"
                    : rejected.has(verdictId)
                      ? "rejected by a Verdict Resolution"
                      : "not attested by a tester"
                : null;
        out.push({
            verdictId,
            positionKey: verdictStampOf(judgement).positionKey,
            kind: absolute
                ? "absolute"
                : standing?.kind === "paired"
                  ? "complete-pair"
                  : "incomplete",
            ...(standing?.kind === "paired" ? { role: standing.role } : {}),
            ...(standing?.kind === "incomplete"
                ? { why: standing.why }
                : outOfFit !== null && !absolute
                  ? { why: outOfFit }
                  : {}),
            ...(discriminant === null ? {} : { discriminant }),
            answerKind: judgement.answer.kind,
            moves: [...indexes]
                .sort((a, b) => a - b)
                .map(
                    (i) =>
                        judgement.candidates[i]?.description ?? `candidate ${i}`
                ),
        });
    }
    return out.sort((a, b) => (a.verdictId < b.verdictId ? -1 : 1));
}
