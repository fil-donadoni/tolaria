// ISD (Innistrad) — red behavior tests (ADR 0043 colour split).
//
// Past in Flames: the mass grant of flashback (CR 702.34a) — every instant and
// sorcery in the controller's graveyard becomes castable for its own mana cost
// until end of turn (CR 514.2), a creature card does not.
import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup.helper";
import { resolveTopOfStack } from "../../../../gre/state";
import { projectPublicState } from "../../../../gameProjections";
import { getDefinition } from "../../../index";
import { preloadDefinitions } from "../../../registry";
import { resolveCardExport } from "../../../defineCard";
import { pastInFlames as pastInFlamesExport } from "../red.cards";

// The PR head carries no `definition-index.json` row for the card (ADR 0157:
// derived state is regenerated post-merge), so register the module's own
// definition rather than depend on the lazy catalogue source.
preloadDefinitions([resolveCardExport(pastInFlamesExport)!]);
const pastInFlames = getDefinition("23af6033-4930-48e4-821d-14cbbe1754b4");
const firebolt = getDefinition("d5e45005-dd81-4d80-b043-02f719aca929");
const grizzlyBears = getDefinition("ce2d603a-3231-4a8c-bf39-1617586ea870");

describe("Past in Flames (mass flashback grant, CR 702.34a)", () => {
    it("grants each instant/sorcery in your graveyard flashback at its own cost, tagged on the wire", () => {
        const inGraveyard = (defId: string, id: string, owner: string) =>
            makeInstance(defId, {
                id,
                zone: "graveyard",
                controllerId: owner,
                ownerId: owner,
            });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    graveyard: [
                        inGraveyard(firebolt.id, "gy-firebolt", "p1"),
                        inGraveyard(grizzlyBears.id, "gy-bear", "p1"),
                    ],
                }),
                makePlayer("p2", {
                    graveyard: [inGraveyard(firebolt.id, "gy-theirs", "p2")],
                }),
            ],
        });
        pushSpell(state, pastInFlames.id, "p1");
        expect(resolveTopOfStack(state)).not.toBeNull();

        const mine = state.players[0].graveyard;
        expect(
            mine.find((c) => c.id === "gy-firebolt")!.grantedFlashback
        ).toEqual({ R: 1 });
        expect(
            mine.find((c) => c.id === "gy-bear")!.grantedFlashback
        ).toBeUndefined();
        expect(
            state.players[1].graveyard.find((c) => c.id === "gy-theirs")!
                .grantedFlashback
        ).toBeUndefined();

        const projected = projectPublicState(state, 1, "p1");
        const wire = (id: string) =>
            projected.players[0].graveyard.find((c) => c.id === id)!;
        expect(wire("gy-firebolt").castKind).toBe("flashback");
        expect(wire("gy-bear").castKind).toBeUndefined();
    });
});
