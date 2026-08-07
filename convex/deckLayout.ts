// Column Layout engine (ADR 0075, PRD #1617, issue #1618) — the single,
// PURE authority on column identity, claiming order and Card Pin resolution
// for every deckbuilder surface (Constructed, Limited build, draft-time
// Pool).
//
// Pure by construction: deterministic functions over deck data. No React, no
// Convex context, no I/O — which is what lets client and server import the
// same module (ADR 0074: the frontend may import pure engine modules; it just
// never holds authority).
//
// It subsumed the three grouping helpers that predated it — the Constructed
// dynamic Mana-Value piles (`src/components/lobby/deckGrouping.ts`), and the
// Limited fixed-column ladders of the build view and the draft-time Pool
// (`limitedPoolColumns.ts`) — all of which are now retired: every deckbuilder
// and draft surface resolves its Columns here and nowhere else (issues
// #1622/#1632).
//
// Vocabulary (CONTEXT.md): a **Column Layout** is per **Zone** and owns a
// **Grouping** (which generates predicate-carrying **Columns**), an ordered
// Column list that may also contain user-created **manual** Columns, a
// mandatory undeletable **Catch-All Column** in last position, and an
// **Ordering** applied INSIDE each Column. Grouping and Ordering are
// orthogonal axes: "columns by colour, ordered by Mana Value" is one Layout.
import { getDefinition } from "./cards";
import { getCardColorIdentity } from "./cards/colors";
import type { CardDefinition, CardType, Color, Rarity } from "./cards/types";
import { isLandDefinition, manaValue } from "./gre/constants";

// ────────────────────────────────────────────────────────────────────────────
// Vocabulary types
// ────────────────────────────────────────────────────────────────────────────

/** The rule that GENERATES a Layout's predicate-carrying Columns. */
export type GroupingKind = "mv" | "color" | "type" | "none";

/** The rule that sorts cards INSIDE a Column. Orthogonal to {@link GroupingKind}. */
export type OrderingKind = "name" | "mv" | "color" | "rarity";

/** A Card Pin is recorded per namespace, so a `mv` pin keeps existing while
 *  the active Grouping is colour — it simply does not apply, and applies again
 *  on the way back (ADR 0075 §3). `none` has no namespace: its single column
 *  claims everything, so a pin there would be meaningless. */
export type PinNamespace = "mv" | "color" | "type" | "custom";

export type ColumnKind = "generated" | "manual" | "catchAll";

/** A namespaced column id — `mv:5`, `mv:lands`, `color:R`, `type:creature`,
 *  `custom:<slug>`, plus the reserved {@link CATCH_ALL_COLUMN_ID}. */
export type ColumnId = string;

/** The mandatory, undeletable last Column of every Layout. Deliberately NOT
 *  namespaced: it is the same Column under every Grouping and can never be a
 *  pin target (pins name a namespaced column). */
export const CATCH_ALL_COLUMN_ID = "catch-all";
export const CATCH_ALL_COLUMN_LABEL = "Catch-All";

/** The single Column Grouping `none` generates. Unnamespaced like the
 *  Catch-All: with no grouping there is no Pin namespace to record into. */
export const UNGROUPED_COLUMN_ID = "all";

/** Highest numbered Mana-Value column — every card of this value or higher
 *  shares the one `MV 7+` bucket. Reproduces the retired Limited
 *  `MAX_POOL_COLUMN` ladder exactly, which is why adopting this engine cost
 *  the Limited build view (#1622) and the draft-time Pool (#1632) no visible
 *  change. */
export const MAX_MANA_VALUE_COLUMN = 7;

/** A **Deck Zone** — the unit a Column Layout belongs to. Each Zone owns its
 *  Layout independently (the Maindeck may be grouped by Mana Value while the
 *  Sideboard is grouped by colour). Maindeck/Sideboard is modelled as two
 *  parallel fields everywhere else in the codebase, so this tag exists only
 *  for the Layout pair. */
export type DeckZone = "maindeck" | "sideboard";

/** One card's Pins, one entry per {@link PinNamespace}. Never erased by a
 *  Grouping switch — an inapplicable Pin is simply skipped. */
export interface CardPins {
    mv?: ColumnId;
    color?: ColumnId;
    type?: ColumnId;
    custom?: ColumnId;
}

/** A user-created Column: a label and NO predicate. No card ever lands in it
 *  except by a `custom` Pin, and it is present under EVERY Grouping of its
 *  Zone (ADR 0075 §3) — which is why a `custom` Pin always applies. */
export interface ManualColumn {
    id: ColumnId;
    label: string;
}

/** The persisted state of one Zone's Column Layout. Generated Columns are
 *  never stored — they are regenerated from `grouping` on every read, minus
 *  `removedColumnIds`. */
export interface ColumnLayout {
    grouping: GroupingKind;
    ordering: OrderingKind;
    /** In render order, after the generated Columns and before the Catch-All. */
    manualColumns: ManualColumn[];
    /** Generated Columns the user has deleted. Namespaced, so deleting `mv:3`
     *  leaves `color:R` alone. A deleted Column's cards fall through to the
     *  Catch-All (ADR 0075 rationale §2). */
    removedColumnIds: ColumnId[];
    /** Card Pins keyed by the surface's own card key — `cardId` for
     *  Constructed (four Lightning Bolts pin together), `String(poolIndex)`
     *  for Limited (the Pool already distinguishes copies, ADR 0075 §4). */
    pins: Record<string, CardPins>;
}

/** Both of a deck's Zone Layouts — the shape `userDecks.layout` stores. */
export type DeckColumnLayout = Record<DeckZone, ColumnLayout>;

/** Catalogue lookup. Defaults to the card registry; injectable so the engine
 *  stays testable (and usable) without the whole catalogue. */
export type CardLookup = (cardId: string) => CardDefinition | undefined;

// ────────────────────────────────────────────────────────────────────────────
// Column ids
// ────────────────────────────────────────────────────────────────────────────

export function makeColumnId(namespace: PinNamespace, key: string): ColumnId {
    return `${namespace}:${key}`;
}

/** Splits a namespaced column id. `null` for an unnamespaced id (the
 *  Catch-All) or an unknown namespace. */
export function parseColumnId(
    id: ColumnId
): { namespace: PinNamespace; key: string } | null {
    const at = id.indexOf(":");
    if (at <= 0) return null;
    const namespace = id.slice(0, at);
    if (!isPinNamespace(namespace)) return null;
    return { namespace, key: id.slice(at + 1) };
}

function isPinNamespace(value: string): value is PinNamespace {
    return (
        value === "mv" ||
        value === "color" ||
        value === "type" ||
        value === "custom"
    );
}

/** The Pin namespace a Grouping records into — `null` for `none`, whose single
 *  Column claims everything and therefore needs no Pin. */
export function pinNamespaceForGrouping(
    grouping: GroupingKind
): PinNamespace | null {
    return grouping === "none" ? null : grouping;
}

// ────────────────────────────────────────────────────────────────────────────
// Generated columns
// ────────────────────────────────────────────────────────────────────────────

/** One generated Column: an id, a label, and the predicate that claims a card
 *  for it. The predicate is a function, which is exactly why generated Columns
 *  are regenerated rather than persisted. */
export interface GeneratedColumn {
    id: ColumnId;
    label: string;
    claims: (def: CardDefinition) => boolean;
}

function landsColumn(namespace: PinNamespace): GeneratedColumn {
    return {
        id: makeColumnId(namespace, "lands"),
        label: "Lands",
        claims: isLandDefinition,
    };
}

/** MV bucket a non-land card falls in — its Mana Value clamped into
 *  `0..MAX_MANA_VALUE_COLUMN`, reproducing today's ladder exactly. */
function manaValueBucket(def: CardDefinition): number {
    return Math.min(
        Math.max(manaValue(def.manaCost), 0),
        MAX_MANA_VALUE_COLUMN
    );
}

const COLOR_COLUMN_ORDER: Color[] = ["W", "U", "B", "R", "G"];

const COLOR_COLUMN_LABEL: Record<Color, string> = {
    W: "White",
    U: "Blue",
    B: "Black",
    R: "Red",
    G: "Green",
    C: "Colourless",
};

/** Claiming rank of every card type that gets its own Column under the `type`
 *  Grouping. `Land` is `Exclude`d on purpose — lands are claimed by the Lands
 *  Column, which is generated under every Grouping. An Artifact Creature is
 *  claimed by the first Column in this order that matches it, i.e. Creature.
 *
 *  Typed as a TOTAL `Record` rather than an array so `tsc` fails the moment a
 *  new `CardType` member is added without a rank here — an unranked type would
 *  otherwise silently route its cards to the Catch-All. */
const TYPE_COLUMN_RANK: Record<Exclude<CardType, "Land">, number> = {
    Creature: 0,
    Planeswalker: 1,
    Instant: 2,
    Sorcery: 3,
    Artifact: 4,
    Enchantment: 5,
    Battle: 6,
    Kindred: 7,
};

/** {@link TYPE_COLUMN_RANK} flattened into claiming order. */
const TYPE_COLUMN_ORDER: CardType[] = (
    Object.keys(TYPE_COLUMN_RANK) as Exclude<CardType, "Land">[]
).sort((a, b) => TYPE_COLUMN_RANK[a] - TYPE_COLUMN_RANK[b]);

/** The Columns a Grouping generates for `defs`, in render order. Only `type`
 *  actually depends on the cards present; the other Groupings emit a fixed
 *  ladder so every Column stays a valid drop target even while empty. */
export function generateColumns(
    grouping: GroupingKind,
    defs: readonly CardDefinition[]
): GeneratedColumn[] {
    switch (grouping) {
        case "mv": {
            const columns: GeneratedColumn[] = [landsColumn("mv")];
            for (let n = 0; n <= MAX_MANA_VALUE_COLUMN; n++) {
                columns.push({
                    id: makeColumnId("mv", String(n)),
                    label: n === MAX_MANA_VALUE_COLUMN ? `MV ${n}+` : `MV ${n}`,
                    claims: (def) =>
                        !isLandDefinition(def) && manaValueBucket(def) === n,
                });
            }
            return columns;
        }
        case "color": {
            const columns: GeneratedColumn[] = [landsColumn("color")];
            for (const color of COLOR_COLUMN_ORDER) {
                columns.push({
                    id: makeColumnId("color", color),
                    label: COLOR_COLUMN_LABEL[color],
                    claims: (def) => {
                        if (isLandDefinition(def)) return false;
                        const colors = getCardColorIdentity(def);
                        return colors.length === 1 && colors[0] === color;
                    },
                });
            }
            columns.push({
                id: makeColumnId("color", "multicolor"),
                label: "Multicolour",
                claims: (def) =>
                    !isLandDefinition(def) &&
                    getCardColorIdentity(def).length > 1,
            });
            columns.push({
                id: makeColumnId("color", "colorless"),
                label: "Colourless",
                claims: (def) =>
                    !isLandDefinition(def) &&
                    getCardColorIdentity(def).length === 0,
            });
            return columns;
        }
        case "type": {
            const present = new Set<CardType>();
            for (const def of defs) {
                if (isLandDefinition(def)) continue;
                for (const type of def.types) present.add(type);
            }
            const columns: GeneratedColumn[] = [landsColumn("type")];
            for (const type of TYPE_COLUMN_ORDER) {
                if (!present.has(type)) continue;
                columns.push({
                    id: makeColumnId("type", type.toLowerCase()),
                    label: type,
                    claims: (def) =>
                        !isLandDefinition(def) && def.types.includes(type),
                });
            }
            return columns;
        }
        case "none":
            // ADR 0075 generates a Lands Column under every Grouping; `none`
            // is the degenerate case where there IS no grouping, so the single
            // Column holds the whole Zone, lands included (issue #1618 AC:
            // "Grouping `none` produces a single column plus the Catch-All").
            return [
                { id: UNGROUPED_COLUMN_ID, label: "All", claims: () => true },
            ];
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Layout construction and mutation (all pure — every helper returns a NEW
// layout, the input is never mutated)
// ────────────────────────────────────────────────────────────────────────────

export function createColumnLayout(
    overrides: Partial<ColumnLayout> = {}
): ColumnLayout {
    return {
        grouping: "mv",
        ordering: "name",
        manualColumns: [],
        removedColumnIds: [],
        pins: {},
        ...overrides,
    };
}

export function createDeckColumnLayout(): DeckColumnLayout {
    return { maindeck: createColumnLayout(), sideboard: createColumnLayout() };
}

export function setGrouping(
    layout: ColumnLayout,
    grouping: GroupingKind
): ColumnLayout {
    // Every Pin survives untouched — that is the whole point of namespacing
    // them (ADR 0075 §3).
    return { ...layout, grouping };
}

export function setOrdering(
    layout: ColumnLayout,
    ordering: OrderingKind
): ColumnLayout {
    return { ...layout, ordering };
}

/** Records (or, with `columnId: null`, clears) one card's Pin in one
 *  namespace. An entry that ends up with no Pin at all is dropped rather than
 *  kept as an empty row — same "don't grow the persisted shape forever"
 *  convention `upsertPoolArrangementEntry` follows. */
export function setCardPin(
    layout: ColumnLayout,
    pinKey: string,
    namespace: PinNamespace,
    columnId: ColumnId | null
): ColumnLayout {
    const next: CardPins = { ...(layout.pins[pinKey] ?? {}) };
    if (columnId === null) delete next[namespace];
    else next[namespace] = columnId;

    const pins = { ...layout.pins };
    if (Object.keys(next).length === 0) delete pins[pinKey];
    else pins[pinKey] = next;
    return { ...layout, pins };
}

/** Pins a card into `columnId`, deriving the namespace from the id — a
 *  `custom:` id records a `custom` Pin, a `mv:`/`color:`/`type:` id records
 *  that Grouping's Pin. Returns the layout unchanged for an id with no
 *  namespace (the Catch-All is never a pin target). */
export function pinCardToColumn(
    layout: ColumnLayout,
    pinKey: string,
    columnId: ColumnId
): ColumnLayout {
    const parsed = parseColumnId(columnId);
    if (!parsed) return layout;
    return setCardPin(layout, pinKey, parsed.namespace, columnId);
}

/** Re-keys one card's Pins from `oldKey` to `newKey` (issue #1629 fixup,
 *  finding F1). `pins` is keyed by the surface's own pin key — `cardId` for
 *  Constructed — so a caller that changes what identity a physical copy is
 *  recorded under (the basic-land art rewrite changes a Basic's `cardId`
 *  outright) must move the Pin's KEY along with it, or the Pin is orphaned
 *  under an id nothing resolves to anymore. A Pin already recorded at
 *  `newKey` wins per namespace over the migrated one — it is the live state
 *  for whatever already resolves to that identity — with the migrated Pin
 *  only filling a namespace the target doesn't have.
 *
 *  Returns the SAME layout reference when `oldKey` has no Pin to move, or
 *  when the keys are equal, so a caller can call this unconditionally instead
 *  of guarding it themselves. */
export function remapPinKey(
    layout: ColumnLayout,
    oldKey: string,
    newKey: string
): ColumnLayout {
    if (oldKey === newKey) return layout;
    const oldPins = layout.pins[oldKey];
    if (!oldPins) return layout;
    const pins = { ...layout.pins };
    delete pins[oldKey];
    pins[newKey] = { ...oldPins, ...pins[newKey] };
    return { ...layout, pins };
}

/** {@link remapPinKey} for every key in `oldKeys`, folded onto the same
 *  `newKey` — the shape a single rewrite needs when it can touch more than
 *  one stale identity at once (a deck can hold several different old
 *  printings of the same Basic subtype before they're all rewritten to the
 *  one just picked). Applied in order, and each step's destination value
 *  outranks the value it's migrating in (see {@link remapPinKey}'s own merge
 *  order) — so two `oldKeys` colliding on the same namespace resolve
 *  FIRST-one-wins: whichever `oldKey` is processed first lands its value at
 *  `newKey`, and every later `oldKey` colliding on that same namespace loses
 *  to the value already sitting there, exactly as it would against a value
 *  `newKey` held from the start. */
export function remapPinKeys(
    layout: ColumnLayout,
    oldKeys: readonly string[],
    newKey: string
): ColumnLayout {
    let next = layout;
    for (const oldKey of oldKeys) next = remapPinKey(next, oldKey, newKey);
    return next;
}

/** Forces an id into the `custom:` namespace, which is the ONLY namespace a
 *  manual Column may live in. A generated-namespace id (`mv:3`) or an
 *  unnamespaced one (`combo`, the Catch-All) is re-prefixed rather than
 *  rejected: `parseColumnId` splits on the FIRST colon, so `mv:3` becomes
 *  `custom:mv:3` — a `custom` Column whose key happens to read `mv:3`, and
 *  therefore collision-free against every generated id by construction. */
export function toManualColumnId(id: ColumnId): ColumnId {
    return parseColumnId(id)?.namespace === "custom"
        ? id
        : makeColumnId("custom", id);
}

/** Adds a user-created Column. The id is normalised through
 *  {@link toManualColumnId} first: a manual Column that shared an id with a
 *  generated one would resolve into TWO `ResolvedColumn` entries with the same
 *  id, both holding the same card — duplicate React keys and a card rendered
 *  twice. Returns the layout unchanged when the normalised id is already
 *  present. */
export function addManualColumn(
    layout: ColumnLayout,
    column: ManualColumn
): ColumnLayout {
    const id = toManualColumnId(column.id);
    if (layout.manualColumns.some((c) => c.id === id)) return layout;
    return {
        ...layout,
        manualColumns: [...layout.manualColumns, { ...column, id }],
    };
}

/** Longest manual Column label the surface will store. A Column is one card
 *  wide, so a longer label cannot render anyway; truncating at the ENGINE
 *  (rather than with a CSS ellipsis) keeps the persisted deck data bounded —
 *  `userDecks.layout` is user-authored text and rides on every deck read. */
export const MANUAL_COLUMN_LABEL_MAX = 24;

/** The label a manual Column is created/renamed with, normalised: whitespace
 *  collapsed, trimmed, truncated. `null` for a label that is empty once
 *  trimmed — the ONE rejection this engine makes, so "add a column" with a
 *  blank name is a no-op rather than an unlabelled Column nobody can name
 *  afterwards. */
export function normalizeManualColumnLabel(raw: string): string | null {
    const label = raw
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, MANUAL_COLUMN_LABEL_MAX)
        .trim();
    return label.length === 0 ? null : label;
}

/** Mints a fresh `custom:` id for `label`, collision-free against the manual
 *  Columns `layout` already has: `"Removal"` → `custom:removal`, and a second
 *  Column also called `"Removal"` → `custom:removal-2`.
 *
 *  Slug-derived rather than random so the persisted layout stays readable and
 *  the id is a deterministic function of its inputs (testable without
 *  stubbing a generator). Collision-free against GENERATED ids by
 *  construction — every generated id lives in the `mv`/`color`/`type`
 *  namespace, never `custom` (see {@link toManualColumnId}). A label with no
 *  slug-able character at all (`"★"`) falls back to `column`, which then
 *  de-duplicates like any other. */
export function manualColumnIdForLabel(
    layout: ColumnLayout,
    label: string
): ColumnId {
    const slug = label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    const base = makeColumnId("custom", slug.length > 0 ? slug : "column");
    const taken = new Set(layout.manualColumns.map((c) => c.id));
    if (!taken.has(base)) return base;
    for (let n = 2; ; n++) {
        const candidate = `${base}-${n}`;
        if (!taken.has(candidate)) return candidate;
    }
}

/** Renames a manual Column. Only manual Columns are renameable: a generated
 *  Column's label is derived from its Grouping (`MV 5`, `White`) and would be
 *  regenerated over on the next resolve, and the Catch-All's is fixed.
 *
 *  Returns the layout unchanged for an unknown/generated id, for a label that
 *  normalises to nothing, and for a no-op rename — so a caller can wire it
 *  straight to an input's `onSubmit` without pre-checking. The Column's ID
 *  never changes: it is what every Card Pin names, so re-slugging on rename
 *  would silently unpin every card in it. */
export function renameManualColumn(
    layout: ColumnLayout,
    columnId: ColumnId,
    label: string
): ColumnLayout {
    const next = normalizeManualColumnLabel(label);
    if (next === null) return layout;
    if (
        !layout.manualColumns.some((c) => c.id === columnId && c.label !== next)
    )
        return layout;
    return {
        ...layout,
        manualColumns: layout.manualColumns.map((c) =>
            c.id === columnId ? { ...c, label: next } : c
        ),
    };
}

/** Deletes a Column: a manual one drops out of the list, a generated one is
 *  recorded in `removedColumnIds` so the Grouping stops regenerating it. The
 *  Catch-All and Grouping `none`'s single whole-Zone Column are undeletable
 *  and return the layout unchanged — the two Columns that are not pin targets
 *  (see {@link canDeleteColumn}). The `none` case is the id shape this guard
 *  used to miss: unnamespaced, so neither the Catch-All check nor the
 *  `custom:` check below caught it, and it rode on `userDecks.layout` forever
 *  (PR #2318 review NB3).
 *
 *  Pins are deliberately NOT erased (ADR 0075 §3: a Pin is never erased). A
 *  Pin naming a Column that no longer exists simply does not apply — and
 *  applies again if the Column is restored. */
export function removeColumn(
    layout: ColumnLayout,
    columnId: ColumnId
): ColumnLayout {
    if (columnId === CATCH_ALL_COLUMN_ID) return layout;
    if (columnId === UNGROUPED_COLUMN_ID) return layout;
    if (layout.manualColumns.some((c) => c.id === columnId)) {
        return {
            ...layout,
            manualColumns: layout.manualColumns.filter(
                (c) => c.id !== columnId
            ),
        };
    }
    // A `custom:` id names a manual Column and nothing else. If it isn't in
    // `manualColumns` it is simply gone — recording it in `removedColumnIds`
    // (which only ever filters GENERATED Columns) would be inert but PERSISTED
    // forever on `userDecks.layout` / `poolArrangement`, accumulating junk.
    if (parseColumnId(columnId)?.namespace === "custom") return layout;
    if (layout.removedColumnIds.includes(columnId)) return layout;
    return {
        ...layout,
        removedColumnIds: [...layout.removedColumnIds, columnId],
    };
}

/** Undoes {@link removeColumn} for a generated Column. */
export function restoreColumn(
    layout: ColumnLayout,
    columnId: ColumnId
): ColumnLayout {
    if (!layout.removedColumnIds.includes(columnId)) return layout;
    return {
        ...layout,
        removedColumnIds: layout.removedColumnIds.filter(
            (id) => id !== columnId
        ),
    };
}

/** Normalises the deprecated `PoolArrangementEntry.column` override into the
 *  namespaced Pin shape (ADR 0075 §5, "schema evolution by tolerant read"):
 *  `5 → { mv: "mv:5" }`, `"lands" → { mv: "mv:lands" }`. Lives here so the
 *  namespaced shape has exactly one author; the tolerant read on the
 *  Arrangement entry itself lands with the persistence slice. */
export function normalizeLegacyColumn(
    column: number | "lands" | null | undefined
): CardPins {
    if (column === null || column === undefined) return {};
    if (column === "lands") return { mv: makeColumnId("mv", "lands") };
    const clamped = Math.min(Math.max(column, 0), MAX_MANA_VALUE_COLUMN);
    return { mv: makeColumnId("mv", String(clamped)) };
}

// ────────────────────────────────────────────────────────────────────────────
// Resolution
// ────────────────────────────────────────────────────────────────────────────

/** Tells the engine how to read the caller's own item shape — a `DeckCard`, a
 *  `ResolvedPlacement`, anything. */
export interface ColumnLayoutAdapter<T> {
    cardId: (item: T) => string;
    /** The key this item's Pins are recorded under. Constructed uses the
     *  `cardId`; Limited uses `String(poolIndex)`. */
    pinKey: (item: T) => string;
    /** Final stable tiebreak inside a Column, applied after the Ordering.
     *  Defaults to comparing `cardId` — today's `cardName` then `cardId`
     *  convention. */
    tiebreak?: (a: T, b: T) => number;
}

export interface ResolveColumnLayoutOptions<T> {
    layout: ColumnLayout;
    items: readonly T[];
    adapter: ColumnLayoutAdapter<T>;
    lookup?: CardLookup;
}

/** One Column with the cards it claimed, in Ordering order. */
export interface ResolvedColumn<T> {
    id: ColumnId;
    label: string;
    kind: ColumnKind;
    /** The namespace a drop onto this Column records a Pin under: the active
     *  Grouping for a generated Column, `custom` for a manual one, `null` for
     *  the Catch-All (which is never a pin target) and for every Column under
     *  Grouping `none`. */
    pinNamespace: PinNamespace | null;
    items: T[];
}

const defaultLookup: CardLookup = (cardId) => {
    try {
        return getDefinition(cardId);
    } catch {
        return undefined;
    }
};

/** THE entry point: resolves `items` into the Layout's Columns.
 *
 *  A card is claimed by the first rule that matches (ADR 0075 §2):
 *  1. its `custom` Pin, if that manual Column exists;
 *  2. the Pin for the active Grouping, if that generated Column exists;
 *  3. the first generated Column whose predicate matches;
 *  4. the Catch-All.
 */
export function resolveColumnLayout<T>({
    layout,
    items,
    adapter,
    lookup = defaultLookup,
}: ResolveColumnLayoutOptions<T>): ResolvedColumn<T>[] {
    const defs = new Map<string, CardDefinition | undefined>();
    const defOf = (item: T): CardDefinition | undefined => {
        const id = adapter.cardId(item);
        if (!defs.has(id)) defs.set(id, lookup(id));
        return defs.get(id);
    };

    const present: CardDefinition[] = [];
    for (const item of items) {
        const def = defOf(item);
        if (def) present.push(def);
    }

    const removed = new Set(layout.removedColumnIds);
    const generated = generateColumns(layout.grouping, present).filter(
        (column) => !removed.has(column.id)
    );
    const generatedIds = new Set(generated.map((c) => c.id));
    const manualIds = new Set(layout.manualColumns.map((c) => c.id));
    const groupingNamespace = pinNamespaceForGrouping(layout.grouping);

    const buckets = new Map<ColumnId, T[]>();
    for (const column of generated) buckets.set(column.id, []);
    for (const column of layout.manualColumns) buckets.set(column.id, []);
    buckets.set(CATCH_ALL_COLUMN_ID, []);

    for (const item of items) {
        buckets
            .get(
                claimColumnId(
                    adapter.pinKey(item),
                    defOf(item),
                    layout,
                    generated,
                    generatedIds,
                    manualIds,
                    groupingNamespace
                )
            )!
            .push(item);
    }

    const compare = orderingComparator(layout.ordering, defOf, adapter);
    const resolved: ResolvedColumn<T>[] = generated.map((column) => ({
        id: column.id,
        label: column.label,
        kind: "generated" as const,
        pinNamespace: groupingNamespace,
        items: buckets.get(column.id)!.slice().sort(compare),
    }));
    for (const column of layout.manualColumns) {
        resolved.push({
            id: column.id,
            label: column.label,
            kind: "manual",
            pinNamespace: "custom",
            items: buckets.get(column.id)!.slice().sort(compare),
        });
    }
    resolved.push({
        id: CATCH_ALL_COLUMN_ID,
        label: CATCH_ALL_COLUMN_LABEL,
        kind: "catchAll",
        pinNamespace: null,
        items: buckets.get(CATCH_ALL_COLUMN_ID)!.slice().sort(compare),
    });
    return resolved;
}

/** The claiming order, for ONE card. Exported shape is
 *  {@link resolveColumnLayout}; this is the rule it applies. */
function claimColumnId(
    pinKey: string,
    def: CardDefinition | undefined,
    layout: ColumnLayout,
    generated: readonly GeneratedColumn[],
    generatedIds: ReadonlySet<ColumnId>,
    manualIds: ReadonlySet<ColumnId>,
    groupingNamespace: PinNamespace | null
): ColumnId {
    const pins = layout.pins[pinKey];

    // 1. A `custom` Pin outranks everything — and always applies, because
    //    manual Columns live under every Grouping.
    if (pins?.custom && manualIds.has(pins.custom)) return pins.custom;

    // 2. The Pin for the ACTIVE Grouping. A Pin in another namespace is not
    //    erased, it simply does not apply here.
    if (groupingNamespace) {
        const pinned = pins?.[groupingNamespace];
        if (pinned && generatedIds.has(pinned)) return pinned;
    }

    // 3. The first generated Column whose predicate claims the card. A card
    //    with no known definition matches nothing.
    if (def) {
        for (const column of generated) {
            if (column.claims(def)) return column.id;
        }
    }

    // 4. The Catch-All.
    return CATCH_ALL_COLUMN_ID;
}

/** Ordering comparators. Each falls back to name, then to the adapter's
 *  tiebreak (`cardId` by default) — today's `cardName` then `cardId`
 *  convention for `name`. */
function orderingComparator<T>(
    ordering: OrderingKind,
    defOf: (item: T) => CardDefinition | undefined,
    adapter: ColumnLayoutAdapter<T>
): (a: T, b: T) => number {
    const tiebreak =
        adapter.tiebreak ??
        ((a: T, b: T) => adapter.cardId(a).localeCompare(adapter.cardId(b)));
    const nameOf = (item: T) => defOf(item)?.name ?? adapter.cardId(item);
    const byName = (a: T, b: T) => nameOf(a).localeCompare(nameOf(b));

    switch (ordering) {
        case "name":
            return (a, b) => byName(a, b) || tiebreak(a, b);
        case "mv":
            return (a, b) =>
                manaValue(defOf(a)?.manaCost) - manaValue(defOf(b)?.manaCost) ||
                byName(a, b) ||
                tiebreak(a, b);
        case "color":
            return (a, b) =>
                colorRank(defOf(a)) - colorRank(defOf(b)) ||
                byName(a, b) ||
                tiebreak(a, b);
        case "rarity":
            return (a, b) =>
                rarityRank(defOf(a)) - rarityRank(defOf(b)) ||
                byName(a, b) ||
                tiebreak(a, b);
    }
}

/** WUBRG, then multicolour, then colourless — the same bucket order the
 *  `color` Grouping generates its Columns in. */
function colorRank(def: CardDefinition | undefined): number {
    if (!def) return COLOR_COLUMN_ORDER.length + 1;
    const colors = getCardColorIdentity(def);
    if (colors.length === 0) return COLOR_COLUMN_ORDER.length + 1;
    if (colors.length > 1) return COLOR_COLUMN_ORDER.length;
    return COLOR_COLUMN_ORDER.indexOf(colors[0]);
}

const RARITY_RANK: Record<Rarity, number> = {
    mythic: 0,
    rare: 1,
    uncommon: 2,
    common: 3,
};

/** Rarest first — the convention every deckbuilder rarity sort uses. */
function rarityRank(def: CardDefinition | undefined): number {
    return def ? RARITY_RANK[def.rarity] : RARITY_RANK.common + 1;
}

// ────────────────────────────────────────────────────────────────────────────
// Deletion
// ────────────────────────────────────────────────────────────────────────────

/** A Column may be deleted only while empty, and a Column that is not a PIN
 *  TARGET never (ADR 0075 §2 + rationale §2 — no card ever has to be relocated
 *  by a deletion, so the only remaining question is where a FUTURE card goes,
 *  answered uniformly by the Catch-All). An unknown column id is not
 *  deletable.
 *
 *  `pinNamespace === null` is the undeletable rule, not `kind === "catchAll"`:
 *  it covers the Catch-All AND Grouping `none`'s single {@link
 *  UNGROUPED_COLUMN_ID} Column, which claims the WHOLE Zone and records no Pin
 *  (`pinNamespaceForGrouping("none")` is `null`). Deleting the latter is
 *  meaningless — every card would fall through to the Catch-All — and it was
 *  the one id shape `removeColumn`'s anti-junk guard let through into
 *  `removedColumnIds`, where it persisted forever with no UI to restore it
 *  (PR #2318 review NB3). */
export function canDeleteColumn<T>(
    columns: readonly ResolvedColumn<T>[],
    columnId: ColumnId
): boolean {
    const column = columns.find((c) => c.id === columnId);
    if (!column) return false;
    if (column.pinNamespace === null) return false;
    return column.items.length === 0;
}

// ────────────────────────────────────────────────────────────────────────────
// Persistence (ADR 0075 §4, issue #1626)
// ────────────────────────────────────────────────────────────────────────────
//
// The Column Layout splits cleanly in two, and the halves live in different
// places on purpose:
//
//   - **Deck data** — manual Columns, deleted Columns, Card Pins. This is work
//     done ON THAT DECK, so it rides on the deck row (`userDecks.layout`) and
//     on the Pool Arrangement for Limited, and follows the deck across devices.
//   - **View preference** — `grouping` and `ordering`. "I always look at my
//     decks by colour" is a property of the USER, not of any one deck, so it
//     lives in `localStorage` (`src/lib/deckViewPrefs.ts`) and applies to every
//     deck the user opens.
//
// `StoredColumnLayout` is therefore the deck half ONLY — a `ColumnLayout` minus
// its two view fields. Every field is optional and an all-default zone is
// omitted entirely, so a deck that has never been arranged stores NOTHING and
// a deck saved before this slice reads back as the default (tolerant read, the
// same rule ADR 0075 §5 applies to `poolArrangement`).

/** The persisted, deck-side half of one Zone's {@link ColumnLayout}. */
export interface StoredColumnLayout {
    manualColumns?: ManualColumn[];
    removedColumnIds?: ColumnId[];
    /** Keyed by the surface's own pin key — `cardId` for Constructed,
     *  `String(poolIndex)` for Limited (whose Pins live on the Pool
     *  Arrangement instead, so this field stays absent there). */
    pins?: Record<string, CardPins>;
}

/** Both Zones' persisted Layouts — the shape `userDecks.layout` stores. */
export interface StoredDeckColumnLayout {
    maindeck?: StoredColumnLayout;
    sideboard?: StoredColumnLayout;
}

/** The view half — the per-user preference a Layout is rehydrated with. */
export interface ColumnViewPreference {
    grouping: GroupingKind;
    ordering: OrderingKind;
}

/** Narrows a live {@link ColumnLayout} to the half that persists on the deck.
 *  `undefined` when nothing is set — an untouched Zone must not write an
 *  empty object onto every deck row.
 *
 *  `includePins` is explicit because the two builders answer it differently
 *  and getting it wrong is silent: Constructed keys its Pins by `cardId` and
 *  stores them here, while Limited keys them by `poolIndex` and stores them on
 *  the seat's Pool Arrangement (ADR 0075 §4) — writing that zone's Pins here
 *  too would duplicate them into a second, diverging home. */
export function toStoredColumnLayout(
    layout: ColumnLayout,
    includePins = true
): StoredColumnLayout | undefined {
    const stored: StoredColumnLayout = {};
    if (layout.manualColumns.length > 0)
        stored.manualColumns = layout.manualColumns.map((c) => ({ ...c }));
    if (layout.removedColumnIds.length > 0)
        stored.removedColumnIds = [...layout.removedColumnIds];
    if (includePins && Object.keys(layout.pins).length > 0)
        stored.pins = structuredPins(layout.pins);
    return Object.keys(stored).length > 0 ? stored : undefined;
}

/** Deep-copies the Pin map so a stored layout never aliases live state. */
function structuredPins(
    pins: Record<string, CardPins>
): Record<string, CardPins> {
    const copy: Record<string, CardPins> = {};
    for (const [key, value] of Object.entries(pins)) copy[key] = { ...value };
    return copy;
}

/** Rehydrates one Zone: the persisted deck half merged with the user's view
 *  preference. `undefined` (a deck saved before this slice, or one never
 *  arranged) yields exactly `createColumnLayout(view)` — which is what makes
 *  "a deck saved before this change behaves exactly as it does today" true by
 *  construction rather than by a migration. */
export function fromStoredColumnLayout(
    stored: StoredColumnLayout | undefined,
    view: ColumnViewPreference
): ColumnLayout {
    return createColumnLayout({
        grouping: view.grouping,
        ordering: view.ordering,
        manualColumns: (stored?.manualColumns ?? []).map((c) => ({ ...c })),
        removedColumnIds: [...(stored?.removedColumnIds ?? [])],
        pins: structuredPins(stored?.pins ?? {}),
    });
}

/** {@link fromStoredColumnLayout} for both Zones at once. */
export function fromStoredDeckColumnLayout(
    stored: StoredDeckColumnLayout | undefined,
    views: Record<DeckZone, ColumnViewPreference>
): DeckColumnLayout {
    return {
        maindeck: fromStoredColumnLayout(stored?.maindeck, views.maindeck),
        sideboard: fromStoredColumnLayout(stored?.sideboard, views.sideboard),
    };
}

/** Writes one Zone's live Layout back into the persisted pair, returning a NEW
 *  stored layout. The counterpart of {@link fromStoredDeckColumnLayout}: a host
 *  holds the stored shape in its working deck, derives the live one to render,
 *  and folds an edit back through here.
 *
 *  Always returns an OBJECT, `{}` included — never `undefined`. That is the
 *  one signal a persistence sink has to tell "this deck has never been
 *  arranged" (the field is absent, so the sink omits it and the stored row is
 *  left byte-identical) from "the player just emptied their arrangement" (the
 *  field is present and empty, so the sink writes it and the stored layout is
 *  cleared). A per-ZONE key is still dropped when that Zone is empty, so the
 *  stored shape never accumulates `{}` sub-objects. */
export function storeZoneLayout(
    stored: StoredDeckColumnLayout | undefined,
    zone: DeckZone,
    layout: ColumnLayout,
    includePins = true
): StoredDeckColumnLayout {
    const next: StoredDeckColumnLayout = { ...stored };
    const zoneLayout = toStoredColumnLayout(layout, includePins);
    if (zoneLayout === undefined) delete next[zone];
    else next[zone] = zoneLayout;
    return next;
}

// The Convex validators for the shapes above live in the LEAF module
// `convex/deckLayoutStorage.ts`, not here: `convex/schema.ts` has to import
// them, and this module carries a runtime edge to the whole card registry
// (`./cards`, for `defaultLookup`). That is the same reason
// `convex/limited/eventTypes.ts` imports `CardPins` type-only.
