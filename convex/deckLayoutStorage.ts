// Convex validators for the persisted Column Layout (ADR 0075 §4/§5, PRD
// #1617, issue #1626) — the storage shape of `userDecks.layout` and of a Pool
// Arrangement entry's Card Pins.
//
// A LEAF module on purpose. The shapes it describes are declared in
// `convex/deckLayout.ts` (the Column Layout engine, the single authority on
// column identity and Pin resolution), but that module carries a runtime edge
// to the whole card registry (`./cards`, for its default catalogue lookup) —
// and the two modules that need these validators are `convex/schema.ts` and
// `convex/limited/eventTypes.ts`, both of which are deliberately kept free of
// it. So the TYPES are imported here type-only (erased at compile time) and
// the only runtime dependency is `convex/values`.
//
// One authority per shape, for the reason issue #1621 paid for: a Pin
// namespace added to `CardPins` and to the schema but not to a hand-kept copy
// used as a `returns` validator 500s the query at runtime, invisibly to `tsc`.
// The `Infer` mirrors at the bottom turn exactly that drift into a `tsc`
// failure.
import { v, type Infer } from "convex/values";
import type { CardPins, StoredDeckColumnLayout } from "./deckLayout";

/** {@link CardPins} as a Convex validator — one optional entry per Pin
 *  namespace. Values are namespaced Column ids minted by the engine
 *  (`makeColumnId`): `mv:5`, `mv:lands`, `color:R`, `custom:combo`. Stored as
 *  free `v.string()` because the id vocabulary is OPEN (a `custom:` key is
 *  user-authored) and the engine, not the DB, is its authority.
 *
 *  Every field optional, and every USE of it optional, so a row written before
 *  Card Pins existed validates untouched (tolerant read, ADR 0075 §5). */
export const cardPinsValidator = v.object({
    mv: v.optional(v.string()),
    color: v.optional(v.string()),
    type: v.optional(v.string()),
    custom: v.optional(v.string()),
});

/** A user-created Column: a label and no predicate. */
export const manualColumnValidator = v.object({
    id: v.string(),
    label: v.string(),
});

/** One Zone's persisted Layout — `StoredColumnLayout`. Every field optional:
 *  a Zone only ever stores the halves the user actually touched, and a Zone
 *  that was never arranged is omitted entirely by
 *  `toStoredColumnLayout`. */
export const storedColumnLayoutValidator = v.object({
    manualColumns: v.optional(v.array(manualColumnValidator)),
    removedColumnIds: v.optional(v.array(v.string())),
    // Keyed by the surface's own pin key — `cardId` for Constructed,
    // `String(poolIndex)` for Limited (whose Pins live on the seat's Pool
    // Arrangement instead, so this field stays absent on a Limited deck row).
    pins: v.optional(v.record(v.string(), cardPinsValidator)),
});

/** {@link StoredDeckColumnLayout} as a Convex validator — THE shape
 *  `userDecks.layout` stores. Imported by `convex/schema.ts` (storage) and
 *  `convex/userDecks.ts` (mutation args) so the two cannot drift; the whole
 *  field is `v.optional` at both sites, which is what lets a deck saved before
 *  this slice load unchanged. */
export const storedDeckColumnLayoutValidator = v.object({
    maindeck: v.optional(storedColumnLayoutValidator),
    sideboard: v.optional(storedColumnLayoutValidator),
});

// Compile-time proof that the validator and the domain type describe the same
// layout: each must be assignable to the other, so a field added to one and
// not to the other fails `tsc` here rather than at runtime in a deployment.
// The same device `poolArrangementEntryValidator` uses.
type ValidatedStoredDeckColumnLayout = Infer<
    typeof storedDeckColumnLayoutValidator
>;
const _layoutValidatorMatchesType: StoredDeckColumnLayout =
    {} as ValidatedStoredDeckColumnLayout;
const _layoutTypeMatchesValidator: ValidatedStoredDeckColumnLayout =
    {} as StoredDeckColumnLayout;
void _layoutValidatorMatchesType;
void _layoutTypeMatchesValidator;

// The same mirror for the Pin map alone, which `convex/limited/eventTypes.ts`
// re-exports for the Pool Arrangement entry.
type ValidatedCardPins = Infer<typeof cardPinsValidator>;
const _pinsValidatorMatchesType: CardPins = {} as ValidatedCardPins;
const _pinsTypeMatchesValidator: ValidatedCardPins = {} as CardPins;
void _pinsValidatorMatchesType;
void _pinsTypeMatchesValidator;
