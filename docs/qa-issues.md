# Carte cubo da creare

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
Skullclamp
Nadu
Lightning Greaves
Springheart Nantuko
Mox Opal
Teferino
Teferone
Fallen Shinobi
Lutri
Grist
Necromancy
Fable of the mirror-breaker
Ramunap Excavator
Crucible of Worlds

# Bug carte

## Carte rotte

- Enduring renewal non mostra l'intero oracle text in card-preview, e anche Icetill Explorer. Cerca altri casi simili e risolvi alla radice.
- La seconda abilità di currency converter non mi mostra le carte esiliate con lei all'interno del dialog di scelta, non posso selezionare niente.
- Earthbend: manca la parte di abilità che ritorna le terre animate in gioco quando muoiono. Non è scritto nell'oracle text della card-preview e non avviene nel gameplay.
- Le creature distrutte dall'ultimate di Sorin, Lord of Innistrad non tornano sul battlefield, rimangono nel cimitero.
- Il may cast di Malcolm è solo nel momento della risoluzione dell'abilità, non nel resto del turno. verifica sul CR./

## UX da migliorare

- Le frecce di target di Arc mage sono sbagliate. Ho targettato una creature e un giocatore, vedo una freccia dalla creatura primo bersaglio al giocatore secondo bersaglio invece di 2 frecce che partono da arc mage e vanno verso la creatura e il giocatore
- staff of the storyteller non è stata implementata nella sua prima edizione ma in una ristampa. correggi, trova altri casi simili e fai in modo che non ricapiti.
- chrome mox: il counter I\* non è chiaro come interfaccia, e la carta imprintata deve essere attaccata a lui, stile banishing light. questo vale per tutte le carte con imprint.
- La zona companion mostra la carta croppata, non ha il formato e le dimensioni corrette. deve essere uguale all'emblema, come formato e dimensioni.
- quando scegli carte da una pile e c'è un filtro attivo, come in Inquisition of Kozilek, stai correttamente mettendo il ring intorno alle valide. mettile anche tutte in prima posizione, come fatto per la ricerca nel grimorio con filtro (es. fetchlands)
- se cerco nel grimorio con filtro e non ci sono risultati validi, devo comunque vedere il grimorio con tutte le carte disattivate e poi mischiare.
- il peek con click to dismiss deve accettare anche il tasto space per fare dismiss e comunque deve avere un timer che dopo 5 secondi chiude il dialog
- Goblin artisans: abbiamo perso l'animazione del coin toss che prima c'era.
- le abilità loyalty di un planeswalker non devono comparire nel context menu se siamo in una fase non sorcery speed, a meno di abilità che le abilitano a questa velocità.

# Bug gameplay

- nello scheam database c'è game_states, unica tabella snake_case. mettila in camelCase come le altre

# Nuova UI

- lo stack non mostra le frecce che attraversano il board tra carta/abilità in stack e bersagli. il badge con scritto il bersaglio non è assolutamente utile.
- Non c'è modo di vedere Printed Card nel card-preview. e fai card-preview un po' piu' piccola su desktop
- Dialog sideboard fa flicker quando la card-preview ha un testo molto lungo, deve avere altezza generalmente maggiore ma anche adattabile con overflow scroll verticale
- i loyalty counters dei planeswalker devono stare sopra l'svg planeswalker, a forma di scudo loyalty
- la schermata di game over ha delle scrollbar che compaiono a tratti, molto strano. e manca il pulsante back to lobby
- le carte in esilio e graveyard non hanno le animazioni di quelle sul battlefield e nella mano. uniforma l'interazione, anche a quelle nelle pile dei dialog
- lo stack spesso si sovrappone ai dialog di posizionamento carte o altri dialog centrati. bisogna metterlo piu' a destra
- il box informativo della dichiarazione attaccanti è sempre sovrapposto alle creature da selezionare per l'attacco. va messo in alto a destra
- il selettore di fasi e' finito a sovrapporsi parzialmente con exile library e graveyard, che hanno dello spazio inutile sotto. abbassa questo blocco per evitare overflow

# Bug bot

- casta wild growth su terra avversaria
- cerca di tappare per mana un everflowing chalice senza counters e continua a fallire nel castare una spell, rinunciando.
