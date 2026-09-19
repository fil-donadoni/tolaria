import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
    lintIssue,
    isBlocking,
    targetFilesSection,
    TARGET_FILES_FIX,
    TARGET_FILES_LABEL,
    unlinkedCardNames,
    type LintableIssue,
} from "../lib/queue-lint";
import { parseTargetFiles } from "../lib/queue-plan";

/**
 * Queue lint — well-formedness of an issue before it is worked (issue #2188).
 *
 * Two things are being asserted, and the second is the one that matters.
 *
 *   1. Each rule fires on the shape it is meant to catch.
 *   2. **A well-formed issue produces NO findings at all.** A lint that flags
 *      everything is indistinguishable from a working one when you only ever
 *      test the positive cases, and its blocking findings would empty the queue
 *      into `needs-info` on the first pass. The `clean` case below is the guard
 *      against that, and every rule is additionally pinned to its severity —
 *      promoting an advisory to blocking is a queue outage, so it must not be
 *      possible to do it silently.
 *
 * Severities were calibrated against the live queue, not chosen on principle:
 * 100 open issues produced 3 blocking findings and 129 advisory ones. Had
 * `no-acceptance-criteria` been blocking it would have taken 44 issues out of
 * the queue in one pass.
 */

const WELL_FORMED = `## What to build

A behaviour described at enough length that the body is a spec rather than the
title written twice.

## Acceptance criteria

- [ ] the behaviour works end to end
- [ ] a test covers it and has been proven to fail

## Target files

- \`scripts/lib/thing.ts\`
`;

function issue(over: Partial<LintableIssue> = {}): LintableIssue {
    return {
        number: 100,
        title: "feat: a thing",
        labels: ["enhancement", "ready-for-agent"],
        parentNumber: null,
        body: WELL_FORMED,
        ...over,
    };
}

const rules = (i: LintableIssue) => lintIssue(i).map((f) => f.rule);
const bySeverity = (i: LintableIssue, sev: string) =>
    lintIssue(i)
        .filter((f) => f.severity === sev)
        .map((f) => f.rule);

describe("queue lint — a well-formed issue is clean (issue #2188)", () => {
    it("produces no findings at all", () => {
        expect(lintIssue(issue())).toEqual([]);
        expect(isBlocking(lintIssue(issue()))).toBe(false);
    });

    it("stays clean with a parent edge present and a single model label", () => {
        expect(
            lintIssue(
                issue({
                    parentNumber: 2180,
                    labels: ["enhancement", "ready-for-agent", "model:opus"],
                    body: `## Parent\n\n#2180\n\n${WELL_FORMED}`,
                })
            )
        ).toEqual([]);
    });
});

describe("queue lint — blocking findings (issue #2188)", () => {
    it("flags a PRD carrying ready-for-agent, and says how to fix it", () => {
        const findings = lintIssue(
            issue({ labels: ["prd", "ready-for-agent"] })
        );
        expect(findings.map((f) => f.rule)).toContain(
            "prd-with-ready-for-agent"
        );
        const f = findings.find((x) => x.rule === "prd-with-ready-for-agent")!;
        expect(f.severity).toBe("blocking");
        expect(f.fix).toContain("--remove-label ready-for-agent");
    });

    it("flags a body too short to be a spec", () => {
        expect(
            bySeverity(issue({ body: "fix the thing" }), "blocking")
        ).toContain("empty-body");
    });

    it("flags CI-config work an agent cannot push", () => {
        const body = WELL_FORMED.replace(
            "`scripts/lib/thing.ts`",
            "`.github/workflows/test.yml`"
        );
        expect(bySeverity(issue({ body }), "blocking")).toContain(
            "unmergeable-ci-config"
        );
    });

    it("flags targets outside the repository", () => {
        const body = WELL_FORMED.replace(
            "`scripts/lib/thing.ts`",
            "`~/.claude/skills/foo/SKILL.md`"
        );
        expect(bySeverity(issue({ body }), "blocking")).toContain(
            "unmergeable-outside-repo"
        );
    });

    it("does NOT flag an in-repo path that merely resembles one of those", () => {
        // `.github/ISSUE_TEMPLATE` is pushable; only `workflows/**` needs the
        // extra OAuth scope. A guard that fired on all of `.github` would send
        // legitimate work to a human forever.
        const body = WELL_FORMED.replace(
            "`scripts/lib/thing.ts`",
            "`.github/ISSUE_TEMPLATE/bug.md`"
        );
        expect(bySeverity(issue({ body }), "blocking")).toEqual([]);
    });
});

describe("queue lint — advisory findings (issue #2188)", () => {
    it("notes a missing acceptance-criteria section WITHOUT blocking", () => {
        // Blocking this would have removed 44 of 100 live issues from the queue
        // in one pass. Severity here is a measured decision, so it is pinned.
        const body = WELL_FORMED.replace(
            /## Acceptance criteria[\s\S]*?\n\n## Target files/,
            "## Target files"
        );
        const findings = lintIssue(issue({ body }));
        expect(findings.map((f) => f.rule)).toContain("no-acceptance-criteria");
        expect(
            findings.find((f) => f.rule === "no-acceptance-criteria")!.severity
        ).toBe("advisory");
        expect(isBlocking(findings)).toBe(false);
    });

    it("notes a missing target-files section WITHOUT blocking, and says why it costs throughput", () => {
        const body = WELL_FORMED.replace(/## Target files[\s\S]*$/, "");
        const f = lintIssue(issue({ body })).find(
            (x) => x.rule === "no-target-files"
        )!;
        expect(f.severity).toBe("advisory");
        expect(f.message).toMatch(/SOLO/);
    });

    it("flags a body that names a parent while the sub-issue edge is missing, and emits the exact fix command", () => {
        // Invisible and permanent: the lineage sort keys off the EDGE, so the
        // slice sorts on its own number and its umbrella never converges.
        const f = lintIssue(
            issue({
                parentNumber: null,
                body: `## Parent\n\n#2180\n\n${WELL_FORMED}`,
            })
        ).find((x) => x.rule === "missing-parent-edge")!;
        expect(f.severity).toBe("advisory");
        expect(f.fix).toContain("--parent 2180");
    });

    it("does NOT flag a parent edge that IS present", () => {
        expect(
            rules(
                issue({
                    parentNumber: 2180,
                    body: `## Parent\n\n#2180\n\n${WELL_FORMED}`,
                })
            )
        ).not.toContain("missing-parent-edge");
    });

    it("flags more than one model label", () => {
        expect(
            rules(
                issue({
                    labels: ["ready-for-agent", "model:sonnet", "model:opus"],
                })
            )
        ).toContain("multiple-model-labels");
    });

    it("does NOT flag exactly one model label, or none", () => {
        expect(
            rules(issue({ labels: ["ready-for-agent", "model:opus"] }))
        ).not.toContain("multiple-model-labels");
        expect(rules(issue())).not.toContain("multiple-model-labels");
    });

    it("questions an HITL flag whose acceptance criteria are all machine-checkable", () => {
        // A wrong HITL flag stops the PR being merged, so it parks finished
        // work indefinitely — quiet, and expensive.
        expect(rules(issue({ body: `⚠️ HITL\n\n${WELL_FORMED}` }))).toContain(
            "hitl-machine-checkable"
        );
    });

    it("accepts an HITL flag when a criterion genuinely needs a person", () => {
        const body = `⚠️ HITL\n\n${WELL_FORMED.replace(
            "- [ ] the behaviour works end to end",
            "- [ ] the board looks right in the browser"
        )}`;
        expect(rules(issue({ body }))).not.toContain("hitl-machine-checkable");
    });
});

describe("queue lint — every finding is actionable (issue #2188)", () => {
    it("carries a non-empty rule, message and fix", () => {
        // A finding with no remedy is a complaint. Sweep every rule this suite
        // can provoke rather than trusting each case above to have checked it.
        const provocations: LintableIssue[] = [
            issue({ labels: ["prd", "ready-for-agent"] }),
            issue({ body: "too short" }),
            issue({
                body: WELL_FORMED.replace(
                    "`scripts/lib/thing.ts`",
                    "`.github/workflows/x.yml`"
                ),
            }),
            issue({
                body: WELL_FORMED.replace("`scripts/lib/thing.ts`", "`~/x.md`"),
            }),
            issue({ body: "## What to build\n\n" + "x".repeat(200) }),
            issue({ body: `## Parent\n\n#2180\n\n${WELL_FORMED}` }),
            issue({ labels: ["model:opus", "model:fable"] }),
            issue({ body: `⚠️ HITL\n\n${WELL_FORMED}` }),
        ];
        const seen = new Set<string>();
        for (const p of provocations) {
            for (const f of lintIssue(p)) {
                seen.add(f.rule);
                expect(f.rule).toMatch(/^[a-z][a-z-]+$/);
                expect(f.message.length).toBeGreaterThan(20);
                expect(f.fix.length).toBeGreaterThan(10);
                expect(["blocking", "advisory"]).toContain(f.severity);
            }
        }
        // Every rule the module can emit must have been exercised above; a rule
        // added later with no test would drop out of this set.
        expect([...seen].sort()).toEqual([
            "empty-body",
            "hitl-machine-checkable",
            "missing-parent-edge",
            "multiple-model-labels",
            "no-acceptance-criteria",
            "no-target-files",
            "prd-with-ready-for-agent",
            "unmergeable-ci-config",
            "unmergeable-outside-repo",
        ]);
    });
});

describe("template, lint hint and reader name the same form (issue #3535)", () => {
    /**
     * The three copies of one convention. They were allowed to drift — the
     * intake skill emitted a bold label, the fix hint named a heading, and the
     * reader matched a heading only — and the cost was silent: 77 open issues
     * declared a real file list that the planner discarded, and each one was
     * scheduled solo.
     *
     * The reader is the arbiter. Both of the other two are asserted against it,
     * so changing what is accepted in one place and not the others reds here.
     */
    const SKILL = path.join(
        __dirname,
        "..",
        "..",
        ".claude",
        "skills",
        "new-qa-issue",
        "SKILL.md"
    );

    it("the reader accepts the label the intake template emits", () => {
        const template = fs.readFileSync(SKILL, "utf8");
        const label = template
            .split("\n")
            .find((l) => /target files/i.test(l) && !/^\s*[-*]\s/.test(l));
        expect(
            label,
            "the Agent Brief template names a Target files section"
        ).toBeDefined();
        expect(TARGET_FILES_LABEL.test(label!.trim())).toBe(true);
    });

    it("the reader accepts every form the fix hint names", () => {
        const quoted = [...TARGET_FILES_FIX.matchAll(/`([^`]+)`/g)]
            .map((m) => m[1])
            .filter((form) => /target files/i.test(form));
        expect(quoted.length).toBeGreaterThan(0);
        for (const form of quoted) {
            expect(
                parseTargetFiles(`${form}\n\n- \`scripts/lib/thing.ts\``),
                `the fix hint tells an author to write ${form}`
            ).toEqual(["scripts/lib/thing.ts"]);
        }
    });

    it("the lint and the planner read the SAME section", () => {
        // One body, two callers: the lint's `.github/workflows` scan and the
        // planner's blast radius must never disagree about whether a section is
        // there.
        const bold = "**Target files:**\n\n- `scripts/lib/thing.ts`";
        expect(targetFilesSection(bold)).not.toBeNull();
        expect(parseTargetFiles(bold)).toEqual(["scripts/lib/thing.ts"]);

        const none = "## Acceptance criteria\n\n- [ ] it works";
        expect(targetFilesSection(none)).toBeNull();
        expect(parseTargetFiles(none)).toBeNull();
    });

    it("flags an unmergeable workflow path declared under the BOLD label", () => {
        // The blocking rule read the heading form only, so a bold-labelled
        // issue touching `.github/workflows/**` reached an agent that could not
        // push it.
        const body = WELL_FORMED.replace(
            /## Target files[\s\S]*$/,
            "**Target files:**\n\n- `.github/workflows/ci.yml`\n"
        );
        const f = lintIssue(issue({ body })).find(
            (x) => x.rule === "unmergeable-ci-config"
        )!;
        expect(f).toBeDefined();
        expect(f.severity).toBe("blocking");
    });

    it("does not flag a missing section when only the bold label is used", () => {
        const body = WELL_FORMED.replace(
            /## Target files[\s\S]*$/,
            "**Target files:**\n\n- `scripts/lib/thing.ts`\n"
        );
        expect(lintIssue(issue({ body })).map((x) => x.rule)).not.toContain(
            "no-target-files"
        );
    });

    it("still flags a bold label with nothing under it", () => {
        const body = WELL_FORMED.replace(
            /## Target files[\s\S]*$/,
            "**Target files:**\n"
        );
        expect(lintIssue(issue({ body })).map((x) => x.rule)).toContain(
            "no-target-files"
        );
    });
});

describe("queue lint — unlinked-card-name (issue #3666)", () => {
    // A slice of the catalogue vocabulary: two multi-word names, one that is a
    // strict substring of neither, and a single-word name the rule must skip.
    const cardNames = ["Lightning Bolt", "Serra Angel", "Shock", "Juzám Djinn"];
    const LINK =
        '[Lightning Bolt](https://scryfall.com/card/d573ef03-4730-45aa-93dd-e45ac1dbaf4a "{R} · Instant")';
    const withCards = (extra: string) =>
        lintIssue(issue({ body: `${WELL_FORMED}\n${extra}\n` }), {
            cardNames,
        });
    const unlinked = (extra: string) =>
        withCards(extra).filter((f) => f.rule === "unlinked-card-name");

    it("flags a bare multi-word card name, advisory, naming the helper", () => {
        const found = unlinked("Resolve Lightning Bolt against the face.");
        expect(found).toHaveLength(1);
        expect(found[0]!.severity).toBe("advisory");
        expect(found[0]!.message).toContain("Lightning Bolt");
        expect(found[0]!.fix).toBe(
            'bun run card:link "Lightning Bolt"   # paste the printed links in place of the bare names'
        );
    });

    it("never blocks, however many names are bare", () => {
        const findings = withCards("Lightning Bolt, Serra Angel, Juzám Djinn.");
        expect(isBlocking(findings)).toBe(false);
    });

    it("flags a name written as inline code — the form the convention replaces", () => {
        expect(unlinked("Cast `Serra Angel` first.")).toHaveLength(1);
    });

    it("stays silent on a linked name", () => {
        expect(unlinked(`Resolve ${LINK} against the face.`)).toEqual([]);
    });

    it("stays silent on a name inside a code fence", () => {
        expect(
            unlinked(
                "```\nlog: Lightning Bolt resolved\n```\n\n~~~ts\nSerra Angel\n~~~"
            )
        ).toEqual([]);
    });

    it("stays silent on the `## Cards` declaration — bare names by contract", () => {
        expect(
            unlinked(
                "## Cards\n\n- Serra Angel\n- `Lightning Bolt`\n\n## Notes\n\nnone"
            )
        ).toEqual([]);
        // …but only inside it: the next section is prose again.
        expect(
            unlinked("## Cards\n\n- Serra Angel\n\n## Notes\n\nLightning Bolt")
        ).toHaveLength(1);
    });

    it("stays silent on a single-word name", () => {
        expect(unlinked("Shock the creature.")).toEqual([]);
    });

    it("matches case-sensitively and on word boundaries only", () => {
        expect(unlinked("a lightning bolt of inspiration")).toEqual([]);
        expect(unlinked("XLightning Bolts")).toEqual([]);
        expect(unlinkedCardNames("Juzám Djinn attacks.", cardNames)).toEqual([
            "Juzám Djinn",
        ]);
    });

    it("is not run when the caller passes no vocabulary (the planner)", () => {
        expect(
            lintIssue(issue({ body: `${WELL_FORMED}\nLightning Bolt\n` }))
        ).toEqual([]);
    });
});
