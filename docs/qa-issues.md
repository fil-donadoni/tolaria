# Carte cubo da creare

# Bug carte

## Carte rotte

- Addle mi permetted di scegliere il colore quando le carte avversarie sono già rivelate. devo prima scegliere il colore alla cieca e poi posso vedere le carte, come da oracle text.

## UX da migliorare

- il dialog dello stack non è collassabile
- Con lo scenario da stress test la performance è molto degradata. verifichiamo se è lato client o server
- I token creati come copia di una carta non sono indicati come tali, è importante saperlo in termini di gameplay (per esempio un bounce su un token è molto più efficace di uno su una creatura reale)
- Quando un permanente viene controllato da un giocatore non owner, non stiamo più mostrando l'owner nella card preview, cosa che prima giustamente facevamo.
- Il dialog del castinc cost modified non converte ancora {2} nell'immagine del simbolo di mana numerico, con l'abilità di Ghitu Fire

# Bug gameplay

- Vesuvan Doppleganger che copia una creatura con volare mentre c'è sul board Gravity Sphere dovrebbe avere flying barrato, quindi non attivo.
- Dwarven Song e Sylvan Paradise devono terminare il loro effetto a fine turno, anche se uno si è sovrapposto all'altro

# Bug bot

- Iron-Shield Elf scarta una carta per renderlo indistruttibile dopo aver saputo che NON veniva bloccato. rimane un'azione inutile e dannosa
- Sylvan Safekeeper continua a sacrificare terre per dare shroud alle creature senza un pericolo noto. perdita secca.
- Attiva correttamente Zuran Orb con Titania ma lo fa in main phase, invece di aspettare la end dell'avversario che è il momento più propizio

# Note su Draft Arena

# Mobile

## Bug

## UI/UX
