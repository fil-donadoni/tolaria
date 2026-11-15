// PROTOTYPE — throwaway. A realistic 60 + 15 for the design-system specimen:
// the Robots preset as the Maindeck, a 15-card hate/control Sideboard.
import { PRESET_DECKS } from "@convex/deckPresets";

function times(n: number, cardId: string, cardName: string) {
    return Array.from({ length: n }, () => ({ cardId, cardName }));
}

export const PROTO_MAIN = (
    PRESET_DECKS.find((d) => d.presetId === "robots")?.cards ?? []
).map((c) => ({ ...c }));

export const PROTO_SIDE = [
    ...times(3, "2722d7e2-61c6-4934-9c21-875ee78fd06c", "Disenchant"),
    ...times(2, "386ea9eb-abc1-4862-aa2d-8fb808d79490", "Swords to Plowshares"),
    ...times(2, "0df55e3f-14de-46ef-b6b1-616618724d9e", "Counterspell"),
    ...times(1, "e691adef-3027-4e6a-889f-9f4e2df36a7c", "Mana Drain"),
    ...times(1, "6f9ea46a-411f-40ce-a873-a905180093f4", "Balance"),
    ...times(1, "badc73ec-3728-4246-90c7-5f4eb7051ed5", "Regrowth"),
    ...times(2, "f8ac5006-91bd-4803-93da-f87cf196dd2f", "Serra Angel"),
    ...times(2, "a2788d69-6a3a-42f0-8736-cc6b57755ecd", "Wrath of God"),
    ...times(1, "f486df00-7c4a-4ff0-bb0b-c8b5432ac742", "Sylvan Library"),
];
