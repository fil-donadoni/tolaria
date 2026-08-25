import { esc, fmtDur, fmtUsd } from "./format.js";
import { toggleDrill } from "./history-drilldown.js";

/**
 * The Sessions card (#2625) — same sort + filter treatment as Issues.
 * Owns `#sessions-tbl`, `#sessions-filters` and `sesState`, which is
 * module-private: rows enter only through `setSessionRows()`.
 */
const SESSION_COLS = [
    { key: "title", label: "session" },
    { key: "cmd", label: "command" },
    { key: "t0", label: "start", num: true },
    { key: "wall_min", label: "wall", num: true },
    { key: "impl_min", label: "impl '", num: true },
    { key: "rev_min", label: "rev '", num: true },
    { key: "fix_min", label: "fix '", num: true },
    { key: "other_min", label: "other '", num: true },
    { key: "issues", label: "issues", num: true },
    { key: "prs", label: "PRs", num: true },
    { key: "orch_cost", label: "orch $", num: true },
    { key: "cost", label: "total $", num: true },
];

const sesState = {
    rows: [],
    sort: "t0",
    dir: -1,
    cmd: "",
    text: "",
};

const prCount = (r) => (r.prs ? JSON.parse(r.prs).length : 0);
const cmdBase = (c) => (c ?? "").split(/\s/)[0] || "(none)";

/** The only way rows enter this module. */
export function setSessionRows(rows) {
    sesState.rows = rows;
}

function sessionCell(col, r) {
    const v = r[col.key];
    switch (col.key) {
        case "title":
            return `<td>${esc(v ?? r.session.slice(0, 8))}</td>`;
        case "cmd":
            return `<td title="${esc(v)}">${esc((v ?? "—").slice(0, 38))}</td>`;
        case "t0":
            return `<td>${new Date(v * 1000).toLocaleString([], { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>`;
        case "wall_min":
            return `<td>${fmtDur(v * 60)}</td>`;
        case "impl_min":
        case "rev_min":
        case "fix_min":
        case "other_min":
            return `<td>${v ? Math.round(v) + "'" : "<span class='mini'>—</span>"}</td>`;
        case "prs": {
            const prs = r.prs ? JSON.parse(r.prs) : [];
            return `<td title="${prs.join(", ")}">${prs.length}</td>`;
        }
        case "orch_cost":
            return `<td>${fmtUsd(v)}</td>`;
        case "cost":
            return `<td><b>${fmtUsd(v)}</b></td>`;
        default:
            return `<td>${esc(v ?? "—")}</td>`;
    }
}

export function renderSessionsTable() {
    const col = SESSION_COLS.find((c) => c.key === sesState.sort);
    const t = sesState.text.toLowerCase();
    const val = (r) =>
        sesState.sort === "prs" ? prCount(r) : r[sesState.sort];
    const rows = sesState.rows
        .filter(
            (r) =>
                (!sesState.cmd || cmdBase(r.cmd) === sesState.cmd) &&
                (!t ||
                    `${r.title ?? ""} ${r.cmd ?? ""} ${r.session}`
                        .toLowerCase()
                        .includes(t))
        )
        .sort((a, b) => {
            const cmp = col?.num
                ? (Number(val(a)) || 0) - (Number(val(b)) || 0)
                : String(val(a) ?? "").localeCompare(String(val(b) ?? ""));
            return cmp * sesState.dir;
        });
    const stbl = document.getElementById("sessions-tbl");
    const arrow = (c) =>
        c.key === sesState.sort ? (sesState.dir === -1 ? " ↓" : " ↑") : "";
    stbl.innerHTML =
        `<thead><tr>` +
        SESSION_COLS.map(
            (c) =>
                `<th class="sortable" data-key="${c.key}">${c.label}${arrow(c)}</th>`
        ).join("") +
        `</tr></thead><tbody>` +
        rows
            .map(
                (r) =>
                    `<tr class="expand" data-session="${esc(r.session)}">` +
                    SESSION_COLS.map((c) => sessionCell(c, r)).join("") +
                    `</tr>`
            )
            .join("") +
        `</tbody>`;
    stbl.querySelectorAll("th.sortable").forEach((th) =>
        th.addEventListener("click", () => {
            const k = th.dataset.key;
            sesState.dir = sesState.sort === k ? -sesState.dir : -1;
            sesState.sort = k;
            renderSessionsTable();
        })
    );
    stbl.querySelectorAll("tr.expand").forEach((tr) =>
        tr.addEventListener("click", () =>
            toggleDrill(
                tr,
                `/api/runs?session=${encodeURIComponent(tr.dataset.session)}`
            )
        )
    );
}

export function renderSessionFilters() {
    const cmds = new Set(sesState.rows.map((r) => cmdBase(r.cmd)));
    document.getElementById("sessions-filters").innerHTML =
        `<label>command <select id="sf-cmd">` +
        `<option value="">all</option>` +
        [...cmds]
            .sort()
            .map(
                (v) =>
                    `<option${v === sesState.cmd ? " selected" : ""}>${esc(v)}</option>`
            )
            .join("") +
        `</select></label>
                     <label>search <input id="sf-text" type="search" placeholder="title / command / id" value="${esc(sesState.text)}"></label>`;
    document.getElementById("sf-cmd").addEventListener("change", (e) => {
        sesState.cmd = e.target.value;
        renderSessionsTable();
    });
    document.getElementById("sf-text").addEventListener("input", (e) => {
        sesState.text = e.target.value;
        renderSessionsTable();
    });
}
