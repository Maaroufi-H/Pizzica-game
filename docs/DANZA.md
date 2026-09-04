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
