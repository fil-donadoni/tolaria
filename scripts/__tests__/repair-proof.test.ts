import { describe, expect, it } from "vitest";
import {
    encodeFixDescription,
    decodeFixStatus,
} from "../lib/health-fix-attempts";
import { ladderRung, type LadderFacts } from "../lib/health-ladder";
import { lineageOf, type Verdict } from "../lib/health-verdict-store";
import {
    repairAmberDecision,
    type RepairAmberFacts,
} from "../lib/repair-proof";

const RED = "a".repeat(40);
const TIP = "b".repeat(40);
const TEST_A = "scripts/__tests__/a.test.ts";
const TEST_B = "scripts/__tests__/b.test.ts";

const v = (sha: string, status: Verdict["status"], extra = {}): Verdict => ({
    sha,
    status,
    ...extra,
});
const redLineage = (extra = {}) =>
    lineageOf([v(RED, "red", { tests: [TEST_A, TEST_B], ...extra })]);

function facts(over: Partial<RepairAmberFacts> = {}): RepairAmberFacts {
    return {
        tip: TIP,
        lineage: redLineage(),
        stored: () => null,
        descendsFrom: () => true,
        mergesRepair: () => true,
        exists: () => true,
        unprovable: () => [],
        run: (tests) => tests.map(() => 0),
        ...over,
    };
}

const noRun = () => {
    throw new Error("the proof ran");
};

// ADR 0163 §1: a Contained RED reads as a RED, or its repair never turns AMBER.
describe("repairAmberDecision under a Contained RED (issue #8074)", () => {
    it("a proved repair writes AMBER, as under any RED", () => {
        expect(
            repairAmberDecision(
                facts({ lineage: redLineage({ redClass: "contained" }) })
            ).kind
        ).toBe("amber");
    });
});

// Issue #7990: `land` was the only writer of AMBER. The hand-off leaves it to
// the push that merges the repair.
describe("repairAmberDecision — AMBER after a proved repair merges", () => {
    it("every failing test green on the merged tip → AMBER against that RED", () => {
        expect(repairAmberDecision(facts())).toEqual({
            kind: "amber",
            repairOf: RED,
            tests: [TEST_A, TEST_B],
        });
    });

    it("a share green leaves the RED to health: another culprit owns the rest (issue #7448)", () => {
        expect(repairAmberDecision(facts({ run: () => [0, 1] }))).toMatchObject(
            {
                kind: "none",
                why: expect.stringContaining(TEST_B),
            }
        );
    });

    it("skips a file the repair deleted; the rest still prove it", () => {
        const ran: string[] = [];
        expect(
            repairAmberDecision(
                facts({
                    exists: (t) => t === TEST_A,
                    run: (tests) => {
                        ran.push(...tests);
                        return tests.map(() => 0);
                    },
                })
            )
        ).toMatchObject({ kind: "amber", tests: [TEST_A] });
        expect(ran).toEqual([TEST_A]);
    });

    it.each<[string, Partial<RepairAmberFacts>, RegExp]>([
        [
            "an unreadable store",
            { lineage: { ...redLineage(), error: "503" } },
            /could not be read/,
        ],
        [
            "no RED standing",
            { lineage: lineageOf([v(RED, "green")]) },
            /no RED stands/,
        ],
        [
            "a verdict already on the tip (health's, or the early run's RED)",
            { stored: () => v(TIP, "red") },
            /already holds a verdict/,
        ],
        [
            "a push that merges no declared repair",
            { mergesRepair: () => false },
            /no declared repair/,
        ],
        [
            "a RED naming no test file",
            { lineage: lineageOf([v(RED, "red")]) },
            /no failing test file/,
        ],
        [
            "a RED newer than the tip — AMBER below it would read as a second RED",
            { descendsFrom: () => false },
            /does not descend/,
        ],
        [
            "a cut failing-file list: all named is not all failing",
            { lineage: redLineage({ testsMore: 3 }) },
            /was cut/,
        ],
        [
            "no named test left on the tip",
            { exists: () => false },
            /exists on the tip/,
        ],
        [
            "a test this runner cannot judge: unproved, not proved",
            { unprovable: (t) => [t[0]] },
            /not provable here/,
        ],
    ])("fails closed, running no test, on %s", (_name, over, why) => {
        expect(repairAmberDecision(facts({ run: noRun, ...over }))).toEqual({
            kind: "none",
            why: expect.stringMatching(why),
        });
    });

    it("the AMBER it earns clears the RED, and a later RED reads as the second", () => {
        const amber = v(TIP, "amber", { repairOf: RED });
        const red = v(RED, "red", { tests: [TEST_A] });
        expect(lineageOf([amber, red]).kind).toBe("amber");
        expect(lineageOf([v("c".repeat(40), "red"), amber, red]).kind).toBe(
            "second-red"
        );
    });
});

/**
 * The RED ladder run behind PR #7827 (the last repair `land` merged,
 * 2026-11-01), replayed through the hand-off: the fixer's verdict → its record
 * on the pivot → the rung for each state the queue moves its PR through → the
 * AMBER on the merge. No GitHub: each step is the code path a real run takes,
 * fed the facts it would read.
 */
describe("replay — a RED repair lands through the queue, end to end (issue #7990)", () => {
    const PR = 7827;
    const base: LadderFacts = {
        red: RED,
        secondRed: false,
        tip: RED,
        laddered: true,
        sinceRed: null,
        repairPrs: [],
        episode: [],
        revertPrs: [],
        fixPrs: [],
        foreignRepairs: [],
        escalated: null,
        now: Date.parse("2026-11-01T12:00:00Z"),
    };
    // What `runFixer` records for `{ outcome: "handed-off", pr }`, as the next
    // ladder run reads it back off the commit status.
    const at = new Date(base.now - 60_000).toISOString();
    const record = decodeFixStatus({
        sha: RED,
        state: "success",
        description: encodeFixDescription({
            sha: RED,
            outcome: "handed-off",
            rung: "fix",
            attempt: 1,
            machine: "macbook",
            pr: PR,
        }),
        createdAt: at,
    });
    const episode = [{ sha: RED, attempt: record, culprits: [] }];

    it("the record round-trips as a hand-off of the PR", () => {
        expect(record).toMatchObject({
            outcome: "handed-off",
            rung: "fix",
            attempt: 1,
            pr: PR,
        });
    });

    it("queued → the ladder waits; merged → it waits for health; AMBER on the push", () => {
        const pr = (state: "open" | "merged") => [
            { number: PR, state, landFailed: false },
        ];
        expect(
            ladderRung({ ...base, episode, fixPrs: pr("open") })
        ).toMatchObject({
            kind: "wait",
            why: expect.stringContaining(`#${PR}`),
        });
        expect(
            ladderRung({ ...base, episode, fixPrs: pr("merged") })
        ).toMatchObject({
            kind: "wait",
            why: expect.stringContaining("health confirms"),
        });
        expect(repairAmberDecision(facts())).toMatchObject({
            kind: "amber",
            repairOf: RED,
        });
    });

    it("refused by the queue → the next rung, not a silent wait", () => {
        expect(
            ladderRung({
                ...base,
                episode,
                fixPrs: [{ number: PR, state: "open", landFailed: true }],
            })
        ).toMatchObject({ kind: "fix", attempt: 2 });
    });
});
