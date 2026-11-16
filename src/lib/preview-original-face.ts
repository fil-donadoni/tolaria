// Which mechanism produced the card preview's SECOND (original) face, and the
// label that names it (issue #9795). One producer per object, one label per
// producer: the label states what happened to the card, not just "Original".

/** `copy` — a Permanent Copy (CR 707.2); `fullText` — a full-text effect
 *  (CR 612.6); `faceDown` — a face-down object the viewer may look at
 *  (CR 708.5 / CR 406.3). */
export type PreviewOriginalMechanism = "copy" | "fullText" | "faceDown";

/** The label over the second face. `presentedName` is the card the permanent
 *  currently presents (the primary face), so the label says what the original
 *  became. Undefined → the body's default. */
export function originalFaceLabel(
    mechanism: PreviewOriginalMechanism | null,
    presentedName: string
): string | undefined {
    switch (mechanism) {
        case "faceDown":
            return "Actual card";
        case "copy":
            return `Original — copying ${presentedName}`;
        case "fullText":
            return `Original — has the full text of ${presentedName}`;
        case null:
            return undefined;
    }
}
