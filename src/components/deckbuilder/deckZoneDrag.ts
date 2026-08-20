// Drag-and-drop resolution for the SHARED deckbuilder zone surface (ADR 0075,
// issue #1622). One surface renders the Maindeck and the Sideboard of BOTH
// builders (Constructed and Limited), so a drop target now names a **Zone**
// AND a **Column** — the pre-#1622 ids (`"main"`/`"side"` whole-zone ids in
// Constructed, `pool-col-N` zone-less column ids in Limited) could not express
// "the Sideboard's MV 3 column" at all.
//
// Like the resolvers it replaces (`deckbuilderColumnDrag.ts`,
// `limitedDraftDrag.ts`), "what does this drop MEAN" is a small PURE function
// so it is unit-testable without a real dnd layout — jsdom has no layout, so a
// pointer-driven drag can never resolve a drop target there.
import type { ColumnId, DeckZone } from "@convex/deckLayout";
import type { DragSourceKind } from "~/components/lobby/deck-builder/dnd-types";

const DROP_PREFIX = "deck-zone:";

/** Prefix for the phone Pane Tabs (issue #2584). A tab is a SECOND drop target
 *  meaning the same thing as a drop on the pane it names, so it cannot reuse
 *  the pane's own id — dnd-kit keys its droppable registry by id and two
 *  mounted droppables sharing one id collide. The prefix differs; the MEANING
 *  is resolved by the same parser below, so a tab drop and a pane drop can
 *  never drift apart. */
const TAB_PREFIX = "deck-tab:";

/** The Source pane's tab (issue #2584) — the Constructed builder's search
 *  results, the one pane that is not a deck Zone. A deck card dropped on it
 *  leaves the deck entirely, which is the phone replacement for the tap that
 *  used to remove it (a tap now opens the Peek Panel instead). */
export const SOURCE_TAB_DROP_ID = `${TAB_PREFIX}source`;

/** Drop-target id for the Pane Tab of one Zone (issue #2584). */
export function zoneTabDropId(zone: DeckZone): string {
    return `${TAB_PREFIX}${zone}`;
}

/** True for the Source pane's tab id — the one drop target that names no
 *  Zone, so {@link parseDeckZoneDropId} cannot express it. */
export function isSourceTabDropId(id: string | undefined): boolean {
    return id === SOURCE_TAB_DROP_ID;
}

/** Drop-target id for one Column of one Zone. Namespaced by Zone because the
 *  Maindeck and the Sideboard generate the SAME Column ids (`mv:5` in both) —
 *  an un-namespaced id would make the two zones' columns collide in dnd-kit's
 *  droppable registry. */
export function zoneColumnDropId(zone: DeckZone, columnId: ColumnId): string {
    return `${DROP_PREFIX}${zone}:${columnId}`;
}

/** Drop-target id for a whole Zone — the pane itself, with no Column named.
 *  The Sideboard is one such target (a drop anywhere in it means "move this
 *  card out of the deck", exactly as before #1622). */
export function zonePaneDropId(zone: DeckZone): string {
    return `${DROP_PREFIX}${zone}`;
}

/** Where a drop landed: a Zone, and the Column inside it (`null` for a
 *  whole-pane drop). */
export interface DeckZoneDropTarget {
    zone: DeckZone;
    columnId: ColumnId | null;
}

function isDeckZone(value: string): value is DeckZone {
    return value === "maindeck" || value === "sideboard";
}

/** Parses a drop-target id back to the Zone/Column it names, or `null` for any
 *  id this surface doesn't own (a foreign droppable, an unknown zone). */
export function parseDeckZoneDropId(
    id: string | undefined
): DeckZoneDropTarget | null {
    if (!id) return null;
    // Both prefixes resolve here (issue #2584): a Pane Tab names a Zone and no
    // Column, i.e. exactly a whole-pane drop.
    const prefix = id.startsWith(DROP_PREFIX)
        ? DROP_PREFIX
        : id.startsWith(TAB_PREFIX)
          ? TAB_PREFIX
          : null;
    if (!prefix) return null;
    const rest = id.slice(prefix.length);
    const at = rest.indexOf(":");
    const zone = at < 0 ? rest : rest.slice(0, at);
    if (!isDeckZone(zone)) return null;
    const columnId = at < 0 ? null : rest.slice(at + 1);
    return { zone, columnId: columnId === "" ? null : columnId };
}

/** The card being dragged — the existing `CardDragData` shape
 *  (`kind: "result" | "main" | "side"`), unchanged so the shared
 *  `DeckCardTile` payload stays one type across both builders and the draft. */
export interface DeckZoneDragSource {
    kind: DragSourceKind;
    cardId: string;
    cardName: string;
    /** The key a Pin for THIS copy is recorded under (issue #1626). Absent
     *  falls back to `cardId` — the Constructed rule, where all copies of a
     *  card pin together. */
    pinKey?: string;
}

/** What a resolved drop MEANS. Membership actions (`add*`, `moveTo*`) are the
 *  working deck; `pin` is the Column Layout's Card Pin — persisted through the
 *  Pool Arrangement in Limited, held in the working deck in Constructed (ADR
 *  0075 §4). */
export type DeckZoneDragAction =
    /** A search result dropped on the Maindeck — add a copy. */
    | { type: "addToMaindeck"; cardId: string; cardName: string }
    /** A search result dropped on the Sideboard — add a copy there. */
    | { type: "addToSideboard"; cardId: string; cardName: string }
    /** A Maindeck card dropped on the Sideboard — move it out of the deck.
     *  Deliberately carries NO column: the Sideboard is one drop target and a
     *  card leaving the deck records no Pin (issue #1622 AC). It DOES carry
     *  the dragged copy's key, so the copy that leaves is the one the player
     *  dragged rather than whichever copy happens to sit first in the zone
     *  array (issue #1626). */
    | { type: "moveToSideboard"; cardId: string; pinKey: string }
    /** A Sideboard card dropped on a Maindeck Column — move it into the deck
     *  AND pin it to exactly that Column, in one gesture. */
    | {
          type: "moveToMaindeck";
          cardId: string;
          columnId: ColumnId | null;
          /** Pin key of the dragged COPY (issue #1626); see
           *  {@link DeckZoneDragSource.pinKey}. */
          pinKey: string;
      }
    /** A Maindeck card dropped on another Maindeck Column — record a Card Pin;
     *  it stays in the deck. */
    | { type: "pin"; cardId: string; columnId: ColumnId; pinKey: string }
    /** A deck card dropped on the SOURCE pane's tab (issue #2584) — it leaves
     *  the deck altogether. `zone` says which list it is leaving, because the
     *  two are separate lists in every variant and the drag payload's `kind`
     *  is the only thing that knows which. */
    | {
          type: "removeFromDeck";
          cardId: string;
          zone: DeckZone;
          pinKey: string;
      };

/** Resolves a completed drag into the action it represents, or `null` for a
 *  cancelled / no-op drop (missing data or target, an id this surface doesn't
 *  own, a Sideboard→Sideboard drag, a Maindeck card dropped on the Maindeck
 *  pane rather than on a Column). Pure — no side effects. */
export function resolveDeckZoneDragAction(
    source: DeckZoneDragSource | undefined,
    destId: string | undefined
): DeckZoneDragAction | null {
    if (!source) return null;

    // The Source pane's tab (issue #2584): a deck card dropped there leaves
    // the deck. A search RESULT dropped there is a no-op — it never entered.
    if (isSourceTabDropId(destId)) {
        if (source.kind === "result") return null;
        return {
            type: "removeFromDeck",
            cardId: source.cardId,
            zone: source.kind === "main" ? "maindeck" : "sideboard",
            pinKey: source.pinKey ?? source.cardId,
        };
    }

    const target = parseDeckZoneDropId(destId);
    if (!target) return null;

    if (source.kind === "result") {
        return target.zone === "sideboard"
            ? {
                  type: "addToSideboard",
                  cardId: source.cardId,
                  cardName: source.cardName,
              }
            : {
                  type: "addToMaindeck",
                  cardId: source.cardId,
                  cardName: source.cardName,
              };
    }

    // The Pin key of the dragged COPY (issue #1626), defaulted to the card id
    // — the Constructed rule (all copies pin together) and the shape every
    // surface that declares no per-copy key gets for free.
    const pinKey = source.pinKey ?? source.cardId;

    if (target.zone === "sideboard") {
        // Only a Maindeck card can move TO the Sideboard; a Sideboard card
        // dropped back on the Sideboard is a no-op.
        return source.kind === "main"
            ? { type: "moveToSideboard", cardId: source.cardId, pinKey }
            : null;
    }

    if (source.kind === "side") {
        return {
            type: "moveToMaindeck",
            cardId: source.cardId,
            columnId: target.columnId,
            pinKey,
        };
    }

    // A Maindeck card already in the Maindeck: only a COLUMN drop means
    // anything. A drop on the pane itself names no Column, so there is no Pin
    // to record — a no-op rather than a silent clear.
    return target.columnId === null
        ? null
        : {
              type: "pin",
              cardId: source.cardId,
              columnId: target.columnId,
              pinKey,
          };
}

/** The callbacks a host wires the resolved action to. Every one is optional
 *  except the two both builders always support, so the Limited builder (which
 *  has no "add from search results" source) simply omits `onAdd*`. */
export interface DeckZoneDragHandlers {
    /** `pinKey` names the COPY being moved (issue #1626) — a host whose zones
     *  hold several identical cards moves exactly that one; a host with no
     *  per-copy identity (Constructed) ignores the argument and keeps the
     *  first-match rule. */
    onMoveToSideboard: (cardId: string, pinKey?: string) => void;
    /** Membership only — the Pin half of the one-gesture Sideboard→Column drop
     *  is dispatched separately through {@link DeckZoneDragHandlers.onPin}. */
    onMoveToMaindeck: (cardId: string, pinKey?: string) => void;
    /** Records a Card Pin. `pinKey` names the COPY being pinned (issue #1626)
     *  — `cardId` in Constructed, `String(poolIndex)` in Limited — so a host
     *  keyed per copy never has to re-derive it from the card id. */
    onPin: (cardId: string, columnId: ColumnId, pinKey: string) => void;
    onAddToMaindeck?: (cardId: string, cardName: string) => void;
    onAddToSideboard?: (cardId: string, cardName: string) => void;
    /** Removes a card from the deck ALTOGETHER (issue #2584) — the Source
     *  pane tab's drop. Optional: a variant with no Source pane (Limited,
     *  whose Sideboard IS its pool) never mints that drop target, so omitting
     *  the handler makes the action unreachable by construction rather than by
     *  a check inside the resolver. */
    onRemoveFromDeck?: (
        cardId: string,
        zone: DeckZone,
        pinKey?: string
    ) => void;
}

/** Dispatches one resolved action to the host's callbacks. Shared by both
 *  builders so the action→callback mapping (notably "move into the deck AND
 *  pin, in one gesture") has exactly one author. */
export function applyDeckZoneDragAction(
    action: DeckZoneDragAction,
    handlers: DeckZoneDragHandlers
): void {
    switch (action.type) {
        case "addToMaindeck":
            handlers.onAddToMaindeck?.(action.cardId, action.cardName);
            return;
        case "addToSideboard":
            handlers.onAddToSideboard?.(action.cardId, action.cardName);
            return;
        case "moveToSideboard":
            handlers.onMoveToSideboard(action.cardId, action.pinKey);
            return;
        case "moveToMaindeck":
            handlers.onMoveToMaindeck(action.cardId, action.pinKey);
            if (action.columnId !== null) {
                handlers.onPin(action.cardId, action.columnId, action.pinKey);
            }
            return;
        case "pin":
            handlers.onPin(action.cardId, action.columnId, action.pinKey);
            return;
        case "removeFromDeck":
            handlers.onRemoveFromDeck?.(
                action.cardId,
                action.zone,
                action.pinKey
            );
            return;
    }
}
