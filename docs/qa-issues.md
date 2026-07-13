Migliorare UI sideboard con /prototype. Card previews, possibilità di avere >60 carte nella main, miglioramento cta spostamento, visualizzazione a pile

Manca la banlist in premodern (parallax tide per esempio)

carte multiple held in exile (parallax wave per esempio): devo vederle tutte, ora vedo solo l'ultima.
Da migliorare la ui di multiple aure sulla stessa carta.
per entrambi i problemi, facciamo un fan orizzontale come quello che usiamo per i permanenti con stesso nome e state, poi al click sulla pila si apre un dialog con la pila stile cimitero, che mostra tutte le carte

filtro in deck builder per formato vintage cube, da lista. supporta più potenziali liste vintage cube

quando provo ad aprire l'applicazione su una url diversa da /, ricevo sempre 404. se ci arrivo da spa funziona. serve il calcolo route anche SSR

bug coalition restraint: permette di attaccare con qualasiasi numero di creature, poi muore con errore non mostrato all'utente. deve essere una validazione, non un'exception.
E comunque il pagamento della tassa deve essere fatto con prompt auto-tap o manualmente, ora vengono tappate terre a caso senza chiedere conferma.
react-DTOXqKhK.js?v=bf8ce4fd:2302 Uncaught (in promise) Error: [CONVEX M(game:confirmAttackers)] [Request ID: 6968d8c20f5abded] Server Error
Uncaught Error: Creatures can't attack you unless their controller pays {X} for each creature they control that's attacking you, where X is the number of basic land types among lands you control.
at chargeManaCostOrThrow (../convex/game.ts:6532:22)
at handler (../convex/game.ts:6641:12)

Called by client
at chargeManaCostOrThrow (../convex/game.ts:6532:22)
at handler (../convex/game.ts:6641:12)

Called by client
at BaseConvexClient.mutation (http://localhost:5173/node_modules/.vite/deps/react-DTOXqKhK.js?v=bf8ce4fd:2302:10)
