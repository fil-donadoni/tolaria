/**
 * The declared-variant vocabulary of `DeckBuilderShell` (ADR 0075 § "One
 * shell, three declared variants", PRD #1617, issue #1623).
 *
 * The shell renders the WHOLE deckbuilder screen — header band, source-panel
 * slot, both zone surfaces, the split, the drag context, the legality panel
 * and the save bar — and it never asks which builder it is rendering for.
 * Every difference between the variants arrives here instead, as a slot
 * (`ReactNode`) or as data. That is the point of the slice: the two surfaces
 * stop being ABLE to drift, rather than being kept in step by convention.
 *
 * The rule the shell obeys, and the one review test that matters:
 *
 *   **No identity discriminant.** There is no `variant` / `isLimited` /
 *   `kind` field here and none inside the shell. A conditional on whether a
 *   SLOT was supplied (`sourcePanel && …`) is fine — the shell learns nothing
 *   about who supplied it, and the third variant gets the same treatment for
 *   free. A conditional on WHO is rendering is the thing this file exists to
 *   make unnecessary; if one seems needed, the vocabulary below is wrong.
 *
 * The three declared variants (ADR 0075 §1 and §6):
 *
 *  1. **Constructed** (`lobby/deck-builder/deck-builder.tsx`) — supplies the
 *     card-search source panel, its persistence sinks and its Format's
 *     legality. Uses every field below.
 *  2. **Limited build** (`pool-deck-builder-form.tsx`) — no source panel (the
 *     Pool zone IS the source), a basics bar, `limited` legality, and its
 *     Pins persisted on the seat's Pool Arrangement.
 *  3. **Draft-time Pool** (ADR 0075 §6, a later slice) — the reduced-bar
 *     variant: Grouping + Ordering in `headerActions`, no `sourcePanel`, no
 *     `legality`, no `saveBar` (a draft pick persists per move, there is no
 *     deck to name or save). Those three are optional here for exactly that
 *     reason — a two-variant vocabulary would have to be reopened for it.
 */
import type { ReactNode } from "react";
import type { FormatId, Reason } from "@convex/formats";
import type {
    ColumnId,
    GroupingKind,
    OrderingKind,
    StoredDeckColumnLayout,
} from "@convex/deckLayout";
import type { DeckCard, ZoneCard } from "~/types/game";
import type { DeckZoneDragHandlers } from "./deckZoneDrag";

/**
 * The deck a variant is editing, in the ONE shape both the shared workspace
 * hook (`useDeckWorkspace`) and the shell agree on. `format` is fixed per
 * variant (`limited` for a Pool build); `featuredCardId` is the Featured Card
 * override (PRD #589), left `undefined` by a variant that offers no such
 * affordance.
 *
 * Deliberately carries no `colors`: the deck's colour identity is DERIVED from
 * its cards, and a variant's persistence sink derives it at write time (a
 * Tabletop deck needs the Full Catalogue to resolve cards the registry doesn't
 * know, ADR 0080 — which is the variant's business, not the workspace's).
 * Keeping a derived field in the working state is what let the two builders
 * disagree about WHEN to recompute it.
 */
export interface WorkingDeck {
    name: string;
    format: FormatId;
    /** {@link ZoneCard}, not `DeckCard`: an entry may carry the per-copy
     *  identity its Card Pin is recorded under (issue #1626). A variant that
     *  mints none (Constructed) simply leaves the field unset. */
    cards: ZoneCard[];
    sideboard: ZoneCard[];
    featuredCardId?: string;
    /** The deck's persisted Column Layout (ADR 0075 §4, issue #1626) — manual
     *  Columns, deleted Columns, Card Pins. It lives in the WORKING DECK, not
     *  beside it, because it IS deck data: every column edit then rides the
     *  same debounced autosave as a card edit, with no second save path to
     *  keep in step. `undefined` = the player has not touched the arrangement
     *  in this session, which the sinks read as "leave the stored layout
     *  alone".
     *
     *  Grouping and Ordering are deliberately NOT in here: they are per-user
     *  view preferences (`localStorage`), so a variant holds them separately
     *  and merges the two halves through `fromStoredDeckColumnLayout`. */
    layout?: StoredDeckColumnLayout;
}

/**
 * `localStorage` namespaces and responsive sizing for the zone pair.
 *
 * The namespaces stay EXPLICIT rather than being derived from one id: the two
 * builders' saved split and zoom already live under distinct keys
 * (`tolaria:deckbuilderSplit:deckbuilder` vs `…:pool`), and collapsing them
 * onto a shared key would silently merge two independent layouts — while
 * renaming them would silently discard a preference a user already set.
 */
export interface DeckBuilderViewSpec {
    /** Responsive base card width (`cardBase()`), the zoom multipliers scale it. */
    cardBase: string;
    /** `useSplitRatio` namespace + the default Maindeck share of the split. */
    splitZone: string;
    splitDefault: number;
    /** `useCardZoom` namespaces, one per zone, and their shared initial value. */
    mainZoomZone: string;
    sideZoomZone: string;
    zoomInitial: number;
}

/** Zone copy and the Sideboard's cap (Constructed `0–15`; Limited uncapped). */
export interface DeckZonePresentation {
    mainTitle?: string;
    sideTitle?: string;
    mainEmptyMessage: string;
    sideEmptyMessage: string;
    /** e.g. `/15`. Absent = uncapped. */
    sideCountSuffix?: string;
    /** Soft-limit warning shown beside the Sideboard count. */
    sideWarning?: string | null;
}

/**
 * Every gesture the zones (and a draggable source panel) can raise.
 *
 * `onAddToMaindeck` / `onAddToSideboard` are optional because they only exist
 * where cards can enter the deck from OUTSIDE the two zones — the Constructed
 * search results. A Limited seat's cards all start in one zone or the other,
 * so omitting the handler makes that drag a no-op by construction rather than
 * by a check inside the shell.
 */
export interface DeckZoneActions extends DeckZoneDragHandlers {
    /** The clicked entry, not merely its card id — a zone holds several
     *  identical cards and the handler must be able to act on the COPY the
     *  player actually tapped (issue #1626). */
    onMainCardClick: (card: ZoneCard) => void;
    onSideCardClick: (card: ZoneCard) => void;
    /** Per-zone Grouping/Ordering control callbacks (PRD #1617, issue #1624).
     *  Every variant supplies all four — unlike `onAdd*` above, there is no
     *  variant whose zones lack these controls. */
    onMainGroupingChange: (grouping: GroupingKind) => void;
    onSideGroupingChange: (grouping: GroupingKind) => void;
    onMainOrderingChange: (ordering: OrderingKind) => void;
    onSideOrderingChange: (ordering: OrderingKind) => void;
    /** Manual-Column management for the MAINDECK (ADR 0075 §2, issue #1626).
     *
     *  Optional as a TRIO, and the surface renders the affordances only when
     *  they are supplied — the reduced draft-time bar (ADR 0075 §6) declares
     *  none, because adding and deleting columns is a workbench gesture, not a
     *  timed-draft one. Supplied for the Maindeck and not the Sideboard: the
     *  Sideboard is a single whole-pane drop target (`dropModel: "pane"`), so a
     *  manual Column there could never receive a card.
     *
     *  `onAddColumn` takes the raw label — the engine normalises it and mints
     *  the collision-free `custom:` id, so no caller has to. */
    onAddColumn?: (label: string) => void;
    onRenameColumn?: (columnId: ColumnId, label: string) => void;
    onDeleteColumn?: (columnId: ColumnId) => void;
}

/** The Featured Card affordance (PRD #589). Absent = not offered. */
export interface FeaturedCardSpec {
    cardId: string | null;
    onSet: (cardId: string) => void;
}

/**
 * Live legality as DATA, not as a rendered node.
 *
 * The acceptance criteria call this one of the three things a wrapper
 * supplies, and it is — but what it supplies is the RESULT of validating
 * against its own Format, never the panel. A `ReactNode` slot here would
 * re-open exactly the drift the slice closes: the two builders already showed
 * different amounts of legality (only Limited folded it into `SaveDeckBar`'s
 * compact chip on a short viewport). One shell rendering both the panel and
 * the chip from one record makes that impossible.
 */
export interface DeckLegalitySpec {
    formatLabel: string;
    isLegal: boolean;
    reasons: Reason[];
}

/**
 * The save bar. Optional: a variant with no deck to name or save (the
 * draft-time Pool) omits it and the shell renders none.
 */
export interface DeckSaveBarSpec {
    name: string;
    cardCount: number;
    onChangeName: (name: string) => void;
    onDelete?: () => void;
    /** The compact, short-viewport-only twin of a header `foldableActions`
     *  control (issue #1631 fixup) — rendered exactly like `onBack`/
     *  `legality` already are, hidden except under `short-viewport:`. Set
     *  this alongside `DeckBuilderSlots.headerFoldableActions` so a control
     *  that disappears with a hidden header band stays reachable. */
    foldableActions?: ReactNode;
}

/** Slots — the builder-specific REGIONS of the screen. */
export interface DeckBuilderSlots {
    /** Header-band controls beyond Back + title (import/export, Format select,
     *  cube filter, banlist panel, search box, a preset's slug chip). Its
     *  presence keeps the header band on screen under `short-viewport:`
     *  (`DeckBuilderHeader`'s `carriesControls` rule) — use
     *  `headerFoldableActions` instead for a control not worth that trade. */
    headerActions?: ReactNode;
    /** A header-band control that does NOT keep the band on screen under
     *  `short-viewport:` (issue #1631 fixup) — passed through to
     *  `DeckBuilderHeader`'s `foldableActions` slot. A caller supplying this
     *  MUST also supply the same control's compact twin on
     *  `saveBar.foldableActions`, or the control is lost (not folded) once
     *  the band hides. The Limited pool builder's Stats button is the
     *  reference case: its header carries no other controls, so #2056's
     *  hidden-band budget (~39px handed back to the card zones) must stay
     *  intact. */
    headerFoldableActions?: ReactNode;
    /** A second, full-width header row (the Constructed search filters). */
    headerFilters?: ReactNode;
    /** Where new cards come FROM. Absent for a variant whose zones are the
     *  only source. */
    sourcePanel?: ReactNode;
    /** The basic-lands bar (generalised to Constructed in a later slice). */
    basicsBar?: ReactNode;
    /** Dialogs the wrapper owns (deck import, delete confirmation). */
    overlays?: ReactNode;
}

/** The one card tooltip both zones of every variant use. */
export function deckCardTitle(card: DeckCard): string {
    return `Remove ${card.cardName} (drag to move zone)`;
}
