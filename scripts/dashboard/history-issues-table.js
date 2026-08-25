import { esc, tier, fmtNum, fmtUsd } from "./format.js";
import { toggleDrill } from "./history-drilldown.js";

/**
 * The Issues card (#2625) — client-side sort + filters over the fetched rows.
 * Owns `#issues-tbl`, `#issues-filters` and `issState`.
 *
 * `issState` is module-private: rows arrive through `setIssueRows()` and
 * nothing outside this file reads or writes the sort/filter fields.
 */
const ISSUE_COLS = [
    { key: "issue", label: "issue", num: true },
    { key: "first_ts", label: "date", num: true },
    { key: "family", label: "family" },
    { key: "impl_model", label: "tier" },
    { key: "impl_min", label: "impl '", num: true },
    { key: "impl_cost", label: "impl $", num: true },
    { key: "rev_min", label: "rev '", num: true },
    { key: "rev_cost", label: "rev $", num: true },
    { key: "fixups", label: "fix ×", num: true },
    { key: "fix_min", label: "fix '", num: true },
    { key: "fix_cost", label: "fix $", num: true },
    { key: "other_min", label: "sup '", num: true },
    { key: "other_cost", label: "sup $", num: true },
    { key: "runs", label: "runs", num: true },
    { key: "latency_min", label: "lat '", num: true },
    { key: "out_tok", label: "out tok", num: true },
    { key: "cost", label: "total $", num: true },
    { key: "state", label: "state" },
];

const issState = {
    rows: [],
    sort: "cost",
    dir: -1,
    family: "",
    tier: "",
    state: "",
    text: "",
};

/** The only way rows enter this module. */
export function setIssueRows(rows) {
    issState.rows = rows;
}

function issueCell(col, r) {
    const v = r[col.key];
    switch (col.key) {
        case "issue":
            return `<td title="${esc(r.title)}">#${r.issue} ${esc((r.title ?? "").slice(0, 42))}</td>`;
        case "first_ts":
            return `<td>${new Date(v * 1000).toLocaleDateString([], { month: "2-digit", day: "2-digit" })}</td>`;
        case "family":
            return `<td>${esc(v ?? "—")}</td>`;
        case "impl_model":
            return `<td>${tier(v)}</td>`;
        case "impl_cost":
        case "rev_cost":
        case "fix_cost":
        case "other_cost":
            return `<td>${v ? fmtUsd(v) : "<span class='mini'>—</span>"}</td>`;
        case "cost":
            return `<td><b>${fmtUsd(v)}</b></td>`;
        case "impl_min":
        case "rev_min":
        case "fix_min":
        case "other_min":
        case "latency_min":
            return `<td>${v ? Math.round(v) + "'" : "<span class='mini'>—</span>"}</td>`;
        case "fixups":
            return `<td>${v ? v + "×" : "<span class='mini'>—</span>"}</td>`;
        case "out_tok":
            return `<td>${fmtNum(v, true)}</td>`;
        case "state":
            return `<td>${v === "closed" ? "✅" : esc(v ?? "?")}</td>`;
        default:
            return `<td>${esc(v)}</td>`;
    }
}

function issueFiltered() {
    const t = issState.text.toLowerCase();
    return issState.rows.filter(
        (r) =>
            (!issState.family || (r.family ?? "(none)") === issState.family) &&
            (!issState.tier || tier(r.impl_model) === issState.tier) &&
            (!issState.state || (r.state ?? "?") === issState.state) &&
            (!t || `#${r.issue} ${r.title ?? ""}`.toLowerCase().includes(t))
    );
}

export function renderIssuesTable() {
    const col = ISSUE_COLS.find((c) => c.key === issState.sort);
    const rows = issueFiltered().sort((a, b) => {
        const av = a[issState.sort],
            bv = b[issState.sort];
        const cmp = col?.num
            ? (Number(av) || 0) - (Number(bv) || 0)
            : String(av ?? "").localeCompare(String(bv ?? ""));
        return cmp * issState.dir;
    });
    const itbl = document.getElementById("issues-tbl");
    const arrow = (c) =>
        c.key === issState.sort ? (issState.dir === -1 ? " ↓" : " ↑") : "";
    itbl.innerHTML =
        `<thead><tr>` +
        ISSUE_COLS.map(
            (c) =>
                `<th class="sortable" data-key="${c.key}">${c.label}${arrow(c)}</th>`
        ).join("") +
        `</tr></thead><tbody>` +
        rows
            .map(
                (r) =>
                    `<tr class="expand" data-issue="${r.issue}">` +
                    ISSUE_COLS.map((c) => issueCell(c, r)).join("") +
                    `</tr>`
            )
            .join("") +
        `</tbody>`;
    itbl.querySelectorAll("th.sortable").forEach((th) =>
        th.addEventListener("click", () => {
            const k = th.dataset.key;
            issState.dir = issState.sort === k ? -issState.dir : -1;
            issState.sort = k;
            renderIssuesTable();
        })
    );
    itbl.querySelectorAll("tr.expand").forEach((tr) =>
        tr.addEventListener("click", () =>
            toggleDrill(tr, `/api/runs?issue=${tr.dataset.issue}`)
        )
    );
}

export function renderIssueFilters() {
    const opts = (vals, sel) =>
        `<option value="">all</option>` +
        [...vals]
            .sort()
            .map(
                (v) =>
                    `<option${v === sel ? " selected" : ""}>${esc(v)}</option>`
            )
            .join("");
    const fams = new Set(issState.rows.map((r) => r.family ?? "(none)"));
    const tiers = new Set(issState.rows.map((r) => tier(r.impl_model)));
    const states = new Set(issState.rows.map((r) => r.state ?? "?"));
    document.getElementById("issues-filters").innerHTML =
        `<label>family <select id="if-family">${opts(fams, issState.family)}</select></label>
                     <label>tier <select id="if-tier">${opts(tiers, issState.tier)}</select></label>
                     <label>state <select id="if-state">${opts(states, issState.state)}</select></label>
                     <label>search <input id="if-text" type="search" placeholder="#N / title" value="${esc(issState.text)}"></label>`;
    for (const [id, key] of [
        ["if-family", "family"],
        ["if-tier", "tier"],
        ["if-state", "state"],
    ]) {
        document.getElementById(id).addEventListener("change", (e) => {
            issState[key] = e.target.value;
            renderIssuesTable();
        });
    }
    document.getElementById("if-text").addEventListener("input", (e) => {
        issState.text = e.target.value;
        renderIssuesTable();
    });
}
