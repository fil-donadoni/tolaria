import { useMemo } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { type UserLobbyDeck, toUserLobbyDeck } from "~/lib/deckTypes";
import { useBanlistOverridesByFormat } from "~/hooks/useBanlistOverride";

export function useUserDecks(): UserLobbyDeck[] | undefined {
    const docs = useQuery(api.userDecks.listMine);
    // User decks aren't validated server-side on list, so legality is derived
    // client-side (`toUserLobbyDeck`). Thread the per-Format DB banlist override
    // (PRD #1138, issue #1144) so a saved deck holding a card newly banned via
    // the admin Scryfall sync flips to illegal here reactively. The list mixes
    // Formats, so each row is matched to its own Format's override.
    const banlistByFormat = useBanlistOverridesByFormat();
    return useMemo(
        () => docs?.map((d) => toUserLobbyDeck(d, banlistByFormat[d.format])),
        [docs, banlistByFormat]
    );
}

export function useUserDeckMutations() {
    const create = useMutation(api.userDecks.create);
    const update = useMutation(api.userDecks.update);
    const remove = useMutation(api.userDecks.remove);
    return { create, update, remove };
}

// Admin-only preset mutations (PRD #466, ADR 0033). The deck editor uses them
// in preset mode; the server gates both via `assertIsAdmin`. `createPreset`
// derives the slug from the name and returns it (issue #469).
export function usePresetMutations() {
    const create = useMutation(api.decks.createPreset);
    const update = useMutation(api.decks.updatePreset);
    const remove = useMutation(api.decks.deletePreset);
    return { create, update, remove };
}
