// Contested positions and the quarantine before the Verdict Lock
// (issue #3579, PRD #3574, ADR 0128 §6 / §11).
//
// Every claim is a property of the classification a promotion reads, never
// the shape of a helper: agreement collapses to one promotable verdict,
// disagreement quarantines the whole position and nothing else, only explicit
// judgements take part, and the metric names what it counts.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
    formatVerdictQuarantine,
    positionKeyOf,
    quarantineContestedPositions,
    verdictIdOf,
    type Verdict,
    type VerdictAttestation,
    type VerdictSourceAxis,
} from "../verdicts";

const BASE: Verdict = {
    id: "in-play:k17abc",
    spec: {
        cards: [],
        phase: "PRECOMBAT_MAIN",
        turn: 3,
        life: { me: 20, opp: 7 },
    },
    seat: "me",
    candidates: [
        { key: '{"kind":"pass"}', description: "pass" },
        { key: '{"kind":"play-land"}', description: "play Mountain" },
        { key: '{"kind":"cast-spell"}', description: "cast Shock" },
    ],
    answer: { kind: "right", rightIndexes: [2] },
    author: "prod:alice",
    createdAt: "2026-09-15T10:00:00.000Z",
    source: "in-play",
};

const answering = (rightIndexes: number[], extra: Partial<Verdict> = {}) =>
    ({ ...BASE, ...extra, answer: { kind: "right", rightIndexes } }) as Verdict;

/** A different decision: same board, a turn later. */
const OTHER_POSITION: Verdict = {
    ...BASE,
    spec: { ...BASE.spec, turn: 4 },
};

const attest = (
    verdict: Verdict,
    author: string,
    sourceAxis: VerdictSourceAxis = "explicit"
): VerdictAttestation => ({
    verdictId: verdictIdOf(verdict),
    author,
    sourceAxis,
});

const ids = (list: { verdictId: string }[]) => list.map((v) => v.verdictId);

describe("agreement — same position key, same answer (ADR 0128 §4)", () => {
    it("is one promotable verdict carrying every attestation", () => {
        // The same judgement recorded twice, on two deployments: provenance
        // and the describer's wording differ, the judgement does not.
        const onProd = answering([2]);
        const onDev = answering([2], {
            id: "in-play:other",
            author: "dev:bob",
            createdAt: "2026-09-16T08:00:00.000Z",
            note: "lethal",
            candidates: BASE.candidates.map((c) => ({
                ...c,
                description: `${c.description}!`,
            })),
        });
        const q = quarantineContestedPositions(
            [onProd, onDev],
            [attest(onProd, "prod:alice"), attest(onDev, "dev:bob")]
        );

        expect(q.contested).toEqual([]);
        expect(ids(q.promotable)).toEqual([verdictIdOf(onProd)]);
        expect(q.promotable[0].attestations.map((a) => a.author)).toEqual([
            "dev:bob",
            "prod:alice",
        ]);
    });

    it("equates what canonicalisation equates — an index set in any order", () => {
        const a = answering([1, 2]);
        const b = answering([2, 1, 2]);
        const q = quarantineContestedPositions(
            [a, b],
            [attest(a, "prod:alice"), attest(b, "prod:carol")]
        );
        expect(q.contested).toEqual([]);
        expect(q.promotable).toHaveLength(1);
    });
});

describe("contradiction — same position key, different answers (ADR 0128 §6)", () => {
    it("quarantines every member and leaves other positions promotable", () => {
        const shock = answering([2]);
        const land = answering([1]);
        const elsewhere = OTHER_POSITION;
        const q = quarantineContestedPositions(
            [shock, land, elsewhere],
            [
                attest(shock, "prod:alice"),
                attest(land, "prod:bob"),
                attest(elsewhere, "prod:bob"),
            ]
        );

        expect(q.contested).toHaveLength(1);
        expect(q.contested[0].positionKey).toBe(positionKeyOf(BASE));
        expect(ids(q.contested[0].verdicts).sort()).toEqual(
            [verdictIdOf(shock), verdictIdOf(land)].sort()
        );
        // None of the contested ids is promotable; the unrelated one is.
        expect(ids(q.promotable)).toEqual([verdictIdOf(elsewhere)]);
    });

    it("takes 'different' literally: a compatible-looking answer is still contested", () => {
        const narrow = answering([2]);
        const wide = answering([1, 2]);
        const q = quarantineContestedPositions(
            [narrow, wide],
            [attest(narrow, "prod:alice"), attest(wide, "prod:bob")]
        );
        expect(q.contested).toHaveLength(1);
        expect(q.promotable).toEqual([]);
    });
});

describe("the source axis — quarantine is confined to explicit judgements (ADR 0128 §11)", () => {
    it("an implicit judgement neither contests an explicit one nor is promoted", () => {
        const given = answering([2]);
        const chosen = answering([1]);
        const q = quarantineContestedPositions(
            [given, chosen],
            [
                attest(given, "prod:alice"),
                attest(chosen, "prod:bob", "implicit"),
            ]
        );
        expect(q.contested).toEqual([]);
        expect(ids(q.promotable)).toEqual([verdictIdOf(given)]);
        expect(ids(q.implicitOnly)).toEqual([verdictIdOf(chosen)]);
    });

    it("two implicit judgements that differ are not quarantined", () => {
        const a = answering([2]);
        const b = answering([1]);
        const q = quarantineContestedPositions(
            [a, b],
            [
                attest(a, "prod:alice", "implicit"),
                attest(b, "prod:bob", "implicit"),
            ]
        );
        expect(q.contested).toEqual([]);
        expect(q.promotable).toEqual([]);
        expect(q.implicitOnly).toHaveLength(2);
    });

    it("one explicit attestation makes a verdict explicit", () => {
        const a = answering([2]);
        const b = answering([1]);
        const q = quarantineContestedPositions(
            [a, b],
            [
                attest(a, "prod:alice"),
                attest(b, "prod:bob", "implicit"),
                attest(b, "prod:carol"),
            ]
        );
        expect(q.contested).toHaveLength(1);
        expect(q.implicitOnly).toEqual([]);
    });
});

describe("attestations the quarantine cannot place", () => {
    it("never promotes a verdict nobody attested (ADR 0128 §4)", () => {
        const q = quarantineContestedPositions([BASE], []);
        expect(q.promotable).toEqual([]);
        expect(ids(q.unattested)).toEqual([verdictIdOf(BASE)]);
    });

    it("throws, naming it, on an attestation for a verdict not supplied", () => {
        expect(() =>
            quarantineContestedPositions([], [attest(BASE, "prod:alice")])
        ).toThrow(`${verdictIdOf(BASE)}: attested by prod:alice`);
    });
});

describe("the contested-position metric — per corpus and per author", () => {
    const shock = answering([2]);
    const land = answering([1]);
    const q = quarantineContestedPositions(
        [shock, land, OTHER_POSITION],
        [
            attest(shock, "prod:alice"),
            attest(land, "prod:bob"),
            attest(OTHER_POSITION, "prod:alice"),
            attest(OTHER_POSITION, "prod:carol"),
            attest(OTHER_POSITION, "prod:dave", "implicit"),
        ]
    );
    const key = positionKeyOf(BASE);

    it("names and counts contested positions per author, zeroes included", () => {
        // carol judged only an agreed position: a row with nothing contested.
        // dave only attested implicitly: no row at all.
        expect(q.byAuthor).toEqual([
            {
                author: "prod:alice",
                judgedPositions: 2,
                contestedPositionKeys: [key],
            },
            {
                author: "prod:bob",
                judgedPositions: 1,
                contestedPositionKeys: [key],
            },
            {
                author: "prod:carol",
                judgedPositions: 1,
                contestedPositionKeys: [],
            },
        ]);
    });

    it("prints the corpus count, the contested keys and each author's row", () => {
        const text = formatVerdictQuarantine(q);
        expect(text).toContain(
            "contested positions    : 1 of 2 explicitly judged"
        );
        expect(text).toContain("quarantined verdicts   : 2");
        expect(text).toContain(`  contested ${key}`);
        expect(text).toContain("  prod:alice: 1 contested of 2 judged");
        expect(text).toContain("  prod:bob: 1 contested of 1 judged");
    });
});

describe("purity", () => {
    it("is a function of the content — input order and repetition change nothing", () => {
        const shock = answering([2]);
        const land = answering([1]);
        const verdicts = [shock, land, OTHER_POSITION];
        const attestations = [
            attest(shock, "prod:alice"),
            attest(land, "prod:bob"),
            attest(OTHER_POSITION, "prod:carol"),
        ];
        const forward = quarantineContestedPositions(verdicts, attestations);
        const reversed = quarantineContestedPositions(
            [...verdicts].reverse(),
            [...attestations, ...attestations].reverse()
        );
        expect(reversed).toEqual(forward);
    });

    it("keeps the same record of a repeated judgement whatever the input order", () => {
        const plain = answering([2]);
        const reworded = answering([2], {
            candidates: BASE.candidates.map((c) => ({
                ...c,
                description: `${c.description} (reworded)`,
            })),
        });
        const attestations = [attest(plain, "prod:alice")];
        const forward = quarantineContestedPositions(
            [plain, reworded],
            attestations
        );
        const reversed = quarantineContestedPositions(
            [reworded, plain],
            attestations
        );
        expect(forward.promotable).toHaveLength(1);
        expect(reversed).toEqual(forward);
    });

    it("reads no store and no clock", () => {
        const source = readFileSync(
            join(__dirname, "../verdicts/quarantine.ts"),
            "utf8"
        );
        const imports = [...source.matchAll(/from "([^"]+)"/g)].map(
            (m) => m[1]
        );
        expect(imports.sort()).toEqual(["./identity", "./types"]);
        expect(source).not.toMatch(/\bDate\b|Math\.random|performance\./);
    });
});
