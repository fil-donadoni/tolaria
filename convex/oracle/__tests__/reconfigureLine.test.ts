// Reconfigure: the keyword line that emits `attach` and `unattach`
// (CR 702.151, issue #5185).
//
//  1. GOLDEN — a real corpus card compiled whole: the coloured-cost form here,
//     the generic-cost form in `GOLDEN_FIXTURES` (Lizard Blades).
//  2. REFUSALS — the printed non-mana cost (Razorfield Ripper) and the costs
//     the payment path cannot pay stay refused.
//  3. BEHAVIOUR — the compiled JSON, run through the engine: both activated
//     abilities and the CR 702.151b `type-remove` descriptor.
import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    resolveActivated,
} from "../../cards/__tests__/setup.helper";
import { getCardByName } from "../../cards";
import { withTemporaryDefinition } from "../../cards/registry";
import type { CardDefinition } from "../../cards/types";
import { activationPreconditionViolation } from "../../gre/activationPrecondition";
import { applySourceDirectives, getLegalTargets } from "../../gre/rules";
import { compileCard } from "../compile";
import { canonicaliseShorthands, sortKeys } from "../gates";
import { routeLine } from "../grammar/router";
import { oracleCard, parseContext } from "./oracle.fixture";

const REMINDER = (cost: string) =>
    `(${cost}: Attach to target creature you control; or unattach from a creature. Reconfigure only as a sorcery. While attached, this isn't a creature.)`;

const RABBIT_BATTERY_TEXT = `Haste\nEquipped creature gets +1/+1 and has haste.\nReconfigure {R} ${REMINDER("{R}")}`;

const rabbitBattery = oracleCard({
    name: "Rabbit Battery",
    manaCost: "{R}",
    typeLine: "Artifact Creature — Equipment Rabbit",
    oracleText: RABBIT_BATTERY_TEXT,
    power: "1",
    toughness: "1",
});

function compiled(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed") {
        throw new Error(`${card.name}: ${JSON.stringify(outcome)}`);
    }
    return outcome.definition;
}

function withCompiled<T>(fn: (id: string) => T): T {
    const id = "test-5185-rabbit-battery";
    const definition = {
        ...compiled(rabbitBattery),
        id,
        rarity: "common",
    } as unknown as CardDefinition;
    return withTemporaryDefinition(definition, () => fn(id));
}

const ATTACH = "rabbit-battery-reconfigure-attach";
const UNATTACH = "rabbit-battery-reconfigure-unattach";

function board(id: string, attachedTo?: string) {
    const rabbit = makeInstance(id, {
        id: "rabbit",
        controllerId: "p1",
        ownerId: "p1",
        ...(attachedTo !== undefined ? { attachedTo } : {}),
    });
    const bears = (instanceId: string, owner: string) =>
        makeInstance(getCardByName("Grizzly Bears").id, {
            id: instanceId,
            controllerId: owner,
            ownerId: owner,
        });
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: [
                    rabbit,
                    bears("host", "p1"),
                    bears("other", "p1"),
                ],
            }),
            makePlayer("p2", { battlefield: [bears("theirs", "p2")] }),
        ],
    });
}

describe("Reconfigure [cost] (CR 702.151a)", () => {
    it("golden: Rabbit Battery compiles whole, both abilities and the type removal", () => {
        const expected = {
            name: "Rabbit Battery",
            types: ["Artifact", "Creature"],
            subtypes: ["Equipment", "Rabbit"],
            manaCost: { R: 1 },
            power: 1,
            toughness: 1,
            oracleText: RABBIT_BATTERY_TEXT,
            staticAbilities: ["haste"],
            activatedAbilities: [
                {
                    id: ATTACH,
                    oracleText: "Reconfigure {R}",
                    cost: { mana: { R: 1 } },
                    sorcerySpeedOnly: true,
                    targetRequirement: {
                        type: "Creature",
                        count: 1,
                        controller: "you",
                        excludeSource: true,
                    },
                    useStack: true,
                    effects: [{ op: "attach", target: { target: 0 } }],
                },
                {
                    id: UNATTACH,
                    oracleText:
                        "{R}: Unattach this permanent. Activate only if this permanent is attached to a creature and only as a sorcery.",
                    cost: { mana: { R: 1 } },
                    sorcerySpeedOnly: true,
                    activatableOnlyWhileAttached: true,
                    useStack: true,
                    effects: [{ op: "unattach" }],
                },
            ],
            compiledStaticEffects: [
                { kind: "pt-buff", appliesTo: "host", power: 1, toughness: 1 },
                { kind: "keyword-grant", appliesTo: "host", keyword: "haste" },
                {
                    kind: "type-remove",
                    appliesTo: "self-while-attached",
                    types: ["Creature"],
                },
            ],
        };
        expect(
            sortKeys(canonicaliseShorthands(compiled(rabbitBattery)))
        ).toEqual(sortKeys(canonicaliseShorthands(expected)));
    });

    it.each([
        // Razorfield Ripper's printed line: a non-mana alternative.
        ["a non-mana cost", "Reconfigure—Pay {2} or {E}{E}{E}."],
        ["a variable cost", "Reconfigure {X}"],
        ["a hybrid cost", "Reconfigure {W/U}"],
        ["a Phyrexian cost", "Reconfigure {R/P}"],
    ])("refuses %s", (_label, line) => {
        expect(routeLine(line, parseContext(rabbitBattery)).ok).toBe(false);
    });

    it("refuses the line on a card that is not an Equipment (CR 301.5c)", () => {
        const card = oracleCard({
            name: "Rabbit Battery",
            manaCost: "{R}",
            typeLine: "Artifact Creature — Rabbit",
            oracleText: `Reconfigure {R} ${REMINDER("{R}")}`,
            power: "1",
            toughness: "1",
        });
        expect(compileCard(card).state).toBe("unparsed");
    });
});

describe("the compiled abilities in the engine (CR 702.151a/b)", () => {
    it("attach makes it stop being a creature; unattach restores the type (CR 702.151b)", () => {
        withCompiled((id) => {
            const state = board(id);
            const rabbit = () => state.players[0].battlefield[0];
            expect(rabbit().types).toContain("Creature");
            resolveActivated(state, rabbit(), ATTACH, [
                { type: "permanent", id: "host" },
            ]);
            expect(rabbit().attachedTo).toBe("host");
            expect(rabbit().types).not.toContain("Creature");
            expect(rabbit().types).toContain("Artifact");

            resolveActivated(state, rabbit(), UNATTACH, []);
            expect(rabbit().attachedTo).toBeUndefined();
            expect(rabbit().types).toContain("Creature");
        });
    });

    it("attaching to the current host does nothing: no new timestamp (CR 701.3b)", () => {
        withCompiled((id) => {
            const state = board(id);
            const rabbit = () => state.players[0].battlefield[0];
            resolveActivated(state, rabbit(), ATTACH, [
                { type: "permanent", id: "host" },
            ]);
            const stamped = rabbit().staticSeq;
            expect(stamped).toBeDefined();
            resolveActivated(state, rabbit(), ATTACH, [
                { type: "permanent", id: "host" },
            ]);
            expect(rabbit().attachedTo).toBe("host");
            expect(rabbit().staticSeq).toBe(stamped);
        });
    });

    it("the unattach half is activatable only while attached (CR 702.151a)", () => {
        withCompiled((id) => {
            const ability = compiled(rabbitBattery).activatedAbilities!.find(
                (a) => a.id === UNATTACH
            )!;
            const violation = (attachedTo?: string) => {
                const state = board(id, attachedTo);
                return activationPreconditionViolation(
                    state,
                    state.players[0].battlefield[0],
                    ability as never
                );
            };
            expect(violation()).not.toBeNull();
            expect(violation("host")).toBeNull();
        });
    });

    it("targets another creature you control: never itself (CR 301.5c), the host stays legal (CR 701.3b)", () => {
        withCompiled((id) => {
            const state = board(id, "host");
            const ability = compiled(rabbitBattery).activatedAbilities!.find(
                (a) => a.id === ATTACH
            )!;
            const legal = getLegalTargets(
                state,
                applySourceDirectives(ability.targetRequirement!, "rabbit"),
                {
                    kind: "activated-ability",
                    instanceId: "rabbit",
                    controllerId: "p1",
                } as never,
                "p1"
            ).map((t) => (t as { id: string }).id);
            expect(legal).toContain("host");
            expect(legal).toContain("other");
            expect(legal).not.toContain("rabbit");
            expect(legal).not.toContain("theirs");
        });
    });
});
