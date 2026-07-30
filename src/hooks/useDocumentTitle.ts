import { useEffect } from "react";
import { formatDocumentTitle } from "~/lib/documentTitle";

/**
 * Set `document.title` to "<page> · Tolaria" for as long as the caller is
 * mounted.
 *
 * ONE mechanism on purpose: the title is set by the page component itself,
 * never by a centralized effect over the matched routes. React runs a parent's
 * effects AFTER its children's, so a shell-level effect would always overwrite
 * a page's dynamic title (a deck's name, an event's name) with the static one
 * derived from the path — the exact race this hook exists to avoid.
 *
 * Call it unconditionally, above any early return, and pass `undefined` while
 * the dynamic name is still loading (it degrades to the bare app name).
 */
export function useDocumentTitle(page?: string | null): void {
    useEffect(() => {
        document.title = formatDocumentTitle(page);
    }, [page]);
}
