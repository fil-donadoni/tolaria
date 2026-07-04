// Graveyard stack-order helpers (CR 404.1, 603.6e / 603.4d). A graveyard is an
// ordered pile: index 0 = bottom, last = top, so a card is "above" another when
// it sits at a higher index. Shared by the graveyard-recursion cards that gate
// on "N or more creature cards above this card" — Nether Shadow (a graveyard-
// zone triggered ability) and Ashen Ghoul (a graveyard-source activated
// ability, issue #737). Structurally typed so it accepts both the card-facing
// `TriggerStateView` (trigger / canActivate path) and the raw engine
// `GameState` (the activateAbility mutation), and both `PermanentView` and a
// raw `CardInstanceState` as the self object.

/** Number of Creature cards stacked ABOVE `self` in its owner's graveyard
 *  (CR 603.6e — "three or more creature cards above this card"). Returns 0 when
 *  the state is absent or `self` isn't found in its owner's graveyard. */
export function creatureCardsAboveInGraveyard(
    state:
        | {
              players: ReadonlyArray<{
                  id: string;
                  graveyard?: ReadonlyArray<{
                      id: string;
                      types: ReadonlyArray<string>;
                  }>;
              }>;
          }
        | undefined,
    self: { id: string; ownerId: string }
): number {
    const graveyard = state?.players.find(
        (p) => p.id === self.ownerId
    )?.graveyard;
    if (!graveyard) return 0;
    const idx = graveyard.findIndex((c) => c.id === self.id);
    if (idx === -1) return 0;
    let count = 0;
    for (let i = idx + 1; i < graveyard.length; i++) {
        if (graveyard[i].types.includes("Creature")) count++;
    }
    return count;
}
