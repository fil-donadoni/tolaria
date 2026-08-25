// CR 613.7 / 611.2c (issue #1750, part a) — `SpellContext.addSubtype`
// (a resolving-ability, one-shot INDEFINITE subtype-add) must stamp a real
// layer timestamp, the same way every other layer-4 writer in
// `applySourceStaticEffects` does. Before this fix it wrote no `seq` at all,
// and `composeMaterializedSubtypes` (`gre/constants.ts`) reads a missing
// `seq` as `0` — the earliest possible value — so a genuinely LATER add lost
// to any live `subtype-set`, of any age, on the next recompose.
import { describe, it, expect } from "vitest";
import {
    applySourceStaticEffects,
    buildSpellContext,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../state";
import { composeMaterializedSubtypes } from "../constants";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup";
import { grizzlyBears } from "../../cards/sets/lea/green";
import { bloodMoon } from "../../cards/sets/drk/red";
import { tundra } from "../../cards/sets/lea/colorless";

function makeBoard(land: CardInstanceState, extra: CardInstanceState[] = []) {
    return makeState({
        players: [
            makePlayer("p1", { battlefield: [land, ...extra] }),
            makePlayer("p2"),
        ],
    });
}

function ctxFor(state: GameState) {
    const item: StackItem = pushSpell(state, grizzlyBears.id, "p1");
    return buildSpellContext(state, item);
}

describe("SpellContext.addSubtype stamps a real CR 613.7 timestamp (issue #1750 part a)", () => {
    it("a later indefinite add survives an earlier live subtype-set's recompose", () => {
        const land = makeInstance(tundra.id, { id: "land-add-1" });
        const moon = makeInstance(bloodMoon.id, { id: "moon-add-1" });
        const state = makeBoard(land, [moon]);
        const ctx = ctxFor(state);

        // Blood Moon applies FIRST — seq 1, subtype-set to ["Mountain"].
        applySourceStaticEffects(state, moon);
        expect(land.subtypes).toEqual(["Mountain"]);
        expect(land.grantedSubtypes).toEqual([
            { subtypes: ["Mountain"], sourceId: "moon-add-1", seq: 1 },
        ]);

        // A resolving ability's one-shot indefinite add applies SECOND
        // (Ley Line-style "this land is a Forest in addition to its other
        // types" resolving effect, CR 611.2c) — must mint a seq LATER than
        // Blood Moon's.
        ctx.addSubtype({ type: "permanent", id: "land-add-1" }, "Forest");
        expect(land.grantedSubtypesAdd).toEqual([
            { subtype: "Forest", auraId: "indefinite", seq: 2 },
        ]);

        // The direct push in `addSubtype` makes it LOOK survived immediately…
        expect(land.subtypes).toEqual(["Mountain", "Forest"]);

        // …but the real proof is the NEXT recompose (any later layer-4 write
        // replays the WHOLE materialized record from `grantedSubtypes` +
        // `grantedSubtypesAdd`, ignoring the ad-hoc direct push). Unstamped,
        // this is exactly where issue #1750's bug showed: the add sorted as
        // seq 0, tied-loses to Blood Moon's seq 1, and vanished.
        const recomposed = composeMaterializedSubtypes(land);
        expect(recomposed).toEqual(["Mountain", "Forest"]);
    });

    it("an add still loses to a subtype-set that resolves AFTER it (CR 613.7 ordering, not blanket survival)", () => {
        // The converse check: the fix must not make every add unconditionally
        // win — only a genuinely LATER one. An add BEFORE a live set is still
        // correctly erased by the set's wholesale land-type replace.
        const land = makeInstance(tundra.id, { id: "land-add-2" });
        const moon = makeInstance(bloodMoon.id, { id: "moon-add-2" });
        const state = makeBoard(land, [moon]);
        const ctx = ctxFor(state);

        ctx.addSubtype({ type: "permanent", id: "land-add-2" }, "Forest");
        applySourceStaticEffects(state, moon);

        const recomposed = composeMaterializedSubtypes(land);
        expect(recomposed).toEqual(["Mountain"]);
    });
});
