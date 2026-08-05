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
            email: "ada@example.com",
            description: "Board freezes on attack\nmore detail below",
        });
        expect(title).toBe("[Bug] Board freezes on attack");
    });

    it("truncates a long first line to 120 chars in the title", () => {
        const line = "x".repeat(200);
        const { title } = buildIssuePayload({
            name: "",
            email: "",
            description: line,
        });
        expect(title).toBe(`[Bug] ${"x".repeat(120)}`);
    });

    it("falls back to a generic title when the first line is empty", () => {
        const { title } = buildIssuePayload({
            name: "Ada",
            email: "ada@example.com",
            description: "   \nactual text",
        });
        // Leading whitespace is trimmed, so the description starts at "actual
        // text" and that seeds the title.
        expect(title).toBe("[Bug] actual text");
    });

    it("puts the reporter, route and user agent in the body footer", () => {
        const { body } = buildIssuePayload({
            name: "Ada",
            email: "ada@example.com",
            description: "It broke",
            route: "/game",
            userAgent: "Mozilla/5.0",
        });
        expect(body).toContain("It broke");
        expect(body).toContain("**Reporter:** Ada (ada@example.com)");
        expect(body).toContain("**Route:** `/game`");
        expect(body).toContain("**User agent:** Mozilla/5.0");
    });

    it("defaults name/email to Anonymous/n/a when blank", () => {
        const { body } = buildIssuePayload({
            name: "   ",
            email: "",
            description: "hi",
        });
        expect(body).toContain("**Reporter:** Anonymous (n/a)");
    });

    it("embeds an attachment link only when a URL is provided", () => {
        const withFile = buildIssuePayload({
            name: "Ada",
            email: "a@b.c",
            description: "see screenshot",
            attachmentUrl: "https://files.convex.dev/abc",
            attachmentName: "screen.png",
        });
        expect(withFile.body).toContain(
            "**Attachment:** [screen.png](https://files.convex.dev/abc)"
        );

        const noFile = buildIssuePayload({
            name: "Ada",
            email: "a@b.c",
            description: "no file",
        });
        expect(noFile.body).not.toContain("**Attachment:**");
    });

    it("labels the attachment 'attachment' when no name is given", () => {
        const { body } = buildIssuePayload({
            name: "Ada",
            email: "a@b.c",
            description: "x",
            attachmentUrl: "https://files.convex.dev/abc",
        });
        expect(body).toContain(
            "**Attachment:** [attachment](https://files.convex.dev/abc)"
        );
    });

    it("rejects an empty description", () => {
        expect(() =>
            buildIssuePayload({
                name: "Ada",
                email: "a@b.c",
                description: "  ",
            })
        ).toThrow("Description is required");
    });

    it("rejects an oversized description", () => {
        expect(() =>
            buildIssuePayload({
                name: "Ada",
                email: "a@b.c",
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

    it("embeds the state as parseable JSON in a collapsed block", () => {
        const state = makeSnapshotState();
        const section = buildGameStateSection({
            gameId: "g",
            seq: 1,
            state,
        });
        expect(section).toContain(
            "<details><summary>Game state (JSON)</summary>"
        );
        const json = section.split("```json\n")[1]!.split("\n```")[0]!;
        expect(JSON.parse(json)).toEqual(state);
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

    // GitHub rejects a body over 65536 chars, and a rejected POST loses the
    // report itself. Dropping the JSON whole (never truncating it, which would
    // read as complete but parse as garbage) keeps the header and the report.
    it("drops an oversized state instead of truncating it", () => {
        const section = buildGameStateSection({
            gameId: "g",
            seq: 1,
            state: makeSnapshotState({ bloat: "x".repeat(60000) }),
        });
        expect(section).toContain("Game state omitted");
        expect(section).not.toContain("```json");
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
            email: "a@b.c",
            description: "bot hangs",
            gameSection: "**Game:** `g` · seq 3",
        });
        expect(body).toContain("**Game:** `g` · seq 3");
    });

    it("omits it entirely for a report filed outside a game", () => {
        const { body } = buildIssuePayload({
            name: "Ada",
            email: "a@b.c",
            description: "lobby is broken",
        });
        expect(body).not.toContain("**Game:**");
    });
});
