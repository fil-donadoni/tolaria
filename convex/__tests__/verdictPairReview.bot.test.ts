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
import type { ScenarioSpec } from "../debugScenarioSpec";
import { verdictSideOf } from "../gre/ai/verdicts/heldOut";
import type { Discriminant, Verdict } from "../gre/ai/verdicts/types";
import {
    pairQueueOf,
    openVerdictOf,
    pairListOf,
    reviewSourcesOf,
    verdictReviewOf,
} from "../verdictReview";
import type { OutboxRow, VerdictDeployment } from "../verdictsOutbox";
import type { ResolutionOutboxRow } from "../verdictResolutionsOutbox";

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
const HALF_SPEC: ScenarioSpec = {
    cards: [{ name: "Mountain", owner: "me" }],
    phase: "ENDING",
};
const HALF_POSITION = {
    spec: HALF_SPEC,
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

/** `sourcesOf`, with an admin's decision over one position. */
const resolvedSources = (
    resolution: Pick<
        ResolutionOutboxRow,
        "positionKey" | "acceptedVerdictId" | "rejected"
    >,
    ...rows: OutboxRow[]
) =>
    reviewSourcesOf({
        stored: null,
        verdictRows: rows,
        resolutionRows: [
            {
                _id: "r1",
                resolutionId: "unused-by-the-read",
                resolverAuthor: "local-3210:admin",
                createdAt: 200,
                deployment: HERE.name,
                deploymentKind: "local",
                ...resolution,
            },
        ],
        here: HERE,
    });

describe("the missing-halves queue", () => {
    it("lists a Conditional Verdict nobody has written the half of, and nothing else", () => {
        const sources = sourcesOf(row(ANCHOR, "alice"), row(ABSOLUTE, "alice"));
        const queue = pairQueueOf(sources).missing;
        expect(queue.map((m) => m.anchorId)).toEqual([ANCHOR_ID]);
        expect(queue[0].positionKey).toBe(positionKeyOf(ANCHOR));
        expect(queue[0].judgement.classification).toEqual(
            ANCHOR.classification
        );
    });

    it("carries no author: a tester sees no one else's name", () => {
        const [entry] = pairQueueOf(sourcesOf(row(ANCHOR, "alice"))).missing;
        expect(JSON.stringify(entry)).not.toContain("alice");
    });

    it("drops the anchor once another tester writes the half, each claim attested by its own author", () => {
        const sources = sourcesOf(row(ANCHOR, "alice"), row(HALF, "bob"));
        expect(pairQueueOf(sources).missing).toEqual([]);

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
        expect(pairQueueOf(sources).missing.map((m) => m.anchorId)).toEqual([
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

describe("the admin's pair filter and the held-out split (issue #5093)", () => {
    const sideOf = (j: VerdictJudgement): "fit" | "held-out" =>
        verdictSideOf(
            { ...j, id: "probe", author: "", createdAt: "", source: "store" },
            new Set()
        );

    /** A pair on `turn`, and a second judgement of the half's board that
     *  shares no position with it (another candidate list), so the half is
     *  refused by the split, never contested. */
    function unitAt(turn: number) {
        const anchor: VerdictJudgement = {
            ...ANCHOR,
            spec: { ...ANCHOR.spec, turn },
        };
        const half: VerdictJudgement = {
            ...HALF,
            spec: { ...HALF_SPEC, turn },
            pairOf: {
                anchorId: verdictIdOf(anchor),
                discriminant: DISCRIMINANT,
            },
        };
        const prior: VerdictJudgement = {
            ...half,
            candidates: [...CANDIDATES, { key: "{}", description: "other" }],
            answer: { kind: "right", rightIndexes: [0] },
        };
        delete prior.pairOf;
        return { anchor, half, prior };
    }

    /** The first turn whose anchor board and half board hash as asked. */
    function unitOn(
        anchorSide: "fit" | "held-out",
        priorSide: "fit" | "held-out"
    ) {
        for (let turn = 1; turn < 500; turn++) {
            const u = unitAt(turn);
            if (
                sideOf(u.anchor) === anchorSide &&
                sideOf(u.prior) === priorSide
            )
                return u;
        }
        throw new Error("no turn hashes to that pair of sides in 500 turns");
    }

    const listOf = (u: ReturnType<typeof unitAt>, registry: Verdict[] = []) =>
        pairListOf(
            sourcesOf(
                row(u.anchor, "alice"),
                row(u.half, "bob"),
                row(u.prior, "carol")
            ),
            registry
        );

    it("lists a split-refused half and its anchor incomplete, naming the reason", () => {
        const u = unitOn("held-out", "fit");
        const list = listOf(u);
        const half = list.find((e) => e.verdictId === verdictIdOf(u.half))!;
        const anchor = list.find((e) => e.verdictId === verdictIdOf(u.anchor))!;
        expect(half.kind).toBe("incomplete");
        expect(half.why).toMatch(
            /already judged by .* on the fit side.*never re-sided/
        );
        expect(anchor.kind).toBe("incomplete");
    });

    it("lists the pair complete when the other judgement is on the anchor's side", () => {
        const u = unitOn("fit", "fit");
        expect(
            listOf(u)
                .filter((e) => e.role !== undefined)
                .map((e) => e.kind)
        ).toEqual(["complete-pair", "complete-pair"]);
    });

    it("reads the registry's Verdicts: an anchor on a Test Position board is fit-side", () => {
        const u = unitOn("held-out", "held-out");
        const kindsOf = (registry: Verdict[]) =>
            listOf(u, registry)
                .filter((e) => e.role !== undefined || e.kind === "incomplete")
                .map((e) => e.kind);
        expect(kindsOf([])).not.toContain("incomplete");
        const registered: Verdict = {
            ...u.anchor,
            id: "registry:anchor-board",
            author: "blade-registry",
            createdAt: "2026-09-05T00:00:00.000Z",
            source: "registry",
        };
        delete registered.classification;
        expect(kindsOf([registered])).toContain("incomplete");
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

describe("the queue reads the resolutions and the pair rule", () => {
    const DISAGREEMENT: VerdictJudgement = {
        ...HALF_POSITION,
        answer: { kind: "forbidden", forbiddenIndexes: [1] },
    };

    it("returns an anchor to the queue when its half was rejected by a resolution", () => {
        const sources = resolvedSources(
            {
                positionKey: positionKeyOf(HALF),
                acceptedVerdictId: verdictIdOf(DISAGREEMENT),
                rejected: [{ verdictId: HALF_ID, reason: "bluffing" }],
            },
            row(ANCHOR, "alice"),
            row(HALF, "bob"),
            row(DISAGREEMENT, "carol")
        );
        expect(pairQueueOf(sources).missing.map((m) => m.anchorId)).toEqual([
            ANCHOR_ID,
        ]);
        expect(pairQueueOf(sources).halves).toEqual([]);
    });

    it("owes nothing to an anchor a resolution rejected", () => {
        const reclassified: VerdictJudgement = {
            ...ANCHOR,
            classification: {
                kind: "conditional",
                discriminant: { kind: "life", detail: "opp life 3" },
            },
        };
        const sources = resolvedSources(
            {
                positionKey: positionKeyOf(ANCHOR),
                acceptedVerdictId: verdictIdOf(reclassified),
                rejected: [{ verdictId: ANCHOR_ID, reason: "wrong reason" }],
            },
            row(ANCHOR, "alice"),
            row(reclassified, "alice")
        );
        expect(pairQueueOf(sources).missing.map((m) => m.anchorId)).toEqual([
            verdictIdOf(reclassified),
        ]);
    });

    it("does not count a half that names another Discriminant than its anchor's", () => {
        const mismatched: VerdictJudgement = {
            ...HALF,
            pairOf: {
                anchorId: ANCHOR_ID,
                discriminant: { kind: "life", detail: "opp life 3" },
            },
        };
        const queue = pairQueueOf(
            sourcesOf(row(ANCHOR, "alice"), row(mismatched, "bob"))
        );
        expect(queue.missing.map((m) => m.anchorId)).toEqual([ANCHOR_ID]);
        expect(queue.halves).toEqual([]);
    });

    it("offers a written half to check, with the move its anchor ruled out", () => {
        const { halves } = pairQueueOf(
            sourcesOf(row(ANCHOR, "alice"), row(HALF, "bob"))
        );
        expect(halves).toHaveLength(1);
        expect(halves[0]).toMatchObject({
            halfId: HALF_ID,
            positionKey: positionKeyOf(HALF),
            anchorMove: "cast Lightning Bolt",
        });
        expect(JSON.stringify(halves)).not.toContain("bob");
    });

    it("does not list a contested pair as complete: Promotion would not fit it", () => {
        const sources = sourcesOf(
            row(ANCHOR, "alice"),
            row(HALF, "bob"),
            row(DISAGREEMENT, "carol")
        );
        const list = pairListOf(sources);
        const half = list.find((e) => e.verdictId === HALF_ID)!;
        const anchor = list.find((e) => e.verdictId === ANCHOR_ID)!;
        expect(half.kind).toBe("incomplete");
        expect(half.why).toContain("contested");
        expect(anchor.kind).toBe("incomplete");
    });
});
