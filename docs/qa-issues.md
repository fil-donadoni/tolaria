Non so se sia un problema di UI o di fasi di gioco, ma mi chiede di scartare per hand size quando c'è scritto untap dell'avversario invece che nella mia cleanup

Flash of Insight non risulta castabile con flashback

Se premo space 2 volte troppo velocemente su declare attackers ricevo un 500 e il gioco si blocca finché non refresho la pagina

Carte cubo da creare:
Atraxa
Sin
Doomsday
Thassa's Oracle
Bowmaster
The one ring
Emrakul
Craterhoof
Ocelot Pride
Jacked Rabbit
Gut
Laelia
Troll of Kazad-dum
Bitter Triumph
Pyrogoyf
Minsc&Boo
Skullclamp
Nadu
Lightning Greaves
Springheart Nantuko
Mox Opal
Teferino
Teferone
Fallen Shinobi
Lurrus
Lutri
Grist
Necromancy
Fable of the mirror-breaker

Enduring renewal non mostra l'intero oracle text in card-preview, e anche Icetill Explorer. Cerca altri casi simili e risolvi alla radice.

La seconda abilità di currency converter non mi mostra le carte esiliate con lei all'interno del dialog di scelta, non posso selezionare niente.

L'abilità di Dark Confidant non ha bisogno del box di spostamento della carta, deve andare in mano per forza. viene rivelata automaticamente, spostata in mano e il controllore perde i punti vita. niente scelte, niente box intermedi.

bug ux: Lion Sash equipaggiato su una creatura non può più attivare le sue abilità, né reconfigure né exile from graveyard. Questo accade anche con le aure (Chromatic armor per esempio).

Il bot cerca di tappare per mana un everflowing chalice senza counters e continua a fallire nel castare una spell, rinunciando.

Earthbend: manca la parte di abilità che ritorna le terre animate in gioco quando muoiono. Non è scritto nell'oracle text della card-preview e non avviene nel gameplay.

manca il token golem di sandtorm salvager e lo spirit di staff of the storyteller e la beast di garruk wildspeaker e human di torsten. verifica quali altri token mancano, importali e fai in modo che non vengano più create carte con token mancanti

staff of the storyteller non è stata implementata nella sua prima edizione ma in una ristampa. correggi, trova altri casi simili e fai in modo che non ricapiti.

Bug quando provo ad attivare l'abilità di Harvester of misery:
installHook.js:1 [CONVEX M(game:selectTarget)] [Request ID: 6efb7360d6a7c912] Server Error
Uncaught Error: Ability source not on battlefield
at finalizeTargetSelection (../convex/game.ts:4011:64)
at advanceTargetGroupOrFinalize (../convex/game.ts:3776:0)
at handler (../convex/game.ts:7608:12)

Le frecce di target di Arc mage sono sbagliate. Ho targettato una creature e un giocatore, vedo una freccia dalla creatura primo bersaglio al giocatore secondo bersaglio invece di 2 frecce che partono da arc mage e vanno verso la creatura e il giocatore

Non si vedono da nessuna parte gli emblemi (Sorin, per esempio, anche se il +1/+0 viene applicato alle creature)

Le creature distrutte dall'ultimate di Sorin, Lord of Innistrad non tornano sul battlefield, rimangono nel cimitero.

Il may cast di Malcolm è solo nel momento della risoluzione dell'abilità, non nel resto del turno. verifica sul CR./

Nuova UI:
lo stack non mostra le frecce che attraversano il board tra carta/abilità in stack e bersagli. il badge con scritto il bersaglio non è assolutamente utile.

Non c'è modo di vedere Printed Card nel card-preview

Dialog sideboard fa flicker quando la card-preview ha un testo molto lungo, deve avere altezza generalmente maggiore ma anche adattabile con overflow scroll verticale

Errore in submission sideboard:
installHook.js:1 [CONVEX M(game:setReady)] [Request ID: c09934f547015c14] Server Error
Uncaught Error: Failed to insert or update a document in table "games" because it does not match the schema: Object contains extra field `sideboard` that is not in the validator.
Path: .players[0].deck
Object: {cards: [{cardId: "2d7643c0-b2db-478f-944e-b27b77bad3eb", cardName: "Stifle"}, {cardId: "2d7643c0-b2db-478f-944e-b27b77bad3eb", cardName: "Stifle"}, {cardId: "2d7643c0-b2db-478f-944e-b27b77bad3eb", cardName: "Stifle"}, {cardId: "2d7643c0-b2db-478f-944e-b27b77bad3eb", cardName: "Stifle"}, {cardId: "e040be83-3fb5-4da5-ba7a-4923b8854b74", cardName: "Portent"}, {cardId: "e040be83-3fb5-4da5-ba7a-4923b8854b74", cardName: "Portent"}, {cardId: "e040be83-3fb5-4da5-ba7a-4923b8854b74", cardName: "Portent"}, {cardId: "e040be83-3fb5-4da5-ba7a-4923b8854b74", cardName: "Portent"}, {cardId: "6e5e3819-3d75-40d4-9a93-1147834dfd69", cardName: "Island"}, {cardId: "6e5e3819-3d75-40d4-9a93-1147834dfd69", cardName: "Island"}, {cardId: "6e5e3819-3d75-40d4-9a93-1147834dfd69", cardName: "Island"}, {cardId: "6e5e3819-3d75-40d4-9a93-1147834dfd69", cardName: "Island"}, {cardId: "6e5e3819-3d75-40d4-9a93-1147834dfd69", cardName: "Island"}, {cardId: "6e5e3819-3d75-40d4-9a93-1147834dfd69", cardName: "Island"}, {cardId: "6e5e3819-3d75-40d4-9a93-1147834dfd69", cardName: "Island"}, {cardId: "6e5e3819-3d75-40d4-9a93-1147834dfd69", cardName: "Island"}, {cardId: "6e5e3819-3d75-40d4-9a93-1147834dfd69", cardName: "Island"}, {cardId: "6e5e3819-3d75-40d4-9a93-1147834dfd69", cardName: "Island"}, {cardId: "6e5e3819-3d75-40d4-9a93-1147834dfd69", cardName: "Island"}, {cardId: "6e5e3819-3d75-40d4-9a93-1147834dfd69", cardName: "Island"}, {cardId: "6e5e3819-3d75-40d4-9a93-1147834dfd69", cardName: "Island"}, {cardId: "6e5e3819-3d75-40d4-9a93-1147834dfd69", cardName: "Island"}, {cardId: "6e5e3819-3d75-40d4-9a93-1147834dfd69", cardName: "Island"}, {cardId: "6e5e3819-3d75-40d4-9a93-1147834dfd69", cardName: "Island"}, {cardId: "6e5e3819-3d75-40d4-9a93-1147834dfd69", cardName: "Island"}, {cardId: "6e5e3819-3d75-40d4-9a93-1147834dfd69", cardName: "Island"}, {cardId: "7b8197b9-0cd1-4fa1-9668-d1b5f1759151", cardName: "Phyrexian Dreadnought"}, {cardId: "7b8197b9-0cd1-4fa1-9668-d1b5f1759151", cardName: "Phyrexian Dreadnought"}, {cardId: "7b8197b9-0cd1-4fa1-9668-d1b5f1759151", cardName: "Phyrexian Dreadnought"}, {cardId: "7b8197b9-0cd1-4fa1-9668-d1b5f1759151", cardName: "Phyrexian Dreadnought"}, {cardId: "30f6b4a2-5780-46e9-b239-459d2cf37743", cardName: "Chain of Vapor"}, {cardId: "30f6b4a2-5780-46e9-b239-459d2cf37743", cardName: "Chain of Vapor"}, {cardId: "e755bbef-bf34-49c0-ae72-d70e3599de52", cardName: "Gush"}, {cardId: "e755bbef-bf34-49c0-ae72-d70e3599de52", cardName: "Gush"}, {cardId: "e755bbef-bf34-49c0-ae72-d70e3599de52", cardName: "Gush"}, {cardId: "c12a0717-e9ea-4be3-a29f-179671ed4489", cardName: "Thwart"}, {cardId: "78b384d3-3adf-493a-8b89-bfe68fd1c3e2", cardName: "Vision Charm"}, {cardId: "78b384d3-3adf-493a-8b89-bfe68fd1c3e2", cardName: "Vision Charm"}, {cardId: "78b384d3-3adf-493a-8b89-bfe68fd1c3e2", cardName: "Vision Charm"}, {cardId: "78b384d3-3adf-493a-8b89-bfe68fd1c3e2", cardName: "Vision Charm"}, {cardId: "9d710a97-062f-4773-b6c6-8aeddeb3b6e8", cardName: "Impulse"}, {cardId: "9d710a97-062f-4773-b6c6-8aeddeb3b6e8", cardName: "Impulse"}, {cardId: "9d710a97-062f-4773-b6c6-8aeddeb3b6e8", cardName: "Impulse"}, {cardId: "ab061406-38f4-40e7-a9ea-e3cbcaabc127", cardName: "Accumulated Knowledge"}, {cardId: "ab061406-38f4-40e7-a9ea-e3cbcaabc127", cardName: "Accumulated Knowledge"}, {cardId: "ab061406-38f4-40e7-a9ea-e3cbcaabc127", cardName: "Accumulated Knowledge"}, {cardId: "ab061406-38f4-40e7-a9ea-e3cbcaabc127", cardName: "Accumulated Knowledge"}, {cardId: "958262ec-8e52-40cf-a9fd-a60e42643e15", cardName: "Opt"}, {cardId: "958262ec-8e52-40cf-a9fd-a60e42643e15", cardName: "Opt"}, {cardId: "958262ec-8e52-40cf-a9fd-a60e42643e15", cardName: "Opt"}, {cardId: "e8493631-6c9c-40a8-b7de-ecf26ba6bf7d", cardName: "Counterspell"}, {cardId: "e8493631-6c9c-40a8-b7de-ecf26ba6bf7d", cardName: "Counterspell"}, {cardId: "e8493631-6c9c-40a8-b7de-ecf26ba6bf7d", cardName: "Counterspell"}, {cardId: "e8493631-6c9c-40a8-b7de-ecf26ba6bf7d", cardName: "Counterspell"}, {cardId: "ffaab905-0b97-42c2-a1a3-1e72275caa82", cardName: "Flash of Insight"}, {cardId: "ffaab905-0b97-42c2-a1a3-1e72275caa82", cardName: "Flash of Insight"}, {cardId: "870fb793-3107-4cb2-ba78-34fbf5c9da2f", cardName: "Foil"}, {cardId: "870fb793-3107-4cb2-ba78-34fbf5c9da2f", cardName: "Foil"}, {cardId: "870fb793-3107-4cb2-ba78-34fbf5c9da2f", cardName: "Foil"}, {cardId: "870fb793-3107-4cb2-ba78-34fbf5c9da2f", cardName: "Foil"}], format: "premodern", id: "deck-1", name: "Stiflenought", sideboard: [{cardId: "13ebb5dd-d7f1-4b06-8585-7004045be542", cardName: "Essence Flare"}, {cardId: "13ebb5dd-d7f1-4b06-8585-7004045be542", cardName: "Essence Flare"}, {cardId: "f62716f0-fde2-49ef-b8a4-c1b03f451194", cardName: "Hydroblast"}, {cardId: "f62716f0-fde2-49ef-b8a4-c1b03f451194", cardName: "Hydroblast"}, {cardId: "f62716f0-fde2-49ef-b8a4-c1b03f451194", cardName: "Hydroblast"}, {cardId: "63b2dcb1-8c3e-434c-865a-196d4d799706", cardName: "Dominate"}, {cardId: "63b2dcb1-8c3e-434c-865a-196d4d799706", cardName: "Dominate"}, {cardId: "3f8c73ff-be92-41ca-93a7-76f9823adb38", cardName: "Annul"}, {cardId: "3f8c73ff-be92-41ca-93a7-76f9823adb38", cardName: "Annul"}, {cardId: "3f8c73ff-be92-41ca-93a7-76f9823adb38", cardName: "Annul"}, {cardId: "0dee69f8-cceb-41b9-a0ee-6b2ac9f4bad9", cardName: "Tsabo's Web"}, {cardId: "0dee69f8-cceb-41b9-a0ee-6b2ac9f4bad9", cardName: "Tsabo's Web"}, {cardId: "4d9715c2-9036-4ae2-a5b4-1b190d50c963", cardName: "Powder Keg"}, {cardId: "68b7444c-fabb-4437-8db9-a1008ea09415", cardName: "Hibernation"}]}
Validator: v.object({cards: v.array(v.object({cardId: v.string(), cardName: v.string()})), format: v.string(), id: v.string(), name: v.string()})
at async buildNextGameForMatch (../convex/game.ts:3072:66)
at async handler (../convex/game.ts:3214:12)

﻿
