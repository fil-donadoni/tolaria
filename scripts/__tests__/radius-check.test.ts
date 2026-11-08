// The blast-radius gate (issue #8937): the refusal deny-guard § 8 and
// wt:new print for an issue with no readable `Target files`.
import { describe, expect, it } from "vitest";
import { radiusRefusal } from "../lib/radius-check";

describe("radiusRefusal (issue #8937)", () => {
    it.each([
        ["a heading with list items", "## Target files\n\n- `scripts/a.ts`\n"],
        ["the bold label", "**Target files:**\n- scripts/a.ts\n"],
        ["bare path lines", "## Target files\nscripts/a.ts\nsrc/x/*.ts\n"],
    ])("accepts %s", (_name, body) => {
        expect(radiusRefusal("issue #1", body)).toBeNull();
    });

    it("refuses a body with no section", () => {
        expect(radiusRefusal("issue #1", "## Agent Brief\nfix it\n")).toMatch(
            /issue #1: unknown blast radius — it declares no readable `Target files`/
        );
    });

    it("refuses an empty section", () => {
        expect(
            radiusRefusal("issue #1", "## Target files\n\n## Band\nP1\n")
        ).toMatch(/declares no readable `Target files`/);
    });

    it("names the plain `Target files:` line, the 2026-11-08 shape", () => {
        const body =
            "Target files:\nconvex/gre/ai/choiceCandidates.ts\nsrc/lib/ai/bot-view.ts\n";
        expect(radiusRefusal("issue #8709", body)).toMatch(
            /`Target files:` line is plain text — the parser reads only a `## Target files` heading/
        );
    });
});
