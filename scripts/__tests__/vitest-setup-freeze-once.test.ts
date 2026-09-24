// Issue #4484: the setup file runs per test file, the catalogue walk once per
// worker. Two files with the same assertion: any worker that runs both sees 1.
import { expect, test } from "vitest";
import { getAllCards } from "../../convex/cards/catalogue";
import {
    catalogueFreezeWalks,
    freezeCatalogueOnce,
} from "../../vitest.freeze-catalogue";

test("the setup walked the catalogue exactly once in this worker", () => {
    expect(catalogueFreezeWalks()).toBe(1);
});

test("a repeated freezeCatalogueOnce() call does not walk again", () => {
    freezeCatalogueOnce();
    freezeCatalogueOnce();
    expect(catalogueFreezeWalks()).toBe(1);
});

test("definitions are frozen before the first test", () => {
    expect(Object.isFrozen(getAllCards()[0])).toBe(true);
});
