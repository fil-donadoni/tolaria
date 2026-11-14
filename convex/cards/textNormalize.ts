// Accent/diacritic folding for card search. Decomposes characters into base
// letter + combining marks (NFD), then strips the marks so that e.g. "Bíff"
// becomes "biff". Used to make name/rules search accent-insensitive: a query
// of "ifh-bi" matches "Ifh-Bíff Efreet". Callers should also lowercase.
export function foldAccents(s: string): string {
    return s.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

/** A card's name folded to the key that survives both deck-builder search
 *  populations (issue #8755): a Search Index entry's `cardId` is a Card ID,
 *  a Full Catalogue entry's is a Print ID, but both carry the printed name.
 *  Lowercased, accent-folded, trimmed — the client and the server compute
 *  the same key from the same name. */
export function foldCardName(name: string): string {
    return foldAccents(name.trim().toLowerCase());
}
