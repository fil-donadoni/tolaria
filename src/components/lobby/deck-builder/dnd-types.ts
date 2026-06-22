// Payload carried on every draggable card in the deck builder. `kind` tells the
// drop handler where the card came from so it can add (from results) or move
// (between maindeck/sideboard). See ADR 0035 (deck builder drag & drop).
export type DragSourceKind = "result" | "main" | "side";

export interface CardDragData {
    kind: DragSourceKind;
    cardId: string;
    cardName: string;
}

export type DropZoneId = "main" | "side";
