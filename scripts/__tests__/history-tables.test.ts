import { describe, it, expect, beforeEach } from "vitest";
import { Window } from "happy-dom";

// @ts-expect-error — browser ES modules with no type declarations; the
// dashboard is deliberately plain JS with no build step (#2625), same as
// `dashboard-glossary.test.ts`'s imports of sibling dashboard/*.js files.
import { lookupTerm } from "../dashboard/glossary.js";
// @ts-expect-error — same.
import {
    setIssueRows,
    renderIssueFilters,
    renderIssuesTable,
} from "../dashboard/history-issues-table.js";
// @ts-expect-error — same.
import {
    setSessionRows,
    renderSessionFilters,
    renderSessionsTable,
} from "../dashboard/history-sessions-table.js";
// @ts-expect-error — same.
import { renderFamiliesTable } from "../dashboard/history-families-table.js";

/**
 * #2634 — Issues/Sessions/Family×role headers read as human phrases with
 * glossary tooltips, numbers never print a raw float, and empty slices read
 * as sentences. The load-bearing risk the ticket itself calls out: renaming
 * a header must not silently change what a click sorts BY — every sort test
 * below uses values (9 vs 100) where a STRING comparison and a NUMERIC
 * comparison disagree, so a regression that started sorting on rendered text
 * (or dropped a column's `num: true`) would flip the observed order rather
 * than merely reading oddly.
 */

const g = globalThis as any;

function mountPage(bodyHtml: string) {
    const win = new Window({ url: "http://localhost/" });
    win.document.body.innerHTML = bodyHtml;
    g.document = win.document;
    return win;
}

/** happy-dom's `dispatchEvent` requires an Event constructed by the SAME
 *  window realm — the global `Event` class is a different realm and is
 *  rejected. */
function fireInput(win: Window, el: HTMLInputElement, value: string) {
    el.value = value;
    el.dispatchEvent(new win.Event("input", { bubbles: true }));
}

/** Every element matching `selector` must carry a `data-term` that resolves
 *  in the glossary — these History-only column names are outside the
 *  server-vocabulary completeness guard in `dashboard-glossary.test.ts`, so
 *  nothing else in the suite would catch a typo'd or missing term. */
function assertAllTermsResolve(selector: string) {
    const unresolved: (string | null)[] = [];
    document.querySelectorAll(selector).forEach((el) => {
        const term = el.getAttribute("data-term");
        if (!term || !lookupTerm(term)) unresolved.push(term);
    });
    expect(unresolved).toEqual([]);
}

function issueRow(over: Record<string, unknown> = {}) {
    return {
        issue: 1,
        title: "a sample issue",
        first_ts: 1_700_000_000,
        family: "engine",
        impl_model: "claude-sonnet-4-5-20250929",
        impl_min: 30,
        impl_cost: 1.5,
        rev_min: 10,
        rev_cost: 0.5,
        fixups: 0,
        fix_min: 0,
        fix_cost: 0,
        other_min: 0,
        other_cost: 0,
        runs: 2,
        latency_min: 45,
        out_tok: 12_345,
        cost: 2,
        state: "closed",
        ...over,
    };
}

function sessionRow(over: Record<string, unknown> = {}) {
    return {
        session: "abcdef12-3456",
        title: "a sample session",
        cmd: "/process-gh-issues",
        t0: 1_700_000_000,
        wall_min: 30,
        impl_min: 20,
        rev_min: 5,
        fix_min: 0,
        other_min: 0,
        issues: 1,
        prs: "[2634]",
        orch_cost: 0.2,
        cost: 3,
        ...over,
    };
}

describe("History Issues table (#2634)", () => {
    beforeEach(() => {
        mountPage(
            `<div class="row-filters" id="issues-filters"></div><table id="issues-tbl"></table>`
        );
    });

    it("renders every header as a glossary human phrase, never the old raw abbreviation", () => {
        setIssueRows([issueRow()]);
        renderIssuesTable();
        const html = document.getElementById("issues-tbl")!.innerHTML;
        for (const stale of [
            "impl '",
            "impl $",
            "rev '",
            "rev $",
            "fix ×",
            "fix '",
            "fix $",
            "sup '",
            "lat '",
            "out tok",
        ]) {
            expect(html).not.toContain(stale);
        }
        expect(html).toContain(lookupTerm("impl_min").label);
        expect(html).toContain(lookupTerm("fixups").label);
        expect(html).toContain(lookupTerm("latency_min").label);
    });

    it("every header carries a data-term that resolves in the glossary", () => {
        setIssueRows([issueRow()]);
        renderIssuesTable();
        assertAllTermsResolve("#issues-tbl th[data-term]");
    });

    it("never prints a raw float — a fractional per-role cost renders through the shared formatter", () => {
        setIssueRows([issueRow({ impl_cost: 62.699807482999994 })]);
        renderIssuesTable();
        const html = document.getElementById("issues-tbl")!.innerHTML;
        expect(html).not.toContain("62.699807482999994");
        expect(html).toContain("$62.70");
    });

    it("sorts by the RAW field value, not the rendered label or cell text", () => {
        setIssueRows([
            issueRow({ issue: 1, impl_min: 9 }),
            issueRow({ issue: 2, impl_min: 100 }),
        ]);
        renderIssuesTable();
        const th = document.querySelector(
            '#issues-tbl th[data-key="impl_min"]'
        ) as HTMLElement;
        th.click(); // new sort key: defaults to descending
        let order = [...document.querySelectorAll("#issues-tbl tbody tr")].map(
            (tr) => tr.getAttribute("data-issue")
        );
        expect(order).toEqual(["2", "1"]); // 100 before 9 — numeric descending
        th.click(); // second click on the same key: ascending
        order = [...document.querySelectorAll("#issues-tbl tbody tr")].map(
            (tr) => tr.getAttribute("data-issue")
        );
        expect(order).toEqual(["1", "2"]); // 9 before 100 — a string sort would invert this
    });

    it("empty state (no data at all) reads as a sentence, header row still present", () => {
        setIssueRows([]);
        renderIssuesTable();
        const tbl = document.getElementById("issues-tbl")!;
        expect(tbl.innerHTML).toContain("ls-empty");
        expect(tbl.innerHTML).toMatch(/No agent activity is recorded/);
        expect(tbl.querySelectorAll("th").length).toBeGreaterThan(0);
    });

    it("empty state (filtered to zero) reads a DIFFERENT sentence than no-data-at-all", () => {
        const win = mountPage(
            `<div class="row-filters" id="issues-filters"></div><table id="issues-tbl"></table>`
        );
        setIssueRows([issueRow()]);
        renderIssueFilters();
        renderIssuesTable();
        const input = document.getElementById("if-text") as HTMLInputElement;
        fireInput(win, input, "no-such-issue-zzz");
        const html = document.getElementById("issues-tbl")!.innerHTML;
        expect(html).toContain("ls-empty");
        expect(html).toMatch(/No issues match the selected/);
        expect(html).not.toMatch(/No agent activity is recorded/);
    });
});

describe("History Sessions table (#2634)", () => {
    beforeEach(() => {
        mountPage(
            `<div class="row-filters" id="sessions-filters"></div><table id="sessions-tbl"></table>`
        );
    });

    it("renders every header as a glossary human phrase, never the old raw abbreviation", () => {
        setSessionRows([sessionRow()]);
        renderSessionsTable();
        const html = document.getElementById("sessions-tbl")!.innerHTML;
        for (const stale of [
            "impl '",
            "rev '",
            "fix '",
            "other '",
            "orch $",
            "total $",
        ]) {
            expect(html).not.toContain(stale);
        }
        expect(html).toContain(lookupTerm("wall_min").label);
        expect(html).toContain(lookupTerm("orch_cost").label);
    });

    it("every header carries a data-term that resolves in the glossary", () => {
        setSessionRows([sessionRow()]);
        renderSessionsTable();
        assertAllTermsResolve("#sessions-tbl th[data-term]");
    });

    it("sorts by the RAW field value, not the rendered label or cell text", () => {
        setSessionRows([
            sessionRow({ session: "s-a", impl_min: 9 }),
            sessionRow({ session: "s-b", impl_min: 100 }),
        ]);
        renderSessionsTable();
        const th = document.querySelector(
            '#sessions-tbl th[data-key="impl_min"]'
        ) as HTMLElement;
        th.click();
        let order = [
            ...document.querySelectorAll("#sessions-tbl tbody tr"),
        ].map((tr) => tr.getAttribute("data-session"));
        expect(order).toEqual(["s-b", "s-a"]);
        th.click();
        order = [...document.querySelectorAll("#sessions-tbl tbody tr")].map(
            (tr) => tr.getAttribute("data-session")
        );
        expect(order).toEqual(["s-a", "s-b"]);
    });

    it("empty state (no data at all) vs (filtered to zero) read different sentences", () => {
        setSessionRows([]);
        renderSessionsTable();
        let html = document.getElementById("sessions-tbl")!.innerHTML;
        expect(html).toMatch(/No sessions ran in the selected date range/);

        const win = mountPage(
            `<div class="row-filters" id="sessions-filters"></div><table id="sessions-tbl"></table>`
        );
        setSessionRows([sessionRow()]);
        renderSessionFilters();
        renderSessionsTable();
        const input = document.getElementById("sf-text") as HTMLInputElement;
        fireInput(win, input, "no-such-session-zzz");
        html = document.getElementById("sessions-tbl")!.innerHTML;
        expect(html).toMatch(/No sessions match the selected/);
    });
});

describe("History Family × role pivot (#2634)", () => {
    beforeEach(() => {
        mountPage(`<table id="families-tbl"></table>`);
    });

    it("keeps the role names as header text but gives each its own glossary tooltip", () => {
        renderFamiliesTable([
            {
                family: "engine",
                role: "implement",
                minutes: 30,
                cost: 1,
                out_tok: 100,
                issues: 1,
            },
            {
                family: "engine",
                role: "review",
                minutes: 10,
                cost: 0.5,
                out_tok: 50,
                issues: 1,
            },
        ]);
        const html = document.getElementById("families-tbl")!.innerHTML;
        expect(html).toContain(">implement<");
        expect(html).toContain(">review<");
        expect(html).toContain('data-term="role.implement"');
        expect(html).toContain('data-term="role.review"');
        assertAllTermsResolve("#families-tbl th[data-term]");
        expect(lookupTerm("role.implement").tip).not.toEqual(
            lookupTerm("role.review").tip
        );
    });

    it("never prints a raw float for a family's total cost", () => {
        renderFamiliesTable([
            {
                family: "engine",
                role: "implement",
                minutes: 30,
                cost: 62.699807482999994,
                out_tok: 100,
                issues: 1,
            },
        ]);
        const html = document.getElementById("families-tbl")!.innerHTML;
        expect(html).not.toContain("62.699807482999994");
        expect(html).toContain("$62.70");
    });

    it("empty state reads as a sentence, not a blank table", () => {
        renderFamiliesTable([]);
        const html = document.getElementById("families-tbl")!.innerHTML;
        expect(html).toContain("ls-empty");
        expect(html).toMatch(/No agent activity is recorded/);
    });

    it("the pivot's own title+subtitle glossary entry matches the issue's required copy", () => {
        const entry = lookupTerm("card.family-role");
        expect(entry.label).toBe("Agent family × role");
        expect(entry.tip).toBe(
            "How cost splits across the agent families and the role each run played."
        );
    });
});
