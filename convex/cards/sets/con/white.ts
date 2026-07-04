// CON — white cards, split by colour per ADR 0043. The registry's
// `import * as con from "./sets/con"` resolves through con/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardDefinition, SpellContext } from "../../types";

// Path to Exile — "Exile target creature. Its controller may search their
// library for a basic land card, put that card onto the battlefield tapped,
// then shuffle." (CR 701.13 exile; CR 601.2c search/battlefield-entry.) Same
// search-to-battlefield gap as Erode (sos/white.ts) — `moveZone` only reaches
// `battlefield` from a graveyard card, not a library search choice. Stays
// `resolve()` (Nature's Lore precedent, ice/green.ts).
const BASIC_LAND_SUBTYPES = ["Plains", "Island", "Swamp", "Mountain", "Forest"];

export const pathToExile: CardDefinition = {
    id: "29b7a8b1-b98e-483a-87a4-73bd831c03d4",
    rarity: "uncommon",
    name: "Path to Exile",
    oracleText:
        "Exile target creature. Its controller may search their library for a basic land card, put that card onto the battlefield tapped, then shuffle.",
    manaCost: { W: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: 1 },
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        if (!target || target.type !== "permanent") return;
        const controllerId = ctx.getController(target);
        // Request the choice BEFORE the irreversible exile so exile only ever
        // executes once, on the final (answered) pass (Cuombajj Witches
        // precedent, arn/black.ts — resolve() re-runs whole on resume).
        const basics = ctx
            .getLibraryCards(controllerId)
            .filter((c) =>
                c.subtypes.some((s) => BASIC_LAND_SUBTYPES.includes(s))
            );
        const found = ctx.requestChoice({
            playerId: controllerId,
            choiceId: `path-to-exile-search-${ctx.sourceInstanceId}`,
            kind: "search-library",
            zone: "library",
            candidateIds: basics.map((c) => c.id),
            count: { min: 0, max: 1 },
            prompt: "Path to Exile: you may search your library for a basic land card.",
        });
        if (found === undefined) return; // suspended for the choice
        ctx.exile(target);
        const foundId = found[0];
        if (foundId) {
            ctx.putFromLibraryOntoBattlefield(controllerId, foundId);
            ctx.tap({ type: "permanent", id: foundId });
        }
        ctx.shuffleLibrary(controllerId);
    },
};
