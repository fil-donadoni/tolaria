// mh1 — white cards (ADR 0043 colour split).
import type { CardDefinition, EffectOp, PermanentView } from "../../types";
import { colors as ALL_COLORS } from "../../types";

const COLOR_NAMES: Record<(typeof ALL_COLORS)[number], string> = {
    W: "white",
    U: "blue",
    B: "black",
    R: "red",
    G: "green",
    C: "colorless",
};

/** One `optionChoice` mode per grantable color/quality, each granting
 *  "protection from <quality>" to the announced target (CR 702.16, 613.1f).
 *  Mirrors Mother of Runes's shared shape (ulg/white.ts, issue #684); kept
 *  local since Giver of Runes' 6-mode set (colors + colorless) differs from
 *  Mother of Runes's 5-mode set. */
function protectionModes(
    codes: ReadonlyArray<(typeof ALL_COLORS)[number]>
): { id: string; label: string; effects: EffectOp[] }[] {
    return codes.map((code) => {
        const quality = COLOR_NAMES[code];
        return {
            id: `protection-${quality}`,
            label: `Protection from ${quality}`,
            effects: [
                {
                    op: "grantAbility",
                    ability: `protection from ${quality}`,
                    target: { target: 0 },
                    duration: { phase: "end-of-turn" },
                } satisfies EffectOp,
            ],
        };
    });
}

// Giver of Runes — {W} Creature — Kor Cleric (issue #684, Cube FREE evasion/
// protection statics). "{T}: Another target creature you control gains
// protection from colorless or from the color of your choice until end of
// turn." (CR 702.16 protection; CR 613.1f temporary keyword grant; CR 700.2
// modal choice; CR 109.2 "another" excludes the source itself.)
export const giverOfRunes: CardDefinition = {
    id: "4e117771-5a8b-4812-b487-32ba34b7f724",
    name: "Giver of Runes",
    rarity: "rare",
    oracleText:
        "{T}: Another target creature you control gains protection from colorless or from the color of your choice until end of turn.",
    manaCost: { W: 1 },
    types: ["Creature"],
    subtypes: ["Kor", "Cleric"],
    power: 1,
    toughness: 2,
    activatedAbilities: [
        {
            id: "giver-of-runes-protect",
            oracleText:
                "{T}: Another target creature you control gains protection from colorless or from the color of your choice until end of turn.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1, controller: "you" },
            getTargetRequirement: (source: PermanentView) => ({
                type: "Creature",
                count: 1,
                controller: "you",
                excludeInstanceIds: [source.id],
            }),
            effects: [
                {
                    op: "optionChoice",
                    prompt: "Choose colorless or a color",
                    modes: protectionModes(["C", "W", "U", "B", "R", "G"]),
                },
            ],
        },
    ],
};

// TODO(issue #676 stub — Rebound, CR 702.88, is `planned` in
// mechanicsRegistry.ts: no "cast this from exile next upkeep without paying
// its cost" primitive exists. Rebound is the entire second half of
// Ephemerate's value (cast it twice); omitting it would misrepresent the
// card. The blink itself ("exile target creature you control, then return
// it") is also not directly an Op — `moveZone`'s `to: "battlefield"` is only
// reachable from a graveyard card, not a same-effect exile-then-return. Stop-
// and-issue per gre-development.md; tracked stub.
// export const ephemerate: CardDefinition = {
//     id: "2da5f3f8-5eef-498f-ba2c-2f3fbc3745aa",
//     name: "Ephemerate",
//     rarity: "common",
//     manaCost: { W: 1 },
//     types: ["Instant"],
// };

// TODO(issue #676 stub — Overload, CR 702.96, is `planned` in
// mechanicsRegistry.ts: no alternative-cost "change target to each" primitive
// exists. Winds of Abandon's overload mode is core to the card (mass exile
// vs opponents), and its base mode's land-search tail ("its controller
// searches... puts it onto the battlefield tapped") also has no moveZone
// path from a library choice to the battlefield (only graveyard-card →
// battlefield is modelled) — would need a resolve() justified by the
// existing Nature's Lore precedent (ice/green.ts), but Overload blocks the
// whole card regardless. Stop-and-issue; tracked stub.
// export const windsOfAbandon: CardDefinition = {
//     id: "3bb17913-fe4d-4acd-9b75-71f5a90f898b",
//     name: "Winds of Abandon",
//     rarity: "rare",
//     manaCost: { X: 1, W: 1 },
//     types: ["Sorcery"],
// };

export {};
