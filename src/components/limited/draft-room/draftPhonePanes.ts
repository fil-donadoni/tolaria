/**
 * What BOTH phone arrangements of the Draft Room need (issue #2588, PRD
 * #2405 slice 9, ADR 0101 §6).
 *
 * One props type, two components (`draft-portrait-panes.tsx`,
 * `draft-landscape-panes.tsx`), because the two arrangements are genuinely
 * different markup — a vertical 85/15 split with a two-half strip, and a
 * horizontal 80/20 split with a sneak-peek column — and collapsing them into
 * one component with orientation ternaries throughout is how a layout stops
 * being readable. What they must NOT differ on is what they are given, which
 * is what this file pins down.
 *
 * Note what is passed as a NODE rather than as data: the Booster grid, the
 * Pick Timer and the Pool surface. They are built ONCE in
 * `limited-draft-table.tsx` — the component that owns the single
 * `DragDropProvider`, the single Inspect Overlay and the single Peek Panel —
 * so the fork is over LAYOUT only. Two panes each rendering their own
 * provider or their own overlay is the failure mode this shape rules out by
 * construction, and it is one that passes every unit test.
 */
import type { EditingSurfaceAction } from "~/components/editing/editing-surface-action";
import type { DraftSnapController } from "./useDraftSnapStops";

/** One card in a pile — the pool's picks, or the collapsed Booster. */
export interface DraftPileCard {
    key: string;
    cardId: string;
    /** Parked in the Sideboard (rings the tile in the pile). */
    highlight?: boolean;
}

export interface DraftPhonePanesProps {
    /** The snap scroller element. Held by the caller and passed straight to a
     *  `ref=` prop (see `useDraftSnapStops`'s own note on why it is not part
     *  of the controller object). */
    scrollerRef: React.RefObject<HTMLDivElement | null>;
    snap: DraftSnapController;
    /** The Booster grid, already sized for this orientation's density. */
    packGrid: React.ReactNode;
    /** The Pick Timer. Mounted in whichever band stays visible at BOTH stops,
     *  which is what "a pack arriving while parked on the pool starts the
     *  timer" resolves to in practice. */
    timer: React.ReactNode;
    /** `LimitedDraftPool`, arranged for this orientation. */
    pool: React.ReactNode;
    densityToggle: React.ReactNode;
    /** The Booster as a pile — the landscape collapsed pack. */
    packPile: readonly DraftPileCard[];
    /** Everything picked so far, Maindeck first, sideboarded cards flagged. */
    pickPile: readonly DraftPileCard[];
    mainCount: number;
    sideCount: number;
    /** 1-based Pick number, the same one the room's thin bar shows. */
    pickNumber: number;
    /** Cards left in the Booster; `0` = waiting for a pack. */
    packLeft: number;
    /** The Selected Card (`seat.selectedPickId`), or `null`. */
    selected: { cardId: string; cardName: string } | null;
    /** `Pick` / `→ Side` / `Inspect` — the same set the Inspect Overlay gets. */
    actions: readonly EditingSurfaceAction[];
    /** A pack landed while the player was parked on the pool. */
    pulsing: boolean;
}
