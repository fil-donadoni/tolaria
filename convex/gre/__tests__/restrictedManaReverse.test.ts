// CR 106.4 / 601.3 — `reverseRestrictedManaFromPool` is the total inverse of
// `addRestrictedManaToPool`: it addresses the same unit, including the
// instance-keyed (`castableCardId`) bucket.

import { describe, expect, it } from "vitest";
import { makePlayer } from "../../cards/__tests__/setup.helper";
import {
    addRestrictedManaToPool,
    reverseRestrictedManaFromPool,
} from "../state";

describe("reverseRestrictedManaFromPool round trip (CR 106.4)", () => {
    it("undoes an instance-keyed deposit and leaves the type-keyed one", () => {
        const p = makePlayer("p1");
        addRestrictedManaToPool(p, "C", 1, undefined);
        addRestrictedManaToPool(p, "C", 2, undefined, "exiled-card");

        reverseRestrictedManaFromPool(
            p,
            "C",
            2,
            undefined,
            undefined,
            "exiled-card"
        );

        expect(p.restrictedMana).toEqual([{ color: "C", amount: 1 }]);
    });

    it("a reversal naming no card never touches an instance-keyed unit", () => {
        const p = makePlayer("p1");
        addRestrictedManaToPool(p, "C", 2, undefined, "exiled-card");

        reverseRestrictedManaFromPool(p, "C", 2, undefined);

        expect(p.restrictedMana).toEqual([
            { color: "C", amount: 2, castableCardId: "exiled-card" },
        ]);
    });
});
