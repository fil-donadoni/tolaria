il bot ha castato Copy artifact senza alcun artefatto in gioco.

Se ho aperto un box di scelta del mana per una terra che sto tappando, e poi premo auto-tap, il box di scelta deve chiudersi.

Pagare il costo dell'abilità attivata di Goblin bombardment non deve mostrare il dialog di auto-tap, non c'è niente da tappare. devo vedere evidenziate le creature sul board che posso sacrificare. Idem per Sylvan Safekeeper.

Witherbloom Charm mi ha fatto sacrificare un permanente random, non a mia scelta.

L'Elemental Token generato da Titania non riporta la sua immagine da Scryfall. E nemmeno gli spirits. sembra che l'immagine dei token non venga recuperata mai, ma il Servo di Retrofitter foundry si vede.

L'effetto mouseover che toggla card-preview non è affidabile. Riproduciamo il comportamento di Arena, per desktop: click -> preview accanto alla carta, longPress -> preview più grande al centro a sinistra del viewport.

Stock up invece di mostrare le 5 top cards della library mostra tutta la library e posso scegliere solo 2 carte tra le prime 5. non funziona così.

Preordain: lo scry non fa niente di quel che dovrebbe. Dovrei selezionare fino a 2 carte da mettere in fondo, secondo il dialog che appare, ma non mi mostra le carte (le top N della library) tra cui scegliere.

Chromatic star quando va al cimitero non triggera l'abilità di pescata.

Cerco di castare Natural Order ma ricevo questo errore:
Uncaught (in promise) Error: [CONVEX M(game:announceCast)] [Request ID: 5764c8880a4745da] Server Error
Uncaught Error: No legal permanent to pay the additional cost
at buildAdditionalCostPicker (../convex/game.ts:3078:13)
at handler (../convex/game.ts:3439:20)

Called by client
at buildAdditionalCostPicker (../convex/game.ts:3078:13)
at handler (../convex/game.ts:3439:20)

Called by client
at BaseConvexClient.mutation (http://localhost:5173/node_modules/.vite/deps/react-DTOXqKhK.js?v=7807a94e:2302:10)
mutation @ react-DTOXqKhK.js?v=7807a94e:2302
await in mutation
mutation @ react-DTOXqKhK.js?v=7807a94e:3014
mutation @ react-DTOXqKhK.js?v=7807a94e:2802
(anonymous) @ useHandCardCommit.tsx:52
(anonymous) @ useHandCardCommit.tsx:91
(anonymous) @ board-hand-card.tsx:96
executeDispatch @ react-dom_client.js?v=7807a94e:9141
runWithFiberInDEV @ react-dom_client.js?v=7807a94e:851
processDispatchQueue @ react-dom_client.js?v=7807a94e:9167
(anonymous) @ react-dom_client.js?v=7807a94e:9454
batchedUpdates$1 @ react-dom_client.js?v=7807a94e:2044
dispatchEventForPluginEventSystem @ react-dom_client.js?v=7807a94e:9240
dispatchEvent @ react-dom_client.js?v=7807a94e:11319
dispatchDiscreteEvent @ react-dom_client.js?v=7807a94e:11301
sentryWrapped @ @sentry_react.js?v=7807a94e:12015

<div>
exports.jsxDEV @ react_jsx-dev-runtime.js?v=7807a94e:193
(anonymous) @ board-hand-card.tsx:151
react_stack_bottom_frame @ react-dom_client.js?v=7807a94e:12868
renderWithHooks @ react-dom_client.js?v=7807a94e:4213
updateFunctionComponent @ react-dom_client.js?v=7807a94e:5569
beginWork @ react-dom_client.js?v=7807a94e:6140
runWithFiberInDEV @ react-dom_client.js?v=7807a94e:851
performUnitOfWork @ react-dom_client.js?v=7807a94e:8429
workLoopSync @ react-dom_client.js?v=7807a94e:8325
renderRootSync @ react-dom_client.js?v=7807a94e:8309
performWorkOnRoot @ react-dom_client.js?v=7807a94e:7957
performWorkOnRootViaSchedulerTask @ react-dom_client.js?v=7807a94e:9059
performWorkUntilDeadline @ react-dom_client.js?v=7807a94e:36
<BoardHandCard>
exports.jsxDEV @ react_jsx-dev-runtime.js?v=7807a94e:193
(anonymous) @ board-hand.tsx:119
(anonymous) @ board-hand.tsx:113
react_stack_bottom_frame @ react-dom_client.js?v=7807a94e:12868
renderWithHooks @ react-dom_client.js?v=7807a94e:4213
updateFunctionComponent @ react-dom_client.js?v=7807a94e:5569
beginWork @ react-dom_client.js?v=7807a94e:6140
runWithFiberInDEV @ react-dom_client.js?v=7807a94e:851
performUnitOfWork @ react-dom_client.js?v=7807a94e:8429
workLoopSync @ react-dom_client.js?v=7807a94e:8325
renderRootSync @ react-dom_client.js?v=7807a94e:8309
performWorkOnRoot @ react-dom_client.js?v=7807a94e:7957
performWorkOnRootViaSchedulerTask @ react-dom_client.js?v=7807a94e:9059
performWorkUntilDeadline @ react-dom_client.js?v=7807a94e:36

se per sbaglio clicco 2 volte su una terra per pagare il costo di una spell:
[CONVEX M(game:tapForActivationPayment)] [Request ID: 6ba7b10498242b82] Server Error
Uncaught Error: Source became tapped during payment
at tryAutoCommitPendingActivation (../convex/game.ts:1163:13)
at handler (../convex/game.ts:3938:12)

Spellseeker castato dall'avversario non mi mostra la carta trovata nella library.

installHook.js:1 [CONVEX M(game:passPriority)] [Request ID: aaee3425caf8b667] Server Error
Uncaught Error: Illegal action (ADR 0047): the game is waiting for priority input from another player.
at assertExpectedInput (../../convex/gre/expectedInput.ts:218:12)
at handler (../convex/game.ts:5842:12)
questo errore deve essere silente, se provo a passare priorità quando non ce l'ho è solo un misclick innocuo.

Dance of the Dead: il prompt di pagamento per untap mostra {1}{b} invece dei simboli di mana (solo nel testo, il button è ok), e dovrebbe presentare anche l'opzione auto-tap.

Headliner Scarlett: la carta esiliata può essere giocata, non solo castata, e solo nel turno in cui è stata esiliata. Invece ho potuto castare una carta esiliata il turno prima e non ho potuto giocare una terra esiliata in questo turno.
