// clb — blue cards (ADR 0043 colour split).

import { PERMANENT_TYPES } from "../../types";
import type { CardDefinition, GameEvent, PermanentView } from "../../types";

// Displacer Kitten — {3}{U} Creature — Cat Beast, 2/2 (issue #1375, closes
// the #1308 residue stub). "Avoidance — Whenever you cast a noncreature
// spell, exile up to one target nonland permanent you control, then return
// that card to the battlefield under its owner's control." ("Avoidance" is a
// flavor ability WORD, not a keyword — no `staticAbilities` entry.)
//
// Three already-shipped pieces compose the whole card, no new Op:
//  - CR 603.2 SPELL_CAST trigger with a noncreature-spell `matches` filter —
//    the Third Path Iconoclast / Vivi Ornitier shape (`bro/multicolor.ts`,
//    `fin/multicolor.ts`).
//  - CR 603.3d targeted trigger (issue #1193): "up to one target nonland
//    permanent you control" is a REAL target locked when the ability is put
//    on the stack, so it is subject to hexproof / protection / ward and
//    fires "becomes the target" triggers. `type: PERMANENT_TYPES` minus Land
//    is the Boomerang idiom (`ons/blue.ts`); `count {min: 0, max: 1}` is the
//    "up to one" shape (Phelia, `mh3/white.ts`); `controller: "you"` scopes
//    the candidates to your own battlefield.
//  - CR 400.7 same-resolution blink (issue #1401): `exile` with a `bind`
//    snapshots the card before it moves, and the immediate `moveZone`
//    resolves that ref back through `resolveObjectRef`'s exile-zone fallback,
//    returning it under its OWNER's control (no explicit `controller` — the
//    default IS the owner). This is Ephemerate's idiom (`mh1/white.ts`), NOT
//    Phelia's delayed-trigger variant: the Oracle text returns the card in
//    the same resolution, with no end-step delay.
//
// "Up to one" with no target chosen (or none legal, CR 603.3c) is a clean
// no-op: `exile` early-returns on an unresolvable target so `$c` stays
// unbound, and `moveZone`'s ref recovery then finds no id and returns too.
export const displacerKitten: CardDefinition = {
    id: "c7a401b8-29fb-46ef-a663-427f66724d5c",
    name: "Displacer Kitten",
    rarity: "rare",
    oracleText:
        "Avoidance — Whenever you cast a noncreature spell, exile up to one target nonland permanent you control, then return that card to the battlefield under its owner's control.",
    manaCost: { X: 3, U: 1 },
    types: ["Creature"],
    subtypes: ["Cat", "Beast"],
    power: 2,
    toughness: 2,
    triggeredAbilities: [
        {
            id: "displacer-kitten-blink",
            oracleText:
                "Avoidance — Whenever you cast a noncreature spell, exile up to one target nonland permanent you control, then return that card to the battlefield under its owner's control.",
            event: "SPELL_CAST",
            // CR 603.2 — fires only when the source's controller is the caster
            // and the cast spell is NOT a creature spell (CR 601.2i).
            matches: (event: GameEvent, self: PermanentView): boolean =>
                event.type === "SPELL_CAST" &&
                event.casterId === self.controllerId &&
                !event.spellTypes.includes("Creature"),
            targetRequirement: {
                type: [...PERMANENT_TYPES],
                count: { min: 0, max: 1 },
                excludeTypes: "Land",
                controller: "you",
            },
            effects: [
                { op: "exile", target: { target: 0 }, bind: "$c" },
                { op: "moveZone", target: { ref: "$c" }, to: "battlefield" },
            ],
        },
    ],
};
