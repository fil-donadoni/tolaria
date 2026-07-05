// SOS (Secrets of Strixhaven) — white cards, split by colour per ADR 0043. The
// registry's `import * as sos from "./sets/sos"` resolves through
// sos/index.ts. Cards are classified by the colour identity of their mana
// cost (CR 202.2): lands and colourless artifacts (no coloured cost) live in
// colorless.ts.
import type { CardDefinition, SpellContext } from "../../types";

// Erode — "Destroy target creature or planeswalker. Its controller may
// search their library for a basic land card, put it onto the battlefield
// tapped, then shuffle." (CR 701.7 destroy; CR 601.2c search/battlefield-
// entry). The land-search tail moves a card from library straight to the
// battlefield, a path the `moveZone` Op only supports FROM a graveyard card
// (reanimation) — not from a library search choice. Stays `resolve()`,
// following the established search-to-battlefield precedent (Nature's Lore,
// ice/green.ts: `ctx.requestChoice` + `ctx.putFromLibraryOntoBattlefield` +
// `ctx.shuffleLibrary`).
const BASIC_LAND_SUBTYPES = ["Plains", "Island", "Swamp", "Mountain", "Forest"];

export const erode: CardDefinition = {
    id: "32e670da-7563-4f6a-a7db-4c126a440eb8",
    rarity: "rare",
    name: "Erode",
    oracleText:
        "Destroy target creature or planeswalker. Its controller may search their library for a basic land card, put it onto the battlefield tapped, then shuffle.",
    manaCost: { W: 1 },
    types: ["Instant"],
    targetRequirement: { type: ["Creature", "Planeswalker"], count: 1 },
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        if (!target || target.type !== "permanent") return;
        const controllerId = ctx.getController(target);
        // The choice suspends/resumes and re-runs this WHOLE closure on
        // resume (CR 608.2c) — request it BEFORE the irreversible destroy so
        // destroy only ever executes once, on the final (answered) pass
        // (Cuombajj Witches precedent, arn/black.ts).
        const basics = ctx
            .getLibraryCards(controllerId)
            .filter((c) =>
                c.subtypes.some((s) => BASIC_LAND_SUBTYPES.includes(s))
            );
        const found = ctx.requestChoice({
            playerId: controllerId,
            choiceId: `erode-search-${ctx.sourceInstanceId}`,
            kind: "search-library",
            zone: "library",
            candidateIds: basics.map((c) => c.id),
            count: { min: 0, max: 1 },
            prompt: "Erode: you may search your library for a basic land card.",
        });
        if (found === undefined) return; // suspended for the choice
        ctx.destroy(target);
        const foundId = found[0];
        if (foundId) {
            ctx.putFromLibraryOntoBattlefield(controllerId, foundId);
            ctx.tap({ type: "permanent", id: foundId });
        }
        ctx.shuffleLibrary(controllerId);
    },
};
