import { esc, fmtDur, fmtUsd, fmtMin } from "./format.js";
import { toggleDrill } from "./history-drilldown.js";
import { labelFor } from "./glossary.js";

/**
 * The Sessions card (#2625) — same sort + filter treatment as Issues.
 * Owns `#sessions-tbl`, `#sessions-filters` and `sesState`, which is
 * module-private: rows enter only through `setSessionRows()`.
 *
 * `term` overrides `key` for the glossary lookup when the two names diverge
 * ("title" renders the glossary's "session" entry); every other column's
 * term IS its key. `key` alone drives sorting (#2634) — see the identical
 * note in `history-issues-table.js`.
 */
const SESSION_COLS = [
    { key: "title", term: "session" },
    { key: "cmd" },
    { key: "t0", num: true },
    { key: "wall_min", num: true },
    { key: "impl_min", num: true },
    { key: "rev_min", num: true },
    { key: "fix_min", num: true },
    { key: "other_min", num: true },
    { key: "issues", num: true },
    { key: "prs", num: true },
    { key: "orch_cost", num: true },
    { key: "cost", num: true },
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
            return `<td>${fmtMin(v)}</td>`;
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

/** An empty state is a sentence, never a blank box (#2634): distinguishes
 *  "no sessions in range" from "filters hid all of them". */
function sessionsEmptyMessage() {
    return sesState.rows.length
        ? "No sessions match the selected command filter or search text."
        : "No sessions ran in the selected date range.";
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
    const headRow =
        `<tr>` +
        SESSION_COLS.map(
            (c) =>
                `<th class="sortable" data-key="${c.key}" data-term="${c.term ?? c.key}">${labelFor(c.term ?? c.key)}${arrow(c)}</th>`
        ).join("") +
        `</tr>`;
    const bodyHtml = rows.length
        ? rows
              .map(
                  (r) =>
                      `<tr class="expand" data-session="${esc(r.session)}">` +
                      SESSION_COLS.map((c) => sessionCell(c, r)).join("") +
                      `</tr>`
              )
              .join("")
        : `<tr><td colspan="${SESSION_COLS.length}"><div class="ls-empty">${esc(sessionsEmptyMessage())}</div></td></tr>`;
    stbl.innerHTML = `<thead>${headRow}</thead><tbody>${bodyHtml}</tbody>`;
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
