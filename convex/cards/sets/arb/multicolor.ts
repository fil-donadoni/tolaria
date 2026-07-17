// ARB (Alara Reborn) — multicolor cards, split by colour per ADR 0043. The
// registry's `import * as arb from "./sets/arb"` resolves through
// arb/index.ts. Cards are classified by the colour identity of their mana
// cost (CR 202.2).

// Thopter Foundry — {W/B}{U} Artifact (Cube FREE residue token-maker, issue
// #1304). "{1}, Sacrifice a nontoken artifact: Create a 1/1 blue Thopter
// artifact creature token with flying. You gain 1 life." The ability itself
// is fully DSL-free — `createToken` (a vanilla flying Thopter, no ability of
// its own) + `gainLife`, gated by a plain `cost.sacrificeFilter: { type:
// "Artifact", isToken: false }` (no self-exclusion needed: unlike Legion
// Extruder's "sacrifice ANOTHER artifact", "a nontoken artifact" legitimately
// allows the source to sacrifice ITSELF to pay its own cost, CR 602.1 —
// correct per the real card). The BLOCKER is the printed cost {W/B}{U}
// itself: `ManaCost` (`convex/cards/types.ts`) has no hybrid-pip
// representation at all (only fixed per-colour counts) — the same
// already-tracked gap blocking Vibrance/Deceit/Wistfulness (`sets/ecl/*.ts`)
// and one RTR card (`sets/rtr/multicolor.ts`). No new gap here; referencing
// the existing tracker. tracked-by: #782
// export const thopterFoundry: CardDefinition = {
//     id: "42b8d797-b01d-49cf-9818-d84bba17029d",
//     name: "Thopter Foundry",
//     rarity: "uncommon",
//     manaCost: { W: 1, B: 1, U: 1 },
//     types: ["Artifact"],
// };

export {};
