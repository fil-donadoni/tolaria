// CR 605.1a — an activated ability is a mana ability only if, among other
// criteria, "its cost and effect don't move any card to or from a library".
// The engine reads `useStack: false` as "this is a mana ability" (CR 605.3b:
// it resolves at once, unrespondable, and may be activated mid-payment), so a
// stackless ability that draws, mills, searches or otherwise touches a library
// is a rules violation the type system cannot see.
//
// Swept catalogue-wide over BOTH populations a game can load: the hand-written
// registry (`getAllCards()`) and the compiled corpus (`data/oracle-compiled.json`,
// registered into the same runtime map). Every stackless ability, wherever it
// sits in a definition (a granted ability included), must be built only from
// pieces this file has reviewed as library-free:
//
//   - its FIELDS — a closed list, so a new rider (a "draws a card on tap"
//     field) reds here until someone decides which side of the criterion it is
//     on. A closure is opaque to a static sweep: `effect` is safe by its type
//     (`ActivatedAbilityContext` exposes `addMana` only), `getManaChoices` and
//     `canActivate` only read; a stackless `resolve` gets the full
//     `SpellContext`, so each one is reviewed by ability id below;
//   - its COST legs — a closed list (a leg such as `exileTopOfLibrary` moves a
//     card from a library, CR 605.1a's "cost" half);
//   - its Effect Script Ops (`effects`, `manaAbilityEffects`), which must sit in
//     the reviewed stackless set and never be a library Op.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MANA_ABILITY_EFFECT_OPS } from "../../gre/effects/manaAbilityEffectOps";
import { getAllCards } from "../index";

/** Ability fields reviewed as moving no card to or from a library. */
const LIBRARY_FREE_FIELDS: ReadonlySet<string> = new Set([
    "id",
    "oracleText",
    "cost",
    "useStack",
    "activateFromHand",
    "canActivate",
    "controllerTurnOnly",
    "oncePerTurn",
    // What is produced.
    "effect",
    "effects",
    "getManaChoices",
    "manaAmount",
    "manaAmountSource",
    "manaChoices",
    "manaColorSource",
    "manaProduced",
    "manaRestriction",
    "manaChoiceRemovesCounters",
    "manaCantBeCounteredRider",
    "manaHasteRider",
    // Riders: damage, counters, a delayed trigger, a sacrifice, the
    // stackless script (its Ops are checked below).
    "armsDelayedTriggerOnTap",
    "dealsDamageToControllerOnColoredTap",
    "dealsDamageToControllerOnTap",
    "putDepletionCounterOnTap",
    "sacrificesSourceWhenNoCountersRemain",
    "manaAbilityEffects",
    // Opaque: allowed only on the abilities named in REVIEWED_RESOLVE.
    "resolve",
]);

/** Cost legs reviewed as moving no card to or from a library. */
const LIBRARY_FREE_COST_LEGS: ReadonlySet<string> = new Set([
    "addCounter",
    "discardAtRandom",
    "discardFilter",
    "exertThis",
    "exileFromGraveyard",
    "exileThis",
    "life",
    "mana",
    "removeCounter",
    "sacrifice",
    "sacrificeFilter",
    "tap",
    "tapOtherFilter",
]);

/** Ops that move a card to or from a library (`moveZone` when either end is
 *  the library). Never admissible on a stackless ability. */
const LIBRARY_OPS: ReadonlySet<string> = new Set([
    "draw",
    "mill",
    "scryReorder",
    "exileTopOfLibrary",
    "revealTopAndRoute",
    "revealUntilMatch",
    "explore",
    "libraryLook",
    "lookDistribute",
    "revealAndCategorize",
    "digMatchingToHand",
    "putBack",
    "rangedTopdeck",
    "shuffleSelfIntoLibrary",
    "cascade",
]);

/** Stackless `resolve` closures read by hand: ability id → what it does. */
const REVIEWED_RESOLVE: Readonly<Record<string, string>> = {
    "farrelite-priest-mana":
        "adds {W}, may schedule an end-step sacrifice of the source",
    "initiates-ebon-hand-mana":
        "adds {B}, may schedule an end-step sacrifice of the source",
};

interface Offence {
    readonly card: string;
    readonly ability: string;
    readonly what: string;
}

function opsOf(script: unknown, out: Record<string, unknown>[] = []) {
    if (Array.isArray(script)) for (const x of script) opsOf(x, out);
    else if (script !== null && typeof script === "object") {
        const o = script as Record<string, unknown>;
        if (typeof o.op === "string") out.push(o);
        for (const v of Object.values(o)) opsOf(v, out);
    }
    return out;
}

function touchesLibrary(op: Record<string, unknown>): boolean {
    if (LIBRARY_OPS.has(op.op as string)) return true;
    return (
        op.op === "moveZone" && (op.from === "library" || op.to === "library")
    );
}

const STACKLESS_OPS: ReadonlySet<string> = new Set([
    "addMana",
    ...MANA_ABILITY_EFFECT_OPS,
]);

/** Every offence of one stackless ability against the reviewed lists. */
function stacklessLibraryOffences(
    card: string,
    ability: Record<string, unknown>
): Offence[] {
    const id = String(ability.id);
    const out: Offence[] = [];
    const flag = (what: string) => out.push({ card, ability: id, what });
    for (const field of Object.keys(ability))
        if (!LIBRARY_FREE_FIELDS.has(field))
            flag(`unreviewed field "${field}"`);
    for (const leg of Object.keys((ability.cost ?? {}) as object))
        if (!LIBRARY_FREE_COST_LEGS.has(leg))
            flag(`unreviewed cost leg "${leg}"`);
    if ("resolve" in ability && REVIEWED_RESOLVE[id] === undefined)
        flag("unreviewed stackless resolve()");
    for (const op of opsOf([ability.effects, ability.manaAbilityEffects])) {
        if (touchesLibrary(op)) flag(`library Op "${String(op.op)}"`);
        else if (!STACKLESS_OPS.has(op.op as string))
            flag(`unreviewed Op "${String(op.op)}"`);
    }
    return out;
}

/** Every stackless activated ability anywhere in a definition tree. */
function stacklessAbilities(root: unknown): Record<string, unknown>[] {
    const found: Record<string, unknown>[] = [];
    const seen = new Set<unknown>();
    const walk = (x: unknown) => {
        if (x === null || typeof x !== "object" || seen.has(x)) return;
        seen.add(x);
        if (Array.isArray(x)) return x.forEach(walk);
        const o = x as Record<string, unknown>;
        if (o.useStack === false && "cost" in o) found.push(o);
        Object.values(o).forEach(walk);
    };
    walk(root);
    return found;
}

function offencesIn(
    cards: readonly { name: string; definition: unknown }[]
): Offence[] {
    return cards.flatMap(({ name, definition }) =>
        stacklessAbilities(definition).flatMap((a) =>
            stacklessLibraryOffences(name, a)
        )
    );
}

describe("CR 605.1a — no stackless ability moves a card to or from a library", () => {
    it("the reviewed lists never admit a library Op", () => {
        expect([...STACKLESS_OPS].filter((op) => LIBRARY_OPS.has(op))).toEqual(
            []
        );
    });

    it("hand-written catalogue", () => {
        const cards = getAllCards().map((c) => ({
            name: c.name,
            definition: c,
        }));
        expect(offencesIn(cards)).toEqual([]);
    });

    it("compiled corpus (data/oracle-compiled.json)", () => {
        const lock = JSON.parse(
            readFileSync("data/oracle-compiled.json", "utf8")
        ) as { cards: { name: string; definition?: unknown }[] };
        const cards = lock.cards.flatMap((c) =>
            c.definition === undefined
                ? []
                : [{ name: c.name, definition: c.definition }]
        );
        expect(cards.length).toBeGreaterThan(1000);
        expect(offencesIn(cards)).toEqual([]);
    });

    it("reds a draw rider, a library cost leg and a library Op", () => {
        const offences = stacklessLibraryOffences("Probe", {
            id: "probe-mana",
            oracleText: "",
            cost: { tap: true, exileTopOfLibrary: true },
            useStack: false,
            manaProduced: { G: 1 },
            drawOnTapRider: 1,
            manaAbilityEffects: [
                { op: "moveZone", from: "library", to: "graveyard" },
            ],
        });
        expect(offences.map((o) => o.what)).toEqual([
            'unreviewed field "drawOnTapRider"',
            'unreviewed cost leg "exileTopOfLibrary"',
            'library Op "moveZone"',
        ]);
    });
});
