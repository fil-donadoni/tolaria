// Compiled DAMAGE trigger heads reach the engine as REAL triggers
// (issue #4131, CR 120.3 / 303.4b / 603.2).
//
// The grammar tests (`oracle/__tests__/damageTriggerHeads.test.ts`) prove the
// Oracle text lowers to the right descriptor. They cannot prove the rebuilt
// ability FIRES on the right damage and reads the RIGHT number and player off
// the event, and those are the halves that fail silently: a host head that
// fires for every creature, a "that much" that reads 0, a "that opponent"
// that names the controller. So every test below compiles a real Oracle
// row, registers the result, and drives it through the ENGINE — real combat
// damage, the real trigger scan, the real stack, the real resolution.

import { describe, expect, it } from "vitest";
import { registerTokenDefinition } from "../../cards";
import { resolveCompiledTrigger } from "../../cards/compiledTriggers";
import type {
    CardDefinition,
    DamageDealtEvent,
    PermanentView,
    TriggerStateView,
} from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
    resolveTriggerOrder,
} from "../../cards/__tests__/setup";
import { compileCard } from "../../oracle/compile";
import { oracleCard } from "../../oracle/__tests__/fixtures";
import { applyAllCombatDamage } from "../phases";
import { resolveTopOfStack, type GameState } from "../state";

/** Compile a real Oracle row and register it as a playable definition. */
function register(
    id: string,
    card: ReturnType<typeof oracleCard>
): CardDefinition {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    const definition = {
        ...outcome.definition,
        id,
        rarity: "common" as const,
    } as CardDefinition;
    registerTokenDefinition(definition);
    return definition;
}

const AURA_TEXT = (lines: string) => `Enchant creature\n${lines}`;

const SOUL_LINK = register(
    "test-4131-soul-link",
    oracleCard({
        name: "Soul Link",
        manaCost: "{1}{W}{B}",
        typeLine: "Enchantment — Aura",
        oracleText: AURA_TEXT(
            "Whenever enchanted creature deals damage, you gain that much life.\nWhenever enchanted creature is dealt damage, you gain that much life."
        ),
        power: undefined,
        toughness: undefined,
    })
);

const ZEBRA_UNICORN = register(
    "test-4131-zebra-unicorn",
    oracleCard({
        name: "Zebra Unicorn",
        manaCost: "{2}{G}{W}",
        typeLine: "Creature — Unicorn",
        oracleText:
            "Whenever this creature deals damage, you gain that much life.",
        power: "2",
        toughness: "2",
    })
);

const CREATURE_HITTER = register(
    "test-4131-creature-hitter",
    oracleCard({
        name: "Test Hitter",
        manaCost: "{2}{G}",
        typeLine: "Creature — Beast",
        oracleText:
            "Whenever this creature deals damage to a creature, put a +1/+1 counter on this creature.",
        power: "2",
        toughness: "2",
    })
);

const HYPNOTIC_SPECTER = register(
    "test-4131-hypnotic-specter",
    oracleCard({
        name: "Hypnotic Specter",
        manaCost: "{1}{B}{B}",
        typeLine: "Creature — Specter",
        oracleText:
            "Whenever this creature deals damage to an opponent, that player discards a card at random.",
        power: "2",
        toughness: "2",
    })
);

const FUNGAL_SHAMBLER = register(
    "test-4131-fungal-shambler",
    oracleCard({
        name: "Fungal Shambler",
        manaCost: "{4}{B}{G}{U}",
        typeLine: "Creature — Fungus Beast",
        oracleText:
            "Whenever this creature deals damage to an opponent, you draw a card and that opponent discards a card.",
        power: "6",
        toughness: "4",
    })
);

const BEAR = "test-4131-bear";
registerTokenDefinition({
    id: BEAR,
    name: "Test Bear",
    rarity: "common",
    manaCost: { G: 1 },
    types: ["Creature"],
    subtypes: ["Bear"],
    power: 3,
    toughness: 5,
} satisfies CardDefinition);

const cardsIn = (n: number, owner: string) =>
    Array.from({ length: n }, (_, i) =>
        makeInstance(BEAR, {
            id: `${owner}-hand-${i}`,
            controllerId: owner,
            ownerId: owner,
            zone: "hand",
        })
    );

/** One combat: p1's `attacker` (optionally blocked by p2's `blocker`). */
function combat(opts: {
    attackerDef: string;
    aura?: boolean;
    blocked?: boolean;
    p2Hand?: number;
}): GameState {
    const attacker = makeInstance(opts.attackerDef, {
        id: "attacker",
        controllerId: "p1",
        ownerId: "p1",
        isAttacking: true,
    });
    const blocker = makeInstance(BEAR, {
        id: "blocker",
        controllerId: "p2",
        ownerId: "p2",
        isBlocking: opts.blocked === true,
    });
    const aura = makeInstance(SOUL_LINK.id, {
        id: "aura",
        controllerId: "p1",
        ownerId: "p1",
        attachedTo: "attacker",
    });
    return makeState({
        phase: "COMBAT_DAMAGE",
        activePlayerId: "p1",
        players: [
            makePlayer("p1", {
                life: 20,
                battlefield: opts.aura ? [attacker, aura] : [attacker],
            }),
            makePlayer("p2", {
                life: 20,
                battlefield: opts.blocked ? [blocker] : [],
                hand: cardsIn(opts.p2Hand ?? 0, "p2"),
            }),
        ],
        combat: {
            attackerIds: ["attacker"],
            confirmed: true,
            blockerAssignments: opts.blocked ? { blocker: ["attacker"] } : {},
            blockersConfirmed: true,
        },
        rngSeed: 1,
    });
}

/** Deal the combat damage; a blocked attacker assigns all of it to its blocker
 *  (CR 510.1c), which the caller states — the engine never guesses. */
function dealDamage(state: GameState, assignedToBlocker?: number): void {
    applyAllCombatDamage(
        state,
        assignedToBlocker === undefined
            ? {}
            : { attacker: { blocker: assignedToBlocker } }
    );
}

function resolveAll(state: GameState): void {
    // CR 603.3b — simultaneous triggers of one controller are ordered first.
    resolveTriggerOrder(state);
    let guard = 0;
    while (state.stack.length > 0 && guard++ < 10) resolveTopOfStack(state);
}

describe("'whenever this creature deals damage, you gain that much life' (CR 120.3)", () => {
    it("gains exactly the damage dealt — read off the event, not a constant", () => {
        const state = combat({ attackerDef: ZEBRA_UNICORN.id });
        dealDamage(state);
        expect(state.stack).toHaveLength(1);
        resolveAll(state);
        // The Unicorn is a 2/2: 2 damage to the opponent, 2 life for p1.
        expect(state.players[1]!.life).toBe(18);
        expect(state.players[0]!.life).toBe(22);
    });

    it("fires for damage dealt to a CREATURE too — the head names no recipient", () => {
        const state = combat({ attackerDef: ZEBRA_UNICORN.id, blocked: true });
        dealDamage(state, 2);
        resolveAll(state);
        expect(state.players[0]!.life).toBe(22);
    });
});

describe("Soul Link — enchanted creature deals / is dealt damage (CR 303.4b)", () => {
    it("gains life for the damage the host DEALS and the damage it is DEALT, each its own amount", () => {
        // The host is a 2/2 Unicorn blocked by a 3/5 Bear: it deals 2 and is
        // dealt 3 — two distinct amounts, so a "that much" reading the wrong
        // event's amount cannot pass by coincidence.
        const state = combat({
            attackerDef: ZEBRA_UNICORN.id,
            aura: true,
            blocked: true,
        });
        // The Unicorn's own head fires too (2), plus Soul Link's two (2 + 3).
        dealDamage(state, 2);
        resolveAll(state);
        expect(state.players[0]!.life).toBe(20 + 2 + 2 + 3);
    });

    it("does not fire for damage the Aura's controller's OTHER creatures deal", () => {
        // Same combat, but the aura is attached to something else.
        const state = combat({
            attackerDef: HYPNOTIC_SPECTER.id,
            aura: true,
            blocked: false,
        });
        state.players[0]!.battlefield.find((c) => c.id === "aura")!.attachedTo =
            "elsewhere";
        dealDamage(state);
        const triggers = state.stack.map((s) => s.triggeredAbilityId);
        // The damage happened and the scan ran (the Specter's own trigger is
        // there) — and the Aura, attached elsewhere, did not answer it.
        expect(triggers).toContain("hypnotic-specter-trigger");
        expect(triggers.some((t) => t?.startsWith("soul-link"))).toBe(false);
    });
});

describe("'that player' / 'that opponent' after a head that names the damaged player", () => {
    it("Hypnotic Specter: the DAMAGED player discards, not the controller", () => {
        const state = combat({ attackerDef: HYPNOTIC_SPECTER.id, p2Hand: 2 });
        state.players[0]!.hand = cardsIn(2, "p1");
        dealDamage(state);
        resolveAll(state);
        expect(state.players[1]!.hand).toHaveLength(1);
        expect(state.players[0]!.hand).toHaveLength(2);
    });

    it("Fungal Shambler: the controller draws and the damaged player is asked to discard", () => {
        const state = combat({ attackerDef: FUNGAL_SHAMBLER.id, p2Hand: 2 });
        state.players[0]!.library = cardsIn(3, "p1").map((c) => ({
            ...c,
            zone: "library" as const,
        }));
        dealDamage(state);
        resolveAll(state);
        expect(state.players[0]!.hand).toHaveLength(1);
        // The discard is the DAMAGED player's choice (CR 701.9b).
        expect(state.pendingChoices?.[0]?.playerId).toBe("p2");
    });
});

describe("the rebuilt ability's gate — which damage fires which head", () => {
    function abilityOf(def: CardDefinition, index = 0) {
        return resolveCompiledTrigger(def.compiledTriggeredAbilities![index]!);
    }

    const view = {
        players: [
            {
                id: "p1",
                life: 20,
                hand: [],
                battlefield: [
                    {
                        id: "host",
                        controllerId: "p1",
                        ownerId: "p1",
                        types: ["Creature"],
                        subtypes: [],
                        staticAbilities: [],
                    },
                ],
            },
            {
                id: "p2",
                life: 20,
                hand: [],
                battlefield: [
                    {
                        id: "opp-creature",
                        controllerId: "p2",
                        ownerId: "p2",
                        types: ["Creature"],
                        subtypes: [],
                        staticAbilities: [],
                    },
                    {
                        id: "opp-walker",
                        controllerId: "p2",
                        ownerId: "p2",
                        types: ["Planeswalker"],
                        subtypes: [],
                        staticAbilities: [],
                    },
                ],
            },
        ],
    } as unknown as TriggerStateView;

    const event = (overrides: Partial<DamageDealtEvent>): DamageDealtEvent => ({
        type: "DAMAGE_DEALT",
        sourceInstanceId: "host",
        sourceControllerId: "p1",
        target: { type: "player", id: "p2" },
        amount: 2,
        isCombat: true,
        ...overrides,
    });

    const self = (overrides: Partial<PermanentView> = {}): PermanentView =>
        ({
            id: "aura",
            controllerId: "p1",
            ownerId: "p1",
            types: ["Enchantment"],
            subtypes: ["Aura"],
            isTapped: false,
            card: {},
            attachedTo: "host",
            ...overrides,
        }) as PermanentView;

    it("host head: only the ATTACHED creature's damage, and nothing while unattached", () => {
        const ability = abilityOf(SOUL_LINK, 0);
        expect(ability.matches(event({}), self(), view)).toBe(true);
        expect(
            ability.matches(
                event({ sourceInstanceId: "someone-else" }),
                self(),
                view
            )
        ).toBe(false);
        expect(
            ability.matches(event({}), self({ attachedTo: undefined }), view)
        ).toBe(false);
    });

    it("host head fires on NON-combat damage too — the words do not say 'combat'", () => {
        const ability = abilityOf(SOUL_LINK, 0);
        expect(ability.matches(event({ isCombat: false }), self(), view)).toBe(
            true
        );
    });

    it("is-dealt-damage head: damage to the ATTACHED creature only, never the Aura or a player", () => {
        const ability = abilityOf(SOUL_LINK, 1);
        const toHost = event({
            sourceInstanceId: "opp-creature",
            sourceControllerId: "p2",
            target: { type: "permanent", id: "host" },
        });
        expect(ability.matches(toHost, self(), view)).toBe(true);
        expect(
            ability.matches(
                {
                    ...toHost,
                    target: { type: "permanent", id: "opp-creature" },
                },
                self(),
                view
            )
        ).toBe(false);
        expect(
            ability.matches(
                { ...toHost, target: { type: "permanent", id: "aura" } },
                self(),
                view
            )
        ).toBe(false);
        expect(
            ability.matches(
                { ...toHost, target: { type: "player", id: "p1" } },
                self(),
                view
            )
        ).toBe(false);
        expect(
            ability.matches(toHost, self({ attachedTo: undefined }), view)
        ).toBe(false);
    });

    it("'to a creature': damage to a creature, never a player and never a planeswalker", () => {
        const ability = abilityOf(CREATURE_HITTER);
        const self1 = self({ id: "hitter", attachedTo: undefined });
        const dealt = (target: DamageDealtEvent["target"]) =>
            event({ sourceInstanceId: "hitter", target });
        expect(
            ability.matches(
                dealt({ type: "permanent", id: "opp-creature" }),
                self1,
                view
            )
        ).toBe(true);
        expect(
            ability.matches(dealt({ type: "player", id: "p2" }), self1, view)
        ).toBe(false);
        expect(
            ability.matches(
                dealt({ type: "permanent", id: "opp-walker" }),
                self1,
                view
            )
        ).toBe(false);
    });

    it("'to an opponent': a player who is NOT the controller — not the controller, not a permanent", () => {
        const ability = abilityOf(HYPNOTIC_SPECTER);
        const self1 = self({ id: "specter", attachedTo: undefined });
        const dealt = (target: DamageDealtEvent["target"]) =>
            event({ sourceInstanceId: "specter", target });
        expect(
            ability.matches(dealt({ type: "player", id: "p2" }), self1, view)
        ).toBe(true);
        expect(
            ability.matches(dealt({ type: "player", id: "p1" }), self1, view)
        ).toBe(false);
        expect(
            ability.matches(
                dealt({ type: "permanent", id: "opp-creature" }),
                self1,
                view
            )
        ).toBe(false);
    });
});
