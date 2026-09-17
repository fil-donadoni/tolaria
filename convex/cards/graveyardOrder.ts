// Graveyard stack-order helpers (CR 404.1, 113.6m / 603.4). A graveyard is an
// ordered pile: index 0 = bottom, last = top, so a card is "above" another when
// it sits at a higher index. Shared by the graveyard-recursion cards that gate
// on "N or more creature cards above this card" — Nether Shadow (a graveyard-
// zone triggered ability) and Ashen Ghoul (a graveyard-source activated
// ability, issue #737). Structurally typed so it accepts both the card-facing
// `TriggerStateView` (trigger / canActivate path) and the raw engine
// `GameState` (the activateAbility mutation), and both `PermanentView` and a
// raw `CardInstanceState` as the self object.

/** Number of Creature cards stacked ABOVE `self` in its owner's graveyard
 *  (CR 404.2 — the pile keeps its order, so "above" is a higher index; read by
 *  "three or more creature cards above this card"). Returns 0 when
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

/** Whether `self` is still sitting in its owner's graveyard — the predicate
 *  behind the "if this card is in your graveyard" intervening-if clause
 *  (CR 603.4) shared by the graveyard-recursion upkeep triggers (Pyre Zombie,
 *  Master of Death).
 *
 *  The `zone: "graveyard"` scan in `collectTriggers` gates only the moment the
 *  ability FIRES; CR 603.4 requires the same condition re-checked as the
 *  ability RESOLVES, and only a declared `interveningIf` reaches that second
 *  check (`gre/state.ts:resolveTopOfStack`). Without it an opponent who exiles
 *  the card off the graveyard in response still gets the payment prompt, and
 *  the cost buys a no-op.
 *
 *  Structurally typed like `creatureCardsAboveInGraveyard` above, so it accepts
 *  both the card-facing `TriggerStateView` and the raw engine `GameState`. */
export function cardIsInOwnerGraveyard(
    state:
        | {
              players: ReadonlyArray<{
                  id: string;
                  graveyard?: ReadonlyArray<{ id: string }>;
              }>;
          }
        | undefined,
    self: { id: string; ownerId: string }
): boolean {
    const graveyard = state?.players.find(
        (p) => p.id === self.ownerId
    )?.graveyard;
    return graveyard?.some((c) => c.id === self.id) === true;
}
