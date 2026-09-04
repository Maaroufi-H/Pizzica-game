# La danza — note tecniche (V2 → V17)

Questo documento raccoglie **tutti** gli interventi sulla danza dei due personaggi,
dal posizionamento geometrico al rendering degli sprite, fino alla pipeline di motion capture.

## 1. Geometria del riquadro (dove stanno i piedi)

* **V2** — `Couple.computeGeometry()`: i raggi non sono più in px fissi ma in frazione di
  `min(w, h)` del riquadro (`radiusFar = 0.26·s`, `radiusClose = 0.115·s`, `dancerSize = 0.22·s`);
  `remeasure()` ricalcola su resize/rotazione dello schermo.
* **V3** — ancoraggio **per i piedi**: `.dancer-wrapper { top: -size; transform-origin: 50% 100%; }`.
  La catena di trasformazioni (invariata dall'originale) è `rotate(θ) translateY(r) rotate(-θ)` sul
  wrapper, dentro `.couple-wheel` che ruota di `wheelAngle`. Con l'origine in basso-centro il punto
  d'appoggio (scarpe) percorre esattamente il cerchio di raggio `r`.
* **V3** — la guida è un **SVG generato** (`updateGuide()`): cerchio esterno `r = radiusFar`,
  cerchio interno `r = radiusClose`, assi lunghi `2·radiusFar`. Il raggio della guida è quindi
  sempre identico all'orbita dei piedi.
* **V8** — raggio adattivo: `radiusFar = max(0.12·s, min(0.325·s, h/2 − d − 3, w/2 − d/2 − 3))`
  (poi 0.345 in V11): il danzatore in alto (corpo che sale di `d` sopra i piedi) e ai lati non esce mai
  dal riquadro.

## 2. Stati della sequenza e come si muovono

| Stato | Movimento | Animazione del corpo |
|---|---|---|
| C | fermo sul cerchio esterno | **piroetta magica** (`magic-spinning`, un solo giro lento su tutta la durata, stelle) |
| E / F | traslazione radiale (avvicinamento / ritorno) | passo (`translating`), **nessuna rotazione** |
| A / B | mezzo cerchio orario / antiorario | `rotating` = un giro su se stessi calato sulla durata (`--spin-dur`), scia di stelle (`startTrail`) |
| G | incrocio al centro | piroette alternate (`cross-spinning` + `dance-step`), stelle |
| K / L | **quarto di giro** orario / antiorario (V18, `QUARTER_DURATION = 1700 ms`) | come A/B: giro su se stessi + scia; dopo un quarto i danzatori sono sulla linea **orizzontale**, quindi E/F avvengono in orizzontale |

* **V6** — regola: *sul cerchio girano sempre su se stessi, sulle linee no*.
* **V11** — `CIRCLE_DURATION = 2700 ms`; al cambio di senso (A↔B, K↔L, A↔L…, tramite `spinDir()`) **pivot di transizione** di 700 ms
  (`turn-settle`, rotazione standard senza stelle, non è uno stato: `sequenceDurationMs()` lo conta
  ma il giocatore non lo conteggia).
* **V12** — le rotazioni su se stessi non usano più `rotateY` (lo sprite piatto sparisce a 90°) ma uno
  *squeeze* `scaleX` con minimo 0.36 (`dancerFlip`, `magicSpin`, `crossSpin`); le transizioni di roue e
  wrapper usano `cubic-bezier(0.42,0.05,0.58,0.95)` per arresti morbidi.

## 3. Gli sprite (come sono disegnati)

Convenzioni comuni a tutti gli sprite (`scratchpad/normalize_frames.py` / `build_man_sprite.py`):
canvas quadrato 160×160 trasparente, contenuto normalizzato a **156 px di altezza** (bbox unione di
tutte le immagini, soglia alpha > 8), **piedi al bordo inferiore**, WebP animato `libwebp_anim` q≈62,
25 img/s, loop infinito.

### Ballerina
* **V4** — emoji Fluent 3D, normalizzata (`w1/w2`).
* **V7** — emoji **Noto animata 💃** (`emoji_u1f483`, dotLottie fornito dall'owner): resa image per image con
  `lottie-web` in Chromium headless (Playwright, `goToAndStop`), 40 immagini, poi normalizzata → `w3.webp`.

### Ballerino — rig procedurali (V9 → V15)
Disegnati con PIL a 3× e ridotti (`draw_man*.py`): arti come linee spesse con contorno, testa,
camicia/gilet/fascia. Evoluzione dei difetti segnalati:
* **V9** — passi con piedi fissi (baseline costante 402 px); braccia a pendolo.
* **V11** — braccia spalla+gomito pilotate da sinusoidi **sfasate** (il gomito segue in ritardo):
  eliminato lo scatto `up = sin>0` che dava l'effetto "robotico".
* **V13** — vero gioco di gambe: ginocchio avanti, piede ripiegato, gamba d'appoggio che spinge, +10 %.
* **V14** — imitazione della ballerina (analisi numerica delle sue 40 immagini: larghezza gambe stabile
  ≈100 px, corpo che oscilla lateralmente): sway ampio, un braccio alzato / uno teso (IK a 2 segmenti,
  legge dei coseni), passi laterali, **scarpe sempre orizzontali verso l'esterno**.
* **V15** — archi continui delle mani, colpo di polso, **mani vere** (palmo, 4 dita, pollice), anche a otto.

Verdetto dell'owner: nessun rig procedurale è "umano". Da qui il cambio di metodo.

### Ballerino — motion capture (V16)
`scratchpad/bvh_dancer.py`, dati **CMU Graphics Lab Motion Capture Database** in formato BVH
(mirror GitHub `una-dinosauria/cmu-mocap`, 120 img/s, skeleton `Hips … LeftHand/RightHand … LeftFoot/RightFoot`).

1. **Parse BVH** — gerarchia (`ROOT/JOINT/End Site`, `OFFSET`, `CHANNELS`) + blocco `MOTION`.
2. **Cinematica diretta** — per ogni giunto `p = p_parent + R_parent·(offset + t)`, `R = R_parent·R_local`,
   con `R_local = Π R_axis(angle)` nell'ordine dei canali.
3. **Vista frontale stabile** — per ogni immagine l'asse laterale del bacino (`RightUpLeg − LeftUpLeg`,
   proiettato sul piano XZ) viene ruotato attorno a Y per allinearlo a X: il danzatore è sempre visto di
   fronte anche quando gira su se stesso; le posizioni sono relative a `Hips`.
4. **Ricerca del loop** — su una finestra di `L = 1.6 s·fps` immagini si minimizza
   `‖pose_i − pose_j‖ + 2·‖vel_i − vel_j‖` diviso per l'energia media del movimento (loop pulito **e**
   ricco). Il segmento scelto viene ricampionato a 40 immagini con interpolazione lineare.
5. **Rendering** — scala: altezza mediana piedi→testa del segmento ×1.12 = 100 unità; i piedi sono
   normalizzati al suolo (`min(LeftFoot.y, RightFoot.y)` = ground) per garantire il contatto con il
   cerchio; ordine di disegno per profondità (`z` di gambe/braccia, corpo al centro); camicia/gilet/fascia
   costruiti dalle spalle e dalle anche reali; mani orientate lungo l'avambraccio; scarpe orizzontali
   verso l'esterno (lato dedotto dall'ordine delle spalle a schermo).

Sequenze provate: 55_01 *dance, whirl* (scelta, `m9`), 60_01/61_02 *salsa*, 93_05 *charleston*,
05_12 *arms held high*, 90_30 *russian dance*, 49_02, 05_10.

## 4. Coreografie variabili (V17)

Obiettivo: il giocatore non deve vedere sempre la stessa danza. Base preservata, variazioni da mocap.

* `CHOREO` in `game.js`: per ogni ruolo una lista di **varianti** (sprite WebP), e per ogni fascia di
  livello un **piano**: la danza propria della fascia, intercalata da riprese delle danze delle fasce
  precedenti per 5–10 s. Il piano è una lista di segmenti `(variante, durata)` generata in modo
  deterministico dal livello.
* Un **orologio globale** (`choreoStart`) parte ad ogni fase di gioco; ogni 250 ms ogni `Couple`
  calcola la variante corrente `variantAt(role, level, elapsed)` e, se cambia, sostituisce `img.src`.
  Tutti i riquadri leggono lo stesso orologio: la coreografia è **identica** ovunque e non può
  tradire il riquadro corretto.
* Ballerina: variante 0 = emoji Noto (base preservata), varianti 1–3 = danze mocap (*whirl* 55_01 —
  le stesse rotazioni su se stessa del ballerino —, *salsa* 61_02, *charleston* 93_04) rese con la
  stessa pipeline ma con il **modello femminile** (abito rosso svasato, capelli lunghi, tacchi, fiore).
* Ballerino: variante 0 = *whirl*, 1 = *salsa* 61_02, 2 = *charleston*, 3 = *salsa* 60_01.
* **V18** — piani per fascia `CHOREO.tiers`: Principiante `[base, variazione]`, Intermedio `[propria, base, …]`,
  Avanzato `[propria, tutte le precedenti]`; danza propria 5–8 s, riprese 4–6,5 s: la danza cambia **a ogni livello**.

## 5. Matrice stato → movimento (V19)

La coreografia a tempo (V17/V18) è sostituita da una **matrice**: `DANCE_MAP[role][key]` con
`key ∈ {REST, E_V, F_V, E_H, F_H, A, B, K, L, G, PIVOT, IDLE}`. `Couple.danceKeyFor(state)` deduce la
chiave dallo stato e dall'orientamento della roue (`wheelAngle mod 180 == 90` → linea orizzontale);
`applyDance(key)` cambia lo sprite (`img.src`) all'inizio di ogni stato (il pivot ha il suo mouvement).
La matrice è caricata da `/dance-config.json` (radice del sito, `no-store`) e amministrata da `admin.html`
(token → `POST /api/dance-config`, validazione delle chiavi/valori lato server). Movimenti disponibili:
lui `m9` whirl, `m10` salsa 61_02, `m11` charleston, `m12` salsa 60_01; lei `w4` whirl, `w5` salsa,
`w6` charleston (tutti da vera motion capture, stesso modello disegnato).

## 6. La pizzica (V20) — che cos'è, come si muove, come l'abbiamo costruita

**Cosa dicono le fonti** (tradizione salentina, «pizzica pizzica» / ronda):
* **Piedi**: passo base *saltellato* sul tempo del tamburello (2/4 veloce, 120–140 bpm): il peso passa da un
  piede all'altro con piccoli **saltelli** e battute di punta/tallone, piedi vicini al suolo, ginocchia elastiche;
  frequenti **giri su se stessi** e cambi di fronte.
* **Braccia**: **aperte e alte**, spesso sopra la spalla, polsi che ruotano; l'uomo tiene le braccia larghe (a volte
  batte le mani o le porta ai fianchi), la donna tiene e fa ondeggiare il **fazzoletto** con una mano,
  con l'altra solleva o accompagna la gonna.
* **Coppia**: non si tocca mai; si avvicina e si allontana (il *corteggiamento*), gira attorno all'altro nella
  *ronda* formata dal pubblico che batte le mani — esattamente la struttura del gioco (cerchio, avvicinamenti,
  incroci, pubblico che applaude).

**Come l'abbiamo realizzata restando su movimenti umani reali**: la base CMU non contiene pizzica. Abbiamo quindi
**composto** due catture reali (`bvh_dancer.py --upper`): il **bacino e le gambe** vengono da 49_02
(*jump up and down, hop on one foot* — i saltelli), il **busto e le braccia** da 55_01 (*dance, whirl* — braccia
alte e giri su se stessi), riscalate all'altezza del clip delle gambe; la testa segue il rimbalzo del bacino.
Per la ballerina si aggiunge il **fazzoletto** bianco nella mano più alta (`--hanky`). Sprite: `m13` / `w7`.
Il tempo del loop resta 1,6 s (≈ 2 saltelli per ciclo).

**Salsa b rallentata e senza giri (V20)**: la boucle scelta in origine dentro 61_02 conteneva **un giro e mezzo reale**
del ballerino (564° di rotazione del bacino in 1,6 s); raddrizzato fronte camera, sembrava «un matto che gira a velocità
folle». `find_loop` accetta ora l'opzione `--maxyaw 50`: le finestre in cui il bacino ruota più di 50° sono escluse, e tra
le altre si tiene una boucle energica (≥ 55 % dell'energia massima) che si richiude bene. La boucle scelta (frame 312,
49° di rotazione) è ricampionata su 80 immagini a 25 img/s (`--nout 80`), cioè ×0,5 della velocità reale.
Stesso filtro per la salsa d (60_01): la vecchia boucle conteneva mezzo giro (165°), la nuova 18°.

**Foulard della pizzica (V20)**: un **foulard lungo** (58 % dell'altezza), bianco con bordo rosso, tenuto nella mano più
alta per tutta la boucle. Non è disegnato con una formula ma **simulato fisicamente** (`simulate_scarf`, motore a corda di
Verlet come nei giochi): 20 punti legati da vincoli di lunghezza, il primo inchiodato alla mano (posizione reale della mano
nella capture, compresa l'altezza del bacino durante i saltelli); gravità ridotta (seta), attrito dell'aria anisotropo (il
nastro resiste allo spostamento perpendicolare e quindi **fila nella scia della mano**), leggera rigidità di flessione e
vincoli anti-forcina (non si ripiega in pallina), un flottement periodico. La simulazione gira per 6 boucle e si tiene
l'ultima; gli ultimi 40 % vengono fusi con la boucle precedente per un loop senza cucitura. Lo sprite è normalizzato sul
**corpo solo** (bbox senza foulard) per restare alto quanto gli altri.

**Charleston c (V20)**: stesso filtro `--maxyaw 50` e velocità ×0,6 (`--nout 64`).

**Transizione fluida fra le danze (V20)**: ogni cambio di sprite in `Couple.applyDance` è un **fondu enchaîné** di
`CONFIG.DANCE_FADE` = 700 ms: l'immagine del movimento precedente resta come *fantasma* (`img.dancer-ghost`, stesse
animazioni CSS e stessa fase perché le classi di animazione sono appena state azzerate) e la sua opacità scende a 0
mentre quella del nuovo movimento sale da 0 a 1. Il fantasma è poi rimosso. Identico nelle quattro tessere.

**Cache**: gli sprite hanno `Cache-Control: max-age=86400`; quando un movimento cambia, il file prende un **nuovo nome**
(`m10b.webp`…) altrimenti i browser mostrano per 24 h la vecchia animazione.

**Foulard in tutte le danze di lei (V20)**: il foulard simulato è ora presente in **ogni** movimento della ballerina
(`--hanky` su whirl 55_01 → `w4b`, salsa 61_02 → `w5c`, charleston 93_04 → `w6c`, pizzica → `w7c`): nel whirl fila in
lunghe arabesche dietro la mano alta, nella salsa e nel charleston pende e ondeggia. Stessa fisica, stessi parametri.

## 7. Motore di movimenti da video e sincronizzazione al tempo (V21)

**Perché**: la libreria CMU non contiene pizzica. I passi reali si trovano nei tutorial video. Il motore V21
(`video_dancer.py`) li trasforma in animazioni del gioco, senza toccare le danze precedenti.

**Pipeline**
1. *Video → posa 3D*: MediaPipe PoseLandmarker (modello *full*) su ogni immagine → 33 punti 3D (`pose_extract.py`).
   Sorgenti: «Pizzica Pizzica Step by step Training» (un solo ballerino, camera fissa, 4 min) e «Tutorial 8 passi
   fondamentali nella pizzica» (1 min). Il video di gruppo «10 passi» era troppo confuso (più persone, camera mobile).
2. *Posa → scheletro del gioco*: lissage Savitzky–Golay (0,17 s), stesse chiavi dei BVH (Hips, Neck, Head, braccia,
   gambe), orientamento fronte camera (`front_view`), scala all'altezza standard. I punti 3D di MediaPipe sono centrati
   sul bacino: il **salto** si ricostruisce dal movimento verticale del bacino nell'*immagine* (camera fissa), convertito
   in metri con la lunghezza del tronco.
3. *Ciclo di passo*: autocorrelazione dell'altezza relativa dei piedi → periodo del passo (1,20 s nel training video,
   1,40 s nel tutorial). Una boucle = 2 cicli (sinistra-destra × 2) = **4 battiti**.
4. *Selezione dei passi*: finestre senza rotazione del corpo (> 40° escluse), buona chiusura, energia sufficiente, e
   **distinte** fra loro per firma (altezza dei polsi, apertura e alzata dei piedi, ampiezza laterale, salto). Chiusura
   della boucle: gli ultimi 22 % scivolano verso il periodo precedente.
5. *Resa*: stessi renderer (`render`, `render_woman`), foulard simulato per lei (§6), normalizzazione sul corpo.

**Catalogo V21** (identificativo lui / lei, sorgente, istante):
| Passo | Lui | Lei | Sorgente | t |
|---|---|---|---|---|
| f — braccia al cielo | m14 | w8 | training | 131,5 s |
| g — passo laterale | m15 | w9 | training | 90,3 s |
| h — mani ai fianchi | m16 | w10 | training | 165,9 s |
| i — fianchi e piede alzato | m17 | w11 | training | 45,7 s |
| j — braccia alte, spostamento | m18 | w12 | tutorial 8 passi | 26,0 s |
| k — saltello puntato | m19 | w13 | tutorial 8 passi | 32,9 s |
| l — MEDLEY continuo | m20 | w14 | tutti | — |

**Tempo**: il tempo di ogni musica è misurato sul file (flusso spettrale + autocorrelazione, `bpm.py`):
Pizzicarella 95,7 bpm (primo battito a 0,255 s), Pizzica Tarantata 99,4 bpm (0,511 s), Pizzica Salento BTQ 95,7 bpm
(0,325 s dopo il taglio dei primi 7 s). Gli sprite «a tempo» esistono in due versioni, `<id>@96.webp` (62 immagini
a 25 img/s = 2,48 s ≈ 96,8 bpm) e `<id>@99.webp` (61 immagini = 2,44 s ≈ 98,4 bpm); `moveImg` sceglie in base alla
musica del livello (`TEMPO[audioId]`). Il **cambio di danza avviene sul battito**: `applyDance` attende il tempo
successivo della musica in corso (`beatDelayMs`, ≤ 0,7 s) prima di avviare il fondu, così il primo appoggio del nuovo
passo cade sul battito.

**Medley (l)**: i sei passi incatenati in un solo sprite continuo — ogni passo per 8 battiti, fondu di posa di 0,45 s ad
ogni giunzione (la boucle precedente continua e si fonde nella nuova), foulard simulato su tutta la sequenza, loop globale
(48 battiti ≈ 30 s, 750 / 727 immagini).

**Amministrazione (V21)**: ogni salvataggio richiede il token (401 altrimenti: nulla viene scritto) e va nello **storico**
`dance-history.json` (nome, data, matrice; `GET /api/dance-history`), da cui una vecchia matrice si riprende nell'editor e si
risalva. «Ricarica dal server» rilegge la matrice attiva; «Valori di base» rimette il whirl ovunque senza salvare.

## 8. Grammatica V22: una piroetta a ogni incrocio, nessun tempo morto

Regola: **dopo ogni movimento c'è una piroetta**, e la piroetta è uno stato contato. `VALID_TRANSITIONS`:
C → {E, A, B, K, L}; A, B, K, L → C; E → G → F → C. Al centro la piroetta è il croisement G (piroette alternate),
seguito dal ritorno obbligatorio. Il *pivot di transizione* (rotazione fuori sequenza al cambio di senso A↔B) non può
più verificarsi: fra due giri c'è sempre una C. `PAUSE_DURATION` = 1500 ms: **una sola rotazione** (era una doppia di
3 s), così la danza occupa più spazio. Nessun movimento che non sia uno stato della macchina è mostrato.

**Tutorial** (`TUTORIAL_PAGES`, `Game.openTutorial`): la sola ballerina (lui nascosto) esegue in loop la sequenza della
pagina — 1) C K C L C, 2) C A C B C, 3) C E G F C K C E G F C, 4) C C C — con testo esplicativo e frecce.
**Tre quarti di giro (M/N, V22)**: 270° in 4050 ms (stessa velocità angolare del mezzo giro), solo nei livelli Avanzato (4 tessere); ballano come A/B nella matrice; seguiti da C come ogni giro. Esempio tipico: mezzo giro avanti, piroetta, tre quarti indietro.
**Livelli**: durata strettamente crescente 8, 11, 14 (2 tessere), 17, 20, 23 (3), 26, 29, 32 s (4).

**Livelli (V22)**: 15 — Principiante I–V (2 tessere, 8→16 s), Intermedio I–III (3 tessere, 18→22 s), Avanzato I–V (4 tessere,
24→32 s), Virtuoso I–II (4 tessere, 35 e 38 s). Musiche a rotazione. Tre quarti di giro dai livelli a 4 tessere.

**Giocatori (V22)**: il nome (2–24 caratteri) identifica il giocatore; `POST /api/player/login` crea/ritrova la riga in
`pizzica_players` (Postgres Railway di marofai.site: `key`, `name`, `level` da riprendere, `best_level`, `games`) e
restituisce il livello da cui riprendere; ogni livello superato chiama `POST /api/player/progress` (livello successivo;
al 15° `completed` → si riparte dal livello 1, `games`+1). Senza rete il livello resta almeno in `localStorage`.
Sul VPS: `/etc/pizzica-game/db.env` (root:ttagent 640, le 5 variabili Postgres) caricato dal drop-in
`pizzica-game.service.d/db.conf`; il modulo `pg` è installato in `/opt/pizzica-game/app/node_modules` (`npm install`).

**Musiche (V22)**: 5 brani a rotazione sui 15 livelli (livello n → brano ((n−1) mod 5)+1): Pizzicarella 95,7 bpm,
Pizzica Tarantata 99,4, Pizzica Salento BTQ 95,7, Tarantula Garganica «Rodianella di Carpino» 129,2 (primo battito 0,209 s),
«Alla rodianella» 143,6 (0,302 s). Gli sprite a tempo esistono quindi in quattro versioni: `@96`, `@99`, `@129`, `@144`
(4 battiti = 62 / 61 / 46 / 42 immagini). Menu e tutorial hanno la **musica di accoglienza** (Officina Zoè, «Santu Paulu II»),
avviata al primo gesto dell'utente e fermata da `playLevelMusic` all'inizio del livello.

**Amministrazione giocatori (V22)**: `GET /api/players` (token) → nome, livello da riprendere, record, percorsi completi,
prima/ultima partita; sezione «Giocatori e progresso» in `admin.html` (dentro «Amministrazione giochi» su marofai.site).
