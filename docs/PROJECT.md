# Tolaria — Project Brief

Documento di orientamento architetturale. Descrive **com'è fatto il progetto
oggi** e **perché**: le scelte strutturali, i flussi di business logic, i confini
da non superare, e le convenzioni che tengono insieme il codice mentre cresce.

**Stato al 2026-07-29.** ~1.800 carte implementate su 149 set, ~613k righe di
TypeScript (esclusa la codegen), 836 file di test, 81 ADR, ~1.500 commit da
marzo 2026.

---

## 0. Come leggere la documentazione

Quattro documenti, quattro scopi distinti. Non si sovrappongono.

| Documento               | Scopo                                                                                         |
| ----------------------- | --------------------------------------------------------------------------------------------- |
| `docs/PROJECT.md`       | **questo** — architettura, flussi, confini. Il "come è fatto e perché".                       |
| `CONTEXT.md`            | glossario di dominio (ubiquitous language). Il significato esatto di ogni termine nel codice. |
| `docs/adr/README.md`    | indice degli 81 ADR. Ogni decisione non ovvia ha il suo record, con contesto e alternative.   |
| `CLAUDE.md`/`AGENTS.md` | regole operative: comandi, cadenza dei gate, convenzioni di authoring.                        |

**Gli ADR sono la memoria del progetto.** Questo brief riassume; l'ADR spiega.
Quando una scelta qui sembra arbitraria, l'indice ADR ha quasi sempre il record
che la giustifica — è indicizzato per parola chiave (`combat`, `mana`, `bot`,
`layer`, `limited`).

---

## 1. Cos'è Tolaria oggi

Un motore di gioco per Magic: The Gathering, giocabile via web, con focus su
**correttezza delle regole** e **reattività real-time** fra due client.

Non è un prodotto commerciale.

Il progetto è cresciuto ben oltre il "gameplay a due giocatori" iniziale. Oggi
comprende quattro domini:

1. **Gameplay** — il GRE (Game Rules Engine), il cuore. Server-side, autoritativo.
2. **Costruzione mazzi** — deck builder, Format tipizzati, banlist, cubi.
3. **Limited** — eventi Sealed e Draft completi: booster, draft sincrono con bot,
   deckbuilding dal pool, turni di Swiss, standings.
4. **Avversario artificiale** — un bot ISMCTS che gioca partite reali, e un bot
   separato che drafta.

Ognuno ha il suo confine e le sue regole; il § 8 li tratta uno per uno.

---

## 2. Stack & toolchain

| Layer       | Tecnologia                         | Note                                                        |
| ----------- | ---------------------------------- | ----------------------------------------------------------- |
| Frontend    | React 19 + TypeScript + Vite 8     | React Compiler attivo via `babel-plugin-react-compiler`     |
| Routing     | TanStack Router                    | route file-based in `src/routes/`                           |
| Styling     | Tailwind 4 + design system interno | token semantici, non cromatici (ADR 0007 / 0069)            |
| Backend/DB  | Convex                             | stato reattivo, mutation atomiche e transazionali           |
| Auth        | `@convex-dev/auth` (Password)      | email + password + nickname. **Non Clerk** (scelta rivista) |
| Package mgr | bun                                | mai `npx`: sempre `bunx`                                    |
| Test        | vitest 4                           | due suite separate (§ 9)                                    |

### Comandi essenziali

```bash
bun run dev            # dev server
bun run worktree:init  # PRIMO comando in un worktree nuovo (deps + codegen + hook)
bun run check:pr       # gate leggero: format + lint + tsc + guard offline
bun run check:all      # gli stessi check, tier pesante (mutex machine-wide)
bun run test           # suite completa (app + bot, in sequenza)
bunx vitest run <path> # test mirati — questo è ciò che si usa mentre si lavora
```

### Perché Convex

- Lo stato del tavolo è reattivo per definizione: quando un giocatore agisce,
  l'altro vede il cambiamento senza polling né WebSocket da gestire.
- Le mutation sono atomiche: ogni transizione di stato è consistente o non
  avviene.
- Un gioco turn-based è fatto di azioni discrete, che è esattamente il modello.

**Limitazioni accettate**: vendor lock-in totale, nessuna query SQL raw (si
lavora con indici espliciti), timeout mutation di 1-2 secondi.

Il timeout non è un vincolo reale — l'engine si ferma sempre ad aspettare input
umano — ma **il costo di lettura sì**. Convex fattura la lettura per byte del
documento intero, e ogni scrittura ri-esegue tutte le query sottoscritte. Questo
ha già prodotto due interventi architetturali visibili nello schema: la tabella
`gameTicks` (§ 4) e lo split `limitedEvents`/`limitedSeats` (§ 8.3). È il vincolo
non ovvio da tenere presente quando si aggiunge una tabella o una subscription.

---

## 3. Architettura del sistema

```
Client React (P1) ──┐
                    ├── Convex (mutation + query) ── GRE (Game Rules Engine)
Client React (P2) ──┘
```

Il GRE gira **server-side**, dentro le mutation Convex. È:

- **autoritativo** — ogni mossa è validata server-side prima di essere applicata;
- **puro** — funzioni senza side effect, senza `async`, senza `ctx`;
- **deterministico** — dato lo stesso stato e lo stesso seed, produce lo stesso
  risultato.

### 3.1 Il confine è l'autorità, non l'import (ADR 0074)

Questo è cambiato rispetto al design iniziale ed è la fonte più comune di
malintesi.

Il frontend **può** importare i moduli puri di `convex/gre/` e `convex/limited/`,
e lo fa di continuo:

- il **Brain** del bot vs-AI gira client-side (`searchWithTrace`, `evaluate`,
  `layers`, `resolveTopOfStack` su un clone locale dello stato);
- il **Draft Lab** esegue draft interi in-browser sopra
  `botDrafter.ts`/`draftEngine.ts`;
- i validatori di Format (`convex/formats.ts`) sono condivisi fra la validazione
  live nel deck builder e il gate autoritativo a inizio partita.

Condividere il modulo è **esattamente ciò che impedisce a client e server di
divergere**.

Quello che il frontend non ha mai è l'**autorità**: nessuna esecuzione lato
client produce stato persistito o creduto. Ogni mossa reale passa da una mutation
pubblica in `convex/game.ts`, il server rivalida, e il client resta una view più
un simulatore locale.

> `AGENTS.md` contiene ancora la formulazione vecchia ("il frontend non importa
> mai da `convex/gre/`"). Superata da ADR 0074. Vale questa.

### 3.2 Il ciclo di una mossa

```
1. Il client invia un'azione → mutation Convex
2. assertExpectedInput  — è il momento giusto, dal giocatore giusto,
                          per questo tipo di input? (ADR 0047)
3. Validazione specifica dell'azione (è legale?)
4. Il GRE applica l'effetto in memoria
5. Il GRE emette eventi interni (SPELL_RESOLVED, PERMANENT_ENTERED, …)
6. Scan dei trigger sulle sorgenti in campo
7. Trigger trovati → vanno sullo stack (NON risolvono da soli)
8. State-Based Actions (automatiche, senza priority)
9. Stato stabile → saveGameState: una scrittura atomica su gameStates + gameTicks
10. Entrambi i client reagiscono (reattività Convex)
```

**Lo stato si salva solo in punti stabili**, cioè quando il gioco aspetta input
umano: spell entrata sullo stack, priority passata di mano, trigger accodato,
stack svuotato.

`saveGameState` (`convex/game.ts`) è **l'unico scrittore** della riga
`gameStates`. Essendo il collo di bottiglia obbligato, ci sono appese due
invarianti che devono valere per ogni stato persistito:

- `refreshCounterGatedStatics` — le static condizionali sono ri-materializzate,
  così una posizione salvata non porta mai un keyword stantìo;
- `refreshExpectedInput` — il campo `expectedInput` è coerente con i campi
  `pending*`/priority appena assestati.

Questo è un pattern ricorrente nel progetto: **appendere l'invariante al punto di
strozzatura**, non a ogni chiamante che deve ricordarsene.

---

## 4. Modello dati (Convex)

15 tabelle in `convex/schema.ts`. Lo schema è pesantemente commentato: quando un
campo esiste per una ragione non ovvia, la ragione è scritta lì accanto. Vale la
pena leggerlo per intero una volta.

### Gameplay

| Tabella      | Contenuto                                                                      |
| ------------ | ------------------------------------------------------------------------------ |
| `games`      | una partita: giocatori, mazzi, stato del ciclo di vita, vincitore              |
| `gameStates` | **una riga per partita**: lo snapshot completo (`state: v.any()`) + `seq`      |
| `gameTicks`  | riga di segnalazione (~150 byte) scritta insieme a ogni `gameStates`           |
| `matches`    | un Match Bo1/Bo3: punteggio, copia mutabile dei mazzi, sideboarding, play/draw |

**Non esiste un event log.** Il design iniziale prevedeva una tabella
`game_events` append-only come source of truth per il replay: non è mai stata
implementata. La source of truth è lo snapshot; il replay via log non esiste.

Il determinismo però è preservato: `GameState` porta `rngSeed` e `rngCounter`
(contatore monotono avanzato da ogni consumo di casualità — shuffle, scarto
random, lanci di moneta). Se un giorno si vuole il replay, l'infrastruttura di
riproducibilità c'è già; manca il log.

**`gameTicks` è un'ottimizzazione di costo, non una feature.** Un sottoscrittore
che deve solo sapere "è cambiato qualcosa, e tocca a me?" non deve tenere una
subscription sullo stato completo (3-9 KB). Il tick porta i soli campi che
servono a quella decisione: `seq`, `priorityPlayerId`, `phase`,
`expectedInputKind`, `owedPlayerIds`, `gameOver`. Il driver del bot vs-AI monta
la query pesante solo quando `owedPlayerIds` nomina il proprio seat.

`owedPlayerIds` è un **array**, non un singolo id, e va sempre testato con
`.includes()`. L'assegnazione del danno da combattimento (CR 510.1c, banding
702.22j-k) si presenta come una normale finestra di priority ma l'attore reale
sta in `combat.damageAssignerIds` e può differire da `priorityPlayerId` — con
banding entrambi i giocatori possono dovere una conferma. Confrontare per
uguaglianza con un solo id fa deadlockare la partita.

### Mazzi e Format

| Tabella          | Contenuto                                                          |
| ---------------- | ------------------------------------------------------------------ |
| `userDecks`      | mazzi salvati dagli utenti (maindeck + sideboard + featured card)  |
| `presetDecks`    | i mazzi built-in, editabili da un Admin (ADR 0033). Chiave: `slug` |
| `formatBanlists` | banlist ufficiali **per nome**, non per cardId (ADR 0057)          |
| `cubeLists`      | liste cubo curate, per nome. Filtro di discovery, mai di legalità  |
| `decks`          | legacy preset. Sostituita da `presetDecks`                         |

Il pattern **"per nome, risolto a read time"** ricorre: banlist e cubi
memorizzano nomi oracle, non id. Il nome si risolve alla `CardDefinition` viva
tramite `nameRegistry` quando serve. Conseguenza: una carta implementata domani
è bannata/inclusa nel cubo **istantaneamente**, senza toccare il dato.

### Limited

| Tabella         | Contenuto                                                                   |
| --------------- | --------------------------------------------------------------------------- |
| `limitedEvents` | un evento: tipo, stato, seat (identità), round di Swiss, config booster     |
| `limitedSeats`  | il **payload pesante** di un seat: pool, pack corrente, coda pack           |
| `cardRatings`   | Pick Rating per `(scope, cardId)`, override Admin sui file seed (ADR 0066)  |
| `cardProfiles`  | profili di sinergia per `(scope, cardId)`: archetipi, capability (ADR 0072) |

Lo split `limitedEvents`/`limitedSeats` merita attenzione perché è **l'esempio
canonico del vincolo di costo Convex**. I payload dei seat erano il 99% del
documento evento (fino a 48 KB). `myLimitedEvents` scansiona ogni evento in cui
il viewer siede e legge solo l'identità dei seat — ma pagava ~315 KB per
esecuzione, e si ri-eseguiva a **ogni pick di draft**. Separare il payload rende
quasi gratis l'elenco eventi, e un pick riscrive solo i seat che tocca.

ADR 0076 fa la scelta **opposta** per i round di Swiss: restano embedded nel
documento evento. Al massimo 12 pairing minuscoli — la simmetria con i `seats`
già embedded batte l'isolamento che una tabella figlia comprerebbe. Le due
decisioni non sono in contraddizione: **la dimensione del payload decide**, non
un principio astratto.

### Altro

- `users` — profilo + flag `isAdmin`
- `debugScenarios` — board preset salvati sul DB (ADR 0044). `spec: v.any()` di
  proposito: il path di lettura è tollerante, quello di scrittura è validato
  stretto (`convex/debugScenarioSpec.ts`)

### Retention

Un cron (`convex/crons.ts`) elimina Match finiti da più di 24 ore, con cascata su
Game e `gameStates`, e sweepa gli eventi Limited abbandonati.

---

## 5. Il GRE

`convex/gre/` — una settantina di moduli. Sotto, quelli che bisogna conoscere per
orientarsi.

### 5.1 GameState

`convex/gre/state.ts` (~17k righe: è il modulo più grande del progetto, e contiene
sia il tipo che gran parte delle primitive).

I campi obbligatori sono pochi:

```ts
type GameState = {
    players: PlayerState[];
    stack: StackItem[];
    turn: number;
    activePlayerId: string;
    priorityPlayerId: string;
    passCount: number; // 2 passaggi consecutivi ⇒ risolve il top dello stack
    phase: Phase;
    rngSeed: number;
    rngCounter: number;
    // …più ~100 campi opzionali
};
```

Il resto è **opzionale e assente per default**. Una partita normale non porta
`highTideThisTurn` né `gazeOfPainActiveThisTurn`: quei campi esistono solo quando
la carta corrispondente è in gioco. È il compromesso scelto per il costo di
lettura Convex — lo stato serializzato resta piccolo — al prezzo di una superficie
di tipo ampia.

**Ogni nuovo campo opzionale di `GameState` va aggiunto a
`PERSISTED_OPTIONAL_KEYS` in `convex/gre/serialize.ts`** (o a `TRANSIENT_KEYS` se
è volutamente effimero). Un guard test fallisce se una chiave non sta in nessuno
dei due insiemi. Senza, il campo si perde silenziosamente al round-trip sul DB —
un bug che non si manifesta nei test unitari e appare in partita.

### 5.2 Expected Input (ADR 0047)

La macchina di attesa dell'engine è distribuita su campi indipendenti:
`pendingCast`, `pendingActivation`, `pendingTarget`, `pendingChoices`, la
dichiarazione dei bloccanti, la priority. `convex/gre/expectedInput.ts` la
collassa in **una risposta autoritativa**: cosa aspetta il gioco, e da chi.

La precedenza rispecchia l'annidamento del CR:

1. partita finita (CR 104) → non si aspetta nulla;
2. una `PendingChoice` a metà risoluzione (CR 608.2 / 101.4) sospende tutto;
3. selezione bersagli in corso (CR 601.2c);
4. dichiarazione bloccanti (CR 509.1);
5. altrimenti priority (CR 117) — che copre anche un pagamento in corso.

Il campo è **mantenuto**, non derivato a read time: `refreshExpectedInput` lo
ricalcola in `saveGameState`, e `assertExpectedInputCoherent` lo ri-deriva per
verificarne la coerenza.

`assertExpectedInput` è **il gate unico** che ogni mutation di gioco attraversa
prima della validazione specifica. "È il momento giusto, dal giocatore giusto,
per questo tipo di input?" vive in un solo posto invece di essere ri-derivato in
quindici mutation.

### 5.3 Stack e priority

Lo stack risolve **un elemento alla volta**, dall'alto verso il basso. Dopo ogni
risoluzione la priority riparte dal giocatore attivo. Servono due passaggi
consecutivi (`passCount === 2`) per procedere.

`StackItem` porta spell, abilità attivate, abilità innescate e le loro copie.
Le mana ability hanno `useStack: false` e risolvono immediatamente (CR 605.3a).

Timer di priority: 30 secondi via `ctx.scheduler.runAfter`, con **cancellazione
basata su seq** — quando il timer scatta confronta il `seq` catturato alla
schedulazione con quello vivo; se differiscono l'azione è già avvenuta e il
timeout è un no-op. Convex non ha una cancellazione economica dei job
schedulati, quindi questo pattern ricorre ovunque serva un timer (lo riusa
identico l'Auto-Pick del draft, con `pickSeq`).

### 5.4 Fasi

14 fasi, in `convex/gre/phases.ts`:

```
MULLIGAN
UNTAP (automatica) → UPKEEP → DRAW
PRECOMBAT_MAIN
BEGINNING_OF_COMBAT → DECLARE_ATTACKERS → DECLARE_BLOCKERS
  → FIRST_STRIKE_DAMAGE → COMBAT_DAMAGE → END_OF_COMBAT
POSTCOMBAT_MAIN
END_STEP → CLEANUP (automatica)
```

Tolaria appiattisce la distinzione CR fra fasi e step: sono tutte "phase".

Lo skip delle fasi senza azioni possibili è **drenato server-side** (ADR 0077):
il server avanza in un colpo solo invece di far fare un round-trip al client per
ogni fase vuota — di nuovo, una scelta guidata dal costo di scrittura.

### 5.5 Trigger (CR 603)

`convex/gre/triggers.ts`. L'engine applica un'azione, emette uno o più
`GameEvent`, poi chiama `collectTriggers`, che restituisce uno `StackItem` per
ogni match (permanente, abilità, evento). Il chiamante li accoda e riparte con la
priority.

Quattro famiglie, tutte implementate:

- **normali** — dichiarate su una `CardDefinition` come `triggeredAbilities[]`;
- **ritardate** (CR 603.7) — create durante una risoluzione ("all'inizio del
  prossimo end step, distruggilo"). In un Effect Script si scrivono inline: l'Op
  di schedulazione porta il corpo ritardato e le sue capture (ADR 0048), così la
  carta si legge come il suo oracle text;
- **riflessive** (CR 603.3c) — "Sacrifica una creatura. Quando lo fai, …". Vanno
  sullo stack nello stesso batch APNAP dei dies-trigger del sacrificio che le ha
  prodotte, che è esattamente ciò che chiede il CR;
- **cast trigger** (Storm, ADR 0052) — scattano dallo stack al momento
  dell'annuncio, non dal campo di battaglia. Raccolti da un pass dedicato e messi
  **sopra** la spell, così risolvono prima.

**Ordinamento APNAP** (CR 603.3b): trigger simultanei dello stesso controllore
vengono ordinati dal controllore stesso. Il batch resta off-stack in
`pendingTriggerBatch` mentre le `PendingChoice` di tipo `trigger-order` sono
attive, poi atterra sullo stack tutto insieme.

**Una riga di oracle text = una `TriggeredAbility`.** Quando una singola frase
scatta su più eventi engine ("messa in un cimitero da qualsiasi zona" =
`CREATURE_DIED` + `CARD_DISCARDED` + `CARD_MILLED`) si dichiara **una** abilità
con `event: GameEventType[]` (array), non N abilità quasi identiche. Duplicare
renderizza la stessa riga N volte sullo stack — un bug UI. Un guard test
catalogue-wide (`triggerDedup.test.ts`) fallisce la CI su qualunque carta con due
trigger stesso-`oracleText` che differiscono solo per `event`. Limite noto: una
abilità con `event` array non può leggere `$event` in un Effect Script; se
l'effetto deve ispezionare l'evento scatenante, resta `event` scalare.

### 5.6 State-Based Actions

`convex/gre/sba.ts`. Sono **regole globali del gioco** applicate automaticamente
dopo ogni azione: creatura con toughness ≤ 0 muore, giocatore a vita ≤ 0 perde,
planeswalker a 0 loyalty va al cimitero (CR 704.5i), aura senza host legale va al
cimitero, ecc.

Le carte non dichiarano nulla per il caso base. Dichiarano `sbaMods` **solo per
le eccezioni** (indestructible, persist, undying).

### 5.7 Layer system (CR 611 / 613)

`convex/gre/layers.ts`. Gli effetti continui statici sono **calcolati a read
time**, mai scritti sullo stato della carta. `getEffectivePower(state, card)` è la
funzione che conta; leggere `card.card.power` è quasi sempre un bug.

Layer implementati: controllo (2), text-changing (3, ADR 0011), tipo/sottotipo
(4), colore (5), concessione/rimozione/perdita di abilità (6), P/T nella pipeline
ordinata 7a-7e (ADR 0017).

Un effetto statico si dichiara come dato, con un predicato `applies`:

```ts
staticEffects: [
    {
        kind: "pt-buff",
        power: 1,
        toughness: 1,
        applies: (target, source, ctx) =>
            ctx.isCreature(target) &&
            ctx.hasSubtype(target, "Goblin") &&
            target.controllerId === source.controllerId,
    },
];
```

L'engine non mantiene un enum di scope o filtri: ogni carta porta la propria
regola di eleggibilità. Anthem (Crusade) e stripping di abilità (Humility) sono
entrambi esprimibili così.

**Durata indefinita (CR 611.2b).** Su `setBasePT`, `setSubtype` e `grantAbility`
il campo `duration` è **opzionale**: omesso, l'effetto continuo generato da
un'abilità che risolve dura indefinitamente — finché il permanente resta sul
battlefield. È la forma che serve al respec a stadi ("becomes a Kithkin Spirit",
Figure of Destiny/Fable), insieme al predicato live `objectMatchesFilter` che
legge le caratteristiche materializzate a layer di un oggetto in campo. I marker
indefiniti vengono azzerati da `resetBattlefieldTransientState` (CR 400.7), così
un Figure rimbalzato torna 1/1 Kithkin.

### 5.8 Replacement effects

`convex/gre/replacements.ts` — danno, distruzione (ADR 0020), pescata (seam
unificato e riprendibile, ADR 0061), sostituzioni di ingresso in campo.

### 5.9 Pending Choice: sospensione e ripresa

È il meccanismo che rende esprimibili le carte interattive, e vale la pena
capirlo prima di scrivere carte non banali.

Un effetto che ha bisogno di una decisione a metà risoluzione chiama
`SpellContext.requestChoice`. L'engine accoda una `PendingChoice`, **sospende la
risoluzione lasciando l'elemento sullo stack**, e persiste. La UI generica
renderizza il prompt; la mutation generica `submitResolutionChoice` registra le
scelte; l'engine riprende **dall'Op sospeso**, non dall'inizio (CR 608.3 — gli Op
precedenti, potenzialmente irreversibili, non vengono rieseguiti).

Il checkpoint è una **posizione lineare pre-order sull'intero albero di Op**
annidati, non un indice top-level: un `if` può contenere un Op sospensivo dopo
uno con side effect, quindi alla ripresa l'albero è ri-percorso saltando ogni Op
la cui posizione precede il checkpoint.

I binding sopravvivono alla sospensione perché sono memorizzati in
`collectedChoices`, lo store di risposte già persistito e già wire-safe
dell'elemento sullo stack. Nessun nuovo campo di `GameState` è stato introdotto
per il DSL — il guard di serializzazione non ha avuto niente da coprire.

Sopra questa stessa infrastruttura girano: `choice` Op, ordinamento trigger,
legend rule (ADR 0030), divisione in pile (ADR 0053), scelta di sacrificio, pay
choice all'ingresso di una terra (ADR 0051), mulligan, damage assignment.

### 5.10 Determinismo

`convex/gre/rng.ts`. Ogni consumo di casualità passa da uno stream seeded
(`makeRng(seed)`) e avanza `rngCounter`. Non c'è `Math.random()` nell'engine —
né nei workflow, né negli script.

---

## 6. Sistema di definizione delle carte

Le carte sono **dati**, non codice imperativo. Questa è la scelta strutturale
centrale del progetto: la scalabilità dipende dal fatto che aggiungere una carta
non significhi aggiungere logica.

### 6.1 `CardDefinition`

`convex/cards/types.ts`. Un tipo ampio (~90 campi opzionali) che copre:

- **identità**: `id`, `name`, `rarity`, `manaCost`, `types`, `subtypes`,
  `supertypes`, `power`/`toughness`/`loyalty`, `oracleText`;
- **effetti**: `effects[]` (Effect Script — il default), `resolve()` /
  `resolveSteps[]` / `effect` (mutuamente esclusivi con `effects`), `modes[]`;
- **abilità**: `staticAbilities[]` (keyword come stringhe), `staticEffects[]`
  (continui, layer system), `activatedAbilities[]`, `triggeredAbilities[]`,
  `replacementEffects[]`, `chapterAbilities[]` (Saga, ADR 0078);
- **costi alternativi e addizionali**: `flashback`, `escape`, `madness`,
  `buyback`, `kicker`, `evoke`, `dash`, `alternativeCosts[]`;
- **ingresso in campo**: `entersTapped`, `entersTappedUnlessPay`, `entersWith`;
- **hint per il bot**: `aiValue`, `aiCombatHint`, `aiEffects`.

`id` è lo **Scryfall id della prima stampa cartacea** della carta (ADR 0041). Non
di una ristampa: una carta implementata contro una ristampa si archivia nel set
sbagliato e mostra l'art sbagliata. Un check offline (`check:index`) lo verifica
contro il lockfile `data/card-index.json`.

### 6.2 Effect Script — il DSL (ADR 0045 / 0046)

**Il default obbligatorio per ogni carta nuova.** ~1.270 usi contro ~440
`resolve()` residui.

L'effetto di una carta è una lista ordinata di **Op** (`dealDamage`, `draw`,
`destroy`, `moveZone`, `createToken`, `choice`, …) connessi da **quattro costrutti
strutturali congelati**:

| Costrutto | Significato                                   |
| --------- | --------------------------------------------- |
| `bind`    | cattura un valore/una selezione sotto un nome |
| `ref`     | rilegge un binding                            |
| `if`      | ramo condizionale su un predicato             |
| `forEach` | itera su un insieme                           |

"Congelati" significa che la grammatica strutturale non si estende: si aggiungono
Op, non costrutti. L'interprete è
`convex/gre/effects/interpreter.ts`; gira sopra le primitive `SpellContext` già
esistenti e restituisce una normale resolve closure attraverso lo stesso seam
`getResolveFn` che serve i corpi imperativi — l'engine di risoluzione non sa quale
modalità di authoring sia stata usata.

Esempio (Lightning Bolt):

```ts
export const lightningBolt: CardDefinition = {
    id: "…",
    name: "Lightning Bolt",
    manaCost: { red: 1 },
    types: ["Instant"],
    targetRequirement: { type: "any-target" },
    effects: [{ op: "dealDamage", amount: 3, target: { target: 0 } }],
};
```

**`resolve()` è l'escape hatch**, riservato alle carte "protocollari" (Word of
Command, Camouflage — stimate al 10-15% del pool) il cui effetto non è esprimibile
con il vocabolario di Op. Richiede una **giustificazione esplicita** in commento
sulla carta; "l'Op che mi serve non esiste" **non** è una giustificazione valida —
quello è il caso stop-and-issue del § 6.3.

Il DSL non è solo eleganza: essendo JSON puro, uno script è **ispezionabile**.
Da qui derivano tre cose che l'engine ottiene gratis e che una closure non
darebbe: la validazione statica catalogue-wide, i test smoke auto-generati
(§ 9), e la valutazione degli effetti da parte del bot (`opValuers.ts`,
`cardScriptValue.ts`) senza eseguirli.

### 6.3 Mechanics Registry (ADR 0046)

`convex/cards/mechanicsRegistry.ts` è **l'autorità unica sui nomi**: censimento
machine-readable di ogni keyword action (CR 701) e keyword ability (CR 702), più
`EFFECT_OP_REGISTRY` per i nomi di Op.

- una `staticAbilities[]` deve corrispondere (case-insensitive) al `name` di una
  riga, o al suo `bindingPattern` per i keyword parametrizzati ("protection from
  red", "rampage 2", landwalk);
- un `EffectOp.op` deve essere una riga di `EFFECT_OP_REGISTRY`.

Il censimento è **totale**, l'implementazione è **on demand**: una riga `planned`
non costa nulla e non impegna a nulla.

**Meccanica non censita ⇒ ci si ferma e si apre una issue.** Non si inventa un
nome, e non si aggira il buco con una `resolve()` a forma di carta. Un guard test
catalogue-wide fallisce comunque in CI; intercettarlo mentre si scrive costa meno.

Attenzione al caso subdolo che ha già colpito due volte: una carta che dichiara un
keyword `planned` **compila, sembra funzionante, ed è inerte**. Il "Guard A" in
`mechanicsRegistry.test.ts` esige che una carta non-stub dichiari solo keyword con
`status: "implemented"`, con un'allowlist stretta legata a issue aperte.

**Un Op nuovo va registrato in sette punti su cinque file** — la lista completa è
nella memoria di progetto e nei test; il tranello è che `opValuers` sta nella
suite bot (che il gate leggero non esegue) e `scenarioGenerator` ne contiene due.
Un Op registrato a metà passa il gate leggero e fallisce al merge.

### 6.4 Organizzazione del catalogo

```
convex/cards/
├── index.ts              # registry: id → CardDefinition. Seam di import unico
├── types.ts              # CardDefinition, ManaCost, SpellContext, EffectOp, …
├── mechanicsRegistry.ts  # autorità sui nomi
├── sets/<code>/          # un set = una DIRECTORY, split per colore (ADR 0043)
│   ├── white.ts  blue.ts  black.ts  red.ts  green.ts
│   ├── multicolor.ts  artifacts.ts  lands.ts
│   └── __tests__/<colour>.test.ts   # file di test PARALLELO per colore
└── generated/token-prints.json      # lockfile art dei token
```

Regole non negoziabili:

- **le carte si importano dal seam registry** (`getDefinition` / `tryGetDefinition`
  da `convex/cards`), mai dai moduli di set. Una regola ESLint
  `no-restricted-imports` lo impone; i test sono esenti;
- **lo split per colore** (ADR 0043) esiste per rendere parallelizzabile il lavoro
  su un set senza conflitti di merge;
- il file di test di un colore è **parallelo** al modulo: `sets/lea/red.ts` →
  `sets/lea/__tests__/red.test.ts`;
- le fixture condivise stanno in `convex/cards/__tests__/setup.ts`
  (`makeInstance`, `makePlayer`, `makeState`, `pushSpell`). Non si duplicano.

### 6.5 Art di token ed emblemi

Una carta che crea un token o un emblema **deve** avere l'art collegata. Manca
l'immagine → si renderizza un placeholder testuale (e in un caso ha fatto
crashare `<StackRow>`), silenziosamente lato server.

- **token**: si preferisce una spec condivisa da `convex/cards/sharedTokens.ts`.
  Un token nuovo prende l'art rigenerando il lockfile
  (`node scripts/fetch-token-prints.mjs`) o fissando `imagePrintId` a mano. Il
  guard `tokenPrintLookup.test.ts` fallisce su qualunque `createToken` DSL senza
  art risolvibile. **Punto cieco**: un token creato da una `resolve()`
  (`ctx.createToken(...)`) è invisibile al guard — lì l'`imagePrintId` va messo a
  mano;
- **emblemi**: `imagePrintId` sulla `EmblemDefinition` in `convex/cards/emblems.ts`;
  `emblemArt.test.ts` presidia;
- **regola di match**: il token associato alla stampa **della carta stessa** dove
  esiste, altrimenti un sostituto con le stesse caratteristiche. Un'art moderna su
  una carta old-border è un errore.

---

## 7. Proiezioni e frontend

### 7.1 Le proiezioni (`convex/gameProjections.ts`)

Il client **non vede mai** `GameState`. Vede l'output di riduttori che lo
assottigliano:

- `projectPublicState(state, playerIndex, viewerId)` — vista di un giocatore.
  Strippa `card.card` a `{ id }`, riduce `library` a `{ count }`, azzera la mano
  avversaria a `null[]`, rimuove `knownTo` grezzo sostituendolo con flag derivati;
- `getFullState` — vista completa, per debug e solo mode.

**Da qui nasce la classe di bug più ricorrente del progetto.** Un effetto che
legge un campo "grasso" passa i test unitari del GRE (che girano sullo stato
completo) ed è **rotto sul client**. Contromisura: il **wire format test** —
ri-eseguire la stessa assertion dopo `projectPublicState`. È **obbligatorio** per
ogni effetto visibile lato client.

### 7.2 I riduttori client

Oltre alla proiezione ci sono riduttori lato client, ognuno un punto in cui un
campo può sparire in silenzio:

| Riduttore                                   | Guida                                          | Sintomo se droppa                                  |
| ------------------------------------------- | ---------------------------------------------- | -------------------------------------------------- |
| `projectPublicState`                        | tutto ciò che la board renderizza              | valore sbagliato lato client                       |
| `buildTriggerStateView`                     | hint di affordabilità, predicati `canActivate` | abilità mai offerta benché il GRE la permetta      |
| `getStackAbilities`                         | comparsa di un'abilità nel menu                | sempre mostrata (server rifiuta) o sempre nascosta |
| `matchesTargetRequirement` / `TARGET_LABEL` | bersagli cliccabili + label del prompt         | niente cliccabile / stringa di fallback grezza     |

**Una carta corretta nel GRE è regolarmente morta nella UI.** Prima di
considerare finita una carta o una meccanica si percorrono i riduttori: il campo
che l'affordance legge sopravvive fino in fondo? Un test che costruisce la view a
mano **non conta** — maschera esattamente il campo droppato. Il test deve passare
per il riduttore vero.

### 7.3 Struttura del frontend

```
src/
├── components/
│   ├── board/          # ~120 componenti: battlefield, mano, stack, combat, controller
│   ├── deckbuilder/    # builder unificato a colonne (ADR 0075)
│   ├── limited/        # draft, sealed, event
│   ├── draft-lab/      # replay draft client-only (ADR 0074)
│   ├── admin/          # preset, banlist, cubi, rating, profili
│   └── ui/             # design system (Panel, PanelHeader/Body/Footer, …)
├── hooks/              # ~60 hook: useGameContext, useVsAiDriver, usePendingChoiceBuffer…
├── lib/                # logica pura: targeting, layout, combat graph, deck, ai/
└── routes/             # TanStack Router
```

Convenzioni:

- **un componente per file**, senza eccezioni;
- **estrarre, non inlineare**: calcolo di stato visivo, handler, dati derivati
  diventano funzioni o file dedicati appena crescono;
- **i tipi vengono da `convex/`**, che è la source of truth. `src/types/`
  ri-esporta. Nessun tipo di gioco definito localmente;
- costanti e helper da `convex/gre/constants.ts` — niente copie locali;
- **tutto il testo UI è in inglese**;
- token di design **semantici** (`surface`, `accent`, `danger`), mai cromatici
  (`amber-50`);
- i pannelli condividono un frame centralizzato con API a composizione;
- un bottone che lancia una mutation si **disabilita mentre è in volo**.

La route `/design-system` è il censimento permanente del design system (token con
rapporti WCAG live, chrome, varianti). È codice di produzione, va aggiornata
quando il sistema cambia.

---

## 8. I domini attorno al gameplay

### 8.1 Match (ADR 0029)

Un **Match** è un contenitore best-of-N sopra i **Game**. Possiede lo stato
cross-game: punteggio, la **copia mutabile** dei mazzi (il sideboarding la
modifica; `userDecks` resta read-only per la durata del Match), i flag di ready,
e la scelta play/draw per ogni Game dopo il primo.

Ciclo: `waiting` → `pregame` (coin toss + play/draw, CR 103.2-103.4) → `playing`
→ `sideboarding` (solo Bo3) → `finished`.

Anche una partita singola è un Match `bestOf: 1`. Non esiste il Game orfano.

### 8.2 Deck e Format

**Format** (ADR 0036) — `convex/formats.ts`. Cinque: `freeform`, `alpha-40`,
`old-school`, `premodern`, `limited`. Il modulo è **puro** e importato sia dal
server (gate autoritativo a inizio partita) sia dal frontend (pannello di
validazione live). La legalità è **derivata, mai memorizzata**.

Il Format di un mazzo è scelto alla creazione ed è **immutabile**.

**Banlist** (ADR 0057) — memorizzate per nome oracle, incluse carte non ancora
implementate. L'enforcement risolve nome → `CardDefinition.id` a read time, così
una carta costruita dopo un sync è bannata subito.

**Cubi** — liste curate per nome. Filtro di **discovery** nel builder, mai gate di
legalità.

**Deck builder** (ADR 0075, PRD #1617) — shell unificata a colonne, drag & drop
(ADR 0035), raggruppamento/ordinamento/filtro per zona, statistiche del maindeck.

### 8.3 Limited (ADR 0054 / 0055 / 0060 / 0062 / 0076)

Il sottosistema più recente, e il più completo dopo il GRE.

**Ciclo di vita di un evento**: `open` (i seat si riempiono) → `started` (pool
generati o draft in corso; i seat costruiscono i mazzi) → `playing` (round di
Swiss) → `finished`.

> Non si confrontano mai questi literal fuori da
> `convex/limited/eventStatus.ts`. Quel modulo ha una tabella esaustiva di cosa
> ogni fase permette; un `!== "started"` sparso si rompe nel momento in cui un
> evento raggiunge la fase di gioco.

**Sealed** — `startEvent` riempie i seat vuoti con bot, poi distribuisce i pool
tramite il generatore di booster seeded e puro
(`convex/limited/boosterGenerator.ts`), che legge le sheet MTGJSON reali
(ADR 0055 — un set è "Draftable" solo se le sue sheet sono complete; ADR 0059
ammette on-ramp parziali all'80% per sheet).

**Draft** — draft di booster classico, sincrono:
`convex/limited/draftEngine.ts`. Si prende una carta, si passa il resto; i pack
ruotano sinistra/destra/sinistra a ogni round; ogni seat ha una **coda di pack in
arrivo**, così un seat veloce non si serializza su uno lento. Timer per pick
opzionale, con la scaletta ufficiale discendente indicizzata sulle carte rimaste
(`pickTimerSchedule.ts`) e Auto-Pick cancellato via `pickSeq`.

Il **Vintage Cube** (ADR 0062) è una sorgente draft speciale: il pool è
**congelato** nel documento evento a `startEvent`. Ricostruirlo dal registry vivo
a ogni round significherebbe che implementare una carta a metà draft cambia la
lunghezza del pool, rimescola la permutazione e fa riapparire in un pack tardivo
una carta già pescata.

**Fase di gioco** (ADR 0076, PRD #1628) — round di Swiss embedded nel documento
evento. I pairing sono **persistiti, mai derivati** (Swiss sceglie a caso fra seat
a pari punteggio, quindi una ri-derivazione potrebbe non concordare con ciò che è
stato giocato). Le standings sono l'opposto: **sempre derivate** a read time, mai
memorizzate. I pairing bot-vs-bot sono valutati, non giocati.

**Superficie continua draft→build** (ADR 0060): il pool si organizza mentre si
drafta, senza un passaggio di modalità.

### 8.4 Il bot da gioco — vs-AI (ADR 0000 / 0001)

Sceglie di girare **client-side**, cosa che sorprende ma è coerente: la ricerca è
CPU-intensiva e il timeout mutation Convex è di 1-2 secondi. Non ne deriva alcuna
autorità — il bot gioca **attraverso le stesse mutation** dell'umano, e il server
rivalida ogni mossa (CR 720).

Pipeline:

```
useVsAiDriver (hook)          gate sul tick, guardia in volo, firma per-seq
  └── brain.worker (Web Worker)   la UI non si blocca mai
        ├── enumerateMoves        gre/moves.ts — macro-mosse atomiche legali
        ├── search                gre/search.ts — ISMCTS con determinizzazione
        │     └── evaluate        gre/evaluate.ts — euristica scala Forge (ADR 0018)
        └── executor              src/lib/ai/executor.ts — riproduce via mutation
```

- **`enumerateMoves`** restituisce macro-mosse: una `Move` impacchetta l'intento
  completo (quale spell, quali bersagli, quale X, quale set di attaccanti, quale
  assegnazione di bloccanti). Riusa gli **stessi** helper di legalità della UI
  umana — una mossa enumerata che il server poi rifiuta è un bug, non una
  feature. Le finestre combinatorie sono limitate da `MAX_COMBINATIONS`, con i cap
  documentati e mai silenziosi;
- **`search`** è ISMCTS a osservatore singolo con determinizzazione. Ogni
  iterazione ri-determinizza l'informazione nascosta, discende con UCB1 fra le
  mosse legali _in quel mondo_, espande, esegue un rollout troncato valutato da
  `evaluate`, e backpropaga. **Non modella mai le regole da sé**: applica le mosse
  attraverso la stessa risoluzione GRE del server;
- **`evaluate`** ha magnitudini su scala Forge (~100 base): una creatura vale
  centinaia, vita e materiale in proporzione. È l'headroom numerico che permette
  di distinguere una bomba da una vanilla;
- **la ricompensa è a bande** (issue #138): un esito vinto/perso domina
  l'ordinamento, ma il materiale sopravvissuto discrimina ancora dentro la banda.

**Blade** (`convex/gre/ai/blade/`, ADR 0070) è la suite di **posizioni di
correttezza** del bot: scenari con una risposta giusta nota. Due tier —
`blade-must` blocca il merge, `blade-stretch` è report-only. Ha un workflow CI
separato, perché un fallimento lì significa "il bot è peggiorato", non "una regola
si è rotta".

### 8.5 Il Bot Drafter (ADR 0065 / 0072 / 0073)

Un bot **diverso**, e deliberatamente: gira **server-side** in Convex, è una
funzione pura, e non dipende da nessun client connesso (i seat bot devono pescare
istantaneamente anche se nessuno guarda).

Il punteggio è ricomposto su **una sola scala**: punti di Pick Rating (0-5,
l'unità che un Admin già edita).

```
score = baseRating                        rating da DB/seed, altrimenti euristica
      + archetypeFit     × contextScale   il piano accumulato del pool
      + capabilityFit    × contextScale   matching provides/requires
      + comboEdge        × contextScale   loop a due carte dichiarati
      + colourCommitment × contextScale   fit di colore pesato sui pip
      + castability      × contextScale   le fonti del pool riescono a pagarla?
      + fixingValue      × contextScale   valore del fixing sul deficit
      + curveFit         × contextScale   esigenze di curva
```

Il modello di sinergia (ADR 0072) è **capability matching computato**, non coppie
di carte enumerate: un profilo dichiara quali capability una carta _fornisce_ e
quali _richiede_, da un vocabolario chiuso (`capabilityRegistry.ts`). Il `comboEdge`
è l'escape hatch per il loop chiuso a due carte che nessun vocabolario esprime
(Painter's Servant + Grindstone).

Rating e profili sono **layered**: file seed committati
(`data/pick-ratings/`, `data/card-profiles/`) sotto override di DB editabili
dall'Admin. Tabella vuota ⇒ si drafta byte-identico al path solo-seed.

Il **Draft Lab** (ADR 0074) esegue draft interi in-browser sopra gli stessi
moduli, e ricostruisce il replay di un draft giocato mostrando il diff fra le
pick storiche e quelle che lo scorer attuale farebbe (per questo l'evento stampa
`scorerVersion` a `startEvent`).

> Chi ships una carta del Vintage Cube deve aggiungerne l'id a
> `data/pick-ratings/vintage-cube.json`, o `pickRatings.bot.test.ts` diventa
> rosso.

### 8.6 Debug e Admin

**Debug scenario** (ADR 0044) — board preset caricabili con un click dal pannello
Debug in partita. Vivono **solo nella tabella `debugScenarios`**: non esiste più
un array nel codice (issue #1455). Si inseriscono dal pannello ("Save scenario")
oppure via `seedScenarioDirect`. Conseguenza accettata: una riga è **locale al
deployment**, non sta in git né nel diff di una PR — che è esattamente il punto
(niente edit di file + conflitto di merge solo per registrare uno scenario).

**Per ogni carta o feature di gameplay nuova va aggiunto uno scenario**, scelto
per colpire il golden path e possibilmente un edge case. Si salta solo per
refactor puri senza cambiamenti visibili.

**Admin** (`isAdmin` su `users`) — cura preset deck, banlist, cubi, pick rating,
profili carta.

---

## 9. Test e quality gate

### 9.1 Due suite

| Comando            | Copre                                                               |
| ------------------ | ------------------------------------------------------------------- |
| `bun run test`     | tutto (`test:app` poi `test:bot`) — **il gate**                     |
| `bun run test:app` | regole/GRE/carte/UI — ogni `*.test.ts` che non sia `*.bot.*`        |
| `bun run test:bot` | ricerca ISMCTS, evaluation, enumerazione, drafter — `*.bot.test.ts` |

Un test bot **si dichiara dal nome file**. I test bot eseguono ricerche reali su
stati di gioco completi: mescolati in una suite da ~580 file perdono la corsa alla
CPU e i loro episodi vanno in timeout. Invocazioni separate (non semplicemente
project vitest separati — i project condividono un worker pool) danno alla suite
bot una corsa non contesa. `bot-suite-boundary.test.ts` fallisce la suite app se un
`*.test.ts` normale importa un modulo bot-only.

### 9.2 Admission control sulla CPU

Più sessioni lavorano lo stesso repo in parallelo, ognuna nel suo worktree.
`scripts/gate.ts` definisce due tier:

| Tier      | Comandi                                      | Comportamento                                                             |
| --------- | -------------------------------------------- | ------------------------------------------------------------------------- |
| **heavy** | `test`, `test:app`, `test:bot`, `check:all`  | mutex machine-wide, `ncpu - 1` worker. Uno alla volta; gli altri accodano |
| **light** | `bunx vitest run <path>`, `check:pr`, `lint` | nessun lock, vitest limitato a 2 worker                                   |

Un gate heavy in coda **non è un hang**: è la macchina che si rifiuta di far
girare due suite complete a metà velocità ciascuna.

### 9.3 Cadenza

- **mentre si lavora** — solo i test mirati del modulo toccato. Il formatting è
  automatico (husky + lint-staged);
- **prima di aprire una PR** — test mirati + `bun run check:pr`. Mai un
  sottoinsieme scelto a mano dei `check:*`: costano <0,2s ciascuno, e omettere
  `check:index` faceva fallire ogni PR che porta carte;
  `check:pr` include `check:guards`, che gira **due** lane: la fast lane della
  suite bot (#1912) e **tutto il progetto node** — `convex/**` + `scripts/**`
  più ogni test `src` che non tocca il DOM, 692 file, ~30s a 2 worker, perché
  l'ambiente node non ha init per file e il progetto è `isolate: false`.
  Finché quella lane era filtrata a
  `scripts/__tests__`, ogni guard catalogue-wide del backend
  (`effects/validate`, `mechanicsRegistry`, `divergenceMarkers`, la deriva di
  `serialize`) restava fuori dal gate leggero: una PR è arrivata alla review
  con `validate.test.ts` rosso e `check:pr` uscito 0. Lo scope è fissato da
  `scripts/__tests__/check-guards-scope.test.ts`.
  Il progetto dom è classificato **per bisogno**, non per directory
  (`scripts/test-env-split.ts`, calcolato al load della config): un
  `src/**/*.test.ts` senza global del DOM, senza import di testing-library,
  senza matcher jest-dom e senza `vi.mock`/spy/fake-timer gira nel progetto
  **node** — 110 file oggi, e un file che acquisisce una dipendenza dal DOM
  torna indietro da solo. La partizione è fissata da
  `scripts/__tests__/src-test-env-split.test.ts`: un file selezionato da
  **nessun** progetto non gira e il gate resta verde. `bun run test:app` passa
  da 190s a 108s sul tier heavy.
  Resta fuori dal gate leggero ciò che il DOM lo usa davvero (252 file;
  l'issue #2435 ha sostituito l'ambiente con `happy-dom` — misura
  back-to-back sullo stesso albero, `TOLARIA_VITEST_WORKERS=2 bunx vitest run
--project dom`, 2207 test passati in entrambi i casi: happy-dom 119,35s
  wall / 44,33s di `environment` contro jsdom 180,05s wall / 113,03s di
  `environment`, circa il 34% in meno sul wall, il 61% in meno sulla fase
  `environment` — l'init dell'ambiente DOM per file resta comunque dominante,
  quindi nessuna deny-list aiuta e
  `--pool=threads` misura identico) — per quelli servono i test mirati;

- **prima di considerare finito** — `bun run check:all` + `bun run test` completi,
  zero errori e zero fallimenti.

`check:all` **verifica** il formatting, non lo ripara. Prima chiamava `--write`,
riparando in silenzio la deriva e non potendo quindi mai fallire su di essa: la CI
è rimasta rossa per giorni mentre ogni gate locale diceva verde. Un gate che
ripara ciò che dovrebbe controllare non è un gate.

### 9.4 Cosa va testato

**Il regime dipende da come è scritta la carta.**

Una carta DSL che riusa **solo** Op già esercitati **non richiede alcun test
scritto a mano**. La sua prova d'obbligo sono due cose che girano già
catalogue-wide, a costo di authoring zero:

1. `validateEffectScript` — sweep statico su tutto il catalogo: schema,
   riferimenti dei binding, vocabolario, purezza JSON, mutua esclusività con
   `resolve`/`resolveSteps`/`effect`;
2. lo **smoke test a scenario auto-generato**
   (`convex/gre/effects/scenarioGenerator.ts`) raccoglie la carta da solo e ne
   asserisce gli esiti risolvendola attraverso il path reale
   (`resolveTopOfStack`). Uno script che il generatore non sa scenarizzare emerge
   come **skip esplicito con motivo**, mai come pass silenzioso — ed è il segnale
   che quella carta un test a mano lo vuole davvero.

Una carta con `resolve()`, o una carta DSL che **introduce un Op nuovo**, prende
il regime pieno:

| La carta ha                   | Test GRE                                           | Wire format test             |
| ----------------------------- | -------------------------------------------------- | ---------------------------- |
| `resolve()` (spell)           | sì — push sullo stack, `resolveTopOfStack`, assert | solo se l'effetto è visibile |
| `staticEffects[]` (layer 7c)  | sì — `getEffectivePower/Toughness` con e senza     | **SÌ, obbligatorio**         |
| `staticAbilities[]` (keyword) | snapshot sulla definizione                         | non serve                    |
| `activatedAbilities[]`        | sì — attiva dall'entry point GRE, assert lo stato  | **SÌ** se l'esito è visibile |

Il test di un Op nuovo diventa **il test permanente di quell'Op**, ereditato
gratis da ogni carta successiva che lo riusa: "il nuovo Op paga la quota
d'ingresso una volta, il riuso viaggia gratis".

**Ogni feature che attraversa il confine GRE → game.ts → UI deve avere almeno un
test di integrazione che percorra il path completo.** Due pezzi che passano
separatamente e falliscono insieme è un bug spedito. Per un `TargetRequirement.type`
nuovo la tabella è: `getLegalTargets` (GRE), `selectTarget` (backend),
`matchesTargetRequirement` + `wantsSpellTarget` + `TARGET_LABEL` (frontend).

### 9.5 I guard catalogue-wide

Il progetto ha investito pesantemente in **test che presidiano una classe di
errori su tutto il catalogo**, invece che carta per carta. Vale la pena conoscerli
perché sono ciò che ferma la deriva:

| Guard                                | Cosa impedisce                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------------- |
| `mechanicsRegistry.test.ts`          | nome di meccanica inventato; keyword dichiarato ma non implementato             |
| `divergenceMarkers.test.ts`          | un marker `// Deferred`/`TODO` senza issue di tracking nello stesso paragrafo   |
| `effectScripts.test.ts`              | Effect Script strutturalmente invalido                                          |
| `effectScriptSmoke.test.ts`          | script che non produce l'esito dichiarato                                       |
| `triggerDedup.test.ts`               | trigger duplicati con lo stesso oracle text                                     |
| `tokenPrintLookup.test.ts`           | token DSL senza art risolvibile                                                 |
| `emblemArt.test.ts`                  | emblema senza `imagePrintId`                                                    |
| `serialize.test.ts` (drift guard)    | campo di `GameState` assente da entrambi gli insiemi di chiavi                  |
| `activation-affordability.catalogue` | forma di costo senza gate di affordabilità nel frontend                         |
| `bot-suite-boundary.test.ts`         | test bot infilato nella suite app                                               |
| `worktree-bootstrap.test.ts`         | hook husky mancante (fallisce **in silenzio**: è già sparito per sei settimane) |
| `check:index`                        | lockfile carte fuori sincrono; carta implementata contro una ristampa           |
| `check:stubs`                        | stub senza issue di copertura                                                   |

### 9.6 CI: non c'è

I tre workflow (`lint.yml`, `test.yml`, `blade.yml`) sono stati rimossi
l'8 agosto 2026. Due ragioni, entrambe sufficienti: i minuti Actions inclusi nel
piano sono esauriti, e su questo repo la branch protection non esiste
(`/branches/main/protection` risponde 403 — serve GitHub Pro), quindi nessun
check è mai stato _richiesto_: erano referti, non cancelli. Ogni job duplicava
un comando che il gate locale già esegue — `lint.yml` è un sottoinsieme di
`check:all`, `test.yml` è esattamente `bun run test`.

L'unica cosa che i workflow coprivano e il locale no era la suite blade: ora è
la terza gamba di `bun run test` (tier `must`; lo `stretch` resta manuale e
report-only).

**Conseguenza operativa: il gate locale è l'unico gate.** Niente può essere
lasciato "alla CI", il merge-train usa sempre la corsia locale, e le vie di
fuga (`TOLARIA_SKIP_PUSH_GATE=1`, `git push --no-verify`, un worktree senza
`bun run worktree:init`) non hanno più nessuna rete sotto. Rimettere un
workflow ha senso solo insieme alla branch protection.

**Zero rosso è assoluto.** `main` è sempre verde. "Non è il mio test" non è
un'esenzione: una suite rossa blocca il merge a prescindere da chi l'ha causata.
Se il baseline è rosso prima di iniziare, si sistemano prima i rossi. Mai
ramificare da rosso, mai mergiare sopra rosso, mai silenziare un test per andare
verdi.

---

## 10. Come si mantiene la qualità mentre il progetto cresce

Le convenzioni sotto non sono stilistiche. Ognuna esiste perché la sua assenza ha
già prodotto un bug che è costato caro.

**1. Scrivere un ADR per ogni decisione non ovvia.** 81 ADR non sono burocrazia:
sono il motivo per cui una scelta di due mesi fa è ancora comprensibile. Ogni ADR
nuovo **deve** aggiungere la sua riga a `docs/adr/README.md` nella stessa modifica
che lo crea. Un ADR senza riga d'indice è incompleto perché è indiscopribile.

**2. Un'autorità unica per ogni concetto.** Il pattern più ricorrente del
progetto. Registry delle meccaniche per i nomi; `eventStatus.ts` per cosa una fase
di evento permette; `expectedInput.ts` per cosa il gioco aspetta; il registry dei
filtri di bersaglio (ADR 0068) perché `getLegalTargets` e `selectTarget` devono
essere d'accordo per costruzione. Quando due posti devono concordare, non si fanno
concordare: si fanno leggere dallo stesso posto.

**3. Riusare le primitive, non aggiungerne.** L'obiettivo di scala è enorme; una
primitiva `SpellContext` dedicata per carta non regge. Prima di aggiungerne una:
si può comporre da quelle esistenti? (Timetwister = `moveZone` ×2 +
`shuffleLibrary` + `drawCards`.) Si può parametrizzare una che è quasi giusta? La
primitiva rappresenta un'operazione generale di zona/mana/vita, o è a forma di
carta? (`moveZone` passa; `shuffleHandAndGraveyardIntoLibrary` no.) Preferire una
sequenza di primitive semplici all'aggiunta di flag booleani a una esistente.

**4. Chiudere la classe di bug, non il sintomo.** Quando una carta manifesta un
bug, quasi sempre non è la sola. La correzione è: grep su tutti i set, capire il
pattern, sistemare la classe. Vale in particolare per i confini di seam — è così
che sono nati il registry dei filtri di bersaglio e il seam unificato di
sostituzione della pescata.

**5. Il CR è il default, non una domanda.** Quando il comportamento è governato dal
Comprehensive Rules, si implementa esattamente ciò che il CR dice. Si solleva la
questione solo se il CR è genuinamente ambiguo, se si sta semplificando
volontariamente, o se la scelta non è dettata dal CR. **Ogni meccanica cita la sua
sezione CR in un commento**: è ciò che rende verificabile un'implementazione a
distanza di mesi.

**6. Il testo Oracle moderno vince.** Le carte seguono l'Oracle Scryfall attuale,
non il testo stampato. Se l'implementazione diverge da `oracleText`, si corregge
l'implementazione.

**7. Una divergenza documentata porta una issue.** Un commento
`// Deferred`/`// TODO` dentro `convex/cards/sets/**` documenta una clausola
Oracle che l'implementazione droppa volutamente — e **deve** portare un riferimento
a issue (`tracked-by: #NNN`) o una nota esplicita di fuori-scope, **nello stesso
paragrafo di commento**. Un riferimento in un paragrafo diverso non vale: non
garantisce nulla. Un `ADR NNNN` non conta come riferimento di tracking (un ADR
documenta il design, non è un ticket).

**8. Estrarre alla seconda occorrenza.** Un pattern non-`SpellContext` sta come
closure sulla prima carta; alla seconda diventa un helper condiviso o un pezzo di
DSL.

**9. Le domande al proprietario del progetto sono per la strategia, non per il
CR.** Si chiede conferma su decisioni architetturali significative o quando il CR
lascia un'ambiguità che cambia il comportamento di gioco. Non si chiede se seguire
le regole.

---

## 11. Fuori scope

- **Catalogo completo** — un insieme controllato e crescente, non tutte le ~80k
  carte.
- **Multiplayer 3+** — solo due giocatori, più la modalità solo (un utente, due
  seat).
- **Ante e sottopartite** — Shahrazad, carte ante (ADR 0010).
- **Replay via event log** — infrastruttura di determinismo presente, log assente.

Quando una carta ha bisogno di una capacità genuinamente non costruita, **la si
segnala esplicitamente** invece di assumere che sia rinviata: la maggior parte
delle meccaniche è ormai supportata, e "presumo sia fuori scope" ha già prodotto
carte inerti.

---

## 12. Lavori in corso e roadmap

~177 issue aperte. I filoni attivi:

**Engine — meccaniche mancanti**

- **Mana ibrido** (PRD #1736) — pagare `{R/W}` con mana. Il pip ibrido guild
  (auto-tap da terreno #1738/#1739/#1755, rendering pip #1740, pianificazione
  mana del bot #1741) è spedito e ha sbloccato l'ondata di carte prima stub
  sotto #782 (ora chiuso): Figure of Destiny/Fable, Lutri, Lurrus, Deathrite
  Shaman, Thopter Foundry, Carnage Interpreter, Vibrance/Deceit/Wistfulness.
  Residuo aperto: pip ibridi monocolore `{2/W}` (#1743). Phyrexian-ibridi
  `{G/U/P}` chiuso out-of-scope (nessun consumer, #1744).
- **Framework Saga** (PRD #1878, ADR 0078) — contatori lore e abilità di capitolo;
  Urza's Saga come caso di prova.
- **Modificatori di costo di lancio** (PRD #702, ADR 0063) — riduzione + payWith
  per affinity/delve/convoke.
- **Continuous Effects Registry** (PRD #2064, ADR 0082) — un solo registro degli
  effetti continui su `GameState` come fonte di verità per CR 613, al posto dei
  due modelli incompatibili odierni (layer 7 ricalcolato a ogni lettura, layer 6
  materializzato una volta). Cancella lo split in tre provenienze di
  `staticAbilities`, che è ciò che rende impossibile un ricalcolo uniforme e
  congela il parametro di un grant al momento della materializzazione. Otto
  slice; S3 (layer 6) porta il caso di conformità counter-gate ×
  source-independence assorbito da #1712 — Dread Wight.
- Seam mirati: ritorno di un permanente andato via (#1468), scelta di spesa del
  mana generico (#1442). Typecycling (#1839) è stato consegnato: variante di
  Cycling (CR 702.29e/f) costruita sulla stessa activation shell.

**Migrazione `resolve()` → `effects[]`**

474 closure `resolve()` residue: 320 FREE, 15 X-only, 139 Op-blocked. Un solo
gate resta, drenare il bucket "free" del classificatore (#1435). Il secondo,
"Op-blocked → 0" (#1438), è stato **ritirato** dall'audit del 2026-09-01: 78 Op
per 139 closure, 37 dei quali bloccano una carta sola, l'85% in ice/lea/drk/leg/
atq/arn/fem — nessun cluster con leva. Ne sono sopravvissute tre slice mirate:
#3010 (il classifier sovrastima `Op-blocked`), #3011 (spostamento di zona intera
a livello giocatore) e #3012 (`revealHand`). Lo strumento è
`scripts/migration-classifier.mjs`; la procedura sta in
`docs/agents/effect-script-migration.md`.

> Trappola nota: aggiungere una carta `resolve()` sposta il baseline del
> censimento di migrazione. Il gate leggero non se ne accorge, quello completo
> fallisce.

**Bot — traccia "Wayfinder"**

Il tetto di forza del bot è stato diagnosticato come **fedeltà della valutazione,
non profondità di ricerca** (#1892). In corso: telemetria delle decisioni (quale
quota di scelte alla radice è decisa da un tie-break invece che dalla ricerca,
#1893), metrica di forza del bot (#1895), disciplina di timing/option-value per le
abilità attivate (#1890), priori di scelta che oggi selezionano risposte
attivamente dannose (#1888).

**Limited**

Le fasi di gioco a round Swiss (PRD #1628) sono in gran parte atterrate.
Tracker vivo della classificazione delle carte cubo mancanti: #1525 (219 nomi in
bucket).

**Frontend**

Deck builder unificato (PRD #1617) in corso. Overhaul UX mobile — audit portrait +
landscape (#1758).

**Backlog audit carte**

Diverse decine di issue da audit sistematici delle clausole Oracle droppate,
raggruppate per set (LEG, ICE, INV, MH3, ELD, …). Sono lavoro ideale per
prendere confidenza col catalogo: scope stretto, criteri di correttezza chiari.

---

## 13. Mappa rapida dei file

```
convex/
├── schema.ts               15 tabelle, pesantemente commentate — leggerlo tutto
├── game.ts                 ~13k righe: TUTTE le mutation/query di gioco
├── gameProjections.ts      GameState → PublicGameState / FullGameState
├── gameLifecycle.ts        creazione/join/fine partita
├── matches.ts              orchestrazione Bo1/Bo3
├── formats.ts              legalità dei mazzi (puro, condiviso client/server)
├── limitedEvents.ts        mutation/query eventi Limited
├── auth.ts                 getCurrentUser / assertIsAdmin
├── crons.ts                sweep di retention
├── cards/
│   ├── index.ts            registry — l'UNICO seam di import per le carte
│   ├── types.ts            CardDefinition, SpellContext, EffectOp, …
│   ├── mechanicsRegistry.ts autorità sui nomi di meccaniche e Op
│   ├── emblems.ts sharedTokens.ts filters.ts
│   └── sets/<code>/<colour>.ts
├── gre/
│   ├── state.ts            GameState + la maggior parte delle primitive (~17k righe)
│   ├── expectedInput.ts    ADR 0047 — il gate unico
│   ├── rules.ts            getLegalActions / getLegalTargets
│   ├── stack ⊂ state.ts    resolveTopOfStack
│   ├── phases.ts triggers.ts sba.ts layers.ts replacements.ts
│   ├── combat.ts banding.ts protection.ts
│   ├── serialize.ts        PERSISTED_OPTIONAL_KEYS + drift guard
│   ├── effects/            interpreter.ts validate.ts scenarioGenerator.ts
│   └── ai/                 moves ⊂ ../moves.ts, opValuers, blade/
└── limited/
    ├── draftEngine.ts botDrafter.ts boosterGenerator.ts
    ├── eventLogic.ts eventStatus.ts swiss.ts standings.ts
    └── cardRatings.ts cardProfiles.ts capabilityRegistry.ts

src/
├── components/board/       la board (~120 componenti)
├── lib/card-utils.ts       buildTriggerStateView, getStackAbilities — i riduttori
├── lib/ai/                 brain, worker, executor, state-adapter, selfplay
├── hooks/useVsAiDriver.ts  il driver del bot, gated sul tick
└── routes/                 TanStack Router

scripts/
├── gate.ts                 admission control CPU
├── bootstrap-worktree.ts   `bun run worktree:init`
├── check-card-index.ts check-stub-coverage.ts
├── queue-plan.ts queue-lint.ts train-order.ts   il loop (PRD #2180)
├── loop-scorecard.ts       metriche del loop da telemetria + receipt
├── migration-classifier.mjs   resolve() → effects[]
├── generate-print-set.mts  set di sole ristampe (3ed, 4ed)
└── list-to-cards.mjs       importer worklist (ADR 0041)

data/
├── card-index.json         lockfile delle carte implementate (rigenerato, mai a mano)
├── pick-ratings/ card-profiles/ boosters/ worklists/
```

---

## 14. Riferimenti

- [Magic Comprehensive Rules](https://magic.wizards.com/en/rules) — l'autorità.
  Le sezioni citate nel codice si riferiscono all'edizione corrente; i numeri
  slittano fra edizioni, quindi vanno ri-derivati da un testo aggiornato, mai
  copiati da un commento vecchio.
- [Convex docs](https://docs.convex.dev) — e `convex/_generated/ai/guidelines.md`,
  che sovrascrive parecchie assunzioni comuni sulle API Convex.
- [Scryfall API](https://scryfall.com/docs/api) — oracle text, id delle stampe,
  art.
- Motori open source di riferimento per l'architettura GRE: **XMage** (Java),
  **Forge** (Java). La scala numerica della valutazione del bot è presa da Forge
  (ADR 0018).
