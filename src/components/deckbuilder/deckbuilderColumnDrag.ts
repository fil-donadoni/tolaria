// Drag-and-drop resolution for the limited DECKBUILDER surface (issue #1575).
// The post-draft build view gains column-level drag PARITY with the draft
// Pool (`limitedDraftDrag.ts`): its Maindeck is now a set of fixed Mana-Value
// columns (plus Lands), each an individual drop target, alongside the flat
// Sideboard. Like the draft Pool's resolver, "what does this drop MEAN" is a
// small PURE function so it's unit-testable without a real dnd layout.
//
// Column-id parsing is DELEGATED to `parseColumnDropId` (`limitedDraftDrag.ts`)
// — the two surfaces never fork column-id parsing (issue #1581 unifies them
// fully later).
import {
    parseColumnDropId,
    SIDEBOARD_DROP_ID,
} from "~/components/limited/limitedDraftDrag";
import type { DropZoneId } from "~/components/lobby/deck-builder/dnd-types";

/** The Sideboard drop-zone id shared with the pre-#1575 surface. The limited
 *  deckbuilder's Sideboard reuses the draft Pool's id so a single constant is
 *  the authority. */
export const DECKBUILDER_SIDEBOARD_DROP_ID: DropZoneId = "side";

/** A card being dragged inside the deckbuilder — a Maindeck card (`"main"`) or
 *  a Sideboard card (`"side"`), the existing `CardDragData.kind` values. */
export interface DeckbuilderDragSource {
    kind: DropZoneId;
    cardId: string;
}

/** What a resolved deckbuilder drop MEANS. Maindeck⇄Sideboard membership is
 *  the working deck (persisted to `userDecks`); a column override is the
 *  seat's Pool Arrangement (persisted via `setPoolArrangementEntry`, exactly
 *  like the draft Pool). */
export type DeckbuilderDragAction =
    /** A Maindeck card dropped on the Sideboard — move it out of the deck. */
    | { type: "toSideboard"; cardId: string }
    /** A Maindeck card dropped on ANOTHER Maindeck column — record a manual
     *  column override; stays in the Maindeck. */
    | { type: "setColumn"; cardId: string; column: number | "lands" }
    /** A Sideboard card dropped on a Maindeck column — move it into the deck
     *  AND pin it to exactly that column, in one gesture. */
    | { type: "toMaindeck"; cardId: string; column: number | "lands" };

/** Resolves a completed deckbuilder drag into the action it represents, or
 *  `null` for a cancelled/no-op drop (missing data/target, an unrecognized
 *  target, or a Sideboard→Sideboard drag). Pure — no side effects. */
export function resolveDeckbuilderDragAction(
    source: DeckbuilderDragSource | undefined,
    destId: string | undefined
): DeckbuilderDragAction | null {
    if (!source || !destId) return null;

    if (
        destId === DECKBUILDER_SIDEBOARD_DROP_ID ||
        destId === SIDEBOARD_DROP_ID
    ) {
        // Only a Maindeck card can move TO the Sideboard; a Sideboard card
        // dropped back on the Sideboard is a no-op.
        return source.kind === "main"
            ? { type: "toSideboard", cardId: source.cardId }
            : null;
    }

    const column = parseColumnDropId(destId);
    if (column === null) return null;

    return source.kind === "main"
        ? { type: "setColumn", cardId: source.cardId, column }
        : { type: "toMaindeck", cardId: source.cardId, column };
}
