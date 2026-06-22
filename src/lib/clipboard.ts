/** Serialize a value to MINIFIED JSON (readable, but no spaces or newlines)
 *  and copy it to the clipboard. Shared by the Debug panel "Copy State"
 *  button and the Convex error toast so every state dump uses one compact
 *  format. */
export function copyMinified(value: unknown): Promise<void> {
    return navigator.clipboard.writeText(JSON.stringify(value));
}

/** Copy raw text to the clipboard. Used by the deck-builder Export control to
 *  put a serialized decklist on the clipboard verbatim. */
export function copyText(text: string): Promise<void> {
    return navigator.clipboard.writeText(text);
}
