// The Verdict intake door (issue #3402, PRD #3397, ADR 0124 §1): who may write
// a judgement, and what the server — not the client — decides about it.
//
// It drives the REGISTERED bindings' own `_handler`s against the shared stub
// `MutationCtx`, the same technique as `bugReportsAdminGate.test.ts`: this
// project has no convex-test harness, and driving an EXTRACTED handler
// function would prove the gate logic works while proving nothing about
// whether the deployed `mutation({ handler })` registration actually wires it
// in — the exact gap that suite documents having found for real.
//
// Two claims are load-bearing here and neither is about rules:
//
//  1. AUTHOR AND TIME ARE STAMPED, never arguments. `submit` has no `author`
//     argument to pass, so the test's job is to show the stored row carries
//     the AUTHENTICATED user's nickname and id — a verdict attributed to
//     someone who never gave it is worse than no verdict, because a fit would
//     weight it and a reviewer would trust it.
//  2. THE ROLE IS NOT THE ADMIN ROLE. A tester writes and cannot read the
//     table; an admin reads and grants. `isTesterUser` folding admins in is
//     asserted here rather than only on the predicate, because the whole point
//     of the fold is that an admin can judge without granting the flag to
//     themselves first.
import { describe, it, expect } from "vitest";
import { makeMutationCtx, runMutation, type Row } from "./gameMutationHarness";
import { submit, list } from "../verdicts";
import { listUserRoles, setTesterRole } from "../users";
import type { Id } from "../_generated/dataModel";

function user(id: string, nickname: string, flags: Row = {}): Row {
    return { _id: id, __table: "users", nickname, ...flags };
}

const PLAIN = user("u-plain", "Plain");
const TESTER = user("u-tester", "Tessa", { isTester: true });
const ADMIN = user("u-admin", "Ada", { isAdmin: true });
const EX_TESTER = user("u-ex", "Exa", { isTester: false });

const CANDIDATES = [
    { key: '{"kind":"pass"}', description: "pass" },
    { key: '{"kind":"cast-spell"}', description: "cast Lightning Bolt" },
];

const ARGS = {
    spec: { cards: [{ name: "Mountain", owner: "me" as const }] },
    seat: "me" as const,
    candidates: CANDIDATES,
    answer: { kind: "right" as const, rightIndexes: [1] },
    botPickIndex: 0,
    gameId: "game-7",
    seq: 42,
};

const ALL_USERS = [PLAIN, TESTER, ADMIN, EX_TESTER];

describe("verdicts.submit — the tester gate (issue #3402)", () => {
    it("refuses an unauthenticated caller", async () => {
        const { ctx } = makeMutationCtx(null, ALL_USERS);
        await expect(runMutation(submit, ctx, ARGS)).rejects.toThrow(
            "Forbidden: tester only"
        );
    });

    it("refuses a signed-in player who is not a tester", async () => {
        const { ctx } = makeMutationCtx("u-plain", ALL_USERS);
        await expect(runMutation(submit, ctx, ARGS)).rejects.toThrow(
            "Forbidden: tester only"
        );
    });

    it("refuses an account whose tester flag was revoked", async () => {
        const { ctx } = makeMutationCtx("u-ex", ALL_USERS);
        await expect(runMutation(submit, ctx, ARGS)).rejects.toThrow(
            "Forbidden: tester only"
        );
    });

    it("accepts a tester and stamps author, author id and time from auth", async () => {
        const { ctx, doc } = makeMutationCtx("u-tester", ALL_USERS);
        const before = Date.now();
        const id = await runMutation<typeof ARGS, Id<"verdicts">>(
            submit,
            ctx,
            ARGS
        );
        const row = doc(id as unknown as string);
        expect(row.author).toBe("Tessa");
        expect(row.authorId).toBe("u-tester");
        expect(row.createdAt as number).toBeGreaterThanOrEqual(before);
        expect(row.createdAt as number).toBeLessThanOrEqual(Date.now());
        // The judgement itself, stored verbatim.
        expect(row.candidates).toEqual(CANDIDATES);
        expect(row.answer).toEqual({ kind: "right", rightIndexes: [1] });
        expect(row.botPickIndex).toBe(0);
        expect(row.gameId).toBe("game-7");
        expect(row.seq).toBe(42);
    });

    it("accepts an admin, who is a tester without carrying the flag", async () => {
        const { ctx, doc } = makeMutationCtx("u-admin", ALL_USERS);
        const id = await runMutation<typeof ARGS, Id<"verdicts">>(
            submit,
            ctx,
            ARGS
        );
        expect(doc(id as unknown as string).author).toBe("Ada");
    });

    it("omits the optional fields rather than storing them undefined", async () => {
        const { ctx, doc } = makeMutationCtx("u-tester", ALL_USERS);
        const id = await runMutation<typeof ARGS, Id<"verdicts">>(submit, ctx, {
            ...ARGS,
            botPickIndex: undefined,
            gameId: undefined,
            seq: undefined,
        } as unknown as typeof ARGS);
        const row = doc(id as unknown as string);
        expect("botPickIndex" in row).toBe(false);
        expect("gameId" in row).toBe(false);
        expect("seq" in row).toBe(false);
    });

    it("refuses a candidate index the list does not hold", async () => {
        // Checked at the door, not at fit time: an out-of-range index is not a
        // stale verdict, it is a record that never meant anything, and the
        // exporter would happily write it into git.
        const { ctx } = makeMutationCtx("u-tester", ALL_USERS);
        await expect(
            runMutation(submit, ctx, {
                ...ARGS,
                answer: { kind: "right" as const, rightIndexes: [5] },
            })
        ).rejects.toThrow("outside the 2-candidate list");
        await expect(
            runMutation(submit, ctx, { ...ARGS, botPickIndex: 9 })
        ).rejects.toThrow("outside the 2-candidate list");
    });

    it("refuses an answer that names nothing", async () => {
        const { ctx } = makeMutationCtx("u-tester", ALL_USERS);
        await expect(
            runMutation(submit, ctx, {
                ...ARGS,
                answer: { kind: "forbidden" as const, forbiddenIndexes: [] },
            })
        ).rejects.toThrow("must name at least one candidate");
    });
});

describe("verdicts.list — admin only (issue #3402)", () => {
    it("refuses a tester who is not an admin", async () => {
        // Judging your own decision and reading everybody's judgements are
        // different trusts; the export is an admin operation.
        const { ctx } = makeMutationCtx("u-tester", ALL_USERS);
        await expect(runMutation(list, ctx, {})).rejects.toThrow(
            "Forbidden: admin only"
        );
    });

    it("returns the stored rows to an admin, projected for the export", async () => {
        const { ctx } = makeMutationCtx("u-admin", ALL_USERS);
        await runMutation(submit, ctx, ARGS);
        const rows = await runMutation<
            Record<string, never>,
            { author: string; seat: string; note?: string }[]
        >(list, ctx, {});
        expect(rows).toHaveLength(1);
        expect(rows[0].author).toBe("Ada");
        expect(rows[0].seat).toBe("me");
        expect("note" in rows[0]).toBe(false);
    });
});

describe("the tester role, granted from the admin area (issue #3402)", () => {
    it("refuses a non-admin, tester or not", async () => {
        for (const id of ["u-plain", "u-tester"]) {
            const { ctx } = makeMutationCtx(id, ALL_USERS);
            await expect(runMutation(listUserRoles, ctx, {})).rejects.toThrow(
                "Forbidden: admin only"
            );
            await expect(
                runMutation(setTesterRole, ctx, {
                    userId: "u-plain",
                    isTester: true,
                })
            ).rejects.toThrow("Forbidden: admin only");
        }
    });

    it("grants and revokes the flag", async () => {
        const { ctx, doc } = makeMutationCtx("u-admin", ALL_USERS);
        await runMutation(setTesterRole, ctx, {
            userId: "u-plain",
            isTester: true,
        });
        expect(doc("u-plain").isTester).toBe(true);
        await runMutation(setTesterRole, ctx, {
            userId: "u-plain",
            isTester: false,
        });
        expect(doc("u-plain").isTester).toBe(false);
    });

    it("reports the effective role and the flag separately", async () => {
        // An admin READS as a tester while its flag is false. A toggle bound to
        // the effective value would render on, write false, and render on
        // again — a control that looks broken because it is reporting a
        // different question than the one it answers.
        const { ctx } = makeMutationCtx("u-admin", ALL_USERS);
        const rows = await runMutation<
            Record<string, never>,
            {
                nickname: string;
                isAdmin: boolean;
                isTester: boolean;
                testerFlag: boolean;
            }[]
        >(listUserRoles, ctx, {});
        const byName = new Map(rows.map((r) => [r.nickname, r]));
        expect(byName.get("Ada")).toMatchObject({
            isAdmin: true,
            isTester: true,
            testerFlag: false,
        });
        expect(byName.get("Tessa")).toMatchObject({
            isAdmin: false,
            isTester: true,
            testerFlag: true,
        });
        expect(byName.get("Plain")).toMatchObject({
            isAdmin: false,
            isTester: false,
            testerFlag: false,
        });
        // Sorted by nickname, so the page is stable between renders.
        expect(rows.map((r) => r.nickname)).toEqual([
            "Ada",
            "Exa",
            "Plain",
            "Tessa",
        ]);
    });
});
