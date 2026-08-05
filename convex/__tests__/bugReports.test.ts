import { describe, it, expect } from "vitest";
import {
    buildGameStateSection,
    buildIssuePayload,
    describeOwedInput,
    isGameParticipant,
} from "../bugReports";

// Pure payload builder for the in-app bug-report button. The action wrapping it
// only adds network/auth/storage — the title/body shaping and validation live
// here, so this is where they are exercised (the project has no convex-test
// harness).

describe("buildIssuePayload (bug-report button)", () => {
    it("derives the title from the first line of the description", () => {
        const { title } = buildIssuePayload({
            name: "Ada",
            description: "Board freezes on attack\nmore detail below",
        });
        expect(title).toBe("[Bug] Board freezes on attack");
    });

    it("truncates a long first line to 120 chars in the title", () => {
        const line = "x".repeat(200);
        const { title } = buildIssuePayload({
            name: "",
            description: line,
        });
        expect(title).toBe(`[Bug] ${"x".repeat(120)}`);
    });

    it("falls back to a generic title when the first line is empty", () => {
        const { title } = buildIssuePayload({
            name: "Ada",
            description: "   \nactual text",
        });
        // Leading whitespace is trimmed, so the description starts at "actual
        // text" and that seeds the title.
        expect(title).toBe("[Bug] actual text");
    });

    it("puts the reporter, route and user agent in the body footer", () => {
        const { body } = buildIssuePayload({
            name: "Ada",
            description: "It broke",
            route: "/game",
            userAgent: "Mozilla/5.0",
        });
        expect(body).toContain("It broke");
        expect(body).toContain("**Reporter:** Ada");
        expect(body).toContain("**Route:** `/game`");
        expect(body).toContain("**User agent:** Mozilla/5.0");
    });

    it("defaults the name to Anonymous when blank", () => {
        const { body } = buildIssuePayload({
            name: "   ",
            description: "hi",
        });
        expect(body).toContain("**Reporter:** Anonymous");
    });

    it("names an attachment without linking to it", () => {
        const withFile = buildIssuePayload({
            name: "Ada",
            description: "see screenshot",
            attachmentName: "screen.png",
        });
        expect(withFile.body).toContain("**Attachment:** `screen.png`");
        // A screenshot of a board shows a hand — the file stays on the report
        // row, so the body names it and links nothing.
        expect(withFile.body).not.toContain("http");

        const noFile = buildIssuePayload({
            name: "Ada",
            description: "no file",
        });
        expect(noFile.body).not.toContain("**Attachment:**");
    });

    it("prints the report id and how to read it", () => {
        const { body } = buildIssuePayload({
            name: "Ada",
            description: "x",
            reportId: "k57xyz",
        });
        expect(body).toContain("**Report:** `k57xyz`");
        expect(body).toContain(
            `bunx convex run bugReports:getReport '{"reportId":"k57xyz"}' --prod`
        );
    });

    it("rejects an empty description", () => {
        expect(() =>
            buildIssuePayload({
                name: "Ada",
                description: "  ",
            })
        ).toThrow("Description is required");
    });

    it("rejects an oversized description", () => {
        expect(() =>
            buildIssuePayload({
                name: "Ada",
                description: "x".repeat(8001),
            })
        ).toThrow(/too long/);
    });
});

// --- Game-state attachment (issue #1728) -----------------------------------
//
// A report filed from a game carries that game's state. #1728 was filed as
// "Oppo continua a pensare e non si sblocca" and nothing else — no card, no
// phase, no game id — and could only be closed as a probable duplicate. The
// header these tests pin (turn / phase / priority / owed input) is exactly what
// would have identified it; the JSON is there so a later reader can go deeper
// without asking the reporter to remember a game from a week ago.

function makeSnapshotState(
    overrides: Record<string, unknown> = {}
): Record<string, unknown> {
    return {
        turn: 6,
        phase: "PRECOMBAT_MAIN",
        activePlayerId: "p1",
        priorityPlayerId: "p2",
        players: [{ id: "p1" }, { id: "p2" }],
        ...overrides,
    };
}

describe("describeOwedInput (bug-report game snapshot)", () => {
    it("names a pending container that is holding the game up", () => {
        expect(
            describeOwedInput(
                makeSnapshotState({ pendingActivation: { abilityId: "x" } })
            )
        ).toEqual(["pendingActivation"]);
    });

    it("reports the length of a pending array rather than just its name", () => {
        expect(
            describeOwedInput(
                makeSnapshotState({
                    pendingChoices: [{ kind: "a" }, { kind: "b" }],
                })
            )
        ).toEqual(["pendingChoices[2]"]);
    });

    it("omits absent and empty pending containers", () => {
        expect(
            describeOwedInput(
                makeSnapshotState({
                    pendingCast: undefined,
                    pendingChoices: [],
                })
            )
        ).toEqual([]);
    });

    // The census is over the state's own keys, so a `pending*` container added
    // to GameState later is reported without touching this module. A
    // hand-maintained list is how #1209's park family grew uncovered.
    it("picks up a pending container this module has never heard of", () => {
        expect(
            describeOwedInput(
                makeSnapshotState({ pendingSomethingNew: { a: 1 } })
            )
        ).toEqual(["pendingSomethingNew"]);
    });

    it("ignores non-pending keys", () => {
        expect(describeOwedInput(makeSnapshotState())).toEqual([]);
    });
});

describe("buildGameStateSection (bug-report game snapshot)", () => {
    it("puts the triage facts in the header", () => {
        const section = buildGameStateSection({
            gameId: "game123",
            seq: 47,
            state: makeSnapshotState(),
        });
        expect(section).toContain("`game123`");
        expect(section).toContain("seq 47");
        expect(section).toContain("turn 6");
        expect(section).toContain("PRECOMBAT_MAIN");
        expect(section).toContain("active: p1");
        expect(section).toContain("priority: p2");
    });

    // The tracker repo is PUBLIC and a game is often still in progress when the
    // report is filed, so the section is a summary of the position and never
    // the position itself. The state lives on the `bugReports` row.
    it("never emits the state itself, only facts about it", () => {
        const section = buildGameStateSection({
            gameId: "g",
            seq: 1,
            state: makeSnapshotState({
                players: [
                    { id: "p1", hand: ["Black Lotus"], library: ["Ancestral"] },
                    { id: "p2", hand: ["Mox Jet"], library: ["Time Walk"] },
                ],
            }),
        });
        expect(section).not.toContain("Black Lotus");
        expect(section).not.toContain("Ancestral");
        expect(section).not.toContain("hand");
        expect(section).not.toContain("library");
        expect(section).not.toContain("```");
    });

    it("names the owed input in the header when the game is parked", () => {
        const section = buildGameStateSection({
            gameId: "g",
            seq: 1,
            state: makeSnapshotState({
                pendingActivation: { abilityId: "sac" },
            }),
        });
        expect(section).toContain("**Owed input:** pendingActivation");
    });

    it("omits the owed-input line when nothing is pending", () => {
        const section = buildGameStateSection({
            gameId: "g",
            seq: 1,
            state: makeSnapshotState(),
        });
        expect(section).not.toContain("**Owed input:**");
    });

    // The section is bounded by construction (a fixed set of facts), so a huge
    // state cannot push the issue body past GitHub's 65536-char limit and lose
    // the report — the size cap the JSON-in-body version needed is gone with it.
    it("stays small regardless of how large the state is", () => {
        const section = buildGameStateSection({
            gameId: "g",
            seq: 1,
            state: makeSnapshotState({ bloat: "x".repeat(200000) }),
        });
        expect(section.length).toBeLessThan(500);
        expect(section).toContain("turn 6");
    });
});

describe("isGameParticipant (bug-report game snapshot)", () => {
    it("accepts a seat whose id equals the user id (2-player game)", () => {
        expect(
            isGameParticipant([{ id: "userA" }, { id: "userB" }], "userA")
        ).toBe(true);
    });

    // A solo game seats one user twice as `${userId}-p1` / `${userId}-p2`, so an
    // equality-only check would attach nothing to every solo report.
    it("accepts the derived seats of a solo game", () => {
        expect(
            isGameParticipant([{ id: "userA-p1" }, { id: "userA-p2" }], "userA")
        ).toBe(true);
    });

    it("rejects a user who is not seated in the game", () => {
        expect(
            isGameParticipant([{ id: "userA" }, { id: "userB" }], "userC")
        ).toBe(false);
    });

    // The issue is filed on a PUBLIC repo: a prefix match that ignored the
    // separator would let `userA` read `userAB`'s hidden zones by filing a
    // report against their game id.
    it("rejects a user id that is a bare prefix of a seat id", () => {
        expect(isGameParticipant([{ id: "userAB" }], "userA")).toBe(false);
    });
});

describe("buildIssuePayload — game section", () => {
    it("includes the game section when one is supplied", () => {
        const { body } = buildIssuePayload({
            name: "Ada",
            description: "bot hangs",
            gameSection: "**Game:** `g` · seq 3",
        });
        expect(body).toContain("**Game:** `g` · seq 3");
    });

    it("omits it entirely for a report filed outside a game", () => {
        const { body } = buildIssuePayload({
            name: "Ada",
            description: "lobby is broken",
        });
        expect(body).not.toContain("**Game:**");
    });
});

// The public/private line is enforced by the builder's SIGNATURE, not by a
// reviewer remembering it: `IssueInput` has no email, no attachment URL and no
// state field, so there is nothing for a template edit to leak. This block
// pins the property from the caller's side — if any of those ever come back as
// a field, one of these goes red.
describe("buildIssuePayload — public-repo boundary", () => {
    it("carries no reporter email", () => {
        const { body } = buildIssuePayload({
            name: "Gaulun",
            description: "Oppo continua a pensare e non si sblocca",
            route: "/game",
            attachmentName: "board.png",
            gameSection: "**Game:** `g` · seq 3",
            reportId: "k57xyz",
        });
        expect(body).not.toContain("@");
    });

    it("carries no link to the attachment blob", () => {
        const { body } = buildIssuePayload({
            name: "Gaulun",
            description: "screenshot attached",
            attachmentName: "board.png",
            reportId: "k57xyz",
        });
        expect(body).toContain("board.png");
        expect(body).not.toContain("http");
    });

    it("is bounded in size — a report can never be lost to GitHub's body limit", () => {
        const { body } = buildIssuePayload({
            name: "Gaulun",
            description: "x".repeat(8000),
            userAgent: "Mozilla/5.0",
            gameSection: buildGameStateSection({
                gameId: "g",
                seq: 1,
                state: makeSnapshotState({ bloat: "x".repeat(200000) }),
            }),
            reportId: "k57xyz",
        });
        expect(body.length).toBeLessThan(65536);
    });
});
