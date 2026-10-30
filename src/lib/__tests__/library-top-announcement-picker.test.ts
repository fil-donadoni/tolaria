// CR 601.3e (issue #7526) — the client cast-option picker for the card on top
// of the library, read off the WIRE: `projectPublicState` → the projected
// library card + players → `affordableAltCostsForCard` /
// `printedCostCastUnavailable`. A filtered permission licenses each
// announcement by ITS subject, so the picker must offer exactly the rows
// `announceCast` accepts: Petty Theft and not Brazen Borrower under an
// instant-and-sorcery grant, the reverse under a creature grant, the
// face-down cast alone for a noncreature morph card under a creature grant.

import { describe, expect, it } from "vitest";
import { projectPublicState } from "@convex/gameProjections";
import { adventureCastAltCostId } from "@convex/gre/adventure";
import { MORPH_CAST_ALT_COST_ID } from "@convex/gre/morph";
import type { GameState } from "@convex/gre/state";
import {
    BRAZEN_BORROWER,
    CREATURES_ONLY,
    INSTANTS_AND_SORCERIES,
    NONCREATURE_MORPH,
    board,
    withDefs,
} from "@convex/gre/__tests__/libraryTopCastFilter.fixture";
import { affordableAltCostsForCard } from "../card-utils";
import type { CardInstance, Player } from "~/types/game";

const PETTY_THEFT = adventureCastAltCostId(BRAZEN_BORROWER);

/** The picker's inputs exactly as the client holds them. */
function picker(state: GameState) {
    const view = projectPublicState(state, 1, "p1");
    const top = view.players.find((p) => p.id === "p1")!.library.known[0]!
        .card as unknown as CardInstance & {
        printedCostCastUnavailable?: true;
    };
    const rows = affordableAltCostsForCard(
        top,
        "p1",
        view.players as unknown as Player[],
        view.activePlayerId
    ).map((alt) => alt.id);
    return { rows, printed: top.printedCostCastUnavailable !== true };
}

describe("CR 601.3e — the library-top picker offers only licensed announcements (issue #7526)", () => {
    it("instant-and-sorcery grant: Petty Theft only, no printed row", () => {
        withDefs(() => {
            expect(
                picker(board([INSTANTS_AND_SORCERIES.id], BRAZEN_BORROWER.id))
            ).toEqual({ rows: [PETTY_THEFT], printed: false });
        });
    });

    it("creature grant: the printed row only, no Petty Theft", () => {
        withDefs(() => {
            expect(
                picker(board([CREATURES_ONLY.id], BRAZEN_BORROWER.id))
            ).toEqual({ rows: [], printed: true });
        });
    });

    it("creature grant over a noncreature morph card: the face-down row only", () => {
        withDefs(() => {
            expect(
                picker(board([CREATURES_ONLY.id], NONCREATURE_MORPH.id))
            ).toEqual({ rows: [MORPH_CAST_ALT_COST_ID], printed: false });
        });
    });
});
