# Tolaria

An MTG gameplay engine for study and experimentation. Rules-correct, real-time reactive, two-player.

## MTG Domain

Terms from the Magic: The Gathering Comprehensive Rules. The CR is the authority — these definitions capture how we use each term in code, not the full CR definition.

### Game Structure

**Game**:
A match between two **Players**, proceeding in **Turns** divided into **Phases**.
_Avoid_: Match, session

**Player**:
A participant in a **Game**, identified by a **Player ID**. Has life total, **Zones**, and a **Mana Pool**.
_Avoid_: User (that's the authenticated human; a user controls one or two players)

**Turn**:
One full cycle of **Phases** for the **Active Player**. Numbered sequentially from 1.
_Avoid_: Round

**Phase**:
A subdivision of a **Turn**. Tolaria implements 14 phases: MULLIGAN, UNTAP, UPKEEP, DRAW, PRECOMBAT*MAIN, BEGINNING_OF_COMBAT, DECLARE_ATTACKERS, DECLARE_BLOCKERS, FIRST_STRIKE_DAMAGE, COMBAT_DAMAGE, END_OF_COMBAT, POSTCOMBAT_MAIN, END_STEP, CLEANUP.
\_Avoid*: Step (CR distinguishes phases and steps; we flatten both into "phase")

**Active Player**:
The **Player** whose **Turn** it is.
_Avoid_: Current player, turn player

**Priority**:
The right to take an action. Only one **Player** has priority at a time. Both must pass consecutively for the game to advance (CR 117).
_Avoid_: Turn to act

**State-Based Actions (SBA)**:
Automatic game rules checked whenever a **Player** would receive **Priority**. Applied without using the **Stack** (CR 704). Examples: creature with toughness ≤ 0 dies, player with life ≤ 0 loses.
_Avoid_: Cleanup rules, auto-checks

### Zones

**Library**:
A **Player**'s face-down draw pile. Cards are ordered.
_Avoid_: Deck (ambiguous — see **Deck** in Tolaria Engine section)

**Hand**:
Cards a **Player** has drawn but not yet played.

**Battlefield**:
The shared zone where **Permanents** exist.
_Avoid_: Board, field, play area

**Graveyard**:
A **Player**'s discard pile. Public information, ordered.
_Avoid_: Discard pile

**Exile**:
A zone for cards removed from the game. Public information.
_Avoid_: Removed from game (old terminology)

**Stack**:
The zone where **Spells** and **Abilities** wait to **Resolve**. Last-in, first-out.
_Avoid_: Queue

### Cards

**Permanent**:
A card or **Token** on the **Battlefield**. Has types, subtypes, and may have abilities.
_Avoid_: Board card, in-play card

**Spell**:
A card on the **Stack** that has been **Cast** but hasn't **Resolved** yet.
_Avoid_: Playing (overloaded — "cast" for spells, "play" for lands)

**Creature**:
A **Permanent** type with power and toughness that can attack and block.

**Land**:
A card type that produces **Mana**. Played (not cast) — does not use the **Stack**.

**Token**:
A **Permanent** not represented by a physical card. Created by effects. Ceases to exist when it leaves the **Battlefield**.

### Abilities

**Activated Ability**:
An ability with a cost and effect, written as "cost: effect". Uses the **Stack** unless it's a **Mana Ability**.
_Avoid_: Action, skill

**Triggered Ability**:
An ability that fires automatically when a condition is met ("when/whenever/at"). Uses the **Stack**.
_Avoid_: Event handler, listener

**Static Ability**:
An ability that applies continuously while the **Permanent** is in the appropriate **Zone**. Does not use the **Stack**.
_Avoid_: Passive ability, aura effect

**Mana Ability**:
An **Activated Ability** that produces **Mana** and has no target. Resolves immediately — does not use the **Stack** (CR 605.3a).
_Avoid_: Tap for mana

**Keyword**:
A shorthand for a defined ability (flying, haste, first strike, etc.). Stored as `staticAbilities[]` on a **Card Instance**.

### Spells & Stack

**Cast**:
The process of putting a **Spell** on the **Stack**: announce, choose targets, pay costs.
_Avoid_: Play (for spells — "play" is reserved for lands)

**Resolve**:
A **Spell** or **Ability** on the **Stack** completes its effect and leaves the **Stack**.
_Avoid_: Execute, trigger, fire

**Target**:
A specific **Permanent**, **Player**, or **Spell** chosen during **Casting** that the effect will apply to.

**Spell Copy**:
A **Stack Item** created by copying another spell on the **Stack** (CR 707.10, e.g. Fork). It is not a real card: it carries `isCopy`, inherits the original's resolve/targets/X, may be given a different color via `colorOverride`, and ceases to exist after resolving instead of going to a **Graveyard**. The copy's controller _may_ choose new targets for it (a **Copy-Retarget** target selection).
_Avoid_: Token spell, duplicate

### Combat

**Attacker**:
A **Creature** declared as attacking during DECLARE_ATTACKERS.

**Blocker**:
A **Creature** declared as blocking an **Attacker** during DECLARE_BLOCKERS.

**Combat Damage**:
Damage dealt by **Creatures** during COMBAT_DAMAGE (or FIRST_STRIKE_DAMAGE for first strikers).

**Band**:
A group of attacking **Creatures** (1+ with banding, at most 1 without) declared via banding (CR 702.21e). A band attacks and is blocked as a unit — blocking any member blocks them all. Tracked in `combat.bands`.

**Damage Assignment Authority**:
Who chooses how a combat-damage **Source** splits its damage among its targets. Normally the source's controller; **Band**ing flips it to the controller of the banding creature(s) opposite (CR 702.21j-k). Tracked per source in `combat.damageAssignerIds`, with a multi-party confirm handshake (`damageAssignmentConfirmedBy`).

### Mana

**Mana Cost**:
The resource cost to **Cast** a **Spell** or activate an **Ability**. Expressed as color symbols (W, U, B, R, G) and generic/colorless (C).
_Avoid_: Cost (too vague)

**Mana Pool**:
A **Player**'s current available **Mana**. Empties at end of each **Phase**.
_Avoid_: Resources, energy

**Mana Value (MV)**:
The total mana in a card's **Mana Cost** (CR 202.3). Abbreviated `mv` in code. Formerly "converted mana cost" (CMC) — that term is obsolete.
_Avoid_: CMC, converted mana cost

**Color**:
One of the five mana colors: White (W), Blue (U), Black (B), Red (R), Green (G). Colorless (C) is not a color.

## Tolaria Engine

Terms specific to this project. These are our design choices, not CR mandates.

### Architecture

**GRE (Game Rules Engine)**:
The server-side rules processor. Validates moves, applies effects, emits events. Pure functions, deterministic given the same input. Runs inside Convex mutations.
_Avoid_: Backend, server logic, game loop

**Projection**:
The transformation of a fat **GameState** into a client-safe view. Strips hidden information (opponent's **Hand** → null array, **Library** → count only). Two variants: public (for gameplay) and full (for debug).
_Avoid_: View, snapshot, DTO

**Solo Mode**:
A single-user game where one human controls both **Players**. The UI auto-switches the viewer to whoever has **Priority**. Removes the need for two browser tabs during development and play.
_Avoid_: Single player, practice mode

**vs-AI Game**:
A single-user game where one seat is controlled by the **AI Opponent** instead of the human. Structurally a **Solo Mode** game in which one seat's moves are chosen by the **Bot** rather than clicked by the user. Authority stays server-side: the **Bot**'s move is submitted and validated like any human move (see ADR 0001).
_Avoid_: AI mode, bot match, practice mode

**AI Opponent / Bot**:
The non-human **Player** in a **vs-AI Game**. Chooses legal moves by searching possible game continuations, not by scripted per-card rules.
_Avoid_: CPU, computer player, enemy

**Brain**:
The component that computes the **Bot**'s next move. Distinct from authority: the **Brain** only _proposes_ a move; the **GRE** still validates and applies it. Runs client-side, off the authoritative path.
_Avoid_: AI engine, solver

**Determinization**:
Guessing a concrete possible world for the hidden information (the opponent's **Hand** and the order of the **Library**) so the **Brain** can reason about an otherwise-hidden position as if it were fully known.
_Avoid_: Sampling, guessing, simulation

**Difficulty**:
How much thinking the **Bot** is allowed before moving. A stronger **Bot** is the same **Brain** given a larger search budget, not different logic.
_Avoid_: Level, skill setting

**Compact State**:
The serialized form of **GameState** stored in Convex. Strips defaults, coalesces against **Card Definitions**, and compresses **Library** entries to `[instanceId, cardId]` tuples.
_Avoid_: Blob, serialized state, stored state

### Card System

**Card Definition**:
A static, immutable data record describing a card's properties: name, mana cost, types, abilities, and resolve behavior. Keyed by **Card ID**. Lives in the card registry.
_Avoid_: Card template, card data, card spec

**Card Instance**:
A mutable runtime representation of a specific copy of a card in a **Game**. Carries an **Instance ID**, current zone, tap state, damage, counters, and modified abilities. One **Card Definition** may have multiple **Card Instances** in a game.
_Avoid_: Card copy, card object, card state

**Card ID**:
The Scryfall UUID identifying a **Card Definition**. Maps to card art and oracle text. Immutable, shared across all games.
_Avoid_: Definition ID, Scryfall ID

**Instance ID**:
A unique identifier for a **Card Instance** within a single **Game**. Used as React keys, target references, and attachment pointers. Assigned at game creation.
_Avoid_: Card UUID, runtime ID

**SpellContext**:
The API surface available to a **Card Definition**'s `resolve()` function. Provides composable primitives (moveZone, drawCards, damage, gainLife, etc.) that the resolver calls to apply effects.
_Avoid_: Resolver, effect context, spell API

**Deck**:
The list of **Card IDs** a **Player** brings to a **Game**. Used only at game creation to build the initial **Library**. Static metadata — never mutated during gameplay.
_Avoid_: Library (that's the zone), card list

### Identity

**Player ID**:
An opaque string handle for a **Player** in a **Game**. For two-player games, equals the user's Convex ID. For **Solo Mode**, suffixed with `-p1`/`-p2`.
_Avoid_: User ID (different concept)

**Controller**:
The **Player** who currently controls a **Permanent** or **Spell**. Defaults to **Owner** but can change via effects.
_Avoid_: Player (too vague when control changes)

**Owner**:
The **Player** who started the game with a card in their **Deck**. Never changes. **Tokens** are owned by the **Controller** who created them.

### Interaction

**Card Preview Overlay**:
A full-screen centered overlay showing a card's art and oracle text at maximum legible size. On touch devices, triggered by **Long-Press**. On desktop, the lateral zoom panel serves the same purpose (triggered by hover).
_Avoid_: Tooltip, zoom (overloaded — "zoom" is the desktop variant)

**Action Sheet**:
A bottom sheet listing available actions for a card when more than one is legal (cast, play land, activate abilities). Touch-device replacement for the desktop right-click context menu.
_Avoid_: Context menu (that's the desktop variant), popup

**Long-Press**:
A 400ms sustained touch on a card that opens the **Card Preview Overlay**. Cancelled if finger moves >10px (scroll intent). Provides visual feedback via progressive scale (1.05×).
_Avoid_: Long tap, press-and-hold

**Peek/Lock**:
The dismiss model for the **Card Preview Overlay** on touch devices. Release before 1s = peek (closes immediately). Hold >1s = lock (stays open, dismiss via tap on backdrop).

### Flow

**Announce**:
The first step of **Casting**: the client declares intent to cast a card. Reserves the card, puts it on the **Stack**, and waits for target selection and mana payment.
_Avoid_: Start casting, begin cast

**Pending Choice**:
A mid-resolution decision point where a **Spell** or **Ability** requires a **Player** to make a selection (choose targets, divide damage, search library). **Priority** is frozen until the choice is submitted.
_Avoid_: Prompt, dialog, selection

**Auto-Pass**:
A client preference where a **Player** automatically passes **Priority** during specified **Phases** when they have no legal actions. Can be cancelled.
_Avoid_: Auto-skip, fast-forward

**Drain Auto-Pass**:
The engine-side loop that applies consecutive **Auto-Passes** after a **Priority** change, without requiring round-trips to the client.
_Avoid_: Auto-pass chain, cascade

## Example Dialogue

> **Dev**: "When a creature dies, we need to move it."
> **Domain**: "A **Creature** that dies moves from the **Battlefield** to its **Owner**'s **Graveyard**. That's an **SBA** — it happens automatically before any **Player** receives **Priority**. If anything triggers on death, those **Triggered Abilities** go on the **Stack**."
>
> **Dev**: "What if a card gives all creatures +1/+1?"
> **Domain**: "That's a **Static Ability** on a **Permanent**. It applies continuously via the layer system — no **Stack** involvement. Each **Card Instance** on the **Battlefield** gets modified power/toughness. The **Card Definition** stays unchanged."
>
> **Dev**: "Player wants to Lightning Bolt a creature."
> **Domain**: "The **Player** **Announces** Lightning Bolt — it goes on the **Stack** as a **Spell** with a **Target**. The opponent gets **Priority** to respond. If both pass, it **Resolves**: the **SpellContext** calls `damage(target, 3)` on the targeted **Card Instance**. Then **SBAs** check if the creature has lethal damage."
