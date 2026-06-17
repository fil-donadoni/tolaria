// Accent/diacritic folding for card search. Decomposes characters into base
// letter + combining marks (NFD), then strips the marks so that e.g. "Bíff"
// becomes "biff". Used to make name/rules search accent-insensitive: a query
// of "ifh-bi" matches "Ifh-Bíff Efreet". Callers should also lowercase.
export function foldAccents(s: string): string {
    return s.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}
