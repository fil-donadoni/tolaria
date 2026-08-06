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
    PROTECTION_FROM_COLORED_SPELLS,
    protectionSourceView,
} from "../protection";
import {
    getLegalTargets,
    getPendingTargetSourceSupertypes,
    NO_TARGETING_SOURCE,
    pendingTargetingSource,
    protectionSourceFromTargeting,
    raiseTriggerTargetSelection,
} from "../rules";
import { collectTriggers } from "../triggers";
import { buildSpellContext, resolveTopOfStack } from "../state";
import { pushSpell } from "../../cards/__tests__/setup";
import { legalActions } from "../legalActions";
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
        expect(isProtectedFromSource(tsabo(), source, false)).toBe(true);
    });

    it("does NOT match a non-legendary creature source", () => {
        const source = makeInstance(GRIZZLY_BEARS, { id: "bears" });
        expect(isProtectedFromSource(tsabo(), source, false)).toBe(false);
    });

    it("does NOT match a legendary NON-creature source (the conjunction holds)", () => {
        // Karakas is a Legendary Land — it has the supertype but not the card
        // type, so "protection from legendary creatures" does not apply.
        const source = makeInstance(KARAKAS, { id: "karakas" });
        expect(isProtectedFromSource(tsabo(), source, false)).toBe(false);
    });

    it("has NO controller exception — the controller's own legend is barred too", () => {
        const own = makeInstance(BARKTOOTH, {
            id: "own",
            controllerId: "p1",
            ownerId: "p1",
        });
        expect(isProtectedFromSource(tsabo("p1"), own, false)).toBe(true);
    });

    it("reads supertypes LIVE (CR 205.4a) — a granted Legendary makes a plain bear match", () => {
        const bears = makeInstance(GRIZZLY_BEARS, { id: "bears" });
        expect(isProtectedFromSource(tsabo(), bears, false)).toBe(false);
        expect(
            isProtectedFromSource(tsabo(), makeLegendary(bears), false)
        ).toBe(true);
    });

    it("fails closed on a source with no matching characteristics", () => {
        expect(
            isProtectedFrom(tsabo(), {
                colors: [],
                types: [],
                supertypes: [],
                controllerId: "p2",
                isSpell: false,
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
            isProtectedFromSource(
                state.players[0].battlefield[0],
                legend0,
                false
            )
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
                slimLegend as unknown as CardInstanceState,
                false
            )
        ).toBe(true);
        expect(
            isProtectedFromSource(
                slimTsabo as unknown as CardInstanceState,
                slimBears as unknown as CardInstanceState,
                false
            )
        ).toBe(false);
        expect(
            protectionSourceView(
                slimLegend as unknown as CardInstanceState,
                false
            ).supertypes
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
        expect(isProtectedFromSource(tsabo(), legend, false)).toBe(true);
        expect(isProtectedFromSource(tsabo(), bear, false)).toBe(false);
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

/** Strips `//` line comments and block comments so the scan below sees CODE
 *  only. Load-bearing: prose in an engine comment that merely NAMES the two
 *  fields (there is one, in `game.ts`, explaining this very invariant) would
 *  otherwise register as a violation. */
function stripComments(text: string): string {
    return text
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** Every production (non-test) `.ts`/`.tsx` file, excluding the TWO modules
 *  that DEFINE a source bundle and its constructors, and are therefore the
 *  only places the shape may legitimately be written out: `gre/rules.ts`
 *  (`TargetingSource` + `targetingSourceFromCard` / `pendingTargetingSource` /
 *  `NO_TARGETING_SOURCE` / `protectionSourceFromTargeting`) and
 *  `gre/protection.ts` (`ProtectionSourceView` + `protectionSourceView` /
 *  `protectionSourceCharacteristics`, issue #2296). */
function productionFiles(
    /** Repo-relative path suffixes of the modules that legitimately DEFINE
     *  what the caller's guard polices. Defaults to the two source-bundle
     *  constructors; the absent-kind guard below passes `gre/constants.ts`. */
    definingModules: string[] = [
        join("gre", "rules.ts"),
        join("gre", "protection.ts"),
    ]
): string[] {
    const out: string[] = [];
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
            if (definingModules.some((m) => full.endsWith(m))) continue;
            out.push(full);
        }
    };
    walk("convex");
    walk("src");
    return out;
}

/** A `TargetingSource` — or, since issue #2296, a `ProtectionSourceView` —
 *  being written out by hand. This is a LEXICAL scan, not
 *  an AST shape check: it flags the co-occurrence of the `supertypes` and
 *  `isSpell` IDENTIFIERS within 400 characters of each other in
 *  comment-stripped code. Matching on identifiers rather than `key:` colon
 *  pairs is what makes it catch ES6 shorthand (`{ colors, types, subtypes,
 *  supertypes, isSpell }` — the most idiomatic way to write the forbidden
 *  helper) and property assignment, both of which an earlier `supertypes:` …
 *  `isSpell:` version walked straight past.
 *
 *  Why the pair discriminates: exactly two types in the codebase carry both
 *  fields, `TargetingSource` and `ProtectionSourceView`, and both are excluded
 *  above at their defining module — `GuardActionSource` has `isSpell` and no
 *  `supertypes`; the various supertype views have `supertypes` and no
 *  `isSpell`. Since #2296 that makes this ONE regex police BOTH bundles: the
 *  accepted set (`game.ts::selectTarget`) used to hand-write its
 *  `ProtectionSourceView` literal, which the guard could not see because the
 *  view had no `isSpell` field to co-occur with; it now goes through
 *  `protectionSourceFromTargeting`, the same projection the offered set uses.
 *
 *  What it does NOT catch, stated plainly rather than overclaimed: a hand-built
 *  bundle whose two fields are more than 400 characters apart, or one assembled
 *  field-by-field across separate statements with other code between. The
 *  residual risk is small because all five fields are compiler-enforced — only
 *  a WRONG VALUE can slip through, never a missing dimension. */
const HAND_ASSEMBLED =
    /\bsupertypes\b[\s\S]{0,400}?\bisSpell\b|\bisSpell\b[\s\S]{0,400}?\bsupertypes\b/;

describe("single-authority guard — source bundles are never hand-assembled", () => {
    it("production code builds a TargetingSource / ProtectionSourceView ONLY through their constructors", () => {
        // `TargetingSource` has five required fields, so omitting one is a
        // compile error — but a hand-written bundle type-checks fine and
        // silently reintroduces the divergence class (a site free-hands
        // `isSpell: kind !== "ability"`, calling a triggered ability a spell —
        // issue #1120 review round 3). The only safe constructors are
        // `targetingSourceFromCard`, `pendingTargetingSource` and
        // `NO_TARGETING_SOURCE`, all in `gre/rules.ts`.
        const offenders: string[] = [];
        for (const file of productionFiles()) {
            const code = stripComments(readFileSync(file, "utf8"));
            if (code.includes("...NO_TARGETING_SOURCE")) {
                offenders.push(`${file} (spread)`);
            }
            if (HAND_ASSEMBLED.test(code)) {
                offenders.push(`${file} (hand-assembled bundle)`);
            }
        }
        expect(offenders).toEqual([]);
    });

    it("the guard detects every hand-assembly form it claims to (self-check)", () => {
        // Proof the pattern is load-bearing. A guard whose regex silently
        // stopped matching would report green forever — the failure mode this
        // whole file exists to make impossible.
        const colonLiteral = `getLegalTargets(state, req, {
            colors: [], types: [], subtypes: [], supertypes: [], isSpell: true,
        }, "p1");`;
        const shorthand = `return { colors, types, subtypes, supertypes, isSpell };`;
        const assignment = `src.supertypes = []; src.isSpell = true;`;
        expect(HAND_ASSEMBLED.test(colonLiteral)).toBe(true);
        expect(HAND_ASSEMBLED.test(shorthand)).toBe(true);
        expect(HAND_ASSEMBLED.test(assignment)).toBe(true);
        // …and does NOT match a `GuardActionSource` (no `supertypes`).
        expect(
            HAND_ASSEMBLED.test(
                `{ types: [], subtypes: [], isSpell: true, controllerId: "p1" }`
            )
        ).toBe(false);
    });

    // ── The ABSENT-kind default has one home too (issue #2296 review) ──
    //
    // `PendingTarget.kind` is optional and `announceCast` omits it, so every
    // reader must resolve `undefined` to `"cast"`. That default used to be
    // hand-written at six server sites while the CLIENT's gate independently
    // mapped `undefined` to "not a spell" — so for the DOMINANT production
    // shape (any ordinary cast) the client offered a target the server then
    // rejected: the ADR 0068 divergence, from a duplicated one-liner rather
    // than a duplicated bundle. `resolvePendingTargetKind` (`gre/constants.ts`)
    // is now the only place it lives.
    const LOCAL_KIND_DEFAULT = /\bkind\b\s*\?\?\s*["']cast["']/;

    it("production code never re-states the absent-kind default", () => {
        const offenders: string[] = [];
        for (const file of productionFiles([join("gre", "constants.ts")])) {
            const code = stripComments(readFileSync(file, "utf8"));
            if (LOCAL_KIND_DEFAULT.test(code)) offenders.push(file);
        }
        expect(offenders).toEqual([]);
    });

    it("the absent-kind pattern matches the shapes it claims to (self-check)", () => {
        expect(LOCAL_KIND_DEFAULT.test(`const k = pt.kind ?? "cast";`)).toBe(
            true
        );
        expect(
            LOCAL_KIND_DEFAULT.test(`source(state, id, kind ?? 'cast')`)
        ).toBe(true);
        // …and does not fire on the shared helper's own call sites.
        expect(
            LOCAL_KIND_DEFAULT.test(`resolvePendingTargetKind(pt.kind)`)
        ).toBe(false);
    });

    it("the comment stripper is what keeps prose from registering (self-check)", () => {
        // `game.ts` carries a comment naming both fields while explaining this
        // invariant. Without stripping, the guard would flag the very file it
        // was written to protect.
        const prose = `// the offered side dropped supertypes; the accepted side kept isSpell`;
        expect(HAND_ASSEMBLED.test(prose)).toBe(true);
        expect(HAND_ASSEMBLED.test(stripComments(prose))).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────
// CR 113.3 — a TRIGGERED ability is not a spell, on every offered/accepted
// site (issue #1120 review round 3)
// ─────────────────────────────────────────────────────────────────────────
//
// This is the sibling axis to protection: `TargetingSource.isSpell` narrows
// `targetSourceMustBeSpell` guards. Lurker ("This creature can't be the target
// of SPELLS unless it attacked or blocked this turn", `drk/green.ts`) is the
// shipped fixture — a triggered ability MUST be able to target it.
//
// Before the `TargetingSource` bundle, the three sites disagreed:
//   - `raiseTriggerTargetSelection` (engine)   → isSpell false  (CR-correct)
//   - `legalActions.ts` (bot/UI enumerator)    → `kind !== "ability"` = TRUE
//   - `selectTarget` guard (accepted set)      → `kind !== "ability"` = TRUE
// so a trigger targeting Lurker was offered by the engine, hidden from the bot
// enumerator, and REJECTED by the mutation. All three now read the one bundle.

describe("CR 113.3 — a triggered ability is not a spell (Lurker, spell-only guard)", () => {
    const LURKER = "b39eb671-e17e-4c5a-8913-1e3be7faedfb";

    /** Lurker (p2, has not attacked/blocked → guard ACTIVE) and a plain bear,
     *  with `sourceId` on p1's stack as a triggered-ability item and a
     *  `kind: "trigger"` PendingTarget owed to p1. */
    function lurkerTriggerState(): GameState {
        const lurker = makeInstance(LURKER, {
            id: "lurker",
            controllerId: "p2",
            ownerId: "p2",
        });
        const bear = makeInstance(GRIZZLY_BEARS, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const halfdane = makeInstance("2e939761-3542-4044-9038-d1d30c6a38fc", {
            id: "halfdane",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            phase: "UPKEEP",
            activePlayerId: "p1",
            players: [
                makePlayer("p1", { battlefield: [halfdane] }),
                makePlayer("p2", { battlefield: [lurker, bear] }),
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
        raiseTriggerTargetSelection(state);
        return state;
    }

    it("pendingTargetingSource reports isSpell:false for a trigger, true for a cast", () => {
        const state = lurkerTriggerState();
        const pt = state.pendingTarget!;
        expect(pt.kind).toBe("trigger");
        expect(
            pendingTargetingSource(state, pt.cardInstanceId, "trigger").isSpell
        ).toBe(false);
        expect(
            pendingTargetingSource(state, pt.cardInstanceId, "retarget").isSpell
        ).toBe(true);
    });

    it("the BOT/UI enumerator offers Lurker to a triggered ability (finding 1)", () => {
        // `legalActions` drives `targetActions`, which used to pass
        // `isSpell: kind !== "ability"` — TRUE for a trigger — so Lurker's
        // spell-only guard wrongly hid it from the enumerator.
        const state = lurkerTriggerState();
        const offered = legalActions(state)
            .map((a) => a.action)
            .filter((a) => a.kind === "select-target")
            .map((a) => (a as { target: { id: string } }).target.id);
        expect(offered).toContain("lurker");
        expect(offered).toContain("bear");
    });

    it("the ENGINE offered set agrees (getLegalTargets through the same bundle)", () => {
        const state = lurkerTriggerState();
        const pt = state.pendingTarget!;
        const offered = getLegalTargets(
            state,
            { type: "Creature", count: 1 },
            pendingTargetingSource(state, pt.cardInstanceId, "trigger"),
            pt.playerId
        ).map((t) => t.id);
        expect(offered).toContain("lurker");
    });

    it("must-NOT — a CAST source is still barred by Lurker's spell-only guard", () => {
        // Proves the gate is genuinely spell-narrowed, not disabled outright.
        const state = lurkerTriggerState();
        const offered = getLegalTargets(
            state,
            { type: "Creature", count: 1 },
            {
                ...NO_TARGETING_SOURCE,
                types: ["Instant"],
                isSpell: true,
            },
            "p1"
        ).map((t) => t.id);
        expect(offered).not.toContain("lurker");
        expect(offered).toContain("bear");
    });
});

// ─────────────────────────────────────────────────────────────────────────
// CR 702.16a — "protection from spells that are one or more colors"
// (issue #2296): the SPELL-RESTRICTED, ANY-COLOUR quality
// ─────────────────────────────────────────────────────────────────────────
//
// The quality is a CONJUNCTION of two independent facts, and this block is
// organised as the producer census that drove it — one `it` per source shape,
// with the must-NOT rows carrying most of the weight. Honouring only the
// colour half (the easy half: `colors.length > 0`) leaves an engine that bars
// coloured PERMANENTS, coloured BLOCKERS and the ABILITIES of coloured
// permanents, none of which CR 702.16 bars. Every source below is derived
// from a REAL catalogue card through the production projection
// (`pendingTargetingSource` / `protectionSourceFromTargeting` /
// `protectionSourceView`) — never a hand-written literal — because a literal
// lets the test assert the answer it already assumed.
//
//   source shape                                     spell?  coloured?  barred?
//   Lightning Bolt cast from hand (red Instant)      yes     yes        YES
//   Blessing cast from hand (white Aura)             yes     yes        YES
//   Ornithopter cast from hand (colourless)          yes     no         no
//   Prodigal Sorcerer's activated ability (blue)     no      yes        no
//   Grizzly Bears blocking / dealing combat damage   no      yes        no

const LIGHTNING_BOLT = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a"; // red Instant
const PYROCLASM = "88040748-ad76-4b9a-bd4e-87e5980e9816"; // red Sorcery, untargeted sweep
const ORNITHOPTER = "59cc9bdb-7cf2-4795-bac7-ffff605c9eb0"; // colourless Artifact Creature
const PRODIGAL_SORCERER = "e4dc1103-7bf1-47f6-9006-d3ed9ccd7a6a"; // blue, {T}: 1 damage

/** A plain creature carrying the new quality. Granted onto a shipped vanilla
 *  rather than invented as a card definition: no catalogue card declares the
 *  string yet (Emrakul is the tracked stub this slice unblocks, PRD #1301),
 *  and `staticAbilities` is exactly where a printed or granted keyword lands,
 *  so the predicate reads it through the identical path either way. */
function warded(controllerId = "p1", id = "warded"): CardInstanceState {
    const card = makeInstance(GRIZZLY_BEARS, {
        id,
        controllerId,
        ownerId: controllerId,
    });
    card.staticAbilities = [
        ...card.staticAbilities,
        PROTECTION_FROM_COLORED_SPELLS,
    ];
    return card;
}

describe("parseProtectionQuality — spells that are one or more colors (CR 702.16a)", () => {
    it("parses the phrase, and the parser agrees with isProtectionAbility", () => {
        expect(isProtectionAbility(PROTECTION_FROM_COLORED_SPELLS)).toBe(true);
        expect(parseProtectionQuality(PROTECTION_FROM_COLORED_SPELLS)).toEqual({
            kind: "colored-spell",
        });
        // The combination the catalogue guard fails on — `isProtectionAbility`
        // true while the parser returns null — is what blocked the card.
        expect(parseProtectionQuality(PROTECTION_FROM_COLORED_SPELLS)).not.toBe(
            null
        );
    });

    it("still FAILS CLOSED on a neighbouring phrasing it does not name", () => {
        // The parser must not become a loose "mentions spells and colors"
        // heuristic — an unnameable quality has to reach the catalogue guard.
        expect(
            parseProtectionQuality("protection from colored spells")
        ).toBeNull();
        expect(
            parseProtectionQuality("protection from spells that are all colors")
        ).toBeNull();
    });

    it("reads through CR 612.6 text changes and dedups (CR 702.16m)", () => {
        const card = warded();
        card.staticAbilities = [
            PROTECTION_FROM_COLORED_SPELLS,
            PROTECTION_FROM_COLORED_SPELLS,
        ];
        expect(getProtectionQualities(card)).toEqual([
            { kind: "colored-spell" },
        ]);
    });
});

describe("isProtectedFrom — spells that are one or more colors (CR 702.16a/112.1/105.2)", () => {
    /** The board every row below reads from: the warded creature and a plain
     *  bear for p1; p2 holds a red Instant, a white Aura and a colourless
     *  artifact creature in hand, and controls a blue Prodigal Sorcerer. */
    function board(): GameState {
        return makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        warded("p1"),
                        makeInstance(GRIZZLY_BEARS, {
                            id: "plain",
                            controllerId: "p1",
                            ownerId: "p1",
                        }),
                    ],
                }),
                makePlayer("p2", {
                    hand: [
                        makeInstance(LIGHTNING_BOLT, {
                            id: "bolt",
                            controllerId: "p2",
                            ownerId: "p2",
                            zone: "hand",
                        }),
                        makeInstance(BLESSING, {
                            id: "aura",
                            controllerId: "p2",
                            ownerId: "p2",
                            zone: "hand",
                        }),
                        makeInstance(ORNITHOPTER, {
                            id: "orni",
                            controllerId: "p2",
                            ownerId: "p2",
                            zone: "hand",
                        }),
                    ],
                    battlefield: [
                        makeInstance(PRODIGAL_SORCERER, {
                            id: "tim",
                            controllerId: "p2",
                            ownerId: "p2",
                        }),
                    ],
                }),
            ],
        });
    }

    /** The OFFERED set (`getLegalTargets`) for a "target creature" requirement,
     *  from a source derived by the production helper. */
    function offered(
        state: GameState,
        sourceId: string,
        kind: "cast" | "ability"
    ): string[] {
        return getLegalTargets(
            state,
            CREATURE_REQ,
            pendingTargetingSource(state, sourceId, kind),
            "p2"
        ).map((t) => t.id);
    }

    /** The ACCEPTED set's verdict — the exact expression `selectTarget`
     *  (`convex/game.ts`) evaluates for CR 702.16b. */
    function accepted(
        state: GameState,
        sourceId: string,
        kind: "cast" | "ability",
        target: CardInstanceState
    ): boolean {
        return isProtectedFrom(
            target,
            protectionSourceFromTargeting(
                pendingTargetingSource(state, sourceId, kind),
                "p2"
            )
        );
    }

    it("MUST — a coloured SPELL cannot target it, offered set and accepted set agreeing", () => {
        const state = board();
        const target = state.players[0].battlefield[0];
        expect(pendingTargetingSource(state, "bolt", "cast")).toMatchObject({
            colors: ["R"],
            isSpell: true,
        });
        expect(offered(state, "bolt", "cast")).not.toContain("warded");
        expect(offered(state, "bolt", "cast")).toContain("plain");
        expect(accepted(state, "bolt", "cast", target)).toBe(true);
    });

    it("MUST — a coloured AURA spell cannot target it (CR 702.16b, not 702.16c)", () => {
        const state = board();
        const target = state.players[0].battlefield[0];
        expect(pendingTargetingSource(state, "aura", "cast")).toMatchObject({
            colors: ["W"],
            isSpell: true,
        });
        expect(offered(state, "aura", "cast")).not.toContain("warded");
        expect(accepted(state, "aura", "cast", target)).toBe(true);
    });

    it("must-NOT — a COLOURLESS spell targets it normally (CR 105.2)", () => {
        const state = board();
        const target = state.players[0].battlefield[0];
        expect(pendingTargetingSource(state, "orni", "cast")).toMatchObject({
            colors: [],
            isSpell: true,
        });
        expect(offered(state, "orni", "cast")).toContain("warded");
        expect(accepted(state, "orni", "cast", target)).toBe(false);
    });

    it("must-NOT — an ABILITY of a COLOURED permanent targets it normally (CR 113.3)", () => {
        const state = board();
        const target = state.players[0].battlefield[0];
        // The ability's stack item is a clone of the blue permanent, so its
        // COLOURS match the permanent's exactly — the spell bit is the only
        // thing that separates this row from the Lightning Bolt row above.
        expect(pendingTargetingSource(state, "tim", "ability")).toMatchObject({
            colors: ["U"],
            isSpell: false,
        });
        expect(offered(state, "tim", "ability")).toContain("warded");
        expect(accepted(state, "tim", "ability", target)).toBe(false);
    });

    it("must-NOT — a coloured PERMANENT source is not barred at all", () => {
        const bear = makeInstance(GRIZZLY_BEARS, { id: "bear" });
        expect(isProtectedFromSource(warded(), bear, false)).toBe(false);
        // …and the SAME card object, stated as a spell, IS barred. One
        // argument apart: proof the predicate keys on the caller's fact and
        // not on anything readable off the card.
        expect(isProtectedFromSource(warded(), bear, true)).toBe(true);
    });

    it("wire format — the same verdicts survive projectPublicState", () => {
        const state = board();
        const projected = projectPublicState(state, 1, "p2");
        const slimWarded = projected.players[0].battlefield.find(
            (c) => c.id === "warded"
        )! as unknown as CardInstanceState;
        const slimTim = projected.players[1].battlefield.find(
            (c) => c.id === "tim"
        )! as unknown as CardInstanceState;
        expect(slimWarded.staticAbilities).toContain(
            PROTECTION_FROM_COLORED_SPELLS
        );
        // The projection strips `card.card` to `{ id }`; colours must still
        // resolve through the registry on the client's side of the wire.
        expect(protectionSourceView(slimTim, true).colors).toEqual(["U"]);
        expect(isProtectedFromSource(slimWarded, slimTim, true)).toBe(true);
        expect(isProtectedFromSource(slimWarded, slimTim, false)).toBe(false);
    });
});

describe("CR 702.16e — damage from a coloured spell is prevented, from an ability is not", () => {
    function damageBoard(): GameState {
        return makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        warded("p1"),
                        // 6/5, so it SURVIVES the 2 damage below and can be
                        // read for `damageMarked` (a 2/2 control would be
                        // destroyed by SBA and the assertion would read
                        // `undefined ?? 0`, passing for the wrong reason).
                        makeInstance(BARKTOOTH, {
                            id: "plain",
                            controllerId: "p1",
                            ownerId: "p1",
                        }),
                    ],
                }),
                makePlayer("p2", {
                    battlefield: [
                        makeInstance(PRODIGAL_SORCERER, {
                            id: "tim",
                            controllerId: "p2",
                            ownerId: "p2",
                        }),
                    ],
                }),
            ],
        });
    }

    it("MUST — Pyroclasm (a red SORCERY) deals it no damage, but hits the plain bear", () => {
        // End-to-end through the real path: pushSpell → resolveTopOfStack →
        // the Effect Script's `dealDamage` → `isProtectedFromSource(card,
        // item, isSpellStackItem(item))`. Pyroclasm is UNTARGETED, so the CR
        // 608.2b legality gate cannot be what stops it — this isolates the
        // 702.16e damage clause from the 702.16b targeting clause.
        const state = damageBoard();
        pushSpell(state, PYROCLASM, "p2");
        resolveTopOfStack(state);
        const bf = state.players[0].battlefield;
        expect(bf.find((c) => c.id === "warded")!.damageMarked ?? 0).toBe(0);
        expect(
            bf.find((c) => c.id === "plain")!.damageMarked ?? 0
        ).toBeGreaterThan(0);
    });

    it("must-NOT — damage from a COLOURLESS spell lands (CR 105.2, the acceptance criterion's damage half)", () => {
        // The targeting half of "a colourless spell affects it normally" is
        // asserted above (`offered`/`accepted` rows); this is the DAMAGE half,
        // through the same `SpellContext.dealDamage` an Effect Script's
        // `dealDamage` Op calls — hence the same CR 702.16e gate Pyroclasm is
        // stopped by. The source is a colourless PERMANENT spell (Ornithopter)
        // on the stack rather than a burn spell because the catalogue contains
        // no colourless Instant/Sorcery at all (471 of them, every one
        // coloured); what the gate reads is the pair (is-a-spell, colours), and
        // this fixture is the only shipped way to present "spell + colourless".
        const state = damageBoard();
        const orni = makeInstance(ORNITHOPTER, {
            id: "orni",
            controllerId: "p2",
            ownerId: "p2",
            zone: "stack",
        });
        const item = {
            ...orni,
            castById: "p2",
        } as unknown as (typeof state.stack)[number];
        state.stack.push(item);
        // 1, not lethal: the warded creature is a 2/2, and a destroyed
        // creature would leave `find(...)` undefined instead of asserting the
        // damage actually landed.
        buildSpellContext(state, item).dealDamage(
            { type: "permanent", id: "warded" },
            1
        );
        expect(
            state.players[0].battlefield.find((c) => c.id === "warded")!
                .damageMarked ?? 0
        ).toBe(1);
    });

    it("must-NOT — the same 1 damage from a coloured permanent's ABILITY lands (CR 113.3)", () => {
        const state = damageBoard();
        const tim = state.players[1].battlefield[0];
        state.stack.push({
            ...tim,
            zone: "stack",
            castById: "p2",
            abilityId: "prodigal-sorcerer-zap",
            targets: [{ type: "permanent", id: "warded" }],
        });
        resolveTopOfStack(state);
        const after = state.players[0].battlefield.find(
            (c) => c.id === "warded"
        );
        // The ability was neither fizzled by the CR 608.2b gate nor prevented
        // by CR 702.16e — a blue permanent's ability is not a blue spell.
        expect(after?.damageMarked ?? 0).toBe(1);
    });
});

describe("CR 702.16d/f — a coloured PERMANENT blocks, is blocked, and equips normally", () => {
    it("must-NOT — a coloured creature can block it and be blocked by it", () => {
        // CR 702.16f is VACUOUS for this quality (a spell never blocks), but
        // the code path still RUNS and must answer "no" rather than be
        // skipped. Both directions, since the protected creature is the
        // ATTACKER in one and the BLOCKER in the other.
        const attacker = warded("p1", "atk");
        attacker.isAttacking = true;
        const blocker = makeInstance(GRIZZLY_BEARS, {
            id: "blk",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [attacker] }),
                makePlayer("p2", { battlefield: [blocker] }),
            ],
        });
        expect(
            validateBlockerEligibility(attacker, blocker, [blocker], state)
                .eligible
        ).toBe(true);
        expect(
            validateBlockerEligibility(blocker, attacker, [attacker], state)
                .eligible
        ).toBe(true);
    });

    it("must-NOT — combat damage from a coloured creature still lands", () => {
        const attacker = makeInstance(GRIZZLY_BEARS, {
            id: "attacker",
            controllerId: "p2",
            ownerId: "p2",
            isAttacking: true,
        });
        const blocker = warded("p1");
        blocker.isBlocking = true;
        const state = makeState({
            phase: "COMBAT_DAMAGE",
            activePlayerId: "p2",
            players: [
                makePlayer("p1", { battlefield: [blocker] }),
                makePlayer("p2", { battlefield: [attacker] }),
            ],
            combat: {
                confirmed: true,
                attackerIds: ["attacker"],
                blockerAssignments: { warded: ["attacker"] },
                blockedAttackerIds: ["attacker"],
                blockersConfirmed: true,
                damageConfirmed: false,
            } as GameState["combat"],
        });
        // 1, not 2: the warded creature is a 2/2 and lethal damage would let
        // the SBA remove it, so the assertion below would read `undefined`
        // and a genuinely PREVENTED hit would look identical to a landed one.
        applyAllCombatDamage(state, { attacker: { warded: 1 } });
        expect(
            state.players[0].battlefield.find((c) => c.id === "warded")
                ?.damageMarked ?? 0
        ).toBeGreaterThan(0);
    });

    it("must-NOT — a coloured Equipment stays attached (CR 702.16d, 704.5n)", () => {
        const host = warded("p1");
        host.attachedTo = undefined;
        const equipment = makeInstance(LION_SASH, {
            id: "sash",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "warded",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [host, equipment] }),
                makePlayer("p2"),
            ],
        });
        expect(checkAttachmentSBA(state)).toBe(false);
        expect(
            state.players[0].battlefield.find((c) => c.id === "sash")!
                .attachedTo
        ).toBe("warded");
    });

    it("must-NOT — an attached coloured Aura stays attached (CR 702.16c, 704.5m)", () => {
        const aura = makeInstance(BLESSING, {
            id: "aura",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "warded",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [warded("p1"), aura] }),
                makePlayer("p2"),
            ],
        });
        checkAuraAttachmentSBA(state);
        expect(
            state.players[0].battlefield.find((c) => c.id === "aura")
                ?.attachedTo
        ).toBe("warded");
    });
});
