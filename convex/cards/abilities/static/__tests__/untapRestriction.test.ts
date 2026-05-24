// Unit tests for the `untapRestriction` factory (CR 502.1).
//
// Pure-fixture tests around the factory's output shape — the discriminated
// `kind`, defaults for `maxUntap` / `scope`, and filter pass-through. The
// dispatcher behavior (auto-resolve vs prompt) is covered by the GRE-level
// scenario tests in `convex/gre/__tests__/untap-restriction.test.ts` and the
// card-level end-to-end coverage in `convex/cards/sets/__tests__/lea.test.ts`
// (Winter Orb).

import { describe, expect, it } from "vitest";
import { untapRestriction } from "../untapRestriction";

describe("untapRestriction factory", () => {
    it("tags the discriminated union with kind: 'untap-restriction'", () => {
        const effect = untapRestriction({
            id: "winter-orb-cap",
            oracleText: "Players can't untap more than one land.",
            filter: { types: "Land" },
            maxUntap: 1,
        });
        expect(effect.kind).toBe("untap-restriction");
        expect(effect.id).toBe("winter-orb-cap");
    });

    it("defaults maxUntap to 0 — Stasis-style hard skip", () => {
        const effect = untapRestriction({
            id: "stasis-cap",
            oracleText: "Players skip their untap steps.",
            filter: {},
        });
        expect(effect.maxUntap).toBe(0);
    });

    it("defaults scope to 'each-player' so the cap binds regardless of the source's controller", () => {
        const effect = untapRestriction({
            id: "winter-orb-cap",
            oracleText: "Players can't untap more than one land.",
            filter: { types: "Land" },
            maxUntap: 1,
        });
        expect(effect.scope).toBe("each-player");
    });

    it("passes the filter through unmodified — multi-field filter survives", () => {
        const filter = {
            types: "Creature" as const,
            powerAtLeast: 3,
            controllerRelation: "any" as const,
        };
        const effect = untapRestriction({
            id: "meekstone-cap",
            oracleText:
                "Creatures with power 3 or greater don't untap during their controllers' untap steps.",
            filter,
            maxUntap: 0,
        });
        expect(effect.filter).toBe(filter);
    });

    it("preserves oracleText for surfacing in the pending-choice prompt", () => {
        const effect = untapRestriction({
            id: "winter-orb-cap",
            oracleText:
                "Players can't untap more than one land during their untap steps.",
            filter: { types: "Land" },
            maxUntap: 1,
        });
        expect(effect.oracleText).toBe(
            "Players can't untap more than one land during their untap steps."
        );
    });
});
