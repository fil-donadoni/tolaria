import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { spawnSync } from "child_process";

import {
    FindingError,
    parseFinding,
    triageOrder,
    type Finding,
} from "../lib/findings";

/**
 * The findings drawer (pre-triage handoff).
 *
 * Asserted in both directions: a validator that rejected every finding would
 * empty the drawer while looking exactly like a strict one, and an empty drawer
 * is indistinguishable from "nobody found anything".
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DIR = path.join(REPO_ROOT, "docs", "findings");

const front = (over: Record<string, string> = {}) => {
    const f = {
        title: "getLegalTargets and selectTarget disagree on face-down permanents",
        discoveredBy: "2187",
        status: "draft",
        confidence: "medium",
        ...over,
    };
    return `---\n${Object.entries(f)
        .filter(([, v]) => v !== "")
        .map(([k, v]) => `${k}: ${v}`)
        .join(
            "\n"
        )}\n---\n\n**What is wrong.** The client offers a target the server then rejects, because the filter reads a field the wire strips.\n`;
};

describe("a well-formed finding round-trips", () => {
    it("parses every field", () => {
        const f = parseFinding("2187-targets.md", front());
        expect(f.title).toMatch(/face-down permanents/);
        expect(f.discoveredBy).toBe(2187);
        expect(f.status).toBe("draft");
        expect(f.confidence).toBe("medium");
        expect(f.issue).toBeUndefined();
        expect(f.body).toMatch(/What is wrong/);
    });

    it("accepts a triaged finding that names its issue", () => {
        const f = parseFinding(
            "2187-targets.md",
            front({ status: "triaged", issue: "#2222" })
        );
        expect(f.status).toBe("triaged");
        expect(f.issue).toBe(2222);
    });

    it("accepts a declined finding with no issue", () => {
        // Declining is a real outcome — it does not need a ticket to point at.
        expect(parseFinding("x.md", front({ status: "declined" })).status).toBe(
            "declined"
        );
    });
});

describe("a malformed finding is rejected at the boundary", () => {
    const cases: Array<[string, string]> = [
        ["no frontmatter", "just a body with no delimiters at all here"],
        ["missing title", front({ title: "" })],
        ["missing discoveredBy", front({ discoveredBy: "" })],
        ["non-numeric discoveredBy", front({ discoveredBy: "soon" })],
        ["unknown status", front({ status: "pending" })],
        ["unknown confidence", front({ confidence: "vibes" })],
        [
            "an empty body nobody can triage",
            "---\ntitle: x\ndiscoveredBy: 1\nstatus: draft\nconfidence: low\n---\n\nsee above\n",
        ],
    ];
    for (const [what, source] of cases) {
        it(`rejects ${what}`, () => {
            expect(() => parseFinding("f.md", source)).toThrow(FindingError);
        });
    }

    it("rejects `triaged` with no issue — the failure this drawer prevents", () => {
        // It reads as handled, and nothing tracks it: the original problem,
        // reintroduced one level up.
        expect(() =>
            parseFinding("f.md", front({ status: "triaged" }))
        ).toThrow(/must point at the issue/);
    });
});

describe("triage order puts the decisions first", () => {
    it("sorts open drafts before anything already decided, by confidence", () => {
        const make = (
            over: Partial<Finding> & Pick<Finding, "file">
        ): Finding =>
            ({
                title: "t",
                discoveredBy: 1,
                status: "draft",
                confidence: "low",
                body: "b",
                ...over,
            }) as Finding;
        const order = triageOrder([
            make({ file: "d.md", status: "triaged", issue: 9 }),
            make({ file: "c.md", confidence: "low" }),
            make({ file: "a.md", confidence: "high" }),
            make({ file: "b.md", confidence: "medium" }),
        ]).map((f) => f.file);
        expect(order).toEqual(["a.md", "b.md", "c.md", "d.md"]);
    });
});

describe("every committed finding is valid", () => {
    it("parses the whole drawer", () => {
        // The drawer is read by a human through the CLI; a file that throws
        // there would take the listing down with it.
        const files = fs.existsSync(DIR)
            ? fs
                  .readdirSync(DIR)
                  .filter((f) => f.endsWith(".md") && f !== "README.md")
            : [];
        for (const f of files) {
            expect(() =>
                parseFinding(f, fs.readFileSync(path.join(DIR, f), "utf8"))
            ).not.toThrow();
        }
    });

    it("the CLI runs and reports an empty drawer honestly", () => {
        const r = spawnSync(
            "bun",
            [path.join(REPO_ROOT, "scripts", "findings.ts")],
            {
                cwd: REPO_ROOT,
                encoding: "utf8",
            }
        );
        expect(r.status, r.stderr).toBe(0);
        expect(r.stdout).toMatch(/finding|No findings|No open drafts/i);
    });
});
