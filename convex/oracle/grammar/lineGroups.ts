/**
 * Line GROUPING — the step that decides what "a line" is before the router
 * decides what it means.
 *
 * Everything downstream of `normalize.ts` treats a line as one self-contained
 * ability (CR 113.3a–d), and for almost every card that is exactly what a
 * printed line is. Modal text is the exception the CR itself creates: CR 700.2
 * writes a modal instruction as an introductory clause followed by a BULLETED
 * LIST, and Scryfall newline-separates the bullets — so a modal spell arrives
 * as `["Choose one —", "• Destroy target artifact.", "• Destroy target
 * enchantment."]`, three "lines" that are one ability.
 *
 * Routed as printed, none of the three can ever compile: the head has no verb,
 * and a bullet's meaning ("this is ONE of the things the spell may do") is
 * carried entirely by the line above it. A grammar that read the bullets as
 * three independent abilities would be strictly worse than refusing them — it
 * would compile a "choose one" spell into a spell that does everything.
 *
 * ── The rule is structural, not semantic ───────────────────────────────────
 *
 * A bullet attaches to the line before it. That is a fact about how Oracle
 * text PRINTS a list, and it holds whether or not this grammar understands the
 * head — so the grouping never has to guess, and a modal head the grammar
 * cannot read fails as ONE unconsumed group naming the whole ability rather
 * than as three fragments that each look like a separate gap in the backlog.
 *
 * A leading bullet with nothing in front of it FAILS rather than being dropped
 * or promoted to a line of its own: it means the text is shaped in a way this
 * module does not model, and inventing a head for it is the one thing a
 * fail-closed compiler may not do.
 */

/** The character Scryfall opens a CR 700.2 mode line with. */
export const BULLET = "•";

/**
 * How a grouped line rejoins its parts.
 *
 * `normalize.ts` has already collapsed every run of whitespace inside a line
 * and split on newlines, so no `"\n"` survives into a normalised line — which
 * makes it available here as a separator that cannot collide with the text
 * being separated. The slot grammar splits on it to recover the parts.
 */
export const GROUP_SEPARATOR = "\n";

export type GroupResult =
    | { readonly ok: true; readonly lines: readonly string[] }
    | {
          readonly ok: false;
          readonly reason: string;
          readonly fragment: string;
      };

/** Attach every bullet line to the line it follows (CR 700.2). */
export function groupLines(lines: readonly string[]): GroupResult {
    const grouped: string[] = [];
    for (const line of lines) {
        if (!line.startsWith(`${BULLET} `)) {
            grouped.push(line);
            continue;
        }
        const head = grouped[grouped.length - 1];
        if (head === undefined)
            return {
                ok: false,
                reason: "a bulleted mode line opens the text with no clause to attach to (CR 700.2)",
                fragment: line,
            };
        grouped[grouped.length - 1] = head + GROUP_SEPARATOR + line;
    }
    return { ok: true, lines: grouped };
}
