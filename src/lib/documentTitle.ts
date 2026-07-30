// The one place that decides what goes in `<title>`. Every page is
// "<page> · Tolaria"; the bare app name is reserved for the state where no
// page identity is known yet (initial HTML, a route that hasn't resolved its
// dynamic name). Keeping the composition here — rather than letting each
// route build its own string — is what stops the separator and the app name
// drifting apart across ~15 pages.

export const APP_NAME = "Tolaria";

/** Middle dot with hair spaces reads better than " - " and matches the app's
 *  typographic register (the same separator the deck panels use). */
const SEPARATOR = " · ";

/**
 * Compose the document title for a page.
 *
 * A nullish or blank `page` degrades to the bare app name instead of
 * rendering a dangling separator — that is the loading state, not an error.
 */
export function formatDocumentTitle(page?: string | null): string {
    const trimmed = page?.trim();
    return trimmed ? `${trimmed}${SEPARATOR}${APP_NAME}` : APP_NAME;
}
