import { esc } from "./format.js";

/**
 * The Now view's markup atoms (issue #3135) — a section frame with an info
 * mark, a stat box, a badge, a compact table. One module, so every section
 * on the page is built from the same four shapes and reads the same way.
 *
 * WHY. Before #3135 each section wrote its own markup: the driver's passes
 * were `<div class="ls-pass">pass 3 · exit 0 · pct 28.0302… · queue 221→218
 * · claims-held</div>`, the queue was a `·`-joined sentence, the batch
 * another. Six facts glued together at 11px in the muted colour, with no
 * hint on the page of what `pct` or `claims-held` meant. Every atom here
 * carries its vocabulary: a `data-term` on the heading's info mark and on a
 * stat's caption resolves in `glossary.js`, so the tooltip engine explains
 * it on hover or focus, and the glossary's completeness guard reds on a
 * term nothing declares.
 *
 * Pure — strings in, an HTML string out — like every other Now renderer, so
 * the `node` vitest project can call these and assert on the result.
 */

/**
 * The `ⓘ` beside a heading or a light. An EMPTY element with a `data-term`
 * would be filled with the glossary LABEL by `enhanceTerms` (tooltip.js) —
 * here the glyph is the visual, so it carries an `aria-label` naming the
 * term, which is what keeps `enhanceTerms` from painting the label over it
 * (the same rule the timeline's merge ticks rely on).
 */
export function infoHtml(term, what = "this section") {
    return (
        `<span class="ls-info" data-term="${esc(term)}" role="img" ` +
        `aria-label="What ${esc(what)} shows">ⓘ</span>`
    );
}

/**
 * A section: heading row (title, info mark, optional right-hand extra) and
 * a body. `id` is what a traffic light scrolls to (`SECTION_IDS`,
 * now-lights.js) — optional for sections no light targets.
 */
export function sectionHtml({ id, term, title, extra = "", body, cls = "" }) {
    const idAttr = id ? ` id="${esc(id)}"` : "";
    return (
        `<section${idAttr} class="ls-section ${cls}">` +
        `<div class="ls-section-head">` +
        `<h3 class="ls-section-title">${esc(title)}</h3>` +
        infoHtml(term, title) +
        (extra ? `<span class="ls-section-extra">${extra}</span>` : "") +
        `</div>` +
        `<div class="ls-section-body">${body}</div>` +
        `</section>`
    );
}

/**
 * A stat box: a big rounded figure, a caption that IS a glossary term, and
 * an optional unit / note line. `tone` paints the left rule with a state
 * hue — colour never the only carrier: the caption says what it is and the
 * figure is in the text colour.
 */
export function statHtml({ term, label, value, note = "", tone = "" }) {
    return (
        `<div class="ls-stat${tone ? ` ${esc(tone)}` : ""}">` +
        `<div class="ls-stat-value">${esc(value)}</div>` +
        `<div class="ls-stat-label" data-term="${esc(term)}">${esc(label)}</div>` +
        (note ? `<div class="ls-stat-note">${esc(note)}</div>` : "") +
        `</div>`
    );
}

/** A row of stat boxes. */
export const statsHtml = (stats) =>
    `<div class="ls-stats">${stats.map(statHtml).join("")}</div>`;

/**
 * A badge: one word, a tone, optionally a glossary term so hovering it
 * explains the word. Tones are the page's four state roles (`good` /
 * `warn` / `bad` / `unknown`) plus `neutral`.
 */
export function badgeHtml(
    text,
    tone = "neutral",
    term = null,
    extraAttrs = ""
) {
    const termAttr = term ? ` data-term="${esc(term)}"` : "";
    return (
        `<span class="ls-badge ${esc(tone)}"${termAttr}${extraAttrs ? ` ${extraAttrs}` : ""}>` +
        `${esc(text)}</span>`
    );
}

/**
 * A compact table. `columns` are `{ term, label, align? }` — every header
 * declares its glossary term; `rows` are arrays of already-rendered cell
 * HTML (the caller escapes). `numeric` columns right-align.
 */
export function tableHtml(columns, rows, { cls = "" } = {}) {
    const head = columns
        .map(
            (c) =>
                `<th class="${c.align === "right" ? "num" : ""}"` +
                (c.term ? ` data-term="${esc(c.term)}"` : "") +
                `>${esc(c.label)}</th>`
        )
        .join("");
    const body = rows
        .map(
            (r) =>
                `<tr>` +
                r
                    .map(
                        (cell, i) =>
                            `<td class="${columns[i]?.align === "right" ? "num" : ""}">${cell}</td>`
                    )
                    .join("") +
                `</tr>`
        )
        .join("");
    return (
        `<div class="tbl-wrap ls-tbl-wrap"><table class="ls-table ${esc(cls)}">` +
        `<thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`
    );
}

/** The empty-state sentence every section renders the same way. */
export const emptyHtml = (text) => `<div class="ls-empty">${esc(text)}</div>`;

/** The unavailable-state note — a FAILED read, never confused with empty. */
export const unavailableHtml = (text, consequence) =>
    `<div class="ls-unavailable">⚠ ${esc(text)}` +
    (consequence ? `<br>${esc(consequence)}` : "") +
    `</div>`;
