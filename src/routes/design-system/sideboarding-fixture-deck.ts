// A realistic 60 + 15 for the Sideboarding specimen (issue #9820): the Robots
// preset as the Maindeck, a 15-card hate / control Sideboard. The window
// cascades printed cards in type columns, so a toy deck would measure a
// dialog with nothing to scroll — the shape that fails on a phone.
import { PRESET_DECKS } from "@convex/deckPresets";
import type { ZoneCard } from "~/types/game";

function copies(n: number, cardId: string, cardName: string): ZoneCard[] {
    return Array.from({ length: n }, () => ({ cardId, cardName }));
}

export const SPECIMEN_MAINDECK: ZoneCard[] = (
    PRESET_DECKS.find((d) => d.presetId === "robots")?.cards ?? []
).map((c) => ({ ...c }));

export const SPECIMEN_SIDEBOARD: ZoneCard[] = [
    ...copies(3, "2722d7e2-61c6-4934-9c21-875ee78fd06c", "Disenchant"),
    ...copies(
        2,
        "386ea9eb-abc1-4862-aa2d-8fb808d79490",
        "Swords to Plowshares"
    ),
    ...copies(2, "0df55e3f-14de-46ef-b6b1-616618724d9e", "Counterspell"),
    ...copies(1, "e691adef-3027-4e6a-889f-9f4e2df36a7c", "Mana Drain"),
    ...copies(1, "6f9ea46a-411f-40ce-a873-a905180093f4", "Balance"),
    ...copies(1, "badc73ec-3728-4246-90c7-5f4eb7051ed5", "Regrowth"),
    ...copies(2, "f8ac5006-91bd-4803-93da-f87cf196dd2f", "Serra Angel"),
    ...copies(2, "a2788d69-6a3a-42f0-8736-cc6b57755ecd", "Wrath of God"),
    ...copies(1, "f486df00-7c4a-4ff0-bb0b-c8b5432ac742", "Sylvan Library"),
];
