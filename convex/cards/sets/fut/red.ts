// fut — red cards (ADR 0043 colour split).
import type { CardDefinition } from "../../types";
import { IS_NONBASIC_LAND } from "../../types";

// Magus of the Moon — {2}{R} 2/2 Creature — Human Wizard. "Nonbasic lands are
// Mountains." Future Sight's "Magus of the ~" cycle reprints an older
// enchantment's static ability on a creature body, so this is Blood Moon's
// text verbatim (`sets/drk/red.ts`) and therefore Blood Moon's composition —
// the shared `IS_NONBASIC_LAND` predicate (`cards/types.ts`) scanned twice:
//   • `subtype-set` (CR 305.7 layer 4) replaces its land types with Mountain,
//   • `ability-loss` (CR 613.1f layer 6) strips the land's printed abilities,
// in the CR 613.1 layer order — 4 before 6 — so the only ability a nonbasic
// land is left holding is the intrinsic "{T}: Add {R}" its new basic land type
// grants (CR 305.6). The order they are DECLARED in below does not matter:
// each layer is an independently computed read, not a chained mutation. Basic
// lands are untouched. The creature body is plain data — no keyword, no
// ability of its own beyond the static above.
//
// CR 613.8 dependency ordering is unimplemented (tracked-by: #2068): this
// card's layer-4 effect and Urborg, Tomb of Yawgmoth's "Each land is a Swamp"
// each change what the other applies to, so 613.8a makes them dependent and
// 613.8b would order them by dependency. The engine orders every layer-4
// effect by CR 613.7 timestamp instead, which is the wrong board whenever the
// dependency disagrees with the play order.
// compiler-gap: Nonbasic lands are Mountains. (#2693)
export const magusOfTheMoon: CardDefinition = {
    id: "c06a4443-6851-4873-8fb8-2ef76c9d6d2c",
    rarity: "rare",
    name: "Magus of the Moon",
    oracleText: "Nonbasic lands are Mountains.",
    manaCost: { X: 2, R: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Wizard"],
    power: 2,
    toughness: 2,
    staticEffects: [
        // CR 613.1f — the layer-6 ability strip, so the land keeps only what
        // its new Mountain subtype grants it.
        {
            kind: "ability-loss",
            applies: IS_NONBASIC_LAND,
        },
        // CR 305.7 — the land's land types become Mountain, and only Mountain.
        {
            kind: "subtype-set",
            applies: IS_NONBASIC_LAND,
            subtypes: ["Mountain"],
            // CR 613.8a clause (b) — `IS_NONBASIC_LAND` reads the PRINTED type
            // line (`ctx.getPrintedTypes`, which no layer can touch) and the
            // Basic SUPERTYPE. It never reads a land's subtypes, so nothing
            // that writes subtypes changes what this effect applies to and
            // nothing in layer 4 can make it wait. That asymmetry is the whole
            // dependency: Urborg, Tomb of Yawgmoth waits for this effect (CR
            // 305.7 destroys the rules text generating Urborg's own), and this
            // effect waits for nothing.
            reads: ["supertypes"],
        },
    ],
};
