// The DEFINITION MANIFEST (issue #5614, PRD #5602): per seat, the Card
// Definitions a Game can need on that seat's client, each with the Set code
// keying the client shard that holds it — so a client can load those
// definitions and nothing else.
//
// For a seat it is: both maindecks, both companions (a declared companion is
// revealed, ADR 0064), and THAT seat's own sideboard — the opponent's is
// hidden information, unlike the maindecks, which `games.cardIds` already
// publishes. Built when a Game's state is (`chooseFirstPlayer`, and every Bo3
// rebuild in `buildNextGameForMatch`, so sideboarding is reflected), and
// WIDENED by a debug load that places a card from outside it — the same move
// `withStatePrintIds` makes for `games.cardIds`.
//
// It reads no Card Definition: the definition ids come off the built state and
// the seats' already-resolved deck entries (`withSeatDefinitionIds`, the
// `cardPrints` path the game build uses), the Set codes off the Definition
// Index (`getDefinitionSetCode`). Tokens, face-down sentinels and twins need no
// entry of their own — they self-decode or derive from a parent, and a twin
// names its parent here. The rows live in `gameDefinitionManifests` behind
// `convex/deckStore.ts`; this half needs the catalogue, so only engine-bound
// modules (`game.ts`, `debugBlade.ts`) import it.
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { getDefinitionSetCode } from "./cards/catalogue";
import { FACE_DOWN_CARD_ID } from "./cards/registry";
import { isTwinDefinitionId, parentIdOfTwin } from "./cards/twinId";
import { loadDefinitionManifests, writeDefinitionManifests } from "./deckStore";
import type { DefinitionManifestEntry } from "./definitionManifestEntry";
import type { CardInstanceState, GameState } from "./gre/state";

type Ctx = Pick<MutationCtx, "db">;

/** A deck entry as the game build holds it: its printing, and the Card
 *  Definition `withSeatDefinitionIds` resolved it to. */
type ResolvedDeckCard = { cardId: string; definitionId?: string };

/** A seat as the game build holds it: its handle, its maindeck and its
 *  sideboard, every entry resolved (`withSeatDefinitionIds`). */
interface ManifestSeat {
    id: string;
    deck: {
        cards: readonly ResolvedDeckCard[];
        sideboard?: readonly ResolvedDeckCard[];
    };
}

/** The definition `cardId` loads through, or `undefined` when it needs no
 *  entry: a token's content-derived id and the face-down sentinel decode
 *  without one, and a twin (an inset spell, a split half, a modal back face)
 *  is derived from its parent, so it names the parent. */
function manifestIdOf(cardId: string | undefined): string | undefined {
    if (!cardId || cardId.startsWith("token:") || cardId === FACE_DOWN_CARD_ID)
        return undefined;
    return isTwinDefinitionId(cardId) ? parentIdOfTwin(cardId) : cardId;
}

/** Every definition id `card` can present: its current one, and each printed
 *  card it stands in for — an Adventure's or split half's parent, a
 *  transformed permanent's front, and (to its controller only, it is hidden
 *  from everyone else) a face-down card's real identity. */
function cardDefinitionIds(
    card: Omit<CardInstanceState, "chosenModeId">,
    viewerId: string
): (string | undefined)[] {
    return [
        (card.card as { id?: string }).id,
        card.adventureOf,
        card.splitHalfOf,
        card.transformedFrom,
        card.controllerId === viewerId ? card.faceDownOf : undefined,
    ];
}

/** Every definition id `state` holds that `viewerId` may know: each card in
 *  a zone or on the stack, and each declared companion. At a Game's build that
 *  is exactly both maindecks plus both companions. */
export function stateDefinitionIds(
    state: GameState,
    viewerId: string
): string[] {
    const ids = new Set<string>();
    const add = (card: Omit<CardInstanceState, "chosenModeId">) => {
        for (const raw of cardDefinitionIds(card, viewerId)) {
            const id = manifestIdOf(raw);
            if (id) ids.add(id);
        }
    };
    for (const player of state.players) {
        for (const zone of [
            player.hand,
            player.library,
            player.graveyard,
            player.exile,
            player.battlefield,
        ]) {
            for (const card of zone) add(card);
        }
        if (player.companion) add(player.companion.instance);
    }
    for (const item of state.stack) add(item);
    return [...ids];
}

/** `ids` as manifest entries, each with its Set code, ordered by shard then
 *  id. The ORDER carries nothing: the ids come off a dealt state, and in
 *  zone order the first ones would be an opening hand. An id the Definition
 *  Index does not hold (no Set code) is no catalogue card, so no shard can
 *  serve it, and it is left out. */
export function manifestEntries(
    ids: Iterable<string>
): DefinitionManifestEntry[] {
    const entries: DefinitionManifestEntry[] = [];
    for (const definitionId of new Set(ids)) {
        const setCode = getDefinitionSetCode(definitionId);
        if (setCode) entries.push({ definitionId, setCode });
    }
    return entries.sort(
        (a, b) =>
            compareText(a.setCode, b.setCode) ||
            compareText(a.definitionId, b.definitionId)
    );
}

const compareText = (a: string, b: string): number =>
    a < b ? -1 : a > b ? 1 : 0;

/** Each seat's manifest for a Game whose state was just built from `seats`:
 *  what the state holds (both maindecks, both companions) plus that seat's
 *  own sideboard. */
export function seatDefinitionManifests(
    seats: readonly ManifestSeat[],
    state: GameState
): Map<string, DefinitionManifestEntry[]> {
    return new Map(
        seats.map((seat) => [
            seat.id,
            manifestEntries([
                ...stateDefinitionIds(state, seat.id),
                ...(seat.deck.sideboard ?? []).map(
                    (c) => c.definitionId ?? c.cardId
                ),
            ]),
        ])
    );
}

/** Each seat's maindeck as Card Definition ids, one per copy in decklist
 *  order (issue #5617): the deck knowledge the Bot's search samples a seat's
 *  hidden zones from (`convex/gre/deckKnowledge.ts`). Resolved here, by the
 *  game build, because a stored deck entry keeps only its print id and the
 *  client cannot resolve one. */
export function seatDeckDefinitionIds(
    seats: readonly ManifestSeat[]
): Map<string, string[]> {
    return new Map(
        seats.map((seat) => [
            seat.id,
            seat.deck.cards.map((c) => c.definitionId ?? c.cardId),
        ])
    );
}

/** Writes the manifests of a Game whose state was just built from `seats`,
 *  each with its seat's maindeck as definition ids. */
export async function writeGameDefinitionManifests(
    ctx: Ctx,
    gameId: Id<"games">,
    seats: readonly ManifestSeat[],
    state: GameState
): Promise<void> {
    await writeDefinitionManifests(
        ctx,
        gameId,
        seatDefinitionManifests(seats, state),
        seatDeckDefinitionIds(seats)
    );
}

/** Widens each seat's stored manifest by every definition a loaded position
 *  places (a debug scenario, a Blade entry), so the client sees the new
 *  entries. A Game with no manifest yet keeps none: one built from the
 *  position alone would lack the sideboards and read as complete. */
export async function widenGameDefinitionManifests(
    ctx: Ctx,
    gameId: Id<"games">,
    state: GameState
): Promise<void> {
    const widened = new Map<string, DefinitionManifestEntry[]>();
    for (const [playerId, entries] of await loadDefinitionManifests(
        ctx,
        gameId
    )) {
        const have = new Set(entries.map((e) => e.definitionId));
        const next = manifestEntries([
            ...have,
            ...stateDefinitionIds(state, playerId),
        ]);
        if (next.some((e) => !have.has(e.definitionId)))
            widened.set(playerId, next);
    }
    if (widened.size > 0) await writeDefinitionManifests(ctx, gameId, widened);
}
