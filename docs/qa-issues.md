frantic search deve evidenziare con un ring le carte selezionate per lo stap. così tutte le carte che fanno una selezione simile.

quando una carta tipo Copy artifact diventa una copia, la card-preview deve mostrare accanto allo stato attuale anche la carta originale. vedi ui arena.

installHook.js:1 [CONVEX M(game:passPriority)] [Request ID: e8655af353f53a01] Server Error
Uncaught Error: Field name $guard starts with a '$', which is reserved.
at validateObjectField (../../node_modules/convex/src/values/value.ts:163:11)
at convexToJsonInternal (../../node_modules/convex/src/values/value.ts:366:8)
at convexToJsonInternal (../../node_modules/convex/src/values/value.ts:366:8)
at <anonymous> (../../node_modules/convex/src/values/value.ts:335:4)
at map [as map] (<anonymous>)
at convexToJsonInternal (../../node_modules/convex/src/values/value.ts:333:29)
at convexToJsonInternal (../../node_modules/convex/src/values/value.ts:366:8)
at convexToJsonInternal (../../node_modules/convex/src/values/value.ts:366:8)
at patchValueToJson (../../node_modules/convex/src/values/value.ts:447:0)

Illusionary terrain non funziona: posso scegliere i 2 tipi di terra base quando entra, ma poi le terre in gioco coinvolte non cambiano tipo e nell'oracle text della card-preview di illusionary terrain non viene mostrato il tipo di terra scelto.

Manca la seconda abilità attivata di Psychic frog

Brainstorm è buggato, verificare

Phase out dovrebbe mostrare le carte disabilitate e con poca opacità, non farle sparire del tutto

Animate dead triggera la sua abilità left-the-battlefield nell'upkeep sucessivo a quando la sua creatura ha lasciato il battlefield. Dovrebbe succedere subito.

Impulse, Stock Up e tutte le carte che dicono "bottom in any order" adesso non ti permettono di scegliere l'ordine.
