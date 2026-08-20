/** Drop-target resolution for the editing-surface gesture engine (PRD #2405).
 *
 *  A touch drag has no dnd-kit-style collision detection to lean on: the ghost
 *  follows the finger and the drop is whatever is UNDER the finger. That is
 *  `document.elementFromPoint`, walked up to the nearest `[data-drop]`
 *  ancestor — the one marker every droppable region of an editing surface
 *  carries (zone tabs, the draft pool strip and its SB half, MV rows, pile
 *  columns). Keeping the marker an attribute rather than a registry means a
 *  surface can declare a drop target in JSX without registering anything.
 */

/** The attribute name every editing-surface drop region carries. */
export const DROP_ATTRIBUTE = "data-drop";
const DROP_SELECTOR = `[${DROP_ATTRIBUTE}]`;

/** Props spread onto a droppable region. `id` is the surface's own drop id
 *  (e.g. `zoneColumnDropId("maindeck", "mv:3")`) — this module never parses
 *  it, it only carries it back to the surface's own resolver. */
export function dropTargetProps(id: string): { "data-drop": string } {
    return { [DROP_ATTRIBUTE]: id } as { "data-drop": string };
}

/** The drop id under a viewport point, or `null` when the point is over no
 *  drop region. `root` is injectable so a test can drive it without a layout
 *  engine (happy-dom's `elementFromPoint` has nothing to hit-test against). */
export function dropIdAt(
    x: number,
    y: number,
    root: Pick<Document, "elementFromPoint"> = document
): string | null {
    const el = root.elementFromPoint(x, y);
    const zone = el?.closest<HTMLElement>(DROP_SELECTOR);
    return zone?.getAttribute(DROP_ATTRIBUTE) ?? null;
}
