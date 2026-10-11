/**
 * The deckbuilder's PANE SET (issue #2584, PRD #2405 slice 5, ADR 0101).
 *
 * On a phone the screen stops being "a source region above a pair of zones"
 * and becomes an ordered strip of full-page panes the player swipes between,
 * with one tab per pane. This module is the ONE place that says which panes
 * exist and in what order.
 *
 * **Derived from what the shell HAS, never from who is calling it**
 * (`deckBuilderVariant.ts` § "No identity discriminant"). A pane exists
 * because its slot was supplied:
 *
 *  - **Constructed** supplies a Source pane (the card-search results), so it
 *    gets three: Search | Main | Side.
 *  - **Limited build** supplies none — its Sideboard IS the pool — so it gets
 *    two: Main | Pool. That is the honest count for that variant, not a
 *    missing feature: there is no third list of cards on that screen.
 *  - The draft-time Pool (ADR 0075 §6) would get the same two for free.
 *
 * Every tab is also a DROP TARGET, so a long-press drag can move a card to a
 * pane the player cannot currently see. The ids come from `deckZoneDrag.ts`
 * and resolve through the same `resolveDeckZoneDragAction` a drop on the pane
 * itself does.
 */
import type { DeckZone } from "@convex/deckLayout";
import { SOURCE_TAB_DROP_ID, zoneTabDropId } from "./deckZoneDrag";
import type { ZoneBand } from "./deckZoneSplit";

/** The identity of a pane. `"source"` is the only one that is not a Zone; the
 *  two band ids exist only while Split creatures cuts the Maindeck in two on a
 *  phone held upright (issue #5400). */
export type DeckPaneId = "source" | DeckZone | MaindeckBandPaneId;

export type MaindeckBandPaneId = `maindeck-${ZoneBand}`;

/** The pane id of one Maindeck band. */
export function maindeckBandPaneId(band: ZoneBand): MaindeckBandPaneId {
    return `maindeck-${band}`;
}

/** The pane id a Maindeck card lands in: its band's while the Maindeck is
 *  cut in two, the Maindeck's own otherwise. */
export function maindeckPaneIdFor(
    isCreature: boolean,
    banded: boolean
): DeckPaneId {
    return banded
        ? maindeckBandPaneId(isCreature ? "creatures" : "others")
        : "maindeck";
}

/** One pane of the strip, and the tab that reaches it. */
export interface DeckPane {
    id: DeckPaneId;
    /** Tab text — short by design (`Search`, `Main`, `Side`, `Pool`). */
    label: string;
    /** Count shown on the tab. */
    count: number;
    /** dnd-kit droppable id the TAB registers. */
    dropId: string;
}

export interface DeckPaneInput {
    /** Present only when the variant supplied a Source pane. */
    source?: { label: string; count: number };
    mainLabel: string;
    mainCount: number;
    sideLabel: string;
    sideCount: number;
    /** Present while the Maindeck is cut in two (issue #5400): its single pane
     *  becomes a Creatures pane and a Non-creatures pane, in that order. */
    mainBands?: { creatures: number; others: number };
}

/** The ordered pane strip. Source first (where cards come FROM), then the two
 *  Zones in the order the desktop layout already puts them. */
export function deckPanes(input: DeckPaneInput): DeckPane[] {
    const panes: DeckPane[] = [];
    if (input.source) {
        panes.push({
            id: "source",
            label: input.source.label,
            count: input.source.count,
            dropId: SOURCE_TAB_DROP_ID,
        });
    }
    if (input.mainBands) {
        panes.push(
            {
                id: maindeckBandPaneId("creatures"),
                label: "Creatures",
                count: input.mainBands.creatures,
                dropId: zoneTabDropId("maindeck", "creatures"),
            },
            {
                id: maindeckBandPaneId("others"),
                label: "Non-creatures",
                count: input.mainBands.others,
                dropId: zoneTabDropId("maindeck", "others"),
            }
        );
    } else {
        panes.push({
            id: "maindeck",
            label: input.mainLabel,
            count: input.mainCount,
            dropId: zoneTabDropId("maindeck"),
        });
    }
    panes.push({
        id: "sideboard",
        label: input.sideLabel,
        count: input.sideCount,
        dropId: zoneTabDropId("sideboard"),
    });
    return panes;
}

/** The pane the strip is on, given the one last picked: that pane while it
 *  still exists, else its counterpart across the Maindeck's cut in two (the
 *  first band, or the whole Maindeck), else the first pane. */
export function resolveActivePaneId(
    panes: readonly DeckPane[],
    pickedId: string
): string {
    if (panes.some((p) => p.id === pickedId)) return pickedId;
    if (pickedId.startsWith("maindeck")) {
        const main = panes.find((p) => p.id.startsWith("maindeck"));
        if (main) return main.id;
    }
    return panes[0]!.id;
}
