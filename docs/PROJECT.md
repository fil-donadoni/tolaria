# MTG Gameplay Engine — Project Brief

Documento di contesto per inizializzare il progetto in Claude Code.
Riassume le decisioni architetturali prese in fase di analisi.

---

## Obiettivo

Costruire un gameplay web di Magic: The Gathering per studio e sperimentazione, con focus sulla correttezza delle regole e sulla reattività real-time tra due client.

**Non è un prodotto commerciale.** Non è richiesta implementazione completa di tutte le carte — l'obiettivo è un engine estendibile con un sottoinsieme di carte funzionante.

---

## Stack scelto

| Layer      | Tecnologia         | Motivazione                                                              |
| ---------- | ------------------ | ------------------------------------------------------------------------ |
| Frontend   | React + TypeScript | Ecosistema nativo Convex                                                 |
| Backend/DB | Convex             | Real-time reattivo out-of-the-box, ideale per stato condiviso tra client |
| Auth       | Clerk (esterno)    | Convex non ha auth nativa                                                |

### Perché Convex per questo progetto

- Lo stato del tavolo da gioco è reattivo per definizione: quando un giocatore agisce, l'altro vede il cambiamento senza polling
- Le mutations sono atomiche e transazionali — ogni cambio di stato è consistente
- Il modello si adatta bene a un gioco turn-based dove ogni azione è discreta
- Per un progetto di studio elimina la gestione infrastrutturale (WebSocket, Redis, server)

### Limitazioni note di Convex accettate

- Vendor lock-in totale (accettabile per progetto di studio)
- Nessuna query SQL raw — si lavora con indici espliciti e TypeScript
- Timeout mutations (~1-2 sec) — non un problema reale per Magic turn-based dove ogni mutation si ferma ad aspettare input umano
- Monitoring/debug meno maturo di Laravel Telescope

---

## Architettura del sistema

### Separazione dei domini

Il gameplay è architetturalmente separato dal "contorno" (matchmaking, profili, collezioni). Questo documento riguarda **solo il gameplay**.

```
Client React (P1) ──┐
                    ├── Convex (stato partita) ── GRE (Game Rules Engine)
Client React (P2) ──┘
```

### Game Rules Engine (GRE)

Il GRE è il cuore del sistema. Gira **server-side** in Convex mutations. Il client non valida mai le regole — è solo una view dello stato.

Principi del GRE:

- **Autoritativo**: ogni mossa viene validata server-side prima di essere applicata
- **Deterministico**: dato lo stesso log di eventi, produce sempre lo stesso stato
- **Isolato**: la logica di regole è indipendente dal layer di trasporto

---

## Modello dati

### Due tabelle principali in Convex

```typescript
// Stato corrente — cache temporanea, si sovrascrive ad ogni azione
defineTable("game_state", {
  gameId: v.id("games"),
  state: v.any(), // snapshot completo della partita
  updatedAt: v.number(),
});

// Log eventi — append-only, permanente
defineTable("game_events", {
  gameId: v.id("games"),
  seq: v.number(), // sequenza progressiva
  type: v.string(), // es. "CAST_SPELL", "PASS_PRIORITY"
  player: v.string(),
  payload: v.any(), // dati specifici dell'evento
  timestamp: v.number(),
});
```

### Struttura dello stato di gioco

```typescript
interface GameState {
  turn: number;
  activePlayer: "player1" | "player2";
  phase: Phase;
  subphase: Subphase;
  priority: "player1" | "player2";
  stack: StackItem[];
  battlefield: {
    player1: Permanent[];
    player2: Permanent[];
  };
  hand: {
    player1: CardId[];
    player2: CardId[];
  };
  library: {
    player1: CardId[];
    player2: CardId[];
  };
  graveyard: {
    player1: CardId[];
    player2: CardId[];
  };
  manaPool: {
    player1: ManaPool;
    player2: ManaPool;
  };
  life: {
    player1: number;
    player2: number;
  };
}
```

---

## Flusso di una azione (esempio: cast Llanowar Elves)

Ogni azione segue questo ciclo:

```
1. Client invia azione → Convex mutation
2. GRE valida (è legal?)
3. GRE applica effetto in memoria
4. GRE genera eventi interni (SPELL_RESOLVED, PERMANENT_ENTERED, CREATURE_ENTERED...)
5. GRE scansiona trigger sui permanenti in campo
6. Se trigger trovati → vanno in stack (NON risolvono automaticamente)
7. Stato stabile raggiunto → salva in game_state + appende a game_events
8. Entrambi i client reagiscono automaticamente (reattività Convex)
```

### Checkpoint di salvataggio

Si salva **solo quando il gioco è in uno stato stabile**, cioè quando aspetta input umano:

| Momento                         | Cosa è cambiato                      |
| ------------------------------- | ------------------------------------ |
| Spell entra in stack            | Stack aggiornato, priority assegnata |
| Priority cambia giocatore       | Nuovo holder della priority          |
| Spell risolve, trigger in stack | Trigger aggiunto allo stack          |
| Stack si svuota                 | Battlefield aggiornato               |

---

## Sistema di eventi e trigger

### Gerarchia eventi

Ogni azione genera eventi in cascata. Esempio per cast di una creatura:

```
CAST_SPELL
  └── SPELL_RESOLVED
        ├── PERMANENT_ENTERED
        └── CREATURE_ENTERED
```

### Struttura di un trigger

Le carte dichiarano i loro trigger come **dati**, non come codice imperativo:

```typescript
interface TriggerDefinition {
  event: EventType[]; // quali eventi ascolta
  condition: (event, state) => boolean; // quando si attiva
  effect: (event, state) => Effect; // cosa fa quando risolve
}
```

### Processamento trigger nella mutation

```typescript
// Dentro la mutation, dopo ogni azione:
const eventQueue: GameEvent[] = []

// 1. Applica effetto principale
applyEffect(gameState, action)
eventQueue.push(...getImpliedEvents(action))

// 2. Processa eventi — cerca trigger
while (eventQueue.length > 0) {
  const event = eventQueue.shift()
  const triggers = checkTriggers(gameState, event)
  // I trigger NON risolvono — vanno in stack
  gameState.stack.push(...triggers)
  eventQueue.push(...getImpliedEvents(event, gameState))
}

// 3. State Based Actions (automatiche, senza priority)
applyStateBased Actions(gameState)

// 4. Una sola scrittura atomica
await ctx.db.replace(gameId, gameState)
await ctx.db.insert("game_events", { ... })
```

---

## Fasi e struttura del turno

```
BEGINNING
  ├── UNTAP      (automatica, nessuna priority)
  ├── UPKEEP     (priority)
  └── DRAW       (priority)

PRECOMBAT_MAIN   (priority)

COMBAT
  ├── BEGINNING_OF_COMBAT  (priority)
  ├── DECLARE_ATTACKERS    (priority)
  ├── DECLARE_BLOCKERS     (priority)
  ├── COMBAT_DAMAGE        (priority)
  └── END_OF_COMBAT        (priority)

POSTCOMBAT_MAIN  (priority)

ENDING
  ├── END_STEP   (priority)
  └── CLEANUP    (automatica)
```

---

## Stack e priority

### Modello della priority

```typescript
type StackItem = {
  id: string;
  type: "SPELL" | "ACTIVATED_ABILITY" | "TRIGGERED_ABILITY";
  source: CardId;
  controller: PlayerId;
  effect: Effect;
  targets: Target[];
  status: "WAITING" | "RESOLVING";
  requiresChoice?: ChoiceRequest; // se l'effetto ha bisogno di input
};
```

### Regola fondamentale

Lo stack risolve **un item alla volta**, dal top verso il bottom. Dopo ogni risoluzione, priority ricomincia dall'active player. Entrambi i giocatori devono passare consecutivamente per procedere.

---

## Timer di priority

Per i casi in cui un giocatore ha tempo limitato per rispondere:

```typescript
// Schedula timeout se il giocatore non risponde
await ctx.scheduler.runAfter(30_000, internal.game.handlePriorityTimeout, {
  gameId,
  expectedSeq: currentSeq, // per evitare false timeout se il giocatore ha già agito
});
```

La cancellazione del timer si gestisce con un check sul seq: se il seq è cambiato quando il timer scatta, l'azione è già avvenuta e il timeout viene ignorato.

---

## Replay e retention dei dati

### Strategia

Il log eventi è la **source of truth** per il replay. Dato un log completo e un GRE deterministico, qualsiasi stato della partita è ricostruibile rieseguendo gli eventi.

```
replay(gameEvents[0..N], GRE) → GameState al momento N
```

### Lifecycle dei dati

| Dato                             | Retention                                  |
| -------------------------------- | ------------------------------------------ |
| `game_state` (snapshot corrente) | Eliminato a fine partita                   |
| `game_events` (log completo)     | 30-90 giorni, poi eliminato o anonimizzato |
| Risultato partita e statistiche  | Permanente                                 |

Per scala futura: tiered storage (DB → S3 → S3 Glacier) basato su età dei dati.

---

## Struttura del progetto

```
project/
├── convex/                        # tutto il backend Convex
│   ├── schema.ts                  # definizione tabelle
│   ├── game.ts                    # mutations/queries pubbliche
│   └── gre/                       # GRE — moduli interni
│       ├── engine.ts              # loop principale
│       ├── phases.ts              # gestione fasi e turni
│       ├── stack.ts               # stack e priority
│       ├── triggers.ts            # sistema eventi e trigger
│       ├── sba.ts                 # state based actions globali
│       ├── actions/               # validatori per ogni tipo di azione
│       │   ├── castSpell.ts
│       │   ├── activateAbility.ts
│       │   └── declareAttackers.ts
│       └── cards/                 # definizioni carte come dati
│           ├── index.ts           # registry — mappa id → CardDefinition
│           ├── types.ts           # tipi condivisi
│           └── sets/
│               └── alpha.ts       # primo set supportato
└── src/                           # frontend React (Vite)
    ├── components/
    │   ├── Battlefield.tsx
    │   ├── Hand.tsx
    │   ├── Stack.tsx
    │   └── Card.tsx
    └── hooks/
        └── useGameState.ts        # wrapper su useQuery Convex
```

Il frontend non importa mai niente da `convex/gre/` — comunica solo tramite le mutations pubbliche in `convex/game.ts`.

---

## Sistema di definizione delle carte

### Tre livelli di complessità

Le carte si dividono per tipo di comportamento da codificare:

**Livello 1 — Dati puri** (nessun comportamento aggiuntivo)
Creature vanilla e terrain base. Completamente descritte da statistiche.

**Livello 2 — Comportamento dichiarativo**
Triggered abilities, activated abilities, static abilities semplici. Seguono il template strutturato.

**Livello 3 — Comportamento imperativo** _(fuori scope iniziale)_
Replacement effects, layer system (Humility, Anthem). Richiedono codice custom che non si presta a template generico.

---

### Tipi base condivisi (`convex/gre/cards/types.ts`)

```typescript
type CardId = string;
type PlayerId = "player1" | "player2";

type ManaCost = {
  generic?: number;
  white?: number;
  blue?: number;
  black?: number;
  red?: number;
  green?: number;
  colorless?: number;
};

type EventType =
  | "SPELL_RESOLVED"
  | "PERMANENT_ENTERED"
  | "CREATURE_ENTERED"
  | "CREATURE_DIED"
  | "PLAYER_ATTACKED"
  | "LAND_PLAYED"
  | "DRAW_STEP_STARTED"
  | "UPKEEP_STARTED"
  | "END_STEP_STARTED";

type StaticAbility =
  | "FLYING"
  | "TRAMPLE"
  | "FIRST_STRIKE"
  | "DOUBLE_STRIKE"
  | "VIGILANCE"
  | "HASTE"
  | "REACH"
  | "DEATHTOUCH"
  | "LIFELINK"
  | "INDESTRUCTIBLE"
  | "HEXPROOF"
  | "FLASH";

type Effect =
  | { type: "ADD_MANA"; mana: ManaCost }
  | { type: "DRAW_CARD"; amount: number }
  | {
      type: "DEAL_DAMAGE";
      amount: number;
      target: "player" | "any_creature" | "target";
    }
  | {
      type: "DESTROY_PERMANENT";
      target: "target_creature" | "target_artifact" | "any";
    }
  | { type: "GAIN_LIFE"; amount: number }
  | { type: "TAP_PERMANENT"; target: "target" | "all_creatures_opponent" };

type ChoiceRequest =
  | { type: "SELECT_TARGET"; filter: "creature" | "player" | "any_permanent" }
  | { type: "SELECT_MODE"; options: string[] };
```

---

### Template CardDefinition (`convex/gre/cards/types.ts`)

```typescript
interface CardDefinition {
  id: CardId;
  name: string;
  cost: ManaCost;

  // Tipo principale
  type:
    | "CREATURE"
    | "INSTANT"
    | "SORCERY"
    | "ENCHANTMENT"
    | "ARTIFACT"
    | "LAND";
  subtypes?: string[]; // es. ["Elf", "Druid"] o ["Forest"]

  // Solo per creature
  power?: number;
  toughness?: number;

  // Solo per land
  produces?: ManaCost; // mana che produce quando tappata

  // Keyword abilities statiche — il GRE le gestisce automaticamente
  staticAbilities?: StaticAbility[];

  // Activated abilities — il giocatore le attiva manualmente
  activatedAbilities?: ActivatedAbility[];

  // Triggered abilities — si attivano automaticamente su eventi
  triggeredAbilities?: TriggeredAbility[];

  // Modificatori alle SBA globali — solo per eccezioni (indestructible ecc.)
  // Nella maggior parte dei casi questo campo è vuoto o assente
  sbaMods?: SBAModifier[];
}

interface ActivatedAbility {
  id: string;
  cost: {
    tap?: boolean;
    mana?: ManaCost;
    sacrifice?: boolean; // sacrifica questa carta
    discardCard?: boolean;
  };
  effect: Effect;
  requiresTarget?: ChoiceRequest;
  // Le mana abilities non usano lo stack — risolvono immediatamente
  useStack: boolean;
}

interface TriggeredAbility {
  // Gli eventi che questa ability ascolta
  listenTo: EventType[];
  // Condizione opzionale — se omessa, si attiva sempre
  condition?: (event: GameEvent, state: GameState, self: Permanent) => boolean;
  // Effetto quando risolve
  effect: Effect;
  requiresTarget?: ChoiceRequest;
  // Quasi sempre true — solo le mana abilities hanno useStack: false
  useStack: boolean;
}

interface SBAModifier {
  // "non muore per danno letale" (indestructible)
  // "non muore per toughness 0" (si usa per Persist, Undying ecc.)
  type: "IGNORE_LETHAL_DAMAGE" | "IGNORE_ZERO_TOUGHNESS" | "CUSTOM";
  condition?: (state: GameState, self: Permanent) => boolean;
}
```

---

### Esempi concreti (`convex/gre/cards/sets/alpha.ts`)

```typescript
// Livello 1 — vanilla, nessun comportamento
export const grizzlyBears: CardDefinition = {
  id: "grizzly_bears",
  name: "Grizzly Bears",
  cost: { generic: 1, green: 1 },
  type: "CREATURE",
  subtypes: ["Bear"],
  power: 2,
  toughness: 2,
};

// Livello 1 — land base
export const forest: CardDefinition = {
  id: "forest",
  name: "Forest",
  cost: {},
  type: "LAND",
  subtypes: ["Forest"],
  produces: { green: 1 }, // il GRE gestisce il tap automaticamente
};

// Livello 2 — activated ability (mana ability)
export const llanowarElves: CardDefinition = {
  id: "llanowar_elves",
  name: "Llanowar Elves",
  cost: { green: 1 },
  type: "CREATURE",
  subtypes: ["Elf", "Druid"],
  power: 1,
  toughness: 1,
  activatedAbilities: [
    {
      id: "tap_for_green",
      cost: { tap: true },
      effect: { type: "ADD_MANA", mana: { green: 1 } },
      useStack: false, // mana ability — risolve immediatamente
    },
  ],
};

// Livello 2 — triggered ability su evento
export const elvishVisionary: CardDefinition = {
  id: "elvish_visionary",
  name: "Elvish Visionary",
  cost: { generic: 1, green: 1 },
  type: "CREATURE",
  subtypes: ["Elf", "Shaman"],
  power: 1,
  toughness: 1,
  triggeredAbilities: [
    {
      listenTo: ["PERMANENT_ENTERED"],
      // Si attiva solo quando entra lei stessa
      condition: (event, _state, self) => event.permanentId === self.id,
      effect: { type: "DRAW_CARD", amount: 1 },
      useStack: true,
    },
  ],
};

// Livello 2 — static ability keyword
export const airElemental: CardDefinition = {
  id: "air_elemental",
  name: "Air Elemental",
  cost: { generic: 3, blue: 2 },
  type: "CREATURE",
  subtypes: ["Elemental"],
  power: 4,
  toughness: 4,
  staticAbilities: ["FLYING"],
};

// Livello 2 — instant con effetto e target
export const lightningBolt: CardDefinition = {
  id: "lightning_bolt",
  name: "Lightning Bolt",
  cost: { red: 1 },
  type: "INSTANT",
  // Nessun power/toughness, nessuna ability
  // L'effetto è direttamente sulla carta
  effect: {
    type: "DEAL_DAMAGE",
    amount: 3,
    target: "target",
  },
  requiresTarget: { type: "SELECT_TARGET", filter: "any_permanent" },
};
```

---

### Registry delle carte (`convex/gre/cards/index.ts`)

```typescript
import {
  grizzlyBears,
  forest,
  llanowarElves,
  elvishVisionary,
  airElemental,
  lightningBolt,
} from "./sets/alpha";

const cardRegistry: Record<CardId, CardDefinition> = {
  grizzly_bears: grizzlyBears,
  forest: forest,
  llanowar_elves: llanowarElves,
  elvish_visionary: elvishVisionary,
  air_elemental: airElemental,
  lightning_bolt: lightningBolt,
};

export function getCard(id: CardId): CardDefinition {
  const card = cardRegistry[id];
  if (!card) throw new Error(`Card not found: ${id}`);
  return card;
}
```

---

### SBA: perché non appartengono alle carte

Le State Based Actions sono **regole globali del gioco** che il GRE applica automaticamente dopo ogni azione, senza che le carte debbano dichiarare nulla. Il checker scansiona tutto il battlefield:

```typescript
// convex/gre/sba.ts
export function checkSBAs(state: GameState): GameEvent[] {
  const events: GameEvent[] = [];

  for (const permanent of allCreatures(state)) {
    const hasIndestructible = permanent.sbaMods?.some(
      (m) => m.type === "IGNORE_LETHAL_DAMAGE",
    );
    if (!hasIndestructible) {
      if (permanent.toughness <= 0 || permanent.damage >= permanent.toughness) {
        events.push({ type: "CREATURE_DIED", permanentId: permanent.id });
      }
    }
  }

  for (const player of ["player1", "player2"] as PlayerId[]) {
    if (state.life[player] <= 0) {
      events.push({ type: "PLAYER_LOSES", player });
    }
  }

  return events;
}
```

Le carte dichiarano `sbaMods` **solo per eccezioni** (indestructible, persist, undying). La regola base non richiede nessuna dichiarazione esplicita.

---

## Cosa NON è in scope iniziale

Per mantenere il progetto gestibile, questi sistemi vengono esclusi dalla prima implementazione:

- **Layer system** per effetti statici (Anthem, Humility) — il più complesso
- **Replacement effects** (es. "instead" effects)
- **Triggered abilities con scelte complesse**
- **Trigger simultanei APNAP ordering**
- **Tutte le carte esistenti** — si parte con un set limitato e controllato

L'obiettivo è un engine corretto per un sottoinsieme di carte, non un engine completo.

---

## Primo milestone suggerito

Implementare una partita funzionante con queste sole meccaniche:

1. Terrain base (tap per mana)
2. Creature vanilla (senza abilità)
3. Creature con una triggered ability semplice (es. Llanowar Elves)
4. Combat completo (declare attackers/blockers, damage)
5. Spell instant/sorcery con effetto diretto (danno, distruggi)

Questo copre il ciclo completo: cast → stack → priority → risoluzione → trigger → stato aggiornato.

---

## Riferimenti

- [Convex docs](https://docs.convex.dev)
- [Magic Comprehensive Rules](https://magic.wizards.com/en/rules)
- Progetti open source di riferimento per architettura GRE: **XMage** (Java), **Forge** (Java)
