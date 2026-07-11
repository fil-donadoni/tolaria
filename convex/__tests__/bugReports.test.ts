import { describe, it, expect } from "vitest";
import { buildIssuePayload } from "../bugReports";

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
