// The design-system page's keycap specimen MOUNTS (issue #9833): a letter,
// Space, Enter and a modifier + click, all drawn by the one `Keycap`.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { ButtonsSection } from "../sections-buttons";

afterEach(cleanup);

describe("ButtonsSection — keycap specimen", () => {
    it("shows a letter, Space, Enter and modifier + click", () => {
        const { container } = render(<ButtonsSection />);
        const keys = [
            ...container.querySelectorAll<HTMLElement>('[data-slot="kbd"]'),
        ].map((k) => k.dataset.key);
        for (const key of ["P", "Space", "Enter", "Mod", "click"]) {
            expect(keys).toContain(key);
        }
    });
});
