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

Quando faccio scry bottom con opt e poi pesco, dovrei vedere la carta in fondo al mazzo come visible nel dialog della library.

Problema di wiring su Cloak of Confusion. Quando la creatura incantata attacca e non e' bloccata, va diretta al danno senza il prompt per scegliere tra danni e discard.

I trigger di sheoldred che vanno in pila devono essere uno per ogni carta. E a volte succedono cose strane. L'interazione con il draw 7 di griselbrand ha fatto: -7 life, risolve e pesco 7. vedo un solo trigger di sheoldred nella stack invece di 7, e infatti guadagno solo 2 invece di 14. Stessa cosa se l'avversario pesca 7, perde solo 2 punti vita con 1 trigger invece di 14 punti vita con 7 trigger.

Nei solo game, quando fai swap tra player1 e player2, non fare l'animazione del cambio punti vita, perché è solo un cambio di view.

L'abilità attivat di Ashen ghoul non risulta attivabile, anche se è nel cimitero con 3 creature sopra ed è il mio upkeep.

Le carte che ti fanno scegliere nel cimitero, esilio, mano o library con filtri (es. exhume solo creature) quando mostrano le pile, devono mettere il ring solo sulle carte eleggibili e rendere meno opache le altre. se non sbaglio e' gia' implementato per le fetchlands, fallo in tutti gli altri scenari simili.

Errore su Sheoldred's Edict: quando l'avversario deve decidere cosa sacrificare, esce questo errore:
installHook.js:1 [CONVEX M(game:submitResolutionChoice)] [Request ID: ceba9efd23506d93] Server Error
Uncaught Error: Illegal action (ADR 0047): the game is waiting for choice input from another player.
at assertExpectedInput (../../convex/gre/expectedInput.ts:233:12)
at handler (../convex/game.ts:6688:12)

Le carte esiliate face-down devono mostrare card-back, non cercare una card-image "https://cards.scryfall.io/normal/front/f/a/face-down:2-2-vanilla.jpg" che non esiste.

Dominate non risulta mai castabile, verifica la presenza di creature con mv <= 0. Se c'è (tipo Ornithopter), poi puoi tappare anche di più per X e prendere creature più costose. È un bug.
