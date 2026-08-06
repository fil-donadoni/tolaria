// Payload carried on every draggable card in the deck builder. `kind` tells the
// drop handler where the card came from so it can add (from results) or move
// (between maindeck/sideboard). See ADR 0035 (deck builder drag & drop).
export type DragSourceKind = "result" | "main" | "side";

export interface CardDragData {
    kind: DragSourceKind;
    cardId: string;
    cardName: string;
    /** The key a Card Pin for THIS copy is recorded under (ADR 0075 §4, issue
     *  #1626). Constructed uses the `cardId`, so all four copies pin together;
     *  Limited uses `String(poolIndex)`, so the two physical copies of a card
     *  in a Pool stay individually placeable. Absent on a search-result drag
     *  (a card not in the deck yet has no pin key) and on any surface that
     *  doesn't declare one — the drop resolver falls back to `cardId`, which
     *  is exactly the Constructed rule. */
    pinKey?: string;
}

export type DropZoneId = "main" | "side";
