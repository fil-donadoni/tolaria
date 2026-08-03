// CR 702.16 — protection from a NON-COLOUR quality (issue #1120, Tsabo Tavoc's
// "protection from legendary creatures").
//
// CR 702.16a: "This quality is usually a color … but can be any characteristic
// value or information. … If the quality is a card type, subtype, or supertype,
// the ability applies to sources that are permanents with that card type,
// subtype, or supertype and to any sources not on the battlefield that are of
// that card type, subtype, or supertype. This is an exception to rule 109.2."
//
// The engine risk this file exists to close is NOT "does the parser work" — it
// is "does the parsed quality reach EVERY consult site". Protection is read
// from many independent places (targeting offered/accepted, damage, blocking,
// Aura attach + its SBA, Equipment SBA, the client click gate); a quality that
// only one of them honours ships functionally dead, the deathtouch/hexproof
// shape of issues #957/#958. So there is ONE test per CR 702.16 clause, each
// paired with its must-NOT row (a source that does NOT have the quality must
// still get through), driven through the REAL predicate/SBA/enumerator rather
// than a hand-built view.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import {
    getProtectionQualities,
    isProtectedFrom,
    isProtectedFromSource,
    isProtectionAbility,
    parseProtectionQuality,
    protectionSourceView,
} from "../protection";
import {
    getLegalTargets,
    getPendingTargetSourceSupertypes,
    NO_TARGETING_SOURCE,
    pendingTargetingSource,
    raiseTriggerTargetSelection,
} from "../rules";
import { collectTriggers } from "../triggers";
import { validateBlockerEligibility } from "../combat";
import { checkAttachmentSBA, checkAuraAttachmentSBA } from "../sba";
import { applyAllCombatDamage } from "../phases";
import { projectPublicState } from "../../gameProjections";
import { getAllCards } from "../../cards";
import type { CardDefinition } from "../../cards/types";
import type { CardInstanceState, GameState } from "../state";

// Real shipped card ids — the catalogue, not synthetic definitions.
const TSABO_TAVOC = "ccbe2539-7a7c-468b-a270-7ca1bdcccb1e"; // Legendary Creature, protection from legendary creatures
const BARKTOOTH = "0ea52228-f8ad-4623-9e05-f162473bfc03"; // Legendary Creature 6/5, no abilities
const GRIZZLY_BEARS = "ce2d603a-3231-4a8c-bf39-1617586ea870"; // plain Creature
const KARAKAS = "31d2422a-bb7d-4cdd-9aac-e5a936a4be3b"; // Legendary Land
const BLESSING = "f131fd27-18da-47ca-b59f-135bcac83abd"; // Aura — enchant creature
const LION_SASH = "3e1766e9-2fa7-4446-a255-7beea1467ece"; // Artifact Creature — Equipment

/** Grants the Legendary supertype to an instance the way a real
 *  `supertype-set` continuous effect does (CR 205.4a) — the engine reads
 *  supertypes LIVE, so this is the supported way to build the exotic
 *  "legendary Aura / legendary Equipment" sources CR 702.16c/d speak about
 *  without inventing a card definition. */
function makeLegendary<T extends CardInstanceState>(card: T): T {
    card.grantedSupertypes = [
        { supertype: "Legendary", sourceId: "test-effect" },
    ];
    return card;
}

function tsabo(controllerId = "p1"): CardInstanceState {
    return makeInstance(TSABO_TAVOC, {
        id: "tsabo",
        controllerId,
        ownerId: controllerId,
    });
}

// ─────────────────────────────────────────────────────────────────────────
// The parser — total and FAIL CLOSED
// ─────────────────────────────────────────────────────────────────────────

describe("parseProtectionQuality (CR 702.16a)", () => {
    it("parses a supertype + card type quality as a conjunction", () => {
        expect(
            parseProtectionQuality("protection from legendary creatures")
        ).toEqual({
            kind: "characteristic",
            types: ["Creature"],
            supertypes: ["Legendary"],
        });
    });

    it("parses a bare card type, singular and plural", () => {
        expect(parseProtectionQuality("protection from artifacts")).toEqual({
            kind: "characteristic",
            types: ["Artifact"],
            supertypes: [],
        });
        // "sorceries", not "sorcerys" — the -y → -ies plural.
        expect(parseProtectionQuality("protection from sorceries")).toEqual({
            kind: "characteristic",
            types: ["Sorcery"],
            supertypes: [],
        });
    });

    it("parses a multi-type quality (artifact creatures)", () => {
        expect(
            parseProtectionQuality("protection from artifact creatures")
        ).toEqual({
            kind: "characteristic",
            types: ["Artifact", "Creature"],
            supertypes: [],
        });
    });

    it("still parses the colour and player families (regression)", () => {
        expect(parseProtectionQuality("protection from red")).toEqual({
            kind: "color",
            color: "R",
        });
        expect(parseProtectionQuality("protection from colorless")).toEqual({
            kind: "color",
            color: "C",
        });
        expect(
            parseProtectionQuality("protection from each of your opponents")
        ).toEqual({ kind: "each-opponent" });
    });

    it("FAILS CLOSED on a quality it cannot name", () => {
        // A quality that returned a match-everything (or match-nothing)
        // value here is the whole bug class — it must be `null`, which the
        // catalogue guard below turns into a CI failure.
        expect(parseProtectionQuality("protection from everything")).toBeNull();
        expect(parseProtectionQuality("protection from goblins")).toBeNull();
        expect(
            parseProtectionQuality("protection from legendary wizards")
        ).toBeNull();
    });

    it("distinguishes a non-protection ability from an unnameable quality", () => {
        expect(parseProtectionQuality("flying")).toBeNull();
        expect(isProtectionAbility("flying")).toBe(false);
        expect(isProtectionAbility("protection from goblins")).toBe(true);
    });

    it("CR 702.16m — duplicate qualities collapse", () => {
        const card = makeInstance(GRIZZLY_BEARS, {
            id: "dup",
            staticAbilities: [
                "protection from legendary creatures",
                "protection from legendary creatures",
                "protection from red",
            ],
        });
        expect(getProtectionQualities(card)).toHaveLength(2);
    });
});

// ─────────────────────────────────────────────────────────────────────────
// Catalogue guard — no shipped card may declare an UNPARSEABLE quality
// ─────────────────────────────────────────────────────────────────────────

/** Every string anywhere in a card definition (staticAbilities, keyword-grant
 *  static effects, `grantAbility` Ops, modal branches). Walking the whole
 *  object is deliberate: an allow-list of known fields silently stops covering
 *  whatever shape ships next. */
const PROSE_KEYS = new Set([
    "oracleText",
    "flavorText",
    "reminderText",
    "note",
    "label",
    "name",
    "description",
]);

function collectStrings(value: unknown, out: string[], depth = 0): void {
    if (depth > 12) return;
    if (typeof value === "string") {
        out.push(value);
        return;
    }
    if (Array.isArray(value)) {
        for (const v of value) collectStrings(v, out, depth + 1);
        return;
    }
    if (value && typeof value === "object") {
        // PROSE keys are excluded by NAME, not by an allow-list of ability
        // fields: an allow-list silently stops covering whatever ability-string
        // field ships next, which is precisely the failure this guard exists to
        // prevent. `oracleText` is printed card text ("Protection from red\n…"),
        // never an ability string the engine parses.
        for (const [k, v] of Object.entries(value)) {
            if (PROSE_KEYS.has(k)) continue;
            collectStrings(v, out, depth + 1);
        }
    }
}

describe("catalogue guard — every shipped protection quality parses (CR 702.16)", () => {
    it("no card declares or grants a protection string the parser cannot name", () => {
        const offenders: string[] = [];
        for (const def of getAllCards() as CardDefinition[]) {
            const strings: string[] = [];
            collectStrings(def, strings);
            for (const s of strings) {
                if (!isProtectionAbility(s)) continue;
                if (parseProtectionQuality(s) === null) {
                    offenders.push(`${def.name}: "${s}"`);
                }
            }
        }
        // A failure here is a STOP-AND-ISSUE, not a test to relax: the card
        // would ship with a functional-looking but inert keyword. Either teach
        // `parseProtectionQuality` the quality (and every consult site gets it
        // for free through `isProtectedFrom`), or leave the card as a tracked
        // stub.
        expect(offenders).toEqual([]);
    });

    it("finds Tsabo Tavoc's characteristic quality in the live catalogue", () => {
        // Proves the sweep above actually reaches a card's `staticAbilities`
        // (a guard that silently scans nothing passes vacuously forever).
        const def = (getAllCards() as CardDefinition[]).find(
            (c) => c.id === TSABO_TAVOC
        );
        expect(def?.staticAbilities).toContain(
            "protection from legendary creatures"
        );
        expect(def?.staticAbilities).toContain("first strike");
    });
});

// ─────────────────────────────────────────────────────────────────────────
// The quality predicate — one row per source shape, must and must-NOT
// ─────────────────────────────────────────────────────────────────────────

describe("isProtectedFrom — characteristic quality (CR 702.16a)", () => {
    it("matches a legendary CREATURE source", () => {
        const source = makeInstance(BARKTOOTH, { id: "legend" });
        expect(isProtectedFromSource(tsabo(), source)).toBe(true);
    });

    it("does NOT match a non-legendary creature source", () => {
        const source = makeInstance(GRIZZLY_BEARS, { id: "bears" });
        expect(isProtectedFromSource(tsabo(), source)).toBe(false);
    });

    it("does NOT match a legendary NON-creature source (the conjunction holds)", () => {
        // Karakas is a Legendary Land — it has the supertype but not the card
        // type, so "protection from legendary creatures" does not apply.
        const source = makeInstance(KARAKAS, { id: "karakas" });
        expect(isProtectedFromSource(tsabo(), source)).toBe(false);
    });

    it("has NO controller exception — the controller's own legend is barred too", () => {
        const own = makeInstance(BARKTOOTH, {
            id: "own",
            controllerId: "p1",
            ownerId: "p1",
        });
        expect(isProtectedFromSource(tsabo("p1"), own)).toBe(true);
    });

    it("reads supertypes LIVE (CR 205.4a) — a granted Legendary makes a plain bear match", () => {
        const bears = makeInstance(GRIZZLY_BEARS, { id: "bears" });
        expect(isProtectedFromSource(tsabo(), bears)).toBe(false);
        expect(isProtectedFromSource(tsabo(), makeLegendary(bears))).toBe(true);
    });

    it("fails closed on a source with no matching characteristics", () => {
        expect(
            isProtectedFrom(tsabo(), {
                colors: [],
                types: [],
                supertypes: [],
                controllerId: "p2",
            })
        ).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────
// CR 702.16b — can't be TARGETED (offered set + wire format)
// ─────────────────────────────────────────────────────────────────────────

function boardWithTsabo(): GameState {
    const legend0 = makeInstance(BARKTOOTH, {
        id: "legend",
        controllerId: "p2",
        ownerId: "p2",
    });
    const bears = makeInstance(GRIZZLY_BEARS, {
        id: "bears",
        controllerId: "p2",
        ownerId: "p2",
    });
    return makeState({
        players: [
            makePlayer("p1", { battlefield: [tsabo("p1")] }),
            makePlayer("p2", { battlefield: [legend0, bears] }),
        ],
    });
}

const CREATURE_REQ = { type: "Creature" as const, count: 1 };

function offeredIds(
    state: GameState,
    sourceTypes: readonly string[],
    sourceSupertypes: readonly string[]
): string[] {
    return getLegalTargets(
        state,
        CREATURE_REQ,
        {
            ...NO_TARGETING_SOURCE,
            types: sourceTypes as never,
            supertypes: sourceSupertypes as never,
            isSpell: true,
        },
        "p2",
        undefined,
        [],
        undefined
    ).map((t) => t.id);
}

describe("CR 702.16b — can't be targeted by a source with the quality", () => {
    it("a legendary creature source is not offered Tsabo Tavoc, a plain creature source is", () => {
        const state = boardWithTsabo();
        expect(offeredIds(state, ["Creature"], ["Legendary"])).not.toContain(
            "tsabo"
        );
        // must-NOT row: the protection is specific, not a blanket untargetable.
        expect(offeredIds(state, ["Creature"], [])).toContain("tsabo");
        expect(offeredIds(state, ["Land"], ["Legendary"])).toContain("tsabo");
    });

    it("still offers every unprotected permanent to the legendary source", () => {
        const state = boardWithTsabo();
        const offered = offeredIds(state, ["Creature"], ["Legendary"]);
        expect(offered).toContain("legend");
        expect(offered).toContain("bears");
    });

    it("derives the source's supertypes from the real battlefield permanent", () => {
        // The whole offered-set path in production reads its supertypes from
        // `getPendingTargetSourceSupertypes`, not from a literal — exercise it.
        const state = boardWithTsabo();
        expect(
            getPendingTargetSourceSupertypes(state, "legend", "ability")
        ).toEqual(["Legendary"]);
        expect(
            getPendingTargetSourceSupertypes(state, "bears", "ability")
        ).toEqual([]);
        const offered = offeredIds(
            state,
            ["Creature"],
            getPendingTargetSourceSupertypes(state, "legend", "ability")
        );
        expect(offered).not.toContain("tsabo");
    });

    it("Tsabo Tavoc's own ability can never target itself (it IS a legend)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [tsabo("p1")] }),
                makePlayer("p2"),
            ],
        });
        const offered = getLegalTargets(
            state,
            { type: "Creature", count: 1, supertypeFilter: "Legendary" },
            {
                ...NO_TARGETING_SOURCE,
                types: ["Creature"],
                supertypes: getPendingTargetSourceSupertypes(
                    state,
                    "tsabo",
                    "ability"
                ),
                isSpell: false,
            },
            "p1",
            undefined,
            [],
            undefined
        );
        expect(offered.map((t) => t.id)).not.toContain("tsabo");
    });

    it("wire format — the same verdict survives projectPublicState", () => {
        const state = boardWithTsabo();
        const legend0 = state.players[1].battlefield[0];
        expect(
            isProtectedFromSource(state.players[0].battlefield[0], legend0)
        ).toBe(true);

        const projected = projectPublicState(state, 1, "p2");
        const slimTsabo = projected.players[0].battlefield.find(
            (c) => c.id === "tsabo"
        )!;
        const slimLegend = projected.players[1].battlefield.find(
            (c) => c.id === "legend"
        )!;
        const slimBears = projected.players[1].battlefield.find(
            (c) => c.id === "bears"
        )!;
        // The projection strips `card.card` to `{ id }` — the supertype read
        // must still resolve through the registry, or the client sees a
        // non-legendary Dakkon and the gate silently disappears client-side.
        expect(
            isProtectedFromSource(
                slimTsabo as unknown as CardInstanceState,
                slimLegend as unknown as CardInstanceState
            )
        ).toBe(true);
        expect(
            isProtectedFromSource(
                slimTsabo as unknown as CardInstanceState,
                slimBears as unknown as CardInstanceState
            )
        ).toBe(false);
        expect(
            protectionSourceView(slimLegend as unknown as CardInstanceState)
                .supertypes
        ).toEqual(["Legendary"]);
    });
});

// ─────────────────────────────────────────────────────────────────────────
// CR 702.16c — can't be ENCHANTED
// ─────────────────────────────────────────────────────────────────────────

describe("CR 702.16c — Auras with the quality fall off as an SBA", () => {
    function auraOn(host: string, legendary: boolean): GameState {
        const aura = makeInstance(BLESSING, {
            id: "aura",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: host,
        });
        // An Aura that is itself a legendary CREATURE (a bestowed/animated
        // Aura) is the shape CR 702.16c speaks about for this quality.
        aura.types = ["Enchantment", "Creature"];
        if (legendary) makeLegendary(aura);
        return makeState({
            players: [
                makePlayer("p1", { battlefield: [tsabo("p1"), aura] }),
                makePlayer("p2"),
            ],
        });
    }

    it("detaches an Aura that is a legendary creature", () => {
        const state = auraOn("tsabo", true);
        expect(checkAuraAttachmentSBA(state)).toBe(true);
        expect(state.players[0].battlefield.some((c) => c.id === "aura")).toBe(
            false
        );
    });

    it("must-NOT — a non-legendary Aura stays attached", () => {
        const state = auraOn("tsabo", false);
        checkAuraAttachmentSBA(state);
        const aura = state.players[0].battlefield.find((c) => c.id === "aura");
        expect(aura?.attachedTo).toBe("tsabo");
    });
});

// ─────────────────────────────────────────────────────────────────────────
// CR 702.16d — can't be EQUIPPED (CR 704.5n unattach)
// ─────────────────────────────────────────────────────────────────────────

describe("CR 702.16d — Equipment with the quality unattaches as an SBA", () => {
    function equippedState(legendary: boolean): GameState {
        const sash = makeInstance(LION_SASH, {
            id: "sash",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "tsabo",
        });
        if (legendary) makeLegendary(sash);
        return makeState({
            players: [
                makePlayer("p1", { battlefield: [tsabo("p1"), sash] }),
                makePlayer("p2"),
            ],
        });
    }

    it("unattaches a legendary-creature Equipment but leaves it on the battlefield", () => {
        const state = equippedState(true);
        expect(checkAttachmentSBA(state)).toBe(true);
        const sash = state.players[0].battlefield.find((c) => c.id === "sash");
        // CR 704.5n — unattached, NOT put into the graveyard (unlike an Aura).
        expect(sash).toBeDefined();
        expect(sash!.attachedTo).toBeUndefined();
    });

    it("must-NOT — a non-legendary Equipment stays equipped", () => {
        const state = equippedState(false);
        expect(checkAttachmentSBA(state)).toBe(false);
        const sash = state.players[0].battlefield.find((c) => c.id === "sash");
        expect(sash!.attachedTo).toBe("tsabo");
    });
});

// ─────────────────────────────────────────────────────────────────────────
// CR 702.16e — DAMAGE prevented
// ─────────────────────────────────────────────────────────────────────────

describe("CR 702.16e — combat damage from a source with the quality is prevented", () => {
    /** p2 attacks with `attackerId`; Tsabo Tavoc (p1) blocks it. Tsabo
     *  blocking is legal — CR 702.16f bars the protected creature from BEING
     *  blocked, not from blocking — so this is the clean board for the
     *  702.16e damage-prevention read. */
    function combatState(attackerId: string): GameState {
        const attacker = makeInstance(attackerId, {
            id: "attacker",
            controllerId: "p2",
            ownerId: "p2",
            isAttacking: true,
        });
        const blocker = tsabo("p1");
        blocker.isBlocking = true;
        return makeState({
            phase: "COMBAT_DAMAGE",
            activePlayerId: "p2",
            players: [
                makePlayer("p1", { battlefield: [blocker] }),
                makePlayer("p2", { battlefield: [attacker] }),
            ],
            combat: {
                confirmed: true,
                attackerIds: ["attacker"],
                blockerAssignments: { tsabo: ["attacker"] },
                blockedAttackerIds: ["attacker"],
                blockersConfirmed: true,
                damageConfirmed: false,
            } as GameState["combat"],
        });
    }

    it("a legendary creature deals no damage to Tsabo Tavoc; a bear does", () => {
        // Read the prevention through the shared predicate the damage sites
        // (`dealDamage`, `markDamageFromPermanentSource`,
        // `applyAllCombatDamage`) all call — see the combat-path assertion in
        // the block test below for the end-to-end run.
        const legend = makeInstance(BARKTOOTH, { id: "d" });
        const bear = makeInstance(GRIZZLY_BEARS, { id: "b" });
        expect(isProtectedFromSource(tsabo(), legend)).toBe(true);
        expect(isProtectedFromSource(tsabo(), bear)).toBe(false);
    });

    it("end-to-end through applyAllCombatDamage — the legend's damage is prevented", () => {
        const state = combatState(BARKTOOTH);
        const before = state.players[0].battlefield[0].damageMarked ?? 0;
        applyAllCombatDamage(state, { attacker: { tsabo: 6 } });
        const after = state.players[0].battlefield.find(
            (c) => c.id === "tsabo"
        );
        expect(after?.damageMarked ?? 0).toBe(before);
    });

    it("must-NOT — a non-legendary attacker's combat damage still lands", () => {
        const state = combatState(GRIZZLY_BEARS);
        applyAllCombatDamage(state, { attacker: { tsabo: 2 } });
        const after = state.players[0].battlefield.find(
            (c) => c.id === "tsabo"
        );
        expect(after?.damageMarked ?? 0).toBeGreaterThan(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────
// CR 702.16f — can't be BLOCKED
// ─────────────────────────────────────────────────────────────────────────

describe("CR 702.16f — creatures with the quality can't block it", () => {
    function blockState(blockerId: string): {
        state: GameState;
        attacker: CardInstanceState;
        blocker: CardInstanceState;
    } {
        const attacker = tsabo("p1");
        attacker.isAttacking = true;
        const blocker = makeInstance(blockerId, {
            id: "blocker",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [attacker] }),
                makePlayer("p2", { battlefield: [blocker] }),
            ],
        });
        return { state, attacker, blocker };
    }

    it("a legendary creature can't block Tsabo Tavoc", () => {
        const { state, attacker, blocker } = blockState(BARKTOOTH);
        expect(
            validateBlockerEligibility(attacker, blocker, [blocker], state)
                .eligible
        ).toBe(false);
    });

    it("must-NOT — a plain creature blocks it normally", () => {
        const { state, attacker, blocker } = blockState(GRIZZLY_BEARS);
        expect(
            validateBlockerEligibility(attacker, blocker, [blocker], state)
                .eligible
        ).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────
// CR 702.16b on the TRIGGERED-ABILITY path (issue #1120 review)
// ─────────────────────────────────────────────────────────────────────────
//
// `raiseTriggerTargetSelection` is a SECOND, independent offered-set site with
// a property the cast/ability paths don't have: when a mandatory single target
// has exactly one legal candidate it AUTO-SELECTS it (CR 603.3d) and emits
// BECAME_TARGET, with no later `selectTarget` mutation to re-check legality.
// So a protection quality invisible here is not merely "offered too widely" —
// it is an illegal target silently committed, and CR 603.3c (remove the
// trigger from the stack when no legal target exists) never fires.
//
// Halfdane is the fixture the review used: a shipped Legendary Creature whose
// upkeep trigger is `count: 1`, mandatory, "target creature other than
// Halfdane".

describe("CR 702.16b/603.3c — a trigger from a legendary creature and a protected permanent", () => {
    const HALFDANE = "2e939761-3542-4044-9038-d1d30c6a38fc";

    /** Halfdane (p1) with its upkeep trigger on the stack, targets un-set, and
     *  `others` as the only other creatures on the battlefield. */
    function halfdaneUpkeepState(others: CardInstanceState[]): GameState {
        const halfdane = makeInstance(HALFDANE, {
            id: "halfdane",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            phase: "UPKEEP",
            activePlayerId: "p1",
            players: [
                makePlayer("p1", { battlefield: [halfdane] }),
                makePlayer("p2", { battlefield: others }),
            ],
        });
        state.stack.push(
            ...collectTriggers(state, [
                {
                    type: "PHASE_BEGIN",
                    phase: "UPKEEP",
                    activePlayerId: "p1",
                },
            ]).filter((t) => t.triggeredAbilityId === "halfdane-copy-pt")
        );
        return state;
    }

    it("CR 603.3c — with ONLY a protected creature available, the trigger is removed from the stack, never auto-locked onto it", () => {
        // The reported failure: `getLegalTargets` returned [tsabo], so the
        // `min===1 && max===1 && length===1` branch locked Tsabo Tavoc as the
        // target and emitted BECAME_TARGET. Nothing downstream re-checks — the
        // trigger then resolves onto a permanent with protection from
        // legendary creatures.
        const state = halfdaneUpkeepState([tsabo("p2")]);
        expect(state.stack).toHaveLength(1);

        raiseTriggerTargetSelection(state);

        // No legal target at all → CR 603.3c removes the trigger.
        expect(state.stack).toHaveLength(0);
        // …and specifically it must NOT have auto-locked the protected one.
        expect(state.pendingTarget).toBeUndefined();
    });

    it("must-NOT — with an UNPROTECTED creature the sole-target auto-select still happens (CR 603.3d)", () => {
        const bear = makeInstance(GRIZZLY_BEARS, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = halfdaneUpkeepState([bear]);

        raiseTriggerTargetSelection(state);

        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].targets).toEqual([
            { type: "permanent", id: "bear" },
        ]);
    });

    it("with BOTH, the offered set excludes the protected one and the unprotected one auto-locks", () => {
        const bear = makeInstance(GRIZZLY_BEARS, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = halfdaneUpkeepState([tsabo("p2"), bear]);

        raiseTriggerTargetSelection(state);

        // Two candidates by type, one legal by CR 702.16b → still a sole
        // mandatory target, so it auto-selects the LEGAL one.
        expect(state.stack[0].targets).toEqual([
            { type: "permanent", id: "bear" },
        ]);
    });

    it("the kind:'trigger' offered set and pendingTargetingSource agree", () => {
        // Two unprotected creatures + Tsabo → a real choice is owed, so a
        // `kind: "trigger"` PendingTarget is raised. The offered set built from
        // `pendingTargetingSource` (what `legalActions` and the client both
        // use) must exclude Tsabo.
        const bear = makeInstance(GRIZZLY_BEARS, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const bear2 = makeInstance(GRIZZLY_BEARS, {
            id: "bear2",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = halfdaneUpkeepState([tsabo("p2"), bear, bear2]);

        raiseTriggerTargetSelection(state);
        const pt = state.pendingTarget!;
        expect(pt.kind).toBe("trigger");

        const source = pendingTargetingSource(
            state,
            pt.cardInstanceId,
            "trigger"
        );
        expect(source.supertypes).toContain("Legendary");
        const offeredForTrigger = getLegalTargets(
            state,
            { type: "Creature", count: 1 },
            source,
            pt.playerId
        ).map((t) => t.id);
        expect(offeredForTrigger).not.toContain("tsabo");
        expect(offeredForTrigger).toContain("bear");
    });
});

// ─────────────────────────────────────────────────────────────────────────
// Structural guard — no hand-assembled TargetingSource in production code
// ─────────────────────────────────────────────────────────────────────────

describe("single-authority guard — TargetingSource is never hand-assembled", () => {
    it("no production file spreads NO_TARGETING_SOURCE to build a partial bundle", () => {
        // `{ ...NO_TARGETING_SOURCE, colors: … }` compiles even when it omits a
        // dimension, which is exactly the hole the required-field interface
        // exists to close. Tests may use it (a test bundle is inspectable in
        // review); engine code must go through `targetingSourceFromCard` /
        // `pendingTargetingSource` so all five dimensions are derived together.
        const offenders: string[] = [];
        const walk = (dir: string): void => {
            for (const entry of readdirSync(dir, { withFileTypes: true })) {
                const full = join(dir, entry.name);
                if (entry.isDirectory()) {
                    if (
                        entry.name === "node_modules" ||
                        entry.name === "_generated" ||
                        entry.name === "__tests__"
                    ) {
                        continue;
                    }
                    walk(full);
                    continue;
                }
                if (!/\.tsx?$/.test(entry.name)) continue;
                if (/\.test\.tsx?$/.test(entry.name)) continue;
                const text = readFileSync(full, "utf8");
                if (text.includes("...NO_TARGETING_SOURCE")) {
                    offenders.push(full);
                }
            }
        };
        walk("convex");
        walk("src");
        expect(offenders).toEqual([]);
    });
});
