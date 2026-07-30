import { describe, expect, it } from "vitest";
import { APP_NAME, formatDocumentTitle } from "~/lib/documentTitle";

describe("formatDocumentTitle", () => {
    it("appends the app name to a page name", () => {
        expect(formatDocumentTitle("Lobby")).toBe(`Lobby · ${APP_NAME}`);
    });

    it("degrades to the bare app name when no page is known", () => {
        // The loading state — a dangling separator would be worse than the
        // generic title.
        expect(formatDocumentTitle(undefined)).toBe(APP_NAME);
        expect(formatDocumentTitle(null)).toBe(APP_NAME);
        expect(formatDocumentTitle("")).toBe(APP_NAME);
        expect(formatDocumentTitle("   ")).toBe(APP_NAME);
    });

    it("trims a page name rather than rendering its padding", () => {
        expect(formatDocumentTitle("  Draft Lab  ")).toBe(
            `Draft Lab · ${APP_NAME}`
        );
    });
});
