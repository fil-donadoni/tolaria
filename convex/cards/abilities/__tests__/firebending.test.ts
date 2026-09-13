// Capability tests for the Firebending N keyword expansion (CR 702.189,
// convex/cards/abilities/firebending.ts, issue #3235) and for the mana
// LIFETIME it is the first producer of (`persistsUntil`, CR 500.5 / 702.189a).
//
// Two things are on trial here and they fail in different places:
//
//  1. the KEYWORD — one `attacksTrigger` per declared instance, injected at the
//     real `getDefinition` seam, whose body is the shipped `addMana` Op; and
//  2. the LIFETIME — mana that survives `emptyManaPools` for exactly as long as
//     the combat phase lasts, is spendable on anything while it does, and is
//     never the unit a tap-refund decrements.
//
// (2) is the half nothing else in the suite covers: every other unit of mana in
// the engine empties at every boundary, so a `persistsUntil` that silently did
// nothing would leave this keyword printing reminder text and enforcing nothing
// with a green suite. The phase assertions therefore drive the REAL
// `advancePhase`, not a hand-called `emptyManaPools`.

import { describe, it, expect } from "vitest";
import {
    getCardByName,
    preloadDefinitions,
    getDefinition,
    tokenDefinitionId,
} from "../..";
import type {
    CardDefinition,
    GameEvent,
    TokenSpec,
    ManaCost,
} from "../../types";
import type { GameState } from "../../../gre/state";
import {
    resolveTopOfStack,
    reverseRestrictedManaFromPool,
    restrictedUnitAllowsSpell,
    manaBalanceForRestriction,
    manaPersistenceSurvives,
} from "../../../gre/state";
import { advancePhase } from "../../../gre/phases";
import { collectTriggers, placeTriggersOnStack } from "../../../gre/triggers";
import { projectPublicState } from "../../../gameProjections";
import { isNamedMechanic, MECHANICS_REGISTRY } from "../../mechanicsRegistry";
import { makeInstance, makePlayer, makeState } from "../../__tests__/setup";
import {
    expandFirebending,
    firebendingOracleText,
    firebendingTrigger,
    firebendingTriggerId,
} from "../firebending";

const MOUNTAIN = getCardByName("Mountain").id;

/** Registers a synthetic attacker carrying the given keyword string(s), so
 *  `getDefinition` runs it through the real expansion chain
 *  (`convex/cards/registry.ts`) — the same seam a printed card uses. */
function registerFirebender(id: string, staticAbilities: string[]): string {
    preloadDefinitions([
        {
            id,
            name: `Synthetic ${id}`,
            rarity: "mythic",
            manaCost: { X: 4 },
            types: ["Creature"],
            subtypes: ["Avatar"],
            power: 4,
            toughness: 4,
            staticAbilities,
        } as CardDefinition,
    ]);
    return id;
}

/** Bare expansion (no registry round-trip) for shape assertions. */
function expandedWith(staticAbilities: string[]): CardDefinition {
    return expandFirebending({
        id: `synthetic-${staticAbilities.join("+")}`,
        name: "Synthetic",
        rarity: "common",
        manaCost: { X: 1 },
        types: ["Creature"],
        subtypes: [],
        power: 1,
        toughness: 1,
        staticAbilities,
    } as CardDefinition);
}

/** p1 attacks with the firebender in the declare-attackers step. `extraP1`
 *  permanents (a Mountain, say) ride along untapped. */
function boardWith(
    attackerCardId: string,
    extraP1: string[] = []
): { state: GameState; attackerId: string } {
    const attacker = makeInstance(attackerCardId, {
        id: "atk",
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
    });
    const extras = extraP1.map((cardId, i) =>
        makeInstance(cardId, {
            id: `x${i}`,
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        })
    );
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [attacker, ...extras] }),
            makePlayer("p2"),
        ],
        phase: "DECLARE_ATTACKERS",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        combat: {
            attackerIds: [attacker.id],
            confirmed: true,
            blockerAssignments: {},
            blockersConfirmed: false,
        },
    });
    return { state, attackerId: attacker.id };
}

/** Emits the real CR 508.1 event, pushes whatever triggers it produces and
 *  resolves them all — the production path minus the phase machinery. */
function declareAttackersAndResolve(state: GameState): void {
    const event: GameEvent = {
        type: "ATTACKERS_DECLARED",
        attackingPlayerId: state.activePlayerId,
        attackerIds: [...state.combat!.attackerIds],
    };
    placeTriggersOnStack(state, collectTriggers(state, [event]));
    while (state.stack.length > 0) resolveTopOfStack(state);
}

/** Total red a player holds, whichever bucket it sits in. */
function redBalance(state: GameState, playerId: string): number {
    const p = state.players.find((x) => x.id === playerId)!;
    return (
        (p.manaPool.R ?? 0) +
        (p.restrictedMana ?? []).reduce(
            (n, u) => (u.color === "R" ? n + u.amount : n),
            0
        )
    );
}

describe("Firebending N — Mechanics Registry (CR 702.189)", () => {
    it("the numbered keyword resolves to an `implemented` row", () => {
        expect(isNamedMechanic("firebending 4")).toBe(true);
        expect(isNamedMechanic("firebending 1")).toBe(true);
        const row = MECHANICS_REGISTRY.find((r) => r.id === "firebending")!;
        expect(row.status).toBe("implemented");
        expect(row.cr).toBe("702.189");
        expect(row.binding).toContain("firebending.ts");
        expect(row.bindingPattern!.test("firebending 4")).toBe(true);
        // The bare word is not what a card declares — N is mandatory.
        expect(row.bindingPattern!.test("firebending")).toBe(false);
    });
});

describe("Firebending N — keyword expansion (CR 702.189a)", () => {
    it("injects one ATTACKERS_DECLARED trigger from the bare keyword string", () => {
        const def = expandedWith(["firebending 4"]);
        const trig = def.triggeredAbilities ?? [];
        expect(trig).toHaveLength(1);
        expect(trig[0].id).toBe(firebendingTriggerId(4));
        expect(trig[0].event).toBe("ATTACKERS_DECLARED");
        expect(trig[0].oracleText).toBe(
            "Firebending 4 (Whenever this creature attacks, add {R}{R}{R}{R}. This mana lasts until end of combat.)"
        );
    });

    it("is a no-op for a card without the keyword", () => {
        expect(expandedWith(["flying"]).triggeredAbilities).toBeUndefined();
    });

    it("is idempotent — re-expanding never double-injects (the mana would double)", () => {
        const once = expandedWith(["firebending 2"]);
        expect(expandFirebending(once).triggeredAbilities ?? []).toHaveLength(
            1
        );
    });

    it("is parametrized off the string, not enumerated — any N works", () => {
        for (const n of [1, 2, 4, 8]) {
            const def = expandedWith([`firebending ${n}`]);
            expect(def.triggeredAbilities).toHaveLength(1);
            expect(def.triggeredAbilities![0].effects![0]).toMatchObject({
                op: "addMana",
                mana: { R: n },
                persistsUntil: "end-of-combat",
            });
            expect(firebendingOracleText(n)).toContain("{R}".repeat(n));
        }
    });

    it("two instances of DIFFERENT N inject two triggers with distinct ids (CR 702.189a — firebending IS a triggered ability, so two are two abilities)", () => {
        const def = expandedWith(["firebending 1", "firebending 4"]);
        expect(def.triggeredAbilities?.map((t) => t.id)).toEqual([
            firebendingTriggerId(1),
            firebendingTriggerId(4),
        ]);
    });

    it("reaches the card through the real getDefinition seam", () => {
        const id = registerFirebender("synthetic-firebending-seam", [
            "flying",
            "firebending 3",
        ]);
        const def = getDefinition(id);
        expect(def.staticAbilities).toContain("firebending 3");
        expect(def.triggeredAbilities?.map((t) => t.id)).toEqual([
            firebendingTriggerId(3),
        ]);
    });

    it("survives the TOKEN id round-trip, so the keyword is grantable to a token (CR 707.2)", () => {
        const spec: TokenSpec = {
            name: "Dragon",
            types: ["Creature"],
            subtypes: ["Dragon"],
            power: 4,
            toughness: 4,
            colors: ["R"],
            staticAbilities: ["flying", "firebending 4"],
        };
        const def = getDefinition(tokenDefinitionId(spec));
        expect(def.staticAbilities).toContain("firebending 4");
        expect(def.triggeredAbilities?.map((t) => t.id)).toEqual([
            firebendingTriggerId(4),
        ]);
    });
});

describe("Firebending N — the mana it makes (CR 702.189a / 106.4)", () => {
    it("adds N red on attack, in the lifetime-tagged bucket rather than the fungible pool", () => {
        const id = registerFirebender("synthetic-firebending-mana", [
            "firebending 4",
        ]);
        const { state } = boardWith(id);
        declareAttackersAndResolve(state);
        const p1 = state.players[0];
        expect(p1.manaPool.R ?? 0).toBe(0);
        expect(p1.restrictedMana).toEqual([
            { color: "R", amount: 4, persistsUntil: "end-of-combat" },
        ]);
    });

    it("carries no restriction and no rider — it is plain red mana that may pay for anything (CR 106.6)", () => {
        const id = registerFirebender("synthetic-firebending-unrestricted", [
            "firebending 2",
        ]);
        const { state } = boardWith(id);
        declareAttackersAndResolve(state);
        const [unit] = state.players[0].restrictedMana!;
        expect(unit.restriction).toBeUndefined();
        expect(unit.castableCardId).toBeUndefined();
        expect(unit.cantBeCounteredRider).toBeUndefined();
        expect(unit.hasteRider).toBeUndefined();
        expect(restrictedUnitAllowsSpell(unit, ["Creature"])).toBe(true);
        expect(restrictedUnitAllowsSpell(unit, ["Instant"])).toBe(true);
        expect(restrictedUnitAllowsSpell(unit, ["Land"])).toBe(true);
    });

    it("is NOT the unit an untap-refund decrements (CR 106.4) — a plain red source's reversal leaves it untouched", () => {
        const id = registerFirebender("synthetic-firebending-refund", [
            "firebending 3",
        ]);
        const { state } = boardWith(id, [MOUNTAIN]);
        declareAttackersAndResolve(state);
        const p1 = state.players[0];
        // The Mountain's own {R} landed in the fungible pool; reversing it must
        // not reach into the firebending unit for the shortfall.
        p1.manaPool.R = 1;
        reverseRestrictedManaFromPool(p1, "R", 1, undefined);
        expect(p1.restrictedMana).toEqual([
            { color: "R", amount: 3, persistsUntil: "end-of-combat" },
        ]);
        // Nor does the "is this tap's mana still unspent" lookup see it.
        expect(manaBalanceForRestriction(p1, "R", undefined)).toBe(1);
    });
});

describe("Firebending's mana lifetime (CR 500.5 / 702.189a)", () => {
    it("`manaPersistenceSurvives` spares every combat boundary except END_OF_COMBAT's, and nothing outside combat", () => {
        for (const phase of [
            "BEGINNING_OF_COMBAT",
            "DECLARE_ATTACKERS",
            "DECLARE_BLOCKERS",
            "FIRST_STRIKE_DAMAGE",
            "COMBAT_DAMAGE",
        ] as const) {
            expect(manaPersistenceSurvives("end-of-combat", phase)).toBe(true);
        }
        expect(manaPersistenceSurvives("end-of-combat", "END_OF_COMBAT")).toBe(
            false
        );
        // Fails closed outside combat (CR 506.4 — an effect that ends the
        // combat phase must not leave the mana floating for the whole turn).
        for (const phase of [
            "PRECOMBAT_MAIN",
            "POSTCOMBAT_MAIN",
            "END_STEP",
            "UPKEEP",
        ] as const) {
            expect(manaPersistenceSurvives("end-of-combat", phase)).toBe(false);
        }
        // An ordinary unit never survives anything.
        expect(manaPersistenceSurvives(undefined, "DECLARE_ATTACKERS")).toBe(
            false
        );
    });

    it("survives every step boundary inside combat while ordinary mana beside it does not, and empties as END_OF_COMBAT ends", () => {
        const id = registerFirebender("synthetic-firebending-lifetime", [
            "firebending 4",
        ]);
        const { state } = boardWith(id);
        declareAttackersAndResolve(state);
        // Ordinary red floating beside it — the discriminating half: without
        // it, a test that only watched the firebending unit could not tell
        // "spared correctly" from "the pool was never emptied at all".
        state.players[0].manaPool.R = 2;
        expect(redBalance(state, "p1")).toBe(6);

        advancePhase(state); // leaves DECLARE_ATTACKERS
        expect(state.phase).toBe("DECLARE_BLOCKERS");
        expect(state.players[0].manaPool.R).toBe(0);
        expect(redBalance(state, "p1")).toBe(4);

        while (state.phase !== "END_OF_COMBAT") advancePhase(state);
        expect(redBalance(state, "p1")).toBe(4);

        advancePhase(state); // leaves END_OF_COMBAT — the combat phase's exit
        expect(state.phase).toBe("POSTCOMBAT_MAIN");
        expect(redBalance(state, "p1")).toBe(0);
        expect(state.players[0].restrictedMana).toBeUndefined();
    });
});

describe("Firebending's mana on the wire (CR 106.6)", () => {
    // The pool LABEL is a client-side pure function and is asserted in
    // `src/lib/__tests__/restricted-mana.test.ts` — a convex test may not
    // import from `src/` (the two live in different tsconfig projects).
    it("projectPublicState carries the unit and its lifetime", () => {
        const id = registerFirebender("synthetic-firebending-wire", [
            "firebending 4",
        ]);
        const { state } = boardWith(id);
        declareAttackersAndResolve(state);
        const view = projectPublicState(state, 1, "p1");
        const me = view.players.find((p) => p.id === "p1")!;
        expect(me.restrictedMana).toEqual([
            { color: "R", amount: 4, persistsUntil: "end-of-combat" },
        ]);
    });
});

describe("Firebending's trigger shape (CR 702.189a)", () => {
    it("the injected ability adds to its OWN controller's pool — no `player` field, so the Op's CR 106.4 default applies", () => {
        const [op] = firebendingTrigger(4).effects!;
        expect(op).not.toHaveProperty("player");
        const cost: ManaCost = { R: 4 };
        expect((op as { mana: ManaCost }).mana).toEqual(cost);
    });
});
