// The Minimal Pair on the Verdict review surface (issue #4801, PRD #4792, ADR
// 0148): the queue of halves still owed, a half completed by someone else with
// each claim attested by its own author, a disagreeing answer on a half
// reading as a Contested Position, the admin's pair filter, and the pair shown
// beside a verdict opened cold.
//
// A `.bot.test.ts` because it derives ids through
// `convex/gre/ai/verdicts/identity`.

import { describe, expect, it } from "vitest";
import {
    positionKeyOf,
    verdictIdOf,
    type VerdictJudgement,
} from "../gre/ai/verdicts/identity";
import type { Discriminant } from "../gre/ai/verdicts/types";
import {
    missingHalvesOf,
    openVerdictOf,
    pairListOf,
    reviewSourcesOf,
    verdictReviewOf,
} from "../verdictReview";
import type { OutboxRow, VerdictDeployment } from "../verdictsOutbox";

const HERE: VerdictDeployment = { name: "local-3210", kind: "local" };
const NO_NAMES = () => undefined;

const DISCRIMINANT: Discriminant = {
    kind: "step",
    detail: "the opponent's end step",
};

const CANDIDATES = [
    { key: '{"kind":"pass"}', description: "pass" },
    { key: '{"kind":"cast-spell"}', description: "cast Lightning Bolt" },
];

/** The anchor: casting the Bolt in one's own main phase is wrong NOW. */
const ANCHOR: VerdictJudgement = {
    spec: {
        cards: [{ name: "Mountain", owner: "me" }],
        phase: "PRECOMBAT_MAIN",
    },
    seat: "me",
    candidates: CANDIDATES,
    answer: { kind: "forbidden", forbiddenIndexes: [1] },
    classification: { kind: "conditional", discriminant: DISCRIMINANT },
};
const ANCHOR_ID = verdictIdOf(ANCHOR);

/** The right-hand half: the same Bolt, at the opponent's end step. */
const HALF_POSITION = {
    spec: { cards: [{ name: "Mountain", owner: "me" }], phase: "ENDING" },
    seat: "me" as const,
    candidates: CANDIDATES,
};
const HALF: VerdictJudgement = {
    ...HALF_POSITION,
    answer: { kind: "right", rightIndexes: [1] },
    pairOf: { anchorId: ANCHOR_ID, discriminant: DISCRIMINANT },
};
const HALF_ID = verdictIdOf(HALF);

const ABSOLUTE: VerdictJudgement = {
    spec: { cards: [{ name: "Forest", owner: "me" }] },
    seat: "me",
    candidates: CANDIDATES,
    answer: { kind: "forbidden", forbiddenIndexes: [1] },
    classification: { kind: "absolute" },
};

const row = (judgement: VerdictJudgement, userId: string): OutboxRow => ({
    _id: `row-${userId}-${verdictIdOf(judgement).slice(-6)}`,
    ...judgement,
    author: `nick-${userId}`,
    authorId: userId,
    attestationAuthor: `${HERE.name}:${userId}`,
    deployment: HERE.name,
    deploymentKind: "local",
    createdAt: 100,
    verdictHash: verdictIdOf(judgement),
    positionKey: positionKeyOf(judgement),
});

const sourcesOf = (...rows: OutboxRow[]) =>
    reviewSourcesOf({
        stored: null,
        verdictRows: rows,
        resolutionRows: [],
        here: HERE,
    });

describe("the missing-halves queue", () => {
    it("lists a Conditional Verdict nobody has written the half of, and nothing else", () => {
        const sources = sourcesOf(row(ANCHOR, "alice"), row(ABSOLUTE, "alice"));
        const queue = missingHalvesOf(sources);
        expect(queue.map((m) => m.anchorId)).toEqual([ANCHOR_ID]);
        expect(queue[0].positionKey).toBe(positionKeyOf(ANCHOR));
        expect(queue[0].judgement.classification).toEqual(
            ANCHOR.classification
        );
    });

    it("carries no author: a tester sees no one else's name", () => {
        const [entry] = missingHalvesOf(sourcesOf(row(ANCHOR, "alice")));
        expect(JSON.stringify(entry)).not.toContain("alice");
    });

    it("drops the anchor once another tester writes the half, each claim attested by its own author", () => {
        const sources = sourcesOf(row(ANCHOR, "alice"), row(HALF, "bob"));
        expect(missingHalvesOf(sources)).toEqual([]);

        const anchor = openVerdictOf(sources, ANCHOR_ID, NO_NAMES)!;
        const half = openVerdictOf(sources, HALF_ID, NO_NAMES)!;
        expect(anchor.attestations.map((a) => a.author)).toEqual([
            "local-3210:alice",
        ]);
        expect(half.attestations.map((a) => a.author)).toEqual([
            "local-3210:bob",
        ]);
    });

    it("keeps an anchor in the queue when the only half names another anchor", () => {
        const stray: VerdictJudgement = {
            ...HALF,
            pairOf: {
                anchorId: "v1-" + "0".repeat(64),
                discriminant: DISCRIMINANT,
            },
        };
        const sources = sourcesOf(row(ANCHOR, "alice"), row(stray, "bob"));
        expect(missingHalvesOf(sources).map((m) => m.anchorId)).toEqual([
            ANCHOR_ID,
        ]);
    });
});

describe("a disagreeing answer on a half", () => {
    const DISAGREEMENT: VerdictJudgement = {
        ...HALF_POSITION,
        answer: { kind: "forbidden", forbiddenIndexes: [1] },
    };

    it("is an ordinary Contested Position beside the half", () => {
        const sources = sourcesOf(
            row(ANCHOR, "alice"),
            row(HALF, "bob"),
            row(DISAGREEMENT, "carol")
        );
        const review = verdictReviewOf(sources, NO_NAMES, false);
        expect(review.positions).toHaveLength(1);
        const [position] = review.positions;
        expect(position.status).toBe("contested");
        expect(position.positionKey).toBe(positionKeyOf(HALF));
        expect(position.verdicts.map((v) => v.verdictId).sort()).toEqual(
            [HALF_ID, verdictIdOf(DISAGREEMENT)].sort()
        );
    });

    it("leaves the position uncontested while nobody disagrees", () => {
        const sources = sourcesOf(row(ANCHOR, "alice"), row(HALF, "bob"));
        expect(verdictReviewOf(sources, NO_NAMES, false).positions).toEqual([]);
    });
});

describe("the admin's pair filter", () => {
    const entryOf = (sources: ReturnType<typeof sourcesOf>, id: string) =>
        pairListOf(sources).find((e) => e.verdictId === id);

    it("sorts a complete pair, an incomplete Conditional Verdict and an Absolute Verdict into their groups", () => {
        const sources = sourcesOf(
            row(ANCHOR, "alice"),
            row(HALF, "bob"),
            row(ABSOLUTE, "alice"),
            row(
                {
                    ...ANCHOR,
                    spec: { cards: [{ name: "Swamp", owner: "me" }] },
                },
                "alice"
            )
        );
        const kinds = pairListOf(sources).map((e) => e.kind);
        expect(kinds.filter((k) => k === "complete-pair")).toHaveLength(2);
        expect(kinds.filter((k) => k === "incomplete")).toHaveLength(1);
        expect(kinds.filter((k) => k === "absolute")).toHaveLength(1);
    });

    it("names the role and Discriminant of each side of a complete pair", () => {
        const sources = sourcesOf(row(ANCHOR, "alice"), row(HALF, "bob"));
        expect(entryOf(sources, ANCHOR_ID)).toMatchObject({
            kind: "complete-pair",
            role: "anchor",
            discriminant: DISCRIMINANT,
            answerKind: "forbidden",
            moves: ["cast Lightning Bolt"],
        });
        expect(entryOf(sources, HALF_ID)).toMatchObject({
            kind: "complete-pair",
            role: "half",
            discriminant: DISCRIMINANT,
            answerKind: "right",
        });
    });

    it("reads an anchor with no half as incomplete, with the standing's own reason", () => {
        const entry = entryOf(sourcesOf(row(ANCHOR, "alice")), ANCHOR_ID)!;
        expect(entry.kind).toBe("incomplete");
        expect(entry.why).toContain("no right-hand half");
    });

    it("leaves an unclassified right verdict out of every group", () => {
        const plain: VerdictJudgement = {
            ...HALF_POSITION,
            answer: { kind: "right", rightIndexes: [0] },
        };
        expect(pairListOf(sourcesOf(row(plain, "alice")))).toEqual([]);
    });
});

describe("the pair beside a verdict opened cold", () => {
    it("shows an anchor its right-hand half and the Discriminant", () => {
        const sources = sourcesOf(row(ANCHOR, "alice"), row(HALF, "bob"));
        const { pair } = openVerdictOf(sources, ANCHOR_ID, NO_NAMES)!;
        expect(pair).toMatchObject({
            role: "anchor",
            discriminant: DISCRIMINANT,
            anchor: null,
        });
        expect(pair!.halves.map((h) => h.verdictId)).toEqual([HALF_ID]);
        expect(pair!.halves[0].judgement.spec).toEqual(HALF.spec);
    });

    it("says the half is still owed when there is none", () => {
        const { pair } = openVerdictOf(
            sourcesOf(row(ANCHOR, "alice")),
            ANCHOR_ID,
            NO_NAMES
        )!;
        expect(pair).toMatchObject({ role: "anchor", halves: [] });
    });

    it("shows a half its anchor", () => {
        const sources = sourcesOf(row(ANCHOR, "alice"), row(HALF, "bob"));
        const { pair } = openVerdictOf(sources, HALF_ID, NO_NAMES)!;
        expect(pair).toMatchObject({
            role: "half",
            discriminant: DISCRIMINANT,
        });
        expect(pair!.anchor?.verdictId).toBe(ANCHOR_ID);
    });

    it("shows an Absolute Verdict no pair", () => {
        const verdict = openVerdictOf(
            sourcesOf(row(ABSOLUTE, "alice")),
            verdictIdOf(ABSOLUTE),
            NO_NAMES
        )!;
        expect(verdict.pair).toBeUndefined();
    });
});
