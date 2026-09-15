// What the Verdict review surface reads (issue #3582, ADR 0128 §6): the store
// and the outbox merged into one corpus, contested and resolved positions with
// who gave each answer, a single verdict opened cold, and a resolution refused
// when the position changed under it.
//
// A `.bot.test.ts` because it derives ids through
// `convex/gre/ai/verdicts/identity`.

import { describe, expect, it } from "vitest";
import {
    positionKeyOf,
    verdictIdOf,
    type VerdictJudgement,
} from "../gre/ai/verdicts/identity";
import { putAttestation, putVerdict, readStoredCorpus } from "../verdictStore";
import { createMemoryVerdictStore } from "../verdictStoreMemory";
import {
    localUserIdOf,
    openVerdictOf,
    resolutionAgainst,
    reviewSourcesOf,
    verdictReviewOf,
} from "../verdictReview";
import type { OutboxRow, VerdictDeployment } from "../verdictsOutbox";
import type { ResolutionOutboxRow } from "../verdictResolutionsOutbox";

const HERE: VerdictDeployment = { name: "local-3210", kind: "local" };

const POSITION: Omit<VerdictJudgement, "answer"> = {
    spec: { cards: [{ name: "Mountain", owner: "me" }] },
    seat: "me",
    candidates: [
        { key: '{"kind":"pass"}', description: "pass" },
        { key: '{"kind":"cast-spell"}', description: "cast Lightning Bolt" },
        { key: '{"kind":"play-land"}', description: "play Mountain" },
    ],
};
const judging = (index: number): VerdictJudgement => ({
    ...POSITION,
    answer: { kind: "right", rightIndexes: [index] },
});
const PASS = judging(0);
const BOLT = judging(1);
const LAND = judging(2);
const KEY = positionKeyOf(PASS);

/** A fat outbox row, as `submit` writes it. */
const row = (
    id: string,
    judgement: VerdictJudgement,
    userId: string
): OutboxRow => ({
    _id: id,
    ...judgement,
    author: `nick-${userId}`,
    authorId: userId,
    attestationAuthor: `${HERE.name}:${userId}`,
    deployment: HERE.name,
    deploymentKind: "local",
    createdAt: 100,
    note: `note by ${userId}`,
    verdictHash: verdictIdOf(judgement),
    positionKey: KEY,
});

const NICKNAMES: Record<string, string> = { alice: "Alice", admin: "Ada" };
const nicknameOf = (author: string) => {
    const userId = localUserIdOf(author, HERE);
    return userId === null ? undefined : NICKNAMES[userId];
};

describe("the review corpus — store and outbox merged", () => {
    it("shows a contested position from outbox rows alone, answers side by side with their authors", () => {
        const sources = reviewSourcesOf({
            stored: null,
            verdictRows: [row("v1", PASS, "alice"), row("v2", BOLT, "bob")],
            resolutionRows: [],
            here: HERE,
        });
        const review = verdictReviewOf(sources, nicknameOf, false);
        expect(review.storeRead).toBe(false);
        expect(review.positions).toHaveLength(1);
        const [position] = review.positions;
        expect(position.status).toBe("contested");
        expect(position.verdicts.map((v) => v.verdictId).sort()).toEqual(
            [verdictIdOf(PASS), verdictIdOf(BOLT)].sort()
        );
        const pass = position.verdicts.find(
            (v) => v.verdictId === verdictIdOf(PASS)
        )!;
        expect(pass.attestations).toEqual([
            {
                author: "local-3210:alice",
                nickname: "Alice",
                createdAt: 100,
                note: "note by alice",
                deploymentKind: "local",
            },
        ]);
        // bob is not an account this resolver knows: shown by author only.
        const bolt = position.verdicts.find(
            (v) => v.verdictId === verdictIdOf(BOLT)
        )!;
        expect(bolt.attestations[0].nickname).toBeUndefined();
        // The spec travels whole — the surface rebuilds the board from it.
        expect(pass.judgement.spec).toEqual(POSITION.spec);
    });

    it("collapses a judgement present in both the store and a row not yet slimmed", async () => {
        const store = createMemoryVerdictStore();
        await putVerdict(store, PASS);
        await putAttestation(store, {
            verdictId: verdictIdOf(PASS),
            author: "local-3210:alice",
            sourceAxis: "explicit",
            createdAt: 100,
        });
        const sources = reviewSourcesOf({
            stored: await readStoredCorpus(store),
            verdictRows: [row("v1", PASS, "alice"), row("v2", BOLT, "bob")],
            resolutionRows: [],
            here: HERE,
        });
        const [position] = verdictReviewOf(sources, nicknameOf, true).positions;
        expect(position.verdicts).toHaveLength(2);
        expect(
            position.verdicts.find((v) => v.verdictId === verdictIdOf(PASS))!
                .attestations
        ).toHaveLength(1);
    });

    it("shows a resolved position with the rejected answer still in it", () => {
        const resolution: ResolutionOutboxRow = {
            _id: "r1",
            positionKey: KEY,
            resolutionId: "unused-by-the-read",
            acceptedVerdictId: verdictIdOf(BOLT),
            rejected: [{ verdictId: verdictIdOf(PASS), reason: "lethal" }],
            resolverAuthor: "local-3210:admin",
            createdAt: 200,
            deployment: HERE.name,
            deploymentKind: "local",
        };
        const sources = reviewSourcesOf({
            stored: null,
            verdictRows: [row("v1", PASS, "alice"), row("v2", BOLT, "bob")],
            resolutionRows: [resolution],
            here: HERE,
        });
        const review = verdictReviewOf(sources, nicknameOf, false);
        expect(review.promotable).toBe(1);
        const [position] = review.positions;
        expect(position.status).toBe("resolved");
        expect(position.verdicts).toHaveLength(2);
        expect(position.resolution).toMatchObject({
            author: "local-3210:admin",
            nickname: "Ada",
            acceptedVerdictId: verdictIdOf(BOLT),
            rejected: [{ verdictId: verdictIdOf(PASS), reason: "lethal" }],
        });
    });

    it("opens any single verdict for cold judging, contested or not", () => {
        const sources = reviewSourcesOf({
            stored: null,
            verdictRows: [row("v3", LAND, "alice")],
            resolutionRows: [],
            here: HERE,
        });
        expect(
            openVerdictOf(sources, verdictIdOf(LAND), nicknameOf)
        ).toMatchObject({
            verdictId: verdictIdOf(LAND),
            positionKey: KEY,
            judgement: { answer: LAND.answer },
        });
        expect(
            openVerdictOf(sources, verdictIdOf(PASS), nicknameOf)
        ).toBeNull();
    });
});

describe("a resolution checked against the position it decides", () => {
    const twoAnswers = reviewSourcesOf({
        stored: null,
        verdictRows: [row("v1", PASS, "alice"), row("v2", BOLT, "bob")],
        resolutionRows: [],
        here: HERE,
    });
    const draft = {
        positionKey: KEY,
        acceptedVerdictId: verdictIdOf(BOLT),
        rejected: [{ verdictId: verdictIdOf(PASS), reason: "lethal" }],
    };

    it("is accepted when it decides over exactly the verdicts held", () => {
        expect(resolutionAgainst(twoAnswers, draft)).toBeNull();
    });

    it("is refused when a third answer arrived after the position was opened", () => {
        const threeAnswers = reviewSourcesOf({
            stored: null,
            verdictRows: [
                row("v1", PASS, "alice"),
                row("v2", BOLT, "bob"),
                row("v3", LAND, "carol"),
            ],
            resolutionRows: [],
            here: HERE,
        });
        expect(resolutionAgainst(threeAnswers, draft)).toMatch(
            /changed since it was opened/
        );
    });

    it("is refused for a position nobody contests", () => {
        const agreed = reviewSourcesOf({
            stored: null,
            verdictRows: [row("v1", PASS, "alice")],
            resolutionRows: [],
            here: HERE,
        });
        expect(resolutionAgainst(agreed, draft)).toMatch(
            /no contested position/
        );
    });
});
