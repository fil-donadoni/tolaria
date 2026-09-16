import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { scanCitations } from "../check-cr-citations.ts";
import {
    applyReview,
    assess,
    buildReport,
    claimAt,
    collect,
    formatReport,
    issueSources,
    mergeReview,
    parseCache,
    renderPrompt,
    replaceId,
    ruleContext,
    serializeAssessments,
    type ApplyIO,
    type AssessClient,
    type AssessRequest,
    type Assessment,
    type IssueRef,
    type Review,
    type ReviewEntry,
} from "../lib/cr-audit.ts";
import { rulesOf } from "../lib/cr-rules.ts";

/**
 * `cr:audit` (issue #3675) — collect / assess / report / apply over a fixture
 * CR document and a scripted fake model. No network, no working tree, no
 * vendored CR: a `cr:sync` cannot move these assertions.
 *
 * Fixture lines interpolate their ids AND the `CR` prefix: this file is a
 * tracked `.ts`, so a literal citation here would be read by the existence
 * scan — and the non-existent id this test proposes must not resolve anywhere.
 */

const P = "CR";
const ONCE = "614.5";
const BACK_FACE = "616.1d";
const ORDER = "616.1e";
const SECTION = "616.1";
const GHOST = ["999", "9z"].join(".");

const doc = (backFace: string) =>
    [
        "1. Game Concepts",
        "",
        "1. Game Concepts",
        "100. General",
        "100.1. These Magic rules apply to any Magic game with two or more players.",
        "614. Replacement Effects",
        `${ONCE}. A replacement effect doesn't invoke itself repeatedly; it gets only one opportunity to affect an event or any modified events that may replace it.`,
        "616. Interaction of Replacement and/or Prevention Effects",
        `${SECTION}. If two or more replacement and/or prevention effects are attempting to modify the way an event affects an object or player, the affected player or controller chooses one to apply.`,
        `${BACK_FACE} ${backFace}`,
        `${ORDER} Any of the applicable replacement and/or prevention effects may be chosen.`,
        "Glossary",
        "Credits",
    ].join("\n");

const CR_V1 = doc(
    "If any of the effects would cause a card to enter the battlefield with its back face up, one of them must be chosen."
);
/** After a `cr:sync` that rewrote 616.1d. */
const CR_V2 = doc(
    "If any of the effects would cause a permanent to enter transformed, one of them must be chosen."
);
const rulesV1 = rulesOf(CR_V1);
const rulesV2 = rulesOf(CR_V2);
const ids = new Set(rulesV1.map((r) => r.id));

const FILE = "convex/gre/replacement.ts";
const ONCE_LINE = `    // ${P} ${BACK_FACE} — a replacement effect applies once per event`;

const sources = () => [
    {
        file: FILE,
        text: [
            "export function apply() {",
            "    // Walk the pending replacements.",
            ONCE_LINE,
            "    // so a second pass never re-applies the same effect.",
            "    const applied = new Set<string>();",
            `    // ${P} ${ORDER} — the affected player picks any of them`,
            "    return applied;",
            "}",
        ].join("\n"),
    },
    {
        file: "docs/notes.md",
        text: [
            "Intro paragraph.",
            "",
            `Replacement effects follow ${P} ${SECTION}: the affected`,
            "player chooses one to apply.",
            "",
            `| rule | meaning |`,
            `| ${P} ${ONCE} | once per event |`,
        ].join("\n"),
    },
];

/** The scripted model: 616.1d once-per-event is wrong → 614.5; the rest correct. */
function scriptedModel(overrides: Record<string, string> = {}) {
    const requests: AssessRequest[] = [];
    const client: AssessClient = async (req) => {
        requests.push(req);
        return {
            model: "fake",
            verdicts: req.items.map((it) => {
                if (req.id === BACK_FACE && it.line.includes("once per event"))
                    return {
                        index: it.index,
                        verdict: "wrong" as const,
                        proposedId: overrides[req.id] ?? ONCE,
                        reason: `${ONCE}: "gets only one opportunity to affect an event"`,
                    };
                return {
                    index: it.index,
                    verdict: "correct" as const,
                    proposedId: "",
                    reason: "says it",
                };
            }),
        };
    };
    return { client, requests };
}

describe("cr:audit — collect", () => {
    it("finds exactly the citation set the existence scan finds", () => {
        const src = sources();
        const { citations, units } = collect(src, ids);
        expect(citations).toEqual(scanCitations(src, ids).citations);
        expect(citations.length).toBe(4);
        expect(units.map((u) => u.id).sort()).toEqual(
            [BACK_FACE, ORDER, SECTION, ONCE].sort()
        );
    });

    it("captures the claim on the neighbouring lines, not just the citing line", () => {
        const { units } = collect(sources(), ids);
        const once = units.find((u) => u.id === BACK_FACE);
        expect(once?.claim).toContain("Walk the pending replacements.");
        expect(once?.claim).toContain("never re-applies the same effect");
        expect(once?.claim).toContain("const applied");
        const para = units.find((u) => u.id === SECTION);
        expect(para?.claim).toContain("player chooses one to apply.");
        expect(para?.claim).not.toContain("Intro paragraph");
        const row = units.find((u) => u.id === ONCE);
        expect(row?.claim).toBe(`| ${P} ${ONCE} | once per event |`);
    });

    it("reads open issues only, bodies and comments", () => {
        const texts = issueSources([
            {
                number: 7,
                state: "OPEN",
                body: `Use ${P} ${ONCE}.`,
                comments: [
                    {
                        url: "https://github.com/o/r/issues/7#issuecomment-42",
                        body: `See ${P} ${SECTION}.`,
                    },
                ],
            },
            {
                number: 8,
                state: "CLOSED",
                body: `Old ${P} ${BACK_FACE}.`,
                comments: [],
            },
        ]);
        expect(texts.map((t) => t.file)).toEqual([
            "issue#7",
            "issue#7/comment/42",
        ]);
        expect(claimAt("issue#7", "a\n\nb c\nd\n\ne", 3)).toBe("b c\nd");
    });
});

describe("cr:audit — assess", () => {
    it("sends the rule, its parent and siblings; a scripted wrong comes back with its proposal", async () => {
        const { units } = collect(sources(), ids);
        const { client, requests } = scriptedModel();
        const cache = new Map<string, Assessment>();
        const s = await assess({
            units,
            rules: rulesV1,
            ids,
            cache,
            client,
            budget: 100,
        });
        expect(s.calls).toBe(4);
        const req = requests.find((r) => r.id === BACK_FACE) as AssessRequest;
        expect(req.context.parent).toContain(`${SECTION}.`);
        expect(req.context.siblings.map((r) => r.id)).toEqual([ORDER]);
        expect(renderPrompt(req)).toContain("back face up");
        expect(ruleContext(rulesV1, SECTION).children.map((r) => r.id)).toEqual(
            [BACK_FACE, ORDER]
        );
        const wrong = s.assessed.find((a) => a.id === BACK_FACE);
        expect(wrong?.verdict).toBe("wrong");
        expect(wrong?.proposedId).toBe(ONCE);
    });

    it("centres a long sibling list on the cited rule's position, not a string sort", () => {
        // A 70-subrule section, like the keyword-action block: "701.9" sorts
        // after "701.66" as a string, so a lexical centre sends 701.1-701.40.
        const actions = rulesOf(
            [
                "1. Game Concepts",
                "1. Game Concepts",
                "701. Keyword Actions",
                ...Array.from(
                    { length: 70 },
                    (_, i) => `701.${i + 1}. Action ${i + 1}`
                ),
                "Glossary",
            ].join("\n")
        );
        const near = ruleContext(actions, "701.66").siblings.map((r) => r.id);
        expect(near).toHaveLength(40);
        expect(near).toContain("701.65");
        expect(near).toContain("701.67");
        expect(near).toContain("701.70");
        expect(near).not.toContain("701.66");
        expect(ruleContext(actions, "701.2").siblings[0].id).toBe("701.1");
        // Every "701.1x"–"701.70" sorts before "701.9" as a string.
        const nine = ruleContext(actions, "701.9").siblings.map((r) => r.id);
        expect(nine).toContain("701.8");
        expect(nine).toContain("701.10");
    });

    it("discards a proposal that resolves to no rule", async () => {
        const { units } = collect(sources(), ids);
        const { client } = scriptedModel({ [BACK_FACE]: GHOST });
        const s = await assess({
            units,
            rules: rulesV1,
            ids,
            cache: new Map(),
            client,
            budget: 100,
        });
        const a = s.assessed.find((x) => x.id === BACK_FACE);
        expect(a?.proposedId).toBeUndefined();
        expect(a?.verdict).toBe("unclear");
        expect(a?.reason).toContain("discarded");
    });

    it("a second run over unchanged input makes zero model calls; a rewritten rule reopens exactly its citations", async () => {
        const { units } = collect(sources(), ids);
        const first = scriptedModel();
        const cache = new Map<string, Assessment>();
        await assess({
            units,
            rules: rulesV1,
            ids,
            cache,
            client: first.client,
            budget: 100,
        });
        // Round-trip the cache through its on-disk form, as a resumed run would.
        const reloaded = parseCache(serializeAssessments([...cache.values()]));

        const second = scriptedModel();
        const again = await assess({
            units,
            rules: rulesV1,
            ids,
            cache: reloaded,
            client: second.client,
            budget: 100,
        });
        expect(second.requests).toHaveLength(0);
        expect(again.cached).toBe(4);

        const third = scriptedModel();
        const synced = await assess({
            units,
            rules: rulesV2,
            ids,
            cache: reloaded,
            client: third.client,
            budget: 100,
        });
        // 616.1d's text changed: its own citation, and the section 616.1 —
        // whose printed text includes its subrules — reopen. 614.5 and
        // 616.1e do not.
        expect(third.requests.map((r) => r.id).sort()).toEqual(
            [BACK_FACE, SECTION].sort()
        );
        expect(synced.cached).toBe(2);
    });

    it("honours the budget: at most N cited ids per run, the rest deferred", async () => {
        const { units } = collect(sources(), ids);
        const { client, requests } = scriptedModel();
        const cache = new Map<string, Assessment>();
        const s = await assess({
            units,
            rules: rulesV1,
            ids,
            cache,
            client,
            budget: 1,
        });
        expect(new Set(requests.map((r) => r.id)).size).toBe(1);
        expect(s.deferredGroups).toBe(3);
        const next = await assess({
            units,
            rules: rulesV1,
            ids,
            cache,
            client,
            budget: 1,
        });
        expect(next.cached).toBe(1);
        expect(next.deferredGroups).toBe(2);
    });
});

describe("cr:audit — report and apply", () => {
    async function reviewed() {
        const src = sources();
        const { units } = collect(src, ids);
        const cache = new Map<string, Assessment>();
        await assess({
            units,
            rules: rulesV1,
            ids,
            cache,
            client: scriptedModel().client,
            budget: 100,
        });
        return { src, report: buildReport(units, rulesV1, cache) };
    }

    function fakeIO(
        files: Record<string, string>,
        issues: Record<string, { state: string; text: string }> = {},
        confirmedIssues: number[] = []
    ) {
        const written: Record<string, string> = {};
        const confirmed: string[] = [];
        const issueWrites: string[] = [];
        const logs: string[] = [];
        const key = (r: IssueRef) =>
            r.commentId === null
                ? `issue#${r.issue}`
                : `issue#${r.issue}/comment/${r.commentId}`;
        const io: ApplyIO = {
            readTree: (f) => written[f] ?? files[f],
            writeTree: (f, t) => {
                written[f] = t;
            },
            confirmTreeLine: (f, l) => {
                confirmed.push(`${f}:${l}`);
            },
            fetchIssueText: async (r) => issues[key(r)],
            writeIssueText: async (r) => {
                issueWrites.push(key(r));
            },
            issueConfirmed: (n) => confirmedIssues.includes(n),
            log: (m) => {
                logs.push(m);
            },
        };
        return { io, written, confirmed, issueWrites, logs };
    }

    it("reports wrong beside both rule texts, grouped by directory", async () => {
        const { report } = await reviewed();
        expect(report.counts).toMatchObject({
            correct: 3,
            wrong: 1,
            unclear: 0,
        });
        const md = formatReport(report, rulesV1);
        expect(md).toContain("## convex/gre");
        expect(md).toContain(`WRONG — ${P} ${BACK_FACE} → ${P} ${ONCE}`);
        expect(md).toContain("back face up");
        expect(md).toContain("only one opportunity");
        expect(md).not.toContain("## docs");
    });

    it("rewrites and confirms only reviewed entries; a model correct alone promotes nothing", async () => {
        const { src, report } = await reviewed();
        const files = Object.fromEntries(src.map((s) => [s.file, s.text]));

        // Nothing reviewed: nothing written, nothing confirmed.
        const idle = fakeIO(files);
        const none = await applyReview(
            { entries: report.entries },
            ids,
            idle.io
        );
        expect(none.unreviewed).toBe(4);
        expect(idle.written).toEqual({});
        expect(idle.confirmed).toEqual([]);

        const decide = (e: ReviewEntry): ReviewEntry =>
            e.id === BACK_FACE ? { ...e, decision: "fix" } : e;
        const live = fakeIO(files);
        const s = await applyReview(
            { entries: report.entries.map(decide) },
            ids,
            live.io
        );
        expect(s.unreviewed).toBe(3);
        expect(live.written[FILE].split("\n")[2]).toBe(
            `    // ${P} ${ONCE} — a replacement effect applies once per event`
        );
        expect(live.confirmed).toEqual([`${FILE}:3`]);
        // 616.1e's line got a model `correct` and no review: never confirmed.
        expect(live.confirmed).not.toContain(`${FILE}:6`);
    });

    it("refuses a line that changed since review, and never confirms a line carrying an unreviewed citation", async () => {
        const { report } = await reviewed();
        const fix = report.entries.find(
            (e) => e.id === BACK_FACE
        ) as ReviewEntry;
        const changed = fakeIO({ [FILE]: "x\ny\n    // edited since\n" });
        const s = await applyReview(
            { entries: [{ ...fix, decision: "fix" }] },
            ids,
            changed.io
        );
        expect(s.refused[0].why).toContain("changed since review");
        expect(changed.written).toEqual({});

        const shared = `    // ${P} ${BACK_FACE} and ${P} ${ORDER} — once per event`;
        const unit = {
            ...fix,
            line: shared.trim(),
            sites: [{ file: FILE, line: 1 }],
            decision: "fix" as const,
        };
        const mixed = fakeIO({ [FILE]: shared });
        const m = await applyReview({ entries: [unit] }, ids, mixed.io);
        expect(m.rewritten).toHaveLength(1);
        expect(mixed.confirmed).toEqual([]);
        expect(m.unconfirmed[0].why).toContain(ORDER);
    });

    it("shows an open-issue edit as a diff and writes it only after explicit confirmation; closed issues are never written", async () => {
        const body = `Implement per ${P} ${BACK_FACE} — applies once per event.`;
        const entry: ReviewEntry = {
            key: "k",
            id: BACK_FACE,
            line: body,
            sites: [{ file: "issue#12", line: 1 }],
            verdict: "wrong",
            proposedId: ONCE,
            reason: "r",
            decision: "fix",
        };
        const review: Review = { entries: [entry] };

        const unconfirmed = fakeIO(
            {},
            { "issue#12": { state: "OPEN", text: body } }
        );
        const u = await applyReview(review, ids, unconfirmed.io);
        expect(unconfirmed.logs.join("\n")).toContain(
            `+ Implement per ${P} ${ONCE}`
        );
        expect(unconfirmed.issueWrites).toEqual([]);
        expect(u.issuesAwaitingConfirmation).toEqual(["issue#12"]);

        const yes = fakeIO(
            {},
            { "issue#12": { state: "OPEN", text: body } },
            [12]
        );
        await applyReview(review, ids, yes.io);
        expect(yes.issueWrites).toEqual(["issue#12"]);

        const closed = fakeIO(
            {},
            { "issue#12": { state: "CLOSED", text: body } },
            [12]
        );
        const c = await applyReview(review, ids, closed.io);
        expect(closed.issueWrites).toEqual([]);
        expect(c.refused[0].why).toContain("closed");
    });

    it("replaces a section id without touching a subrule of it on the same line", () => {
        expect(replaceId(`// ${P} 111 / 111.10 — tokens`, "111", "701.7")).toBe(
            `// ${P} 701.7 / 111.10 — tokens`
        );
        expect(replaceId(`See ${P} 111.`, "111", "701.7")).toBe(
            `See ${P} 701.7.`
        );
        expect(replaceId(`${P} 111 and ${P} 111`, "111", "701.7")).toBeNull();
    });

    it("keeps a reviewer's decisions across a regenerated report", async () => {
        const { report } = await reviewed();
        const prior: Review = {
            entries: report.entries.map((e) =>
                e.id === BACK_FACE ? { ...e, decision: "fix" as const } : e
            ),
        };
        const merged = mergeReview(report.entries, prior);
        expect(merged.entries.find((e) => e.id === BACK_FACE)?.decision).toBe(
            "fix"
        );
        expect(merged.entries.filter((e) => e.decision === null)).toHaveLength(
            3
        );
    });
});

describe("cr:audit — never a gate", () => {
    it("is wired into no check script and imported by no guard", () => {
        const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
        const pkg = JSON.parse(
            readFileSync(join(root, "package.json"), "utf8")
        ) as {
            scripts: Record<string, string>;
        };
        const wiring = Object.entries(pkg.scripts).filter(
            ([name, cmd]) =>
                name !== "cr:audit" &&
                (cmd.includes("cr-audit") || cmd.includes("cr:audit"))
        );
        expect(wiring).toEqual([]);
        for (const guard of [
            "scripts/check-cr-citations.ts",
            "scripts/cr-ledger.ts",
        ])
            expect(readFileSync(join(root, guard), "utf8")).not.toContain(
                "cr-audit"
            );
    });
});
