// Drag-and-drop resolution for the DRAFT table (ADR 0060, issue #1248;
// re-based on the shared zone surface by issue #1632). dnd-kit's real
// pointer-based collision detection can't be meaningfully exercised in jsdom
// (no real layout), so — mirroring the project's convention for GRE/engine
// logic — the "what does this drop MEAN" decision is a small PURE function,
// independently unit-testable by constructing the drag payload/target
// directly. `limited-draft-table.tsx`'s `onDragEnd` is a thin shell that reads
// the real `DragEndEvent` and calls this.
//
// WHAT THIS MODULE IS *NOT*, since issue #1632: it no longer owns a column-id
// vocabulary or a drop-target parser of its own. The draft Pool renders
// through the SAME `DeckZoneSurface` as both build views, so its drop targets
// are the shared `deck-zone:` ids and the parsing is
// `parseDeckZoneDropId`'s — the pre-#1632 `pool-col-N` ids, `columnDropId`,
// `parseColumnDropId`, `resolvePoolDropTarget` and `SIDEBOARD_DROP_ID` are
// gone with the surface that minted them.
//
// What genuinely remains draft-specific, and is all this module still holds:
// the BOOSTER. A booster card is not a member of any Zone — it is not in the
// player's Pool yet — so dropping it means "commit this Pick, and file the
// card it becomes", a two-mutation action (`submitPick` +
// `setPoolArrangementEntry`) the shared `resolveDeckZoneDragAction` has no
// vocabulary for and should not grow one.
import { parseDeckZoneDropId } from "~/components/deckbuilder/deckZoneDrag";
import type { DeckZone } from "@convex/deckLayout";
import type { CardDragData } from "~/components/lobby/deck-builder/dnd-types";
import { parseColumnId, type ColumnId } from "@convex/deckLayout";

/** Prefix for the PHONE SNAP STRIP's drop targets (issue #2588, ADR 0101 §6).
 *
 *  On a phone the Pool is mostly off screen: portrait parks it behind a 15%
 *  strip, landscape behind a 20% sneak-peek column. That strip is a drop
 *  target for the card in hand, and it means exactly what a drop on the pane
 *  it stands for means — which is why it is parsed HERE, into the same
 *  `{ zone, columnId }` shape `parseDeckZoneDropId` returns, rather than
 *  handled by a second `onDragEnd` bolted onto the phone panes.
 *
 *  It cannot reuse the pane's own `deck-zone:` id: dnd-kit keys its droppable
 *  registry by id, and the Pool pane is MOUNTED at the same time as the strip
 *  that stands for it (both live in the snap scroller, one of them merely
 *  scrolled out of view). Two mounted droppables sharing one id collide. Same
 *  reasoning, same shape, as the deckbuilder's `deck-tab:` prefix
 *  (`deckZoneDrag.ts` § `TAB_PREFIX`).
 *
 *  Portrait and landscape mint the SAME two ids and never collide with each
 *  other: `LimitedDraftTable` renders one orientation's panes or the other's,
 *  never both (`useViewportMode` is a 3-way discriminant, not a pair of
 *  independent booleans). */
const STRIP_PREFIX = "draft-strip:";

/** Drop-target id for one half of the phone strip — the Pool half
 *  (`"maindeck"`) or the Sideboard half (`"sideboard"`, the "pick to SB"
 *  gesture ADR 0101 §6 asks for). */
export function draftStripDropId(zone: DeckZone): string {
    return `${STRIP_PREFIX}${zone}`;
}

/** The Zone a strip drop-target id names, or `null` for any other id. */
export function parseDraftStripDropId(id: string | undefined): DeckZone | null {
    if (!id || !id.startsWith(STRIP_PREFIX)) return null;
    const zone = id.slice(STRIP_PREFIX.length);
    return zone === "maindeck" || zone === "sideboard" ? zone : null;
}

/** A booster card being dragged (Booster → Pool column / Sideboard commits
 *  the Pick — ADR 0060). */
export interface BoosterDragData {
    kind: "booster";
    pickId: string;
    cardId: string;
    cardName: string;
}

/** Everything draggable on the draft table: a Booster card, or an
 *  already-picked Pool card. The latter is the SHARED zone payload
 *  (`CardDragData`, `kind: "main" | "side"`) the zone surface mints for every
 *  tile it renders — the draft no longer has a payload shape of its own, which
 *  is what lets one `poolIndex` travel as the standard per-copy `pinKey`. */
export type DraftDragData = BoosterDragData | CardDragData;

/** What a resolved drop MEANS — `limited-draft-table.tsx` maps this to the
 *  actual mutation call(s) (`submitPick` / `setPoolArrangementEntry`).
 *
 *  Both variants carry the SAME destination pair, because both end in the same
 *  Arrangement write: `sideboard` (the Zone the card lands in) and `columnId`
 *  (the Column inside it, `null` for a whole-pane drop that names none). The
 *  Column id travels WHOLE and namespaced (`mv:3`, `color:R`, `custom:ramp`) —
 *  the mutation's `column` arg speaks that vocabulary since issue #1624 and
 *  fails closed on anything it doesn't recognise. */
export type DraftDragAction =
    | {
          type: "commitPick";
          pickId: string;
          sideboard: boolean;
          columnId: ColumnId | null;
      }
    | {
          type: "moveArrangement";
          poolIndex: number;
          sideboard: boolean;
          columnId: ColumnId | null;
      };

/** Resolves a completed drag into the action it represents, or `null` for a
 *  cancelled/no-op drop (missing data/target, a target this surface doesn't
 *  own, or a Pool tile with no per-copy Pin key to identify it by). Pure — no
 *  side effects, no mutation calls. */
export function resolveDraftDragAction(
    data: DraftDragData | undefined,
    dest: string | undefined
): DraftDragAction | null {
    if (!data) return null;

    // ONE parser for both vocabularies (issue #2588): the shared `deck-zone:`
    // ids the Pool's own panes and Columns mint, and the phone strip's
    // `draft-strip:` ids. A strip names a Zone and no Column — exactly a
    // whole-pane drop — so everything below is unchanged by its arrival.
    const stripZone = parseDraftStripDropId(dest);
    const target =
        stripZone !== null
            ? { zone: stripZone, columnId: null }
            : parseDeckZoneDropId(dest);
    if (target === null) return null;

    const sideboard = target.zone === "sideboard";
    // A drop on the Sideboard names no Column by construction (its whole pane
    // is one target, ADR 0075 §2) — "out of the working deck" is not a Pin.
    const columnId = sideboard ? null : target.columnId;

    if (data.kind === "booster") {
        return { type: "commitPick", pickId: data.pickId, sideboard, columnId };
    }

    // An already-picked Pool card. Its `poolIndex` rides the shared payload as
    // the per-copy `pinKey` (issue #1626) — the SAME key
    // `pinsByPoolIndex`/`poolCopyPinKey` record Pins under, so the draft and
    // the build view read and write one identity rather than two. A tile with
    // no key, or a non-numeric one, is not a Pool copy (a Basic added from the
    // bar in the build view) and cannot be arranged: fail closed.
    const poolIndex = Number(data.pinKey);
    if (data.pinKey === undefined || !Number.isInteger(poolIndex)) return null;
    return { type: "moveArrangement", poolIndex, sideboard, columnId };
}

/** The `setPoolArrangementEntry` arguments one resolved draft drop writes
 *  (minus `eventId`) — the ONE author of "which fields does an arrangement
 *  move send", shared by the Booster-commit path and the Pool-card move path
 *  so the two can never diverge on it.
 *
 *  A Column id the engine does not recognise as a pin target — the Catch-All,
 *  Grouping `none`'s single whole-zone Column — is DROPPED rather than sent.
 *  `upsertPoolArrangementEntry` already fails closed on it (an unnamespaced id
 *  records nothing), so sending it would be a no-op field on the wire; leaving
 *  it out keeps the request honest and matches what the build view's own
 *  `handlePin` does with the same ids.
 *
 *  `sideboard: undefined` (issue #2667 round 3, PR #2797 review round 2) means
 *  "don't touch the Zone" — the SAME "don't touch" contract every OTHER
 *  omitted field on this patch and the mutation itself already carries
 *  (`ArrangementPatch.sideboard`/`.column` in `convex/limited/poolArrangement.ts`
 *  are independently optional for exactly this reason). Before round 3 this
 *  function accepted only a `boolean` and always emitted it, which forced
 *  every caller — including a pure column PIN, which reads no Zone at all —
 *  to assert a Zone value it never observed. A caller holding a STALE
 *  selection (the panel does not react to a concurrent drag) then asserted
 *  the WRONG one, silently reverting a Zone move the drag just made. The
 *  build view's own `handlePin` (`pool-deck-builder-form.tsx`) never had this
 *  bug: it always sent `{poolIndex, column}` with no `sideboard` field.
 *  Making a pin's caller pass `undefined` here — rather than adding another
 *  clear at the CTA that happens to reach a stale selection — closes every
 *  such path at once, not just the one a review happened to walk. */
export function poolArrangementPatch(
    poolIndex: number,
    sideboard: boolean | undefined,
    columnId: ColumnId | null
): { poolIndex: number; sideboard?: boolean; column?: ColumnId } {
    const pinnable = columnId !== null && parseColumnId(columnId) !== null;
    return {
        poolIndex,
        ...(sideboard !== undefined ? { sideboard } : {}),
        ...(pinnable ? { column: columnId } : {}),
    };
}
