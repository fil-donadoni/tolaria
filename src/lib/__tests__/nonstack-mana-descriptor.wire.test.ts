// A `useStack: false` ability is a mana ability to the CLIENT only when it
// declares a mana descriptor (CR 605.1a) — `findClientManaAbility`
// (`src/lib/card-utils.ts`) recognises `manaProduced | manaChoices |
// getManaChoices | manaColorSource`, never an `effect`/`effects` body. A card
// declaring the body alone has no tap-for-mana affordance at all: the board
// does not read it as tappable, and on a permanent that ALSO has a stack
// ability the context menu lists only that stack ability.
//
// That is the shape Shelldock Isle shipped with (issue #1959): "{T}: Add {U}."
// with an `effect: (ctx) => ctx.addMana({ U: 1 })` closure and no descriptor —
// which a fixed-output tap ability never executes, since the mana is deposited
// structurally from `manaProduced`. The land tapped for nothing and only its
// {U},{T} hideaway-play ability was clickable.
//
// The catalogue-wide guard against a descriptor-less non-stack ability lives in
// `convex/cards/__tests__/manaAbility.catalogue.test.ts`; this is the CLIENT
// half of the same seam, driven through `projectPublicState` (a hand-built
// instance would mask a wire-dropped field).

import { describe, it, expect } from "vitest";
import {
    getActivatedManaColor,
    getActivatedManaMenuEntry,
    hasManaAbility,
} from "../card-utils";
import type { CardInstance } from "~/types/game";
import { projectPublicState } from "@convex/gameProjections";
import { getCardByName } from "@convex/cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup";

/** The named card on p1's battlefield, projected onto the wire and read back
 *  as the client reads it. */
function projectedPermanent(cardName: string): CardInstance {
    const instance = makeInstance(getCardByName(cardName).id, {
        id: "wire-source",
        controllerId: "p1",
        ownerId: "p1",
        isSummoningSick: false,
    });
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [instance] }),
            makePlayer("p2"),
        ],
    });
    const wire = projectPublicState(state, 1, "p1");
    return wire.players
        .flatMap((p) => p.battlefield)
        .find((c) => c.id === "wire-source") as unknown as CardInstance;
}

describe("non-stack mana ability visibility on the client (CR 605.1a)", () => {
    it("a land whose OTHER ability uses the stack still reads as a tappable mana source", () => {
        // Shelldock Isle: "{T}: Add {U}." next to "{U}, {T}: You may play the
        // exiled card …". Without the mana descriptor the second ability is the
        // only menu entry and the land is not tappable for mana at all.
        const card = projectedPermanent("Shelldock Isle");
        expect(hasManaAbility(card)).toBe(true);
        expect(getActivatedManaMenuEntry(card)).toEqual({
            id: "shelldock-isle-mana",
            oracleText: "{T}: Add {U}.",
        });
        // The board's coloured tap cue reads the same descriptor.
        expect(getActivatedManaColor(card)).toBe("U");
    });
});
