// Shared DOM queries for the deckbuilder zone tests (issue #1624).
//
// Both builders render the SAME `DeckZoneSurface` for both of their Zones, so
// "which columns does this zone show, and in what order do its cards sit"
// is one question with one answer — asked by the Constructed harness
// (`lobby/deck-builder/__tests__/deck-builder-zones.test.tsx`) and the Limited
// one (`pool-deck-builder-form.test.tsx`) alike. These helpers are that one
// answer; they deliberately read the REAL rendered DOM (no hand-built view),
// which is what makes an assertion about a zone traverse the real Column
// Layout engine rather than a fixture.
import { expect } from "vitest";

/** The pane element of ONE zone, found by its header title — the span's
 *  grandparent (`DeckZoneSurface` renders title span → header row → pane).
 *  Scoping every column/card query to a pane is what keeps a Sideboard
 *  assertion from accidentally reading the Maindeck's identically-named
 *  column (both zones can be grouped the same way at the same time). */
export function paneOf(container: HTMLElement, title: RegExp): HTMLElement {
    const span = [...container.querySelectorAll("span")].find((el) =>
        title.test(el.textContent ?? "")
    );
    expect(span, `no zone header matching ${title}`).toBeTruthy();
    return span!.parentElement!.parentElement!;
}

/** Column labels of one zone, in render order, read off the real DOM. */
export function columnLabelsIn(pane: HTMLElement): string[] {
    return [...pane.querySelectorAll("[data-column]")].map(
        (el) => el.querySelector("span")!.textContent!
    );
}

/** Card names in `root`'s column `columnId`, in render order. `root` is a
 *  pane from {@link paneOf} when the zone matters (it usually does), or the
 *  whole container when the column id is unique across both zones. */
export function cardsIn(root: HTMLElement, columnId: string): string[] {
    const column = root.querySelector(`[data-column="${columnId}"]`);
    expect(column, `no column ${columnId} rendered`).toBeTruthy();
    return [...column!.querySelectorAll("[role=button][title]")].map((el) =>
        el
            .getAttribute("title")!
            .replace(/^Remove /, "")
            .replace(/ \(.*$/, "")
    );
}
