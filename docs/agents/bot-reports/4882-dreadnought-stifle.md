# Report — issue #4882: coppia blade Phyrexian Dreadnought + Stifle

Stato: **in corso** (issue #4882 riaperta, `model:opus`, branch
`feat/issue-4882`). Questo documento registra il primo tentativo, l'obiezione
dell'utente e cosa è cambiato dopo.

## Il problema di partenza

L'entry blade `must` "discriminating pair: casts Phyrexian Dreadnought WITH an
out (Stifle)" passava per rumore: `blade:robustness` la classificava
`NOISE-PINNED`, con la radice decisa da `material-tiebreak` su ogni seed. Il
refit dell'issue #4758 l'aveva portata da 20/20 a 18/20, e PR per #4758 l'aveva
ri-seedata (`[0xb1ade, 1, 2]` → `[0xb1ade, 2, 3]`) come tappabuchi, con una riga
in `ROBUSTNESS_BASELINE`.

## Primo tentativo (PR #4916, mergiata)

**Diagnosi.** Uno script scratch ha stampato i figli della radice a opp life 20,
400 iterazioni, seed 0..5, vettori default / jitter+ / jitter−:

| ramo   | visite  | reward medio | margin medio |
| ------ | ------- | ------------ | ------------ |
| `pass` | 200–208 | 0.700–0.708  | 419–437      |
| cast   | 192–200 | 0.699–0.701  | 432–441      |

Nessuno dei due rami era clippato (margin sotto `materialFull`). Conclusione di
allora: i rollout di `pass` castano il Dreadnought al turno dopo e arrivano allo
stesso materiale, quindi "adesso" e "dopo" si equivalgono.

**Risoluzione scelta.** La route 2 dell'issue, cioè ri-tagliare la posizione:
entrambe le metà a `life: { opp: 12 }` (pari alla forza del Dreadnought). Il cast
arriva a lethal un ciclo di turni prima, il gap diventa ≈0.07 di reward ed è
deciso da `mean-reward`. I seed sono tornati `[0xb1ade, 1, 2]` e la riga è uscita
dal baseline. Audit: entrambe le metà `ROBUST` 10/10 × 3 vettori.
Proof-of-failure: togliendo Stifle la metà 2 diventa `WRONG` 0/3.

**Review (opus):** un blocco (`data/blade-reproducers.json` stale) e due commenti
imprecisi, tutti corretti. Landed via `bun run land`, issue chiusa.

## Obiezione dell'utente

> "hai modificato lo scenario per avere sempre l'avversario a 12? ma questo non
> serve a testare che il bot trovi conveniente castare dreadnought e stifle in
> risposta al suo trigger. dovrebbe essere evidente che un 12/12 ancora in campo
> nella fase successiva sia un gran guadagno, anche se l'avversario e' a 30"

> "castare un 12/12 e' meglio prima che dopo, salvo casi rarissimi. non serve un
> avversario che morirebbe in un attacco per giustificarlo, anche al costo di 2
> carte."

## Cosa era sbagliato nel primo tentativo

1. **Ho cambiato la domanda invece di rispondere.** L'entry chiede "il bot
   capisce che un 12/12 protetto in campo adesso vale più di rimandare?". Con la
   vita a 12 la domanda diventa "il bot vede un lethal?", che è un'altra
   posizione. La suite è verde, ma il difetto che l'entry doveva sorvegliare è
   ancora lì, solo nascosto.
2. **Ho scelto la route più economica, non quella giusta.** La route 1
   (correggere la classe nella valutazione) avrebbe toccato `evaluate`/`search`
   e il fit. L'ho scartata senza misurarla. Nella PR ho anche scritto che la
   valutazione "non è sbagliata", cosa che nessuna misura sosteneva.
3. **Ho spiegato i numeri a parole, senza verificarli.** "I rollout di `pass`
   castano al turno dopo" era un'ipotesi. Non avevo verificato né dove finisce
   il rollout né in che fase porta `pass`.
4. **Ho usato un criterio di successo sbagliato.** "`ROBUST` e fuori dal
   baseline" è la condizione di accettazione, non l'obiettivo. Un ri-taglio che
   rende la posizione banale la soddisfa sempre.

## Strategia rivista (concordata)

1. Ripristinare il test fedele all'intento: life 20 o 30, 12/12 protetto da
   Stifle. Il bot deve castarlo anche al costo di 2 carte.
2. Misurare a livello di foglia prima di toccare codice: orizzonte, clip,
   breakdown di `evaluate`.
3. Correggere la classe nella valutazione (ADR 0124 §5: Verdicts → fit →
   report). Nessuna nuova regola alla radice, refit dei pesi e
   `weightFit.bot.test.ts` verde.
4. Accettazione: metà 2 `ROBUST` via `mean-reward` a vita alta, metà 1 ancora
   `ROBUST`, riga fuori da `ROBUSTNESS_BASELINE`.

## Modifiche fatte finora (secondo passaggio)

- Issue #4882 riaperta con un commento, label `model:opus`, riclaimata, nuovo
  worktree da `origin/staging`.
- **Nessuna modifica al codice ancora.** Il registry su staging ha ancora il
  ri-taglio a life 12 di PR #4916: va rimosso in questo stesso branch.
- Misure (script scratch non tracciato, 400 iterazioni, seed 0..2):
    - Il rollout si ferma all'inizio del **prossimo turno del bot**
      (`ROLLOUT_EXTRA_BOT_TURNS = 0`, `search.ts`). L'orizzonte parte dal nodo in
      cui inizia il rollout, non dalla radice.
    - `pass` in PRECOMBAT_MAIN porta al combattimento dello stesso turno (tracciato
      fino a DECLARE_ATTACKERS). Il bot potrebbe castare in POSTCOMBAT_MAIN, ma
      questo non è ancora verificato.
    - **Anche in POSTCOMBAT_MAIN a life 20**, dove `pass` rimanda davvero di un
      turno intero, i rami restano pari: cast r≈0.700 m≈438, pass r≈0.691–0.703
      m≈394–420, `material-tiebreak` su 9 casi su 9. Quindi il difetto non dipende
      dalla fase: la ricerca non vede il valore di un turno di tempo sul 12/12.
    - A life 30 in POSTCOMBAT_MAIN il cast vince per `mean-reward` (r≈0.698 contro
      ≈0.669). La metà 1 resta corretta (pass per `mean-reward`) a 20 e a 30.
- Ipotesi di lavoro, **non ancora verificata**: il ramo `pass` guadagna profondità
  di albero, e le sue foglie arrivano a un clock di gioco più tardo, dove il
  Dreadnought è stato castato comunque. Foglie a tempi diversi rendono
  confrontabili due linee che non lo sono.
- Prossimo passo: strumentare le foglie per ramo della radice (turno della
  foglia, vita dell'avversario, Dreadnought in campo, margin, clip) e il
  breakdown di `evaluate`.

## Cosa fare quando c'è un bug del game bot

1. **L'entry blade è la specifica.** La domanda che pone ("un umano risponde
   senza esitare") non si cambia per farla passare. Ri-tagliare è lecito solo
   se la posizione originale è davvero ambigua per un umano, e va detto
   esplicitamente.
2. **Leggi la regola dell'umano come un'invariante di classe.** "Un 12/12 prima
   è meglio che dopo" vale per ogni permanente, a ogni vita. Il fix deve
   rispettarla ovunque, non solo sulla board dell'entry.
3. **Misura la foglia, non la radice.** Visite, reward e margin alla radice
   dicono _che_ c'è un pareggio, non _perché_. Servono turno e fase della foglia,
   quante foglie sono clippate, e il breakdown di `evaluate` per ramo.
4. **Verifica ogni "perché" con un esperimento a variabile singola.** Una fase
   diversa, una vita diversa, una carta in meno. Mai una spiegazione plausibile
   senza un numero che la separi dall'alternativa.
5. **Scegli la route per misura, non per costo.** Toccare `evaluate` e rifare il
   fit costa di più, ma se il difetto è lì è l'unica correzione. Un fix nel
   registry che rende banale la posizione è un segnale d'allarme.
6. **Non scrivere nella PR conclusioni che non hai misurato.**
