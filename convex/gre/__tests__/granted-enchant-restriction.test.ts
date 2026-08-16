// CR 303.4 — "What an Aura can be attached to is defined by its enchant
// keyword ability (see rule 702.5)." An object can GAIN that ability at
// runtime: a permanent already on the battlefield becomes an Aura ("it becomes
// an Aura with enchant creature"). Before issue #2471 the restriction was read
// only from the card DEFINITION's cast-time `targetRequirement`, in two
// byte-identical copies (sba.ts + state.ts), so such a permanent had no
// readable restriction and CR 704.5m ("If an Aura is attached to an illegal
// object or player … that Aura is put into its owner's graveyard") binned it
// the instant it attached.
//
// These tests cover the single predicate that replaced both copies —
// `resolveEnchantRestriction` (instance-granted first, printed second) — at
// every consumer: the CR 303.4c/704.5m attachment SBA, the CR 303.4f non-cast
// candidate scan, the wire projection, and the runtime grant path itself
// (`addSubtype` + `enchantRestriction`, end to end through the interpreter).
import { describe, expect, it } from "vitest";
import {
    auraEnchantsPlayers,
    hostMatchesEnchantRestriction,
    putReanimatedSetOnBattlefield,
    resolveEnchantRestriction,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../state";
import { checkAuraAttachmentSBA } from "../sba";
import { projectPublicState } from "../../gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { grizzlyBears, mountain, controlMagic } from "../../cards/sets/lea";
import { registerTokenDefinition } from "../../cards";
import { enteredTrigger } from "../../cards/abilities/triggers/enteredTrigger";
import type { CardDefinition } from "../../cards/types";

// The Necromancy shape (PRD #1975), as a test-only definition: an enchantment
// that is NOT printed as an Aura and has NO cast-time `targetRequirement`, and
// whose ETB trigger turns it into one and attaches it. Necromancy itself is
// out of scope here (#2392, blocked on all three slices of #1975) — what this
// slice must prove is the ENGINE shape, which no shipped card exercises:
// `addSubtype`'s only shipped call sites add a CREATURE subtype to another
// creature. `registerTokenDefinition` is the production seam that inserts a
// synthetic definition into the same registry `getDefinition`/
// `tryGetDefinition` read from (idempotent, and safe under this suite's
// `isolate: false` config — see the same pattern in aura-host-choice.test.ts).
const TEST_BECOMES_AURA_ID = "test-only-becomes-aura-enchantment";
const testBecomesAuraDef: CardDefinition = {
    id: TEST_BECOMES_AURA_ID,
    rarity: "rare",
    name: "Test Becomes-Aura Enchantment",
    oracleText:
        "When this enchantment enters, it becomes an Aura with enchant creature. Attach it to target creature.",
    manaCost: { B: 2 },
    types: ["Enchantment"],
    triggeredAbilities: [
        enteredTrigger({
            id: "test-becomes-aura-etb",
            oracleText:
                "When this enchantment enters, it becomes an Aura with enchant creature. Attach it to target creature.",
            scope: "self",
            targetRequirement: { type: "Creature", count: 1 },
            effects: [
                {
                    op: "addSubtype",
                    target: { ref: "$source" },
                    subtype: "Aura",
                    // CR 303.4 — the enchant clause is granted with the
                    // subtype, and names the specific object this permanent
                    // will enchant (Necromancy's "enchant creature put onto
                    // the battlefield with Necromancy").
                    enchantRestriction: {
                        types: ["Creature"],
                        host: { target: 0 },
                    },
                },
                { op: "attach", target: { target: 0 } },
            ],
        }),
    ],
};
registerTokenDefinition(testBecomesAuraDef);

/** p1 board: the becomes-Aura enchantment + `creatures` Grizzly Bears + an
 *  optional Mountain (never a legal creature host). */
function board(opts: { creatureIds: string[]; withLand?: boolean }): {
    state: GameState;
    enchantment: CardInstanceState;
} {
    const enchantment = makeInstance(TEST_BECOMES_AURA_ID, {
        id: "ench-1",
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
    });
    const battlefield: CardInstanceState[] = [
        enchantment,
        ...opts.creatureIds.map((id) =>
            makeInstance(grizzlyBears.id, {
                id,
                controllerId: "p1",
                ownerId: "p1",
                zone: "battlefield",
            })
        ),
    ];
    if (opts.withLand) {
        battlefield.push(
            makeInstance(mountain.id, {
                id: "land-1",
                controllerId: "p1",
                ownerId: "p1",
                zone: "battlefield",
            })
        );
    }
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield }),
            makePlayer("p2", { battlefield: [] }),
        ],
        activePlayerId: "p1",
    });
    return { state, enchantment };
}

/** Puts the ETB trigger on the stack with `targetId` announced and resolves
 *  it — the real trigger-resolution path (CR 603.6a), not a hand-applied
 *  effect. Mirrors the Deceiver Exarch pattern (nph/__tests__/blue.test.ts). */
function resolveEtb(
    state: GameState,
    enchantment: CardInstanceState,
    targetId: string
): void {
    state.stack.push({
        ...enchantment,
        zone: "stack",
        castById: "p1",
        triggeredAbilityId: "test-becomes-aura-etb",
        triggerSourceId: enchantment.id,
        triggerEvent: {
            type: "PERMANENT_ENTERED",
            instanceId: enchantment.id,
            controllerId: "p1",
            types: ["Enchantment"],
        } as StackItem["triggerEvent"],
        targets: [{ type: "permanent", id: targetId }],
    } as StackItem);
    resolveTopOfStack(state);
}

function find(state: GameState, id: string): CardInstanceState | undefined {
    return state.players.flatMap((p) => p.battlefield).find((c) => c.id === id);
}

describe("runtime-granted enchant restriction (CR 303.4)", () => {
    it("addSubtype + enchantRestriction turns the permanent into an Aura that SURVIVES the SBA sweep", () => {
        const { state, enchantment } = board({ creatureIds: ["bear-1"] });

        resolveEtb(state, enchantment, "bear-1");

        const aura = find(state, "ench-1")!;
        expect(aura.subtypes).toContain("Aura");
        expect(aura.attachedTo).toBe("bear-1");
        // CR 303.4 — the granted clause is on the INSTANCE, with the specific
        // object resolved at grant time.
        expect(aura.grantedEnchantRestriction).toEqual({
            types: ["Creature"],
            hostId: "bear-1",
        });

        // CR 303.4c / 704.5m — the sweep must find the attachment legal. This
        // is the whole bug: with the restriction read off the definition only,
        // the enchantment has none and is binned right here.
        expect(checkAuraAttachmentSBA(state)).toBe(false);
        expect(find(state, "ench-1")).toBeDefined();
        expect(state.players[0].graveyard).toHaveLength(0);
    });

    it("CR 704.5m — binned when the host stops matching the granted TYPE clause", () => {
        const { state, enchantment } = board({ creatureIds: ["bear-1"] });
        resolveEtb(state, enchantment, "bear-1");

        // The host stops being a creature (CR 205.1a — a type-changing effect;
        // modelled directly on the instance, which is what the layer system
        // writes).
        find(state, "bear-1")!.types = ["Artifact"];

        expect(checkAuraAttachmentSBA(state)).toBe(true);
        expect(find(state, "ench-1")).toBeUndefined();
        expect(state.players[0].graveyard.map((c) => c.id)).toContain("ench-1");
    });

    it("CR 303.4 — the specific-object clause: another creature is NOT a legal host", () => {
        const { state, enchantment } = board({
            creatureIds: ["bear-1", "bear-2"],
        });
        resolveEtb(state, enchantment, "bear-1");
        const aura = find(state, "ench-1")!;

        // Both bears satisfy the TYPE clause; only the named one satisfies the
        // whole restriction.
        expect(
            hostMatchesEnchantRestriction(find(state, "bear-1")!, aura)
        ).toBe(true);
        expect(
            hostMatchesEnchantRestriction(find(state, "bear-2")!, aura)
        ).toBe(false);

        // Re-point the attachment at the other creature: still an Aura, still
        // attached to a creature, still illegal.
        aura.attachedTo = "bear-2";
        expect(checkAuraAttachmentSBA(state)).toBe(true);
        expect(find(state, "ench-1")).toBeUndefined();
    });

    it("CR 704.5m — binned when the host leaves the battlefield", () => {
        const { state, enchantment } = board({ creatureIds: ["bear-1"] });
        resolveEtb(state, enchantment, "bear-1");

        const p1 = state.players[0];
        p1.battlefield = p1.battlefield.filter((c) => c.id !== "bear-1");

        expect(checkAuraAttachmentSBA(state)).toBe(true);
        expect(find(state, "ench-1")).toBeUndefined();
        expect(p1.graveyard.map((c) => c.id)).toContain("ench-1");
    });

    it("a granted restriction never survives a zone change (CR 400.7)", () => {
        const { state, enchantment } = board({ creatureIds: ["bear-1"] });
        resolveEtb(state, enchantment, "bear-1");
        expect(find(state, "ench-1")!.grantedEnchantRestriction).toBeDefined();

        // Host leaves → the Aura is binned by the SBA, and the object that
        // lands in the graveyard is a NEW object with no memory of what it
        // once enchanted.
        const p1 = state.players[0];
        p1.battlefield = p1.battlefield.filter((c) => c.id !== "bear-1");
        checkAuraAttachmentSBA(state);

        const binned = p1.graveyard.find((c) => c.id === "ench-1")!;
        expect(binned.grantedEnchantRestriction).toBeUndefined();
    });
});

describe("one predicate, both consumers (CR 303.4c/704.5m and CR 303.4f)", () => {
    it("the CR 303.4f non-cast candidate scan honours a granted restriction", () => {
        // The candidate scan (`findAllLegalAuraHosts`, state.ts) reads the
        // aura instance BEFORE it is staged onto the battlefield. Its copy of
        // the type-match loop was independent of the SBA's until #2471; this
        // asserts the collapsed predicate reaches it — a restriction naming
        // ONE object narrows the offered set to that object, so the scan
        // auto-attaches instead of prompting between two legal creatures.
        const aura = makeInstance(TEST_BECOMES_AURA_ID, {
            id: "aura-1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
            subtypes: ["Aura"],
            grantedEnchantRestriction: {
                types: ["Creature"],
                hostId: "bear-2",
            },
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    graveyard: [aura],
                    battlefield: [
                        makeInstance(grizzlyBears.id, {
                            id: "bear-1",
                            controllerId: "p1",
                            ownerId: "p1",
                        }),
                        makeInstance(grizzlyBears.id, {
                            id: "bear-2",
                            controllerId: "p1",
                            ownerId: "p1",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        state.players[0].graveyard = [];

        const entered = putReanimatedSetOnBattlefield(state, [
            { card: aura, controllerId: "p1" },
        ]);

        // Exactly one candidate → auto-attach, no prompt (ADR 0003).
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(entered).toContain("aura-1");
        expect(find(state, "aura-1")!.attachedTo).toBe("bear-2");
    });

    it("resolveEnchantRestriction: instance-granted wins over printed", () => {
        // Control Magic is PRINTED "enchant creature"; a granted clause
        // replaces it rather than adding to it.
        const printed = makeInstance(controlMagic.id, {
            id: "cm-1",
            controllerId: "p1",
            ownerId: "p1",
        });
        expect(resolveEnchantRestriction(printed)).toEqual({
            types: ["Creature"],
            players: false,
        });

        const granted = makeInstance(controlMagic.id, {
            id: "cm-2",
            controllerId: "p1",
            ownerId: "p1",
            grantedEnchantRestriction: { types: ["Artifact"] },
        });
        expect(resolveEnchantRestriction(granted)).toEqual({
            types: ["Artifact"],
        });
        const artifactHost = makeInstance(mountain.id, {
            id: "art-1",
            controllerId: "p1",
            ownerId: "p1",
        });
        artifactHost.types = ["Artifact"];
        expect(hostMatchesEnchantRestriction(artifactHost, granted)).toBe(true);
        expect(hostMatchesEnchantRestriction(artifactHost, printed)).toBe(
            false
        );
    });

    it("an object with neither a granted nor a printed restriction has no legal host", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear-1",
            controllerId: "p1",
            ownerId: "p1",
        });
        // Grizzly Bears has no `targetRequirement` at all.
        expect(resolveEnchantRestriction(bear)).toBeNull();
        expect(hostMatchesEnchantRestriction(bear, bear)).toBe(false);
        expect(auraEnchantsPlayers(bear)).toBe(false);
    });
});

describe("printed Auras are unchanged (regression)", () => {
    function printedAuraBoard(hostTypes: "creature" | "land"): GameState {
        const host =
            hostTypes === "creature"
                ? makeInstance(grizzlyBears.id, {
                      id: "host",
                      controllerId: "p2",
                      ownerId: "p2",
                  })
                : makeInstance(mountain.id, {
                      id: "host",
                      controllerId: "p2",
                      ownerId: "p2",
                  });
        const aura = makeInstance(controlMagic.id, {
            id: "cm-1",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "host",
        });
        return makeState({
            players: [
                makePlayer("p1", { battlefield: [aura] }),
                makePlayer("p2", { battlefield: [host] }),
            ],
        });
    }

    it("Control Magic on a creature survives the sweep", () => {
        const state = printedAuraBoard("creature");
        expect(checkAuraAttachmentSBA(state)).toBe(false);
        expect(find(state, "cm-1")).toBeDefined();
    });

    it("Control Magic on a non-creature is binned (CR 704.5m)", () => {
        const state = printedAuraBoard("land");
        expect(checkAuraAttachmentSBA(state)).toBe(true);
        expect(find(state, "cm-1")).toBeUndefined();
    });
});

describe("wire format (projectPublicState)", () => {
    it("the granted restriction crosses the wire and the shared predicate agrees on the projected board", () => {
        const { state, enchantment } = board({ creatureIds: ["bear-1"] });
        resolveEtb(state, enchantment, "bear-1");

        const projected = projectPublicState(state, 1, "p1");
        const slimAura = projected.players[0].battlefield.find(
            (c) => c.id === "ench-1"
        )!;
        const slimHost = projected.players[0].battlefield.find(
            (c) => c.id === "bear-1"
        )!;

        // The projection strips `card.card` to `{ id }`; the restriction must
        // NOT be one of the fields it drops — the client-side Brain runs the
        // same SBA over this state, and a dropped clause bins the Aura there.
        expect(slimAura.grantedEnchantRestriction).toEqual({
            types: ["Creature"],
            hostId: "bear-1",
        });
        expect(
            hostMatchesEnchantRestriction(
                slimHost as CardInstanceState,
                slimAura as CardInstanceState
            )
        ).toBe(true);
    });
});
