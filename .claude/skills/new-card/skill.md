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

### Step 2 — Map to CardDefinition

Use the interface from `convex/cards/types.ts`:

```typescript
export interface CardDefinition {
    id: CardId; // UUID — generate with crypto.randomUUID()
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

## Validation checklist

- [ ] ManaCost matches Scryfall oracle
- [ ] Types and subtypes match type_line
- [ ] Power/toughness match (creatures only)
- [ ] Keywords mapped to staticAbilities
- [ ] TargetRequirement set for targeted spells
- [ ] resolve() uses only existing SpellContext methods
- [ ] ID is a valid UUID
- [ ] All matching `CardPrint` stubs in `convex/cards/sets/*.ts` uncommented (Step 5b)
