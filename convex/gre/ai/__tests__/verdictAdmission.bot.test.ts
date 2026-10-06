// Admission Candidates and the Promotion streak ledger (issue #3985, PRD
// #3980, ADR 0138; CONTEXT.md § Admission).
//
// Claims:
//
//  - each of the four bars — persons (or one owner), streak, never
//    Contested, every seed — proposes at its threshold and refuses one
//    below it;
//  - a Contested position and a lone Minimal Pair half are never proposed,
//    and a complete pair is proposed as ONE unit or not at all;
//  - the proposer writes nothing: it runs over frozen inputs, and searches
//    only a unit that cleared every other bar;
//  - the ledger advances a satisfied verdict by one, restarts an unsatisfied
//    one at zero, forgets one the lock dropped, and restarts everything —
//    saying why — when it was not advanced with the committed lock.
//
// The runner half — only a promotion that writes the lock writes the ledger,
// and the store is left as it was — is in
// `scripts/__tests__/verdict-promotion-run.bot.test.ts`.
import { describe, expect, it } from "vitest";
import {
    advancePromotionStreaks,
    formatAdmissionProposal,
    parseAdmissionConfig,
    parsePromotionStreakLedger,
    proposeAdmissionCandidates,
    quarantineContestedPositions,
    serializePromotionStreakLedger,
    streaksOverLock,
    verdictIdOf,
    type AdmissionConfig,
    type AdmissionInput,
    type AdmissionSearchResult,
    type AttestedVerdict,
    type Discriminant,
    type VerdictAttestation,
    type VerdictJudgement,
    type VerdictLock,
} from "../verdicts";

const CONFIG: AdmissionConfig = {
    minPersons: 2,
    ownerPersons: ["prod-o:owner"],
    minConsecutivePromotions: 3,
    seeds: [1, 2, 3],
    iterations: 50,
};

const board = (turn: number) => ({
    spec: { cards: [], phase: "PRECOMBAT_MAIN" as const, turn },
    seat: "me" as const,
    candidates: [
        { key: '{"kind":"pass"}', description: "pass" },
        { key: '{"kind":"cast-spell"}', description: "cast Terror" },
    ],
});

/** A right-answer judgement on board `turn`; `index` picks the answer, so
 *  two judgements on one turn with different indexes contest each other. */
const right = (turn: number, index = 1): VerdictJudgement => ({
    ...board(turn),
    answer: { kind: "right", rightIndexes: [index] },
});

const END_STEP: Discriminant = { kind: "step", detail: "opponent's end step" };

const conditional = (turn: number): VerdictJudgement => ({
    ...board(turn),
    answer: { kind: "forbidden", forbiddenIndexes: [1] },
    classification: { kind: "conditional", discriminant: END_STEP },
});

const halfOf = (anchor: VerdictJudgement, turn: number): VerdictJudgement => ({
    ...right(turn),
    pairOf: { anchorId: verdictIdOf(anchor), discriminant: END_STEP },
});

/** Judgements with their explicit authors, classified by the real
 *  quarantine — the shape the engine step hands the proposer. */
function attested(
    rows: [VerdictJudgement, string[]][]
): ReturnType<typeof quarantineContestedPositions> {
    const attestations: VerdictAttestation[] = rows.flatMap(([j, authors]) =>
        authors.map((author) => ({
            verdictId: verdictIdOf(j),
            author,
            sourceAxis: "explicit" as const,
        }))
    );
    return quarantineContestedPositions(
        rows.map(([j]) => j),
        attestations
    );
}

/** Every seed agrees unless `agreedOf` says otherwise. */
function searchPort(agreedOf: (id: string) => number | string = () => 3) {
    const calls: { id: string; seeds: number[]; iterations: number }[] = [];
    const search = (
        id: string,
        budget: { iterations: number; seeds: number[] }
    ): AdmissionSearchResult => {
        calls.push({ id, ...budget });
        const agreed = agreedOf(id);
        return typeof agreed === "string"
            ? { agreed: 0, seeds: budget.seeds.length, error: agreed }
            : { agreed, seeds: budget.seeds.length };
    };
    return { search, calls };
}

function propose(
    verdicts: readonly AttestedVerdict[],
    over: Partial<AdmissionInput> = {}
) {
    const port = searchPort();
    return proposeAdmissionCandidates({
        verdicts,
        contestedPositionKeys: new Set(),
        aliases: [],
        streaks: new Map(verdicts.map((v) => [v.verdictId, 3])),
        streakReset: null,
        config: CONFIG,
        search: port.search,
        ...over,
    });
}

const proposedIds = (p: ReturnType<typeof propose>) =>
    p.candidates.map((u) => u.members.map((m) => m.verdictId));

const refusalOf = (p: ReturnType<typeof propose>, id: string) =>
    p.units.find((u) => u.members.some((m) => m.verdictId === id))!.refusal;

describe("Admission Candidates — one boundary per bar (issue #3985)", () => {
    it("persons: proposes at minPersons distinct people, refuses one below — and two aliased accounts are one person", () => {
        const two = right(1);
        const one = right(2);
        const aliased = right(3);
        const q = attested([
            [two, ["prod-a:alice", "prod-b:bob"]],
            [one, ["prod-a:alice"]],
            [aliased, ["prod-a:alice", "dev-a:alice2"]],
        ]);
        const p = propose(q.promotable, {
            aliases: [{ authors: ["prod-a:alice", "dev-a:alice2"] }],
        });
        expect(proposedIds(p)).toEqual([[verdictIdOf(two)]]);
        expect(refusalOf(p, verdictIdOf(one))).toBe("persons");
        expect(refusalOf(p, verdictIdOf(aliased))).toBe("persons");
    });

    it("owner-alone: one owner suffices — named by any aliased account — one non-owner does not", () => {
        const byOwner = right(1);
        const byOwnerDev = right(2);
        const byStranger = right(3);
        const q = attested([
            [byOwner, ["prod-o:owner"]],
            [byOwnerDev, ["dev-o:owner-dev"]],
            [byStranger, ["prod-s:stranger"]],
        ]);
        const p = propose(q.promotable, {
            aliases: [{ authors: ["dev-o:owner-dev", "prod-o:owner"] }],
        });
        expect(proposedIds(p).flat().sort()).toEqual(
            [verdictIdOf(byOwner), verdictIdOf(byOwnerDev)].sort()
        );
        expect(refusalOf(p, verdictIdOf(byStranger))).toBe("persons");
        const owned = p.candidates[0].members[0];
        expect(owned.owner).toBe(true);
    });

    it("streak: proposes at minConsecutivePromotions, refuses one below and an unread one", () => {
        const at = right(1);
        const below = right(2);
        const absent = right(3);
        const q = attested([
            [at, ["prod-o:owner"]],
            [below, ["prod-o:owner"]],
            [absent, ["prod-o:owner"]],
        ]);
        const p = propose(q.promotable, {
            streaks: new Map([
                [verdictIdOf(at), 3],
                [verdictIdOf(below), 2],
            ]),
        });
        expect(proposedIds(p)).toEqual([[verdictIdOf(at)]]);
        expect(refusalOf(p, verdictIdOf(below))).toBe("streak");
        expect(refusalOf(p, verdictIdOf(absent))).toBe("streak");
    });

    it("seeds: proposes when every seed agrees at the config's budget, refuses one seed short and an unsearchable verdict", () => {
        const all = right(1);
        const short = right(2);
        const broken = right(3);
        const q = attested([
            [all, ["prod-o:owner"]],
            [short, ["prod-o:owner"]],
            [broken, ["prod-o:owner"]],
        ]);
        const port = searchPort((id) =>
            id === verdictIdOf(short)
                ? 2
                : id === verdictIdOf(broken)
                  ? "does not rebuild"
                  : 3
        );
        const p = propose(q.promotable, { search: port.search });
        expect(proposedIds(p)).toEqual([[verdictIdOf(all)]]);
        expect(refusalOf(p, verdictIdOf(short))).toBe("seeds");
        expect(refusalOf(p, verdictIdOf(broken))).toBe("seeds");
        for (const call of port.calls) {
            expect(call).toMatchObject({
                seeds: CONFIG.seeds,
                iterations: CONFIG.iterations,
            });
        }
    });
});

describe("Admission Candidates — never Contested, never half a pair", () => {
    it("never proposes a Contested position, and never searches it", () => {
        const a = right(1, 0);
        const b = right(1, 1);
        const registryContested = right(2);
        const q = attested([
            [a, ["prod-o:owner"]],
            [b, ["prod-b:bob", "prod-c:carol"]],
            [registryContested, ["prod-o:owner"]],
        ]);
        expect(q.contested).toHaveLength(1);
        const port = searchPort();
        const p = propose(
            [...q.contested[0].verdicts, ...q.promotable] as AttestedVerdict[],
            {
                contestedPositionKeys: new Set([
                    q.contested[0].positionKey,
                    q.promotable[0].positionKey,
                ]),
                search: port.search,
            }
        );
        expect(p.candidates).toEqual([]);
        expect(p.units.map((u) => u.refusal)).toEqual([
            "contested",
            "contested",
            "contested",
        ]);
        expect(port.calls).toEqual([]);
    });

    it("never proposes a lone Minimal Pair half, nor an anchor with no half beside it", () => {
        const anchor = conditional(1);
        const half = halfOf(anchor, 2);
        const loneAnchor = conditional(3);
        const q = attested([
            [half, ["prod-o:owner"]],
            [loneAnchor, ["prod-o:owner"]],
        ]);
        const p = propose(q.promotable);
        expect(p.candidates).toEqual([]);
        expect(refusalOf(p, verdictIdOf(half))).toBe("incomplete-pair");
        expect(refusalOf(p, verdictIdOf(loneAnchor))).toBe("incomplete-pair");
    });

    it("proposes a complete pair as ONE unit — and refuses the whole unit when one half falls short", () => {
        const anchor = conditional(1);
        const half = halfOf(anchor, 2);
        const q = attested([
            [anchor, ["prod-o:owner"]],
            [half, ["prod-o:owner"]],
        ]);
        const both = propose(q.promotable);
        expect(proposedIds(both)).toEqual([
            [verdictIdOf(anchor), verdictIdOf(half)],
        ]);
        const shortHalf = propose(q.promotable, {
            streaks: new Map([
                [verdictIdOf(anchor), 3],
                [verdictIdOf(half), 2],
            ]),
        });
        expect(shortHalf.candidates).toEqual([]);
        expect(shortHalf.units).toHaveLength(1);
        expect(shortHalf.units[0].refusal).toBe("streak");
    });
});

/** Freeze `value` and everything reachable from it. */
function deepFreeze<T>(value: T): T {
    if (value !== null && typeof value === "object") {
        for (const inner of Object.values(value)) deepFreeze(inner);
        Object.freeze(value);
    }
    return value;
}

describe("Admission Candidates — the proposer writes nothing", () => {
    it("runs over frozen inputs and says 'eligible for an Admission look', never 'admit'", () => {
        const js = [right(1), right(2)];
        const ids = js.map(verdictIdOf).sort();
        // Two verdicts, handed over in DESCENDING id order: a proposer that
        // sorted, or otherwise wrote into, its input array would throw here.
        const q = deepFreeze(attested(js.map((j) => [j, ["prod-o:owner"]])));
        const verdicts = deepFreeze(
            [...q.promotable].sort((a, b) =>
                a.verdictId < b.verdictId ? 1 : -1
            )
        );
        const streaks = new Map(ids.map((id) => [id, 3]));
        const contested = new Set<string>();
        const p = proposeAdmissionCandidates(
            deepFreeze({
                verdicts,
                contestedPositionKeys: contested,
                aliases: [],
                streaks,
                streakReset: null,
                config: CONFIG,
                search: searchPort().search,
            })
        );
        expect(proposedIds(p)).toEqual(ids.map((id) => [id]));
        // Map and Set contents are not frozen by Object.freeze: read them back.
        expect([...streaks]).toEqual(ids.map((id) => [id, 3]));
        expect(contested.size).toBe(0);
        const text = formatAdmissionProposal(p);
        expect(text).toContain("eligible for an Admission look");
        expect(text).toContain("the forced-loss check is the reviewer's");
        expect(text).not.toMatch(/\badmit (it|this|these)\b/i);
    });

    it("reads its bar from the config block and refuses one that does not read", () => {
        expect(parseAdmissionConfig({ ...CONFIG })).toEqual(CONFIG);
        expect(() => parseAdmissionConfig(undefined)).toThrow(/§ admission/);
        expect(() =>
            parseAdmissionConfig({ ...CONFIG, minPersons: 0 })
        ).toThrow(/"minPersons"/);
        expect(() => parseAdmissionConfig({ ...CONFIG, seeds: [] })).toThrow(
            /"seeds"/
        );
    });
});

const ID = (n: number) => `v1-${n.toString(16).padStart(64, "0")}`;
const lock = (ids: string[], hash: string): VerdictLock => ({
    verdictIds: ids,
    packHash: hash.repeat(64),
});

describe("the Promotion streak ledger (issue #3985)", () => {
    it("advances a satisfied verdict, restarts an unsatisfied one, forgets a dropped one", () => {
        const prior = lock([ID(1), ID(2), ID(3)], "a");
        const ledger = {
            packHash: prior.packHash,
            streaks: { [ID(1)]: 2, [ID(2)]: 5, [ID(3)]: 1 },
        };
        const next = lock([ID(1), ID(2), ID(4)], "b");
        const out = advancePromotionStreaks(
            ledger,
            prior,
            next,
            new Set([ID(2)])
        );
        expect(out.reset).toBeNull();
        expect(out.ledger).toEqual({
            packHash: next.packHash,
            streaks: { [ID(1)]: 3, [ID(2)]: 0, [ID(4)]: 1 },
        });
    });

    it("restarts every streak, saying why, when it was not advanced with the committed lock", () => {
        const committed = lock([ID(1)], "a");
        const stale = { packHash: "c".repeat(64), streaks: { [ID(1)]: 9 } };
        const out = advancePromotionStreaks(
            stale,
            committed,
            lock([ID(1)], "b"),
            new Set()
        );
        expect(out.ledger.streaks).toEqual({ [ID(1)]: 1 });
        expect(out.reset).toMatch(/advanced with pack c{64}/);
        expect(streaksOverLock(null, committed).reset).toMatch(
            /every streak starts at 0/
        );
        expect(streaksOverLock(null, null).reset).toBeNull();
    });

    it("round-trips through its file, ids sorted, and refuses a file that does not read", () => {
        const ledger = {
            packHash: "d".repeat(64),
            streaks: { [ID(2)]: 1, [ID(1)]: 0 },
        };
        const text = serializePromotionStreakLedger(ledger);
        expect(text.indexOf(ID(1))).toBeLessThan(text.indexOf(ID(2)));
        expect(parsePromotionStreakLedger(text)).toEqual(ledger);
        expect(() =>
            parsePromotionStreakLedger(
                JSON.stringify({ ...ledger, streaks: { [ID(1)]: -1 } })
            )
        ).toThrow(/non-negative integer/);
        expect(() => parsePromotionStreakLedger("nope")).toThrow(
            /not valid JSON/
        );
    });
});
