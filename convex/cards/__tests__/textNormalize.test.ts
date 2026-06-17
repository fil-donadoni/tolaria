import { describe, expect, it } from "vitest";
import { foldAccents } from "../textNormalize";

describe("foldAccents", () => {
    it("strips diacritics from accented letters", () => {
        expect(foldAccents("Bíff")).toBe("Biff");
        expect(foldAccents("Lim-Dûl")).toBe("Lim-Dul");
        expect(foldAccents("Séance")).toBe("Seance");
    });

    it("leaves unaccented text unchanged", () => {
        expect(foldAccents("Lightning Bolt")).toBe("Lightning Bolt");
        expect(foldAccents("ifh-bi")).toBe("ifh-bi");
    });

    it("makes a partial accent-free query match an accented name (search aid)", () => {
        // This is exactly what matchesText does: fold both sides, lowercase,
        // substring-match. "ifh-bi" must find "Ifh-Bíff Efreet".
        const nameFold = foldAccents("Ifh-Bíff Efreet".toLowerCase());
        const queryFold = foldAccents("ifh-bi".toLowerCase());
        expect(nameFold.includes(queryFold)).toBe(true);
    });
});
