// CR 113.6b / 603.4 — the intervening-if read of an ability that functions
// from EXILE ("if this card is exiled with a <kind> counter on it"). Reads the
// LIVE exile pile by the source's instance id, never the trigger's own
// snapshot, so the check at resolution sees a counter removed (or the card
// leaving exile) after the ability triggered.

/** The number of `type` counters on the card `self` names while it sits in
 *  some player's exile; `undefined` when it is not in exile at all (it left,
 *  CR 400.7, so "this card is exiled" is false). */
export function exiledCardCounterCount(
    state:
        | {
              players: ReadonlyArray<{
                  exile?: ReadonlyArray<{
                      id: string;
                      counters?: Readonly<Record<string, number>>;
                  }>;
              }>;
          }
        | undefined,
    self: { id: string },
    type: string
): number | undefined {
    const playerList = state?.players ?? [];
    for (let i = 0; i < playerList.length; i++) {
        const player = playerList[i];
        const card = player.exile?.find((c) => c.id === self.id);
        if (card) return card.counters?.[type] ?? 0;
    }
    return undefined;
}
