frantic search deve evidenziare con un ring le carte selezionate per lo stap. così tutte le carte che fanno una selezione simile.

è possibile attivare un'abilità con costo di vite superiore a quelle disponibili, ma poi arriva questo errore.
installHook.js:1 [CONVEX M(game:activateAbility)] [Request ID: d79a046a2ad265b4] Server Error
Uncaught Error: Not enough life
at handler (../convex/game.ts:7094:20)
la validazione a monte deve disabilitare quell'abilità se non è pagabile.

boomerang al momento non può targettare le terre, ma deve poterlo fare.

quando una carta tipo Copy artifact diventa una copia, la card-preview deve mostrare accanto allo stato attuale anche la carta originale. vedi ui arena.

Flooded woodlands: non ho potuto scegliere quali terre sacrificare. questo era già successo con witherbloom charm, è stato sistemato a livello di carta ma deve essere un fix di motore generale. Salvo diverse indicazioni, sacrificare implica una scelta del controllore.
