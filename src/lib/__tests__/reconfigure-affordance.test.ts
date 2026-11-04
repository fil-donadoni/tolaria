// CR 702.151a (issue #5185) — the client offers Reconfigure's unattach half
// only while the permanent is attached: `getStackAbilities` reads the
// declarative `activatableOnlyWhileAttached` through the engine's shared
// `activationPreconditionViolation`.
import { describe, expect, it } from "vitest";
import { getCardByName } from "@convex/cards";
import type { CardInstance } from "../../types/game";
import { getStackAbilities } from "../card-utils";

const SASH = getCardByName("Lion Sash");
const UNATTACH = "lion-sash-reconfigure-unattach";

function sash(attachedTo?: string): CardInstance {
    return {
        id: "sash",
        card: { id: SASH.id },
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
        isTapped: false,
        isSummoningSick: false,
        types: SASH.types,
        subtypes: SASH.subtypes ?? [],
        ...(attachedTo !== undefined ? { attachedTo } : {}),
    };
}

const offered = (card: CardInstance) =>
    getStackAbilities(card, "PRECOMBAT_MAIN").map((a) => a.id);

describe("Reconfigure's client affordance (CR 702.151a)", () => {
    it("hides the unattach half while the permanent is unattached", () => {
        expect(offered(sash())).not.toContain(UNATTACH);
    });

    it("offers the unattach half while it is attached", () => {
        expect(offered(sash("host"))).toContain(UNATTACH);
    });
});
