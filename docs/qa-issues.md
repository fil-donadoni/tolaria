frantic search deve evidenziare con un ring le carte selezionate per lo stap. così tutte le carte che fanno una selezione simile.

Illusionary terrain non funziona: posso scegliere i 2 tipi di terra base quando entra, ma poi le terre in gioco coinvolte non cambiano tipo e nell'oracle text della card-preview di illusionary terrain non viene mostrato il tipo di terra scelto.

Animate dead triggera la sua abilità left-the-battlefield nell'upkeep sucessivo a quando la sua creatura ha lasciato il battlefield. Dovrebbe succedere subito.

Problema di wiring su Cloak of Confusion. Quando la creatura incantata attacca e non e' bloccata, va diretta al danno senza il prompt per scegliere tra danni e discard.

Nei solo game, quando fai swap tra player1 e player2, non fare l'animazione del cambio punti vita, perché è solo un cambio di view.

L'abilità attivat di Ashen ghoul non risulta attivabile, anche se è nel cimitero con 3 creature sopra ed è il mio upkeep.

Errore su Sheoldred's Edict: quando l'avversario deve decidere cosa sacrificare, esce questo errore:
installHook.js:1 [CONVEX M(game:submitResolutionChoice)] [Request ID: ceba9efd23506d93] Server Error
Uncaught Error: Illegal action (ADR 0047): the game is waiting for choice input from another player.
at assertExpectedInput (../../convex/gre/expectedInput.ts:233:12)
at handler (../convex/game.ts:6688:12)

Le carte esiliate face-down devono mostrare card-back, non cercare una card-image "https://cards.scryfall.io/normal/front/f/a/face-down:2-2-vanilla.jpg" che non esiste.

Dominate non risulta mai castabile, verifica la presenza di creature con mv <= 0. Se c'è (tipo Ornithopter), poi puoi tappare anche di più per X e prendere creature più costose. È un bug.

Anche scry e tutti i dialog di choice devono poter essere abbassati per mostrare il battlefield, e poi riaperti per completare l'azione.

Il bot non sa usare le fetchlands.

Migliorare UI sideboard con /prototype. Card previews, possibilità di avere >60 carte nella main, miglioramento cta spostamento, visualizzazione a pile
