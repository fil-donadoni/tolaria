/**
 * Class SECTIONS — the line group a `class`-layout card is split into before
 * any line is routed (CR 716.2).
 *
 * CR 716.2: "Any abilities printed within the same text box section as the
 * class level bar are part of its static ability." So a bar is not a line: it
 * owns every ability line printed under it, up to the next bar, whereas the
 * lines above the first bar are the card's level-1 abilities (CR 716.3). No
 * verb frame can say that, because the meaning of "Whenever you cast a spell,
 * …" under a bar is carried by the bar above it, not by the line.
 *
 * Structural, like `lineGroups.ts`: a line either IS a bar, spelled exactly
 * `{cost}: Level N`, or it belongs to the section it is printed in. A neighbour
 * of the bar's spelling is not read here; it stays an ordinary line of its
 * section and the slots refuse it, so it fails the card.
 */

import { readManaCost } from "../manaCost";
import type { ClassLevelBarDefinition } from "../../cards/types";

/** CR 716.2a — "[Cost]: Level N", the whole line. */
const CLASS_LEVEL_BAR_LINE = /^((?:\{[^{}]+\})+): Level (\d+)$/;

/** One bar with the lines printed under it. */
export interface ClassSection {
    /** The bar's own printed line, which a refusal names. */
    readonly barLine: string;
    readonly bar: Pick<ClassLevelBarDefinition, "level" | "cost" | "costLabel">;
    readonly lines: readonly string[];
}

export type ClassSectionsResult =
    | {
          readonly ok: true;
          /** CR 716.3 — the top section: every line above the first bar. */
          readonly top: readonly string[];
          readonly sections: readonly ClassSection[];
      }
    | {
          readonly ok: false;
          readonly reason: string;
          readonly fragment: string;
      };

/** Split a Class card's printed text at its level bars. */
export function readClassSections(oracleText: string): ClassSectionsResult {
    const top: string[] = [];
    const sections: (ClassSection & { readonly lines: string[] })[] = [];
    for (const raw of oracleText.split("\n")) {
        const line = raw.trim();
        const bar = CLASS_LEVEL_BAR_LINE.exec(line);
        if (bar === null) {
            (sections[sections.length - 1]?.lines ?? top).push(line);
            continue;
        }
        const cost = readManaCost(bar[1]!);
        if (!cost.ok) return { ok: false, reason: cost.reason, fragment: line };
        sections.push({
            barLine: line,
            bar: {
                level: Number(bar[2]),
                cost: cost.cost,
                costLabel: bar[1]!,
            },
            lines: [],
        });
    }
    return { ok: true, top, sections };
}
