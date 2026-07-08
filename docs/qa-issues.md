frantic search deve evidenziare con un ring le carte selezionate per lo stap. così tutte le carte che fanno una selezione simile.

è possibile attivare un'abilità con costo di vite superiore a quelle disponibili, ma poi arriva questo errore.
installHook.js:1 [CONVEX M(game:activateAbility)] [Request ID: d79a046a2ad265b4] Server Error
Uncaught Error: Not enough life
at handler (../convex/game.ts:7094:20)
la validazione a monte deve disabilitare quell'abilità se non è pagabile.

quando una carta tipo Copy artifact diventa una copia, la card-preview deve mostrare accanto allo stato attuale anche la carta originale. vedi ui arena.

Target slection banner mostra la label "spell" per l'abilità attivata di Arcum's Whistle, anche se il name della card definition è presente.

Mishra's Bauble, ma anche Thoughtseize, Gitaxian Probe ecc: alla risoluzione dell'abilità di peek/look/reveal, deve comparire un dialog a tempo (10s) con pulsante X di chiusura manuale che mostra le carte rivelate dalla spell/abilità. poi la visibilità delle carte persiste come già implementato.
