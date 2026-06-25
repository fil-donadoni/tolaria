---
name: new-card
description: Generate a CardDefinition for a new MTG card in convex/cards/sets/. Fetches oracle data from Scryfall, maps to the CardDefinition interface, and validates against CR.
argument-hint: "<card name>"
allowed-tools: Bash(curl:*) WebFetch(domain:api.scryfall.com) WebFetch(domain:scryfall.com) WebFetch(domain:yawgatog.com)
---

# New Card Definition Generator

Generate a `CardDefinition` for a new card in the Tolaria engine.

## Workflow

### Step 1 — Fetch oracle data

Scryfall blocks WebFetch (HTTP 403). Use curl with a User-Agent header:

```sh
curl -s -A "Mozilla/5.0" "https://api.scryfall.com/cards/named?exact={card_name_plus_separated}"
```

Prefer `exact=` over `fuzzy=` to avoid ambiguity. Replace spaces with `+`.

Extract: name, mana_cost, type_line, oracle_text, power, toughness, loyalty.

**Card `id` (mandatory):** the `id` is NOT a fresh UUID. It is the card's
`identifiers.scryfallId` from the set's MTGJSON file under `data/json/<SET>.json`
(the Scryfall card object's own `id` field equals this value). The id is what
maps a card to its art, so an invented UUID silently breaks the image. Pull it
with:

```sh
jq -r '.data.cards[] | select(.name=="<Card Name>") | .identifiers.scryfallId' data/json/<SET>.json
```

A per-set test guard (`convex/cards/sets/__tests__/card-id-scryfall.test.ts`)
fails the gate if any card `id` is not a real scryfallId from its set JSON —
do not work around it, fix the id.

### Step 2 — Map to CardDefinition

Use the interface from `convex/cards/types.ts`:

```typescript
export interface CardDefinition {
    id: CardId; // = the card's `identifiers.scryfallId` from the set's MTGJSON file — NEVER generate a fresh UUID
    name: string;
    manaCost?: ManaCost; // { X?, W?, U?, B?, R?, G?, C? }
    types: CardType[];
    subtypes?: string[];
    supertypes?: CardSupertype[];
    power?: number;
    toughness?: number;
    loyalty?: number;
    targetRequirement?: TargetRequirement;
    resolve?: (ctx: SpellContext) => void;
    entersTapped?: boolean;
    staticAbilities?: string[];
    activatedAbilities?: ActivatedAbility[];
    triggeredAbilities?: string[];
    sbaMods?: string[];
}
```

### Step 3 — Classify complexity

1. **Pure data** — Vanilla creature/land: stats only, no resolve/abilities
2. **Declarative** — Keywords (flying, trample) go in `staticAbilities[]`. Mana abilities use `ActivatedAbility` with `useStack: false`
3. **Imperative** — Spells with effects need a `resolve()` function using `SpellContext` primitives: `dealDamage`, `destroy`, `destroyAll`, `gainLife`, `loseLife`, `exile`, `modifyPower`, `modifyToughness`

### Step 4 — Mana cost conversion

Scryfall format `{3}{W}{W}` → `{ X: 3, W: 2 }`:

- `{N}` → `X: N` (generic/colorless)
- `{W}` → `W: count`, same for U, B, R, G
- `{C}` → `C: count` (true colorless)

### Step 5 — Generate code

Present the complete `CardDefinition` export for `convex/cards/sets/{set}.ts`.

Follow existing patterns in the file (read it first to match style).

### Step 5b — Uncomment matching reprints (mandatory)

After the new `CardDefinition` is in place, search every other set file in
`convex/cards/sets/` for `CardPrint` stubs whose `definitionId` matches the
new card's `id`. Reprints are stored as commented blocks like:

```ts
// export const animateWallLeb: CardPrint = {
//     printId: "5c5b4738-20bb-465d-b67e-c6146dce9d0b",
//     definitionId: "d5c83259-9b90-47c2-b48e-c7d78519e792", // animateWall (stub)
//     setCode: "leb",
// };
```

For every match:

1. Uncomment the entire block (remove the leading `// ` from each line).
2. Drop the trailing ` (stub)` annotation on the `definitionId` line.

Quick locator:

```sh
grep -rn "definitionId: \"<NEW_CARD_ID>\"" convex/cards/sets/
```

This keeps reprint coverage in sync with implementation: as soon as a
`CardDefinition` becomes real, every print that references it goes live in
the registry without a separate follow-up.

### Step 6 — Ability assessment

For each ability on the card, classify:

- **Implementable now**: keyword abilities, simple activated/triggered, direct damage, destroy
- **Needs new SpellContext primitive**: if the effect isn't in SpellContext yet, flag it
- **Out of scope**: layer system, replacement effects, complex choices

Report clearly what works and what needs engine extensions.

### Step 7 — Refresh the card-index lockfile (mandatory)

`data/card-index.json` (ADR 0041) is the committed index of every implemented
card and the only thing the worklist importer (`list-to-cards.mjs`) dedups
against. It does **not** auto-update — adding a card leaves it stale until you
regenerate it from the registry:

```sh
printf '[]\n' > data/card-index.json && bun run scripts/backfill-card-index.ts
```

(Reset to `[]` first: `backfill` is additive and cannot remove stale/pollution
entries on its own. The fetch is online — Scryfall, ~1 req/75 cards.)

The drift guard `bun run check:index` (part of `check:all`) fails when the
lockfile is out of sync — both directions: implemented-but-not-indexed
(stale) and indexed-but-not-implemented (pollution). If it fails, run the
command above; never hand-edit the lockfile.

## Validation checklist

- [ ] ManaCost matches Scryfall oracle
- [ ] Types and subtypes match type_line
- [ ] Power/toughness match (creatures only)
- [ ] Keywords mapped to staticAbilities
- [ ] TargetRequirement set for targeted spells
- [ ] resolve() uses only existing SpellContext methods
- [ ] `id` == the card's `identifiers.scryfallId` from `data/json/<SET>.json` (NOT a generated UUID)
- [ ] All matching `CardPrint` stubs in `convex/cards/sets/*.ts` uncommented (Step 5b)
- [ ] `data/card-index.json` regenerated via `backfill-card-index.ts` (Step 7) — `bun run check:index` passes

The deck builder's card list is computed in-memory from
`convex/cards/sets/*.ts` on every query call (see `convex/cardIndex.ts`),
so a new card appears in the builder as soon as the Convex deploy picks up
the new module — no sync step required. The **lockfile** is the one artifact
that needs the explicit refresh in Step 7.
