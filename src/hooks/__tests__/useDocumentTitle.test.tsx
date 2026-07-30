import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { useDocumentTitle } from "~/hooks/useDocumentTitle";
import { APP_NAME } from "~/lib/documentTitle";

function Page({ title }: { title?: string }) {
    useDocumentTitle(title);
    return null;
}

describe("useDocumentTitle", () => {
    it("sets the document title on mount", () => {
        render(<Page title="Lobby" />);
        expect(document.title).toBe(`Lobby · ${APP_NAME}`);
    });

    it("follows a dynamic name that arrives after the first render", () => {
        // The real shape for a deck / limited-event page: the name only exists
        // once its query lands, and the tab must not stay on the placeholder.
        const { rerender } = render(<Page title={undefined} />);
        expect(document.title).toBe(APP_NAME);

        rerender(<Page title="Channel Fireball" />);
        expect(document.title).toBe(`Channel Fireball · ${APP_NAME}`);
    });
});
