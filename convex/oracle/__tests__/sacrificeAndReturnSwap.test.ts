// The swap: "Choose target <type> a player controls and target <type> card in
// that player's graveyard. If both targets are still legal as this ability
// resolves, that player simultaneously sacrifices the <type> and returns the
// <type> card to the battlefield." (CR 701.21a, CR 608.2b, CR 400.7,
// issue #7206 — Goblin Welder).
//
// Two layers: the GOLDEN (the whole card compiles to exactly the definition the
// rule must produce — the second target group carrying the controller-bound
// graveyard directive) and REFUSALS (each neighbour form stays `unparsed`).

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { GOLDEN_FIXTURES } from "../grammar/fixtures";
import { oracleCard } from "./oracle.fixture";

const CHOOSE =
    "Choose target artifact a player controls and target artifact card in that player's graveyard.";
const SWAP =
    "If both targets are still legal as this ability resolves, that player simultaneously sacrifices the artifact and returns the artifact card to the battlefield.";

function welder(body: string) {
    return compileCard(
        oracleCard({
            name: "Goblin Welder",
            manaCost: "{R}",
            typeLine: "Creature — Goblin Artificer",
            power: "1",
            toughness: "1",
            oracleText: `{T}: ${body}`,
        })
    );
}

describe("sacrificeAndReturn swap — golden (CR 701.21a, CR 608.2b)", () => {
    it("Goblin Welder compiles to the fixtured definition", () => {
        const fixture = GOLDEN_FIXTURES.find(
            (f) => f.card.name === "Goblin Welder"
        )!;
        const outcome = compileCard(oracleCard(fixture.card));
        expect(outcome.state).not.toBe("unparsed");
        if (outcome.state === "unparsed") return;
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys(fixture.expected)
        );
    });

    it("binds the card group to the permanent's controller's graveyard", () => {
        const outcome = welder(`${CHOOSE} ${SWAP}`);
        if (outcome.state === "unparsed") throw new Error("unparsed");
        const ability = outcome.definition.activatedAbilities![0]!;
        expect(ability.effects).toEqual([
            {
                op: "sacrificeAndReturn",
                sacrificed: { target: 0 },
                returned: { target: 1 },
            },
        ]);
        expect(ability.additionalTargetRequirements).toEqual([
            {
                type: "Artifact",
                count: 1,
                zone: "graveyard",
                controller: "any",
                zoneOwnerOfPriorPermanentController: true,
            },
        ]);
    });
});

describe("sacrificeAndReturn swap — refusals (fail-closed)", () => {
    const refused = (body: string) =>
        expect(welder(body).state).toBe("unparsed");

    it("the announcement alone feeds no swap", () => refused(CHOOSE));
    it("the swap alone has no announced targets", () => refused(SWAP));
    it("a swap naming a different type than the announcement", () =>
        refused(
            `${CHOOSE} ${SWAP.replace("returns the artifact card", "returns the creature card")}`
        ));
    it("announcement halves naming different types", () =>
        refused(
            `${CHOOSE.replace("target artifact card", "target creature card")} ${SWAP}`
        ));
    it("the controller's own permanent only is not this form", () =>
        refused(
            `${CHOOSE.replace("a player controls", "you control")} ${SWAP}`
        ));
});
