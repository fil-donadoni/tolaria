// m20 — colorless cards (ADR 0043 colour split).
import { defineCard, type PermanentView } from "../../types";

// Manifold Key — {1} Artifact (issue #684, Cube FREE evasion/protection
// statics). "{1}, {T}: Untap another target artifact.\n{3}, {T}: Target
// creature can't be blocked this turn." (CR 701.26 untap; CR 702.9 flying-class
// "can't be blocked" via the engine's `unblockable` keyword grant, CR
// 613.1f temporary keyword grant.)
export const manifoldKey = defineCard(() => ({
    id: "715e637a-dfd8-45a0-b1ea-53e4abd29307",
    name: "Manifold Key",
    rarity: "uncommon",
    oracleText:
        "{1}, {T}: Untap another target artifact.\n{3}, {T}: Target creature can't be blocked this turn.",
    manaCost: { X: 1 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "manifold-key-untap",
            oracleText: "{1}, {T}: Untap another target artifact.",
            cost: { mana: { X: 1 }, tap: true },
            useStack: true,
            targetRequirement: { type: "Artifact", count: 1 },
            getTargetRequirement: (source: PermanentView) => ({
                type: "Artifact",
                count: 1,
                excludeInstanceIds: [source.id],
            }),
            effects: [
                {
                    op: "tapUntap",
                    action: "untap",
                    target: { target: 0 },
                },
            ],
        },
        {
            id: "manifold-key-unblockable",
            oracleText: "{3}, {T}: Target creature can't be blocked this turn.",
            cost: { mana: { X: 3 }, tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            effects: [
                {
                    op: "restrictCombat",
                    restriction: "cant-be-blocked",
                    target: { target: 0 },
                },
            ],
        },
    ],
}));

// Mystic Forge — {4} Artifact (Vintage Cube, issue #7241). The two library
// clauses are shipped primitives: `looksAtLibraryTop` (CR 401.5, Bolas's
// Citadel) and `castsSpellsFromTopOfLibrary.spellFilter` (issue #7205), whose
// `any` ORs "artifact spells" with "colorless spells" — two different filter
// fields. Colorless = none of the five colours (CR 105.2c).
// CR 701.13 / 119.4 — "{T}, Pay 1 life: Exile the top card of your library."
// compiler-gap: "You may look at the top card of your library any time." (#7220)
// hand-tail: "You may cast artifact spells and colorless spells from the top of your library." (#7241)
export const mysticForge = defineCard(() => ({
    id: "924a24e7-91b8-4ceb-a136-7a765d98c994",
    name: "Mystic Forge",
    rarity: "rare",
    oracleText:
        "You may look at the top card of your library any time.\nYou may cast artifact spells and colorless spells from the top of your library.\n{T}, Pay 1 life: Exile the top card of your library.",
    manaCost: { generic: 4 },
    types: ["Artifact"],
    looksAtLibraryTop: "controller",
    castsSpellsFromTopOfLibrary: {
        spellFilter: {
            any: [
                { types: "Artifact" },
                { excludeColors: ["W", "U", "B", "R", "G"] },
            ],
        },
    },
    activatedAbilities: [
        {
            id: "mystic-forge-exile-top",
            oracleText: "{T}, Pay 1 life: Exile the top card of your library.",
            cost: { tap: true, life: 1 },
            useStack: true,
            effects: [
                { op: "exileTopOfLibrary", player: "controller", count: 1 },
            ],
        },
    ],
}));
