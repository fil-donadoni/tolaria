/** CR 607.2a / 111 — the ONE authority on "the cards exiled with this
 *  permanent" (issue #791, extracted for issue #2943).
 *
 *  The linked pile is every card, in ANY owner's exile zone (CR 400.7 — the
 *  card stays in its owner's exile, which need not be the linking source's
 *  controller), stamped with `exiledBySourceId === sourceInstanceId` by
 *  `SpellContext.linkExileToSource`.
 *
 *  It lived only as a `SpellContext` primitive until #2943, which needs the
 *  same answer from the LAYER path — where there is no `SpellContext` at all
 *  (a continuous static effect is not resolving anything). Both sides ask this
 *  function, so the resolving-ability reading of the pile (Emperor of Bones,
 *  Currency Converter) and the continuous-effect reading of it cannot drift.
 *
 *  Takes a structural view rather than `GameState` so the layer system's
 *  `StaticEffectStateView` — which carries only the three fields read here —
 *  can be passed directly, and so this module stays a leaf (`gre/state.ts`
 *  and `gre/layer6.ts` both import it; neither can import the other's values).
 */

/** The minimum an exile-zone entry must expose to be matched against a link
 *  stamp. `CardInstanceState` satisfies it structurally. */
export interface ExileLinkCandidate {
    readonly id: string;
    readonly exiledBySourceId?: string;
    readonly card: Readonly<Record<string, unknown>>;
}

/** The minimum a board must expose. Both `GameState` and
 *  `StaticEffectStateView` satisfy it — the latter only when its optional
 *  `exile` is populated, which is why a missing zone reads as EMPTY (the
 *  conservative direction for a grant: see `StaticEffectStateView.exile`). */
export interface ExileLinkStateView<C extends ExileLinkCandidate> {
    readonly players: ReadonlyArray<{
        readonly id: string;
        readonly exile?: ReadonlyArray<C>;
    }>;
}

/** Every card linked to `sourceInstanceId`, in a stable owner-then-array order
 *  (the order the `SpellContext` primitive has always produced), each paired
 *  with the id of the player whose exile zone holds it so a caller can route
 *  the card back to its OWN owner (CR 400.7). */
export function getCardsExiledWith<C extends ExileLinkCandidate>(
    state: ExileLinkStateView<C>,
    sourceInstanceId: string
): Array<{ card: C; ownerId: string }> {
    const out: Array<{ card: C; ownerId: string }> = [];
    for (const player of state.players) {
        for (const card of player.exile ?? []) {
            if (card.exiledBySourceId !== sourceInstanceId) continue;
            out.push({ card, ownerId: player.id });
        }
    }
    return out;
}
