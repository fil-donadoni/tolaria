// A kept standing resource through the REAL search (issue #8294): each position
// the Bot used to spend the resource in, on its declared budget and seeds. The
// unit readings are in `standing-resource.bot.test.ts`; this file is what proves
// the search filters and the evaluation term move the pick.
//
// Cards are FIXTURES; nothing under test reads a card name.
import { describe, expect, it } from "vitest";
import { findBladeScenario } from "../blade/registry";
import { runBladeScenario } from "../blade/runner";

const TIMEOUT_MS = 300000;

describe("a standing resource stays kept through the search", () => {
    for (const label of [
        "standing resource: Umezawa's Jitte keeps its counter when the combat is already won",
        "standing resource: leaves the Serra Angel uncrewed",
        "standing resource: Liliana of the Veil keeps the Serra Angel and her loyalty",
        "standing resource: Tendrils of Agony waits for the rituals",
    ]) {
        it(
            label,
            () => {
                const result = runBladeScenario(findBladeScenario(label)!);
                expect(result.ok, result.failureMessage).toBe(true);
            },
            TIMEOUT_MS
        );
    }
});
