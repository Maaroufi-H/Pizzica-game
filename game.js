/**
 * PIZZICA MASTER V6 PRO - Game Engine
 *
 * V6 PRO - VERSION RISQUEE avec danseurs dynamiques:
 * - Animations de bras et jambes plus fluides
 * - Mouvements de balancement rythmique
 * - Effets de pulsation au rythme de la musique
 * - Rotations plus expressives des danseurs
 */

// ============================================
// CONFIGURATION
// ============================================
const CONFIG = {
    // V6 PRO: Rayons ajustés pour suivre exactement les lignes du cercle guide
    RADIUS_FAR: 50,      // Cercle extérieur
    RADIUS_CLOSE: 25,    // Cercle intérieur
    // V6 PRO: Taille augmentee de 15% (40 * 1.15 = 46)
    DANCER_SIZE: 46,
    MOVE_DURATION: 2250,
    // V10: la rotation magique est TRES LENTE et fait UN SEUL tour complet
    // pendant toute la duree de l'etat — le joueur compte 1 unite, sans
    // ambiguite (avant: pirouette 1s en boucle infinie, impossible a compter)
    PAUSE_DURATION: 3000,
    // V8: croisement au centre - jamais figes.
    // Pirouette alternee (un danseur a la fois) et rotation croisee a deux,
    // legerement ralenties pour laisser le temps au joueur de les lire.
    CROSS_SPIN_DURATION: 1400,
    CROSS_ROTATE_DURATION: 3000,
    MAX_CROSS_MOVES: 2,
    // V10: le nombre de carreaux depend du livello (2/3/4) — voir LEVELS
    TILE_COUNT: 4,
    MAX_LEVEL: 9
};

// ============================================
// V10: NIVEAUX PAR PALIERS (tiles = nb de carreaux)
// - Principiante: 3 sotto-livelli, SEMPRE 2 carreaux, duree 10 -> 15 -> 20s
//   (la duree qui augmente = plus de combinaisons a memoriser)
// - Intermedio:   3 sotto-livelli, 3 carreaux, meme echelle de durees
// - Avanzato:     3 sotto-livelli, 4 carreaux, meme echelle de durees
// ============================================
const LEVELS = {
    1: { duration: 10, tiles: 2, name: 'Principiante I',   music: 'Pizzicarella',                     audioId: 'audio-level-1' },
    2: { duration: 15, tiles: 2, name: 'Principiante II',  music: 'Beppe Junior - Pizzica Tarantata', audioId: 'audio-level-2' },
    3: { duration: 20, tiles: 2, name: 'Principiante III', music: 'Pizzica Salento BTQ',              audioId: 'audio-level-3' },
    4: { duration: 10, tiles: 3, name: 'Intermedio I',     music: 'Pizzicarella',                     audioId: 'audio-level-1' },
    5: { duration: 15, tiles: 3, name: 'Intermedio II',    music: 'Beppe Junior - Pizzica Tarantata', audioId: 'audio-level-2' },
    6: { duration: 20, tiles: 3, name: 'Intermedio III',   music: 'Pizzica Salento BTQ',              audioId: 'audio-level-3' },
    7: { duration: 10, tiles: 4, name: 'Avanzato I',       music: 'Pizzicarella',                     audioId: 'audio-level-1' },
    8: { duration: 15, tiles: 4, name: 'Avanzato II',      music: 'Beppe Junior - Pizzica Tarantata', audioId: 'audio-level-2' },
    9: { duration: 20, tiles: 4, name: 'Avanzato III',     music: 'Pizzica Salento BTQ',              audioId: 'audio-level-3' }
};

// V10: nombre de carreaux du niveau courant
function tilesForLevel(level) {
    return (LEVELS[level] && LEVELS[level].tiles) || CONFIG.TILE_COUNT;
}

// ============================================
// V9: PERSONNAGES SELECTIONNABLES (2 hommes, 2 femmes)
// Chaque personnage a sa propre danse (classe char-<id> sur le wrapper,
// animations dediees en CSS). Choix memorise en localStorage.
// ============================================
const CHARACTERS = {
    man: [
        { id: 'm1', img: 'm1.png', name: 'Ballerino classico' },
        { id: 'm2', img: 'm2.png', name: 'Elegante col cappello' }
    ],
    woman: [
        { id: 'w1', img: 'w1.png', name: 'Ballerina in rosso' },
        { id: 'w2', img: 'w2.png', name: 'Fata danzante' }
    ]
};

const selectedChars = { man: 'm1', woman: 'w1' };
try {
    const saved = JSON.parse(localStorage.getItem('pizzica-chars') || '{}');
    if (CHARACTERS.man.some(c => c.id === saved.man)) selectedChars.man = saved.man;
    if (CHARACTERS.woman.some(c => c.id === saved.woman)) selectedChars.woman = saved.woman;
} catch (e) { /* localStorage indisponible: defauts */ }

function getChar(role) {
    return CHARACTERS[role].find(c => c.id === selectedChars[role]) || CHARACTERS[role][0];
}

// ============================================
// DEFINITION DES ETATS
// ============================================
const STATE = {
    A: 'ROTATION_FORWARD',
    B: 'ROTATION_BACKWARD',
    C: 'HUB_FAR',
    D: 'POSITION_CLOSE',      // V8: obsolete (plus jamais figes au centre), garde pour compat
    E: 'TRANSLATE_FORWARD',
    F: 'TRANSLATE_BACKWARD',
    // V8: mouvements de CROISEMENT au centre (remplacent la pause D)
    G: 'CROSS_SPIN_ALTERNATE',   // pirouettes alternees: l'un tourne, l'autre attend, puis echange
    H: 'CROSS_ROTATE_BOTH',      // rotation croisee a deux autour du petit cercle, ralentie
    // V10: REGLE DU CROISEMENT - apres un croisement au centre, INTERDIT de
    // continuer sur la meme trajectoire. Les danseurs soit reculent (F),
    // soit sortent sur la ligne PERPENDICULAIRE, chacun dans un sens oppose
    // (ils sont diametralement opposes sur la roue, donc P/Q les envoient
    // automatiquement dans des sens opposes).
    P: 'EXIT_PERPENDICULAR_CW',  // sortie perpendiculaire, quart de tour horaire
    Q: 'EXIT_PERPENDICULAR_CCW'  // sortie perpendiculaire, quart de tour anti-horaire
};

// V8: etats de croisement (au centre, avec etoiles scintillantes)
function isCrossState(s) {
    return s === STATE.G || s === STATE.H;
}

// ============================================
// TRANSITIONS VALIDES
// V8: E mene toujours a un croisement (G/H), jamais a une pause figee.
// Apres 1 ou 2 croisements max (MAX_CROSS_MOVES), separation obligatoire (F)
// dans les sens opposes. F est en premiere position: c'est la sortie de secours
// des boucles de fermeture de sequence.
// ============================================
// V10: sorties de croisement = F (retour en arriere) OU P/Q (ligne
// perpendiculaire, sens opposes). Jamais tout droit sur la meme trajectoire.
const VALID_TRANSITIONS = {
    [STATE.C]: [STATE.E, STATE.A, STATE.B],
    [STATE.E]: [STATE.G, STATE.H],
    [STATE.G]: [STATE.F, STATE.P, STATE.Q, STATE.G, STATE.H],
    [STATE.H]: [STATE.F, STATE.P, STATE.Q, STATE.G, STATE.H],
    [STATE.D]: [STATE.F],
    [STATE.F]: [STATE.C],
    [STATE.P]: [STATE.C],
    [STATE.Q]: [STATE.C],
    [STATE.A]: [STATE.B, STATE.C],
    [STATE.B]: [STATE.A, STATE.C]
};

const STATE_DURATION = {
    [STATE.C]: CONFIG.PAUSE_DURATION,
    [STATE.D]: CONFIG.PAUSE_DURATION,
    [STATE.E]: CONFIG.MOVE_DURATION,
    [STATE.F]: CONFIG.MOVE_DURATION,
    [STATE.A]: CONFIG.MOVE_DURATION,
    [STATE.B]: CONFIG.MOVE_DURATION,
    [STATE.G]: CONFIG.CROSS_SPIN_DURATION * 2,
    [STATE.H]: CONFIG.CROSS_ROTATE_DURATION,
    [STATE.P]: CONFIG.MOVE_DURATION,
    [STATE.Q]: CONFIG.MOVE_DURATION
};

// V8: filtre les transitions pour ne jamais depasser MAX_CROSS_MOVES
// croisements consecutifs (la sequence doit alors se separer via F)
function allowedNextStates(sequence, currentState) {
    const valid = VALID_TRANSITIONS[currentState];
    if (!isCrossState(currentState)) return valid;
    let consecutive = 0;
    for (let i = sequence.length - 1; i >= 0 && isCrossState(sequence[i]); i--) {
        consecutive++;
    }
    if (consecutive >= CONFIG.MAX_CROSS_MOVES) {
        return valid.filter(s => !isCrossState(s));
    }
    return valid;
}

// ============================================
// GENERATEUR DE SEQUENCES
// ============================================
function generateRandomSequence(targetDurationMs) {
    let sequence = [STATE.C];
    let totalDuration = STATE_DURATION[STATE.C];
    let currentState = STATE.C;

    while (totalDuration < targetDurationMs) {
        const validNextStates = allowedNextStates(sequence, currentState);
        const nextState = validNextStates[Math.floor(Math.random() * validNextStates.length)];
        sequence.push(nextState);
        totalDuration += STATE_DURATION[nextState];
        currentState = nextState;
    }

    while (currentState !== STATE.C) {
        const validNextStates = allowedNextStates(sequence, currentState);
        if (validNextStates.includes(STATE.C)) {
            sequence.push(STATE.C);
            currentState = STATE.C;
        } else {
            const nextState = validNextStates[0];
            sequence.push(nextState);
            currentState = nextState;
        }
    }

    return sequence;
}

function generateSequenceForLevel(level) {
    const targetDuration = LEVELS[level].duration * 1000;
    return generateRandomSequence(targetDuration);
}

// ============================================
// CLASSE COUPLE
// ============================================
class Couple {
    constructor(container, id, isDemo = false, level = 1) {
        this.container = container;
        this.id = id;
        this.isDemo = isDemo;
        this.level = level; // V6 PRO: Pour flip effect niveau 3+

        // V8: timers internes (phases de croisement, emission d'etoiles)
        this.internalTimers = [];
        this.internalIntervals = [];

        // V7: geometrie PROPORTIONNELLE a la taille du carreau.
        // Les danseurs grandissent avec le carreau et restent toujours
        // englobes dedans.
        this.computeGeometry();

        this.currentState = STATE.C;
        this.wheelAngle = 0;
        this.radius = this.radiusFar;

        this.wheel = null;
        this.manWrapper = null;
        this.womanWrapper = null;

        this.createDOM();
        this.applyPosition(true);
    }

    computeGeometry() {
        const tileSize = Math.min(this.container.clientWidth, this.container.clientHeight) || 200;
        this.radiusFar = tileSize * 0.26;
        this.radiusClose = tileSize * 0.115;
        this.dancerSize = Math.round(tileSize * 0.22);
        this.container.style.setProperty('--dancer-size', this.dancerSize + 'px');
        this.updateGuide();
    }

    // V8: guide dessine par le jeu lui-meme — cercle exterieur au rayon EXACT
    // de l'orbite des pieds, petit cercle du croisement, axes vertical et
    // horizontal. Les chaussures des danseurs (ancrees bas-centre) sont donc
    // toujours en contact avec le cercle ou les lignes.
    updateGuide() {
        const w = this.container.clientWidth || 200;
        const h = this.container.clientHeight || 200;
        const cx = w / 2;
        const cy = h / 2;
        const R = this.radiusFar;
        const r = this.radiusClose;

        let svg = this.container.querySelector(':scope > svg.guide-svg');
        if (!svg) {
            const NS = 'http://www.w3.org/2000/svg';
            svg = document.createElementNS(NS, 'svg');
            svg.setAttribute('class', 'guide-svg');
            ['g-outer', 'g-inner'].forEach(cls => {
                const c = document.createElementNS(NS, 'circle');
                c.setAttribute('class', cls);
                svg.appendChild(c);
            });
            ['g-v', 'g-h'].forEach(cls => {
                const l = document.createElementNS(NS, 'line');
                l.setAttribute('class', cls);
                svg.appendChild(l);
            });
            this.container.insertBefore(svg, this.container.firstChild);
        }

        svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
        const set = (sel, attrs) => {
            const el = svg.querySelector(sel);
            for (const k in attrs) el.setAttribute(k, attrs[k]);
        };
        set('.g-outer', { cx, cy, r: R });
        set('.g-inner', { cx, cy, r });
        set('.g-v', { x1: cx, y1: cy - R, x2: cx, y2: cy + R });
        set('.g-h', { x1: cx - R, y1: cy, x2: cx + R, y2: cy });
    }

    // V7: re-mesurer apres resize/rotation d'ecran, sinon la geometrie
    // figee a la creation rogne les danseurs (les carreaux suivent le viewport)
    remeasure() {
        if (!this.wheel || !this.wheel.isConnected) return;
        this.computeGeometry();
        const closeStates = [STATE.D, STATE.E, STATE.G, STATE.H];
        this.radius = closeStates.includes(this.currentState)
            ? this.radiusClose : this.radiusFar;
        this.applyPosition(true);
    }

    createDOM() {
        this.wheel = document.createElement('div');
        this.wheel.className = 'couple-wheel';

        // V9: personnages selectionnes, chacun avec sa propre danse
        const manChar = getChar('man');
        const womanChar = getChar('woman');

        this.manWrapper = document.createElement('div');
        this.manWrapper.className = `dancer-wrapper man-wrapper char-${manChar.id}`;
        const manImg = document.createElement('img');
        manImg.src = manChar.img;
        manImg.className = 'dancer';
        manImg.alt = manChar.name;
        this.manWrapper.appendChild(manImg);

        this.womanWrapper = document.createElement('div');
        this.womanWrapper.className = `dancer-wrapper woman-wrapper char-${womanChar.id}`;
        const womanImg = document.createElement('img');
        womanImg.src = womanChar.img;
        womanImg.className = 'dancer';
        womanImg.alt = womanChar.name;
        this.womanWrapper.appendChild(womanImg);

        this.wheel.appendChild(this.manWrapper);
        this.wheel.appendChild(this.womanWrapper);
        this.container.appendChild(this.wheel);
    }

    applyPosition(instant = false, durationMs = CONFIG.MOVE_DURATION) {
        const duration = instant ? '0ms' : `${durationMs}ms`;

        this.wheel.style.transitionDuration = duration;
        this.wheel.style.transform = `rotate(${this.wheelAngle}deg)`;

        const counterRotation = -this.wheelAngle;

        this.manWrapper.style.transitionDuration = duration;
        this.womanWrapper.style.transitionDuration = duration;

        this.manWrapper.style.transform =
            `rotate(180deg) translateY(${this.radius}px) rotate(${counterRotation - 180}deg)`;
        this.womanWrapper.style.transform =
            `rotate(0deg) translateY(${this.radius}px) rotate(${counterRotation}deg)`;
    }

    transitionTo(newState) {
        const prevState = this.currentState;
        this.currentState = newState;

        let duration = CONFIG.MOVE_DURATION;

        // V6 PRO: Reset animation classes
        this.clearAnimationClasses();

        switch(newState) {
            case STATE.C:
                this.radius = this.radiusFar;
                // V10: la rotation magique dure TOUJOURS PAUSE_DURATION et
                // fait UN SEUL tour lent (voir setMagicSpin) — le joueur
                // compte sans ambiguite: 1 rotation = 1 unite de la matrice
                duration = CONFIG.PAUSE_DURATION;
                this.setMagicSpin(duration);
                this.startStars(this.manWrapper, duration, 2);
                this.startStars(this.womanWrapper, duration, 2);
                break;

            case STATE.D:
                this.radius = this.radiusClose;
                duration = CONFIG.PAUSE_DURATION;
                // V9: idem - rotation magique sur place (etat legacy)
                this.setMagicSpin(duration);
                this.startStars(this.manWrapper, duration, 2);
                this.startStars(this.womanWrapper, duration, 2);
                break;

            case STATE.E:
                this.radius = this.radiusClose;
                // V6 PRO: Animation translation - pas de danse
                this.setAnimationClass('translating');
                break;

            case STATE.F:
                this.radius = this.radiusFar;
                // V6 PRO: Animation translation - pas de danse
                this.setAnimationClass('translating');
                break;

            case STATE.A:
                this.wheelAngle += 180;
                // V6 PRO: Animation rotation - mouvement expressif
                this.setAnimationClass('rotating');
                break;

            case STATE.B:
                this.wheelAngle -= 180;
                // V6 PRO: Animation rotation - mouvement expressif
                this.setAnimationClass('rotating');
                break;

            // V8: CROISEMENT - pirouettes alternees. L'homme tourne sur lui-meme
            // (etoiles), la femme attend, puis echange. Personne n'est fige.
            case STATE.G: {
                this.radius = this.radiusClose;
                duration = CONFIG.CROSS_SPIN_DURATION * 2;
                // V9: celui qui ne pirouette pas DANSE sur place (jambes qui
                // travaillent) - personne n'est jamais immobile
                this.manWrapper.classList.add('cross-spinning');
                this.womanWrapper.classList.add('dance-step');
                this.startStars(this.manWrapper, CONFIG.CROSS_SPIN_DURATION);
                const swap = setTimeout(() => {
                    this.manWrapper.classList.remove('cross-spinning');
                    this.manWrapper.classList.add('dance-step');
                    this.womanWrapper.classList.remove('dance-step');
                    this.womanWrapper.classList.add('cross-spinning');
                    this.startStars(this.womanWrapper, CONFIG.CROSS_SPIN_DURATION);
                }, CONFIG.CROSS_SPIN_DURATION);
                this.internalTimers.push(swap);
                break;
            }

            // V8: CROISEMENT - rotation a deux autour du petit cercle,
            // ralentie, avec etoiles sur les deux danseurs.
            case STATE.H:
                this.radius = this.radiusClose;
                this.wheelAngle += 180;
                duration = CONFIG.CROSS_ROTATE_DURATION;
                this.setAnimationClass('cross-rotating');
                this.startStars(this.manWrapper, duration);
                this.startStars(this.womanWrapper, duration);
                break;

            // V10: SORTIE PERPENDICULAIRE apres un croisement — la roue fait
            // un quart de tour pendant que le rayon repasse au grand cercle:
            // chaque danseur quitte le centre sur la ligne perpendiculaire a
            // celle d'entree, dans des sens opposes (jamais tout droit).
            case STATE.P:
                this.radius = this.radiusFar;
                this.wheelAngle += 90;
                this.setAnimationClass('translating');
                break;

            case STATE.Q:
                this.radius = this.radiusFar;
                this.wheelAngle -= 90;
                this.setAnimationClass('translating');
                break;
        }

        // V8: la rotation de croisement (H) est plus lente que la normale
        const moveDuration = (newState === STATE.H)
            ? CONFIG.CROSS_ROTATE_DURATION : CONFIG.MOVE_DURATION;
        this.applyPosition(false, moveDuration);
        return duration;
    }

    // V8: emission continue de petites etoiles scintillantes pendant une
    // rotation de croisement; elles s'estompent d'elles-memes (starPop)
    startStars(wrapper, totalMs, perBurst = 3) {
        const spawn = () => {
            for (let i = 0; i < perBurst; i++) {
                const s = document.createElement('span');
                s.className = 'cross-star';
                s.textContent = '✦';
                s.style.left = (Math.random() * 85) + '%';
                s.style.top = (Math.random() * 85) + '%';
                s.style.setProperty('--sx', (Math.random() * 44 - 22) + 'px');
                s.style.setProperty('--sy', (-8 - Math.random() * 30) + 'px');
                s.style.animationDuration = (450 + Math.random() * 350) + 'ms';
                wrapper.appendChild(s);
                const rm = setTimeout(() => s.remove(), 900);
                this.internalTimers.push(rm);
            }
        };
        spawn();
        const iv = setInterval(spawn, 240);
        this.internalIntervals.push(iv);
        const stop = setTimeout(() => clearInterval(iv), Math.max(0, totalMs - 150));
        this.internalTimers.push(stop);
    }

    clearInternalTimers() {
        this.internalTimers.forEach(t => clearTimeout(t));
        this.internalIntervals.forEach(i => clearInterval(i));
        this.internalTimers = [];
        this.internalIntervals = [];
        [this.manWrapper, this.womanWrapper].forEach(w => {
            if (w) w.querySelectorAll('.cross-star').forEach(s => s.remove());
        });
    }

    // V6 PRO: Methodes pour gerer les animations dynamiques
    clearAnimationClasses() {
        // V8: stopper aussi les phases de croisement et l'emission d'etoiles
        this.clearInternalTimers();
        const classes = ['dancing', 'rotating', 'translating', 'close', 'flip',
            'static-state', 'cross-spinning', 'cross-rotating',
            'magic-spinning', 'dance-step'];
        classes.forEach(cls => {
            this.manWrapper.classList.remove(cls);
            this.womanWrapper.classList.remove(cls);
        });
    }

    // V10: rotation magique = UN SEUL tour complet, tres lent, etale sur
    // toute la duree de l'etat. L'animation CSS lit --magic-dur et ne joue
    // qu'UNE iteration: impossible de confondre 1 rotation avec un cycle.
    setMagicSpin(durationMs) {
        [this.manWrapper, this.womanWrapper].forEach(w => {
            w.style.setProperty('--magic-dur', durationMs + 'ms');
        });
        this.setAnimationClass('magic-spinning');
    }

    setAnimationClass(className) {
        this.manWrapper.classList.add(className);
        this.womanWrapper.classList.add(className);

        // V6 PRO: Ajouter effet FLIP a TOUS les niveaux pendant rotations
        if (className === 'rotating') {
            this.manWrapper.classList.add('flip');
            this.womanWrapper.classList.add('flip');
        }
    }

    reset() {
        this.currentState = STATE.C;
        this.wheelAngle = 0;
        this.radius = this.radiusFar;
        this.applyPosition(true);
        // V6 PRO: Reset et activer animation de base
        this.clearAnimationClasses();
        this.setAnimationClass('dancing');
    }

    // V6 PRO: Arreter toutes les animations
    stopAnimations() {
        this.clearAnimationClasses();
    }
}

// ============================================
// CLASSE GAME
// ============================================
class PizzicaGame {
    constructor() {
        this.couples = [];
        this.demoCouple = null;
        this.previewCouple = null;
        this.correctTileId = -1;
        this.isGameActive = false;
        this.currentLevel = 1;
        this.currentSequence = [];
        this.currentAudio = null;
        this.isPlaying = false;

        // V6 PRO: Timeouts pour annuler les sequences en cours
        this.sequenceTimeouts = [];

        // Elements DOM
        this.homeScreen = null;
        this.gameScreen = null;
        this.demoPreview = null;
        this.danceFloor = null;
        this.demoOverlay = null;
        this.demoStage = null;
        this.countdown = null;
        this.result = null;
        this.statusText = null;
        this.levelDisplay = null;
        this.levelDisplayGame = null;
        this.musicInfo = null;
        this.demoLevelInfo = null;
        this.btnPlay = null;
        this.btnReplay = null;
        this.btnRestart = null;
        this.btnRetryDemo = null;
        this.btnNextLevel = null;
        this.progressBar = null;
        this.gameStatus = null;

        // V6 PRO: Timer countdown interval
        this.demoTimerInterval = null;
        this.demoTimer = null;

        this.init();
    }

    init() {
        // Ecrans
        this.homeScreen = document.getElementById('home-screen');
        this.gameScreen = document.getElementById('game-screen');
        this.demoPreview = document.getElementById('demo-preview');

        // Elements de jeu
        this.danceFloor = document.getElementById('dance-floor');
        this.demoOverlay = document.getElementById('demo-overlay');
        this.demoStage = document.getElementById('demo-stage');
        this.countdown = document.getElementById('countdown');
        this.goMessage = document.getElementById('go-message');
        this.eccoMessage = document.getElementById('ecco-message');
        this.result = document.getElementById('result');
        this.statusText = document.getElementById('status-text');
        this.levelDisplay = document.getElementById('level-display');
        this.levelDisplayGame = document.getElementById('level-display-game');
        this.musicInfo = document.getElementById('music-info');
        this.demoLevelInfo = document.getElementById('demo-level-info');
        this.btnPlay = document.getElementById('btn-play');
        this.btnReplay = document.getElementById('btn-replay');
        this.btnRestart = document.getElementById('btn-restart');
        this.btnRetryDemo = document.getElementById('btn-retry-demo');
        this.btnNextLevel = document.getElementById('btn-next-level');
        this.btnShowError = document.getElementById('btn-show-error');
        this.progressBar = document.getElementById('bar');
        this.gameStatus = document.getElementById('game-status');
        this.demoTimer = document.getElementById('demo-timer');

        // Comparison overlay elements
        this.comparisonOverlay = document.getElementById('comparison-overlay');
        this.comparisonDemo = document.getElementById('comparison-demo');
        this.comparisonUser = document.getElementById('comparison-user');
        this.comparisonMessage = document.getElementById('comparison-message');
        this.btnComparisonRetry = document.getElementById('btn-comparison-retry');
        this.btnComparisonReplay = document.getElementById('btn-comparison-replay');

        // Track user selection for error analysis
        this.userSelectedTileId = null;
        this.allSequences = null;
        this.divergenceData = null; // Store divergence info for replay

        // Event listeners
        this.btnPlay.addEventListener('click', () => this.startDemo());
        this.btnReplay.addEventListener('click', () => this.replayDemo());
        this.btnRestart.addEventListener('click', () => this.restartGame());
        this.btnRetryDemo.addEventListener('click', () => this.retryWithDemo());
        this.btnNextLevel.addEventListener('click', () => this.nextLevel());
        this.btnShowError.addEventListener('click', () => this.showErrorComparison());
        this.btnComparisonRetry.addEventListener('click', () => this.closeComparisonAndRetry());
        this.btnComparisonReplay.addEventListener('click', () => this.replayDivergence());

        // Initialisation
        this.updateLevelDisplay();
        this.buildCharSelect();
        this.createPreviewCouple();

        // V7: re-mesurer la geometrie de tous les couples vivants
        // apres resize / rotation d'ecran (debounce 150ms)
        let resizeTimer = null;
        const onViewportChange = () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => this.remeasureAllCouples(), 150);
        };
        window.addEventListener('resize', onViewportChange);
        window.addEventListener('orientationchange', onViewportChange);
    }

    remeasureAllCouples() {
        const all = [
            this.previewCouple,
            this.demoCouple,
            this.comparisonDemoCouple,
            this.comparisonUserCouple,
            ...this.couples
        ];
        all.forEach(c => { if (c) c.remeasure(); });
    }

    // ========================================
    // GESTION DES PROJECTEURS
    // ========================================
    activateSpotlights() {
        document.querySelectorAll('.spotlight').forEach(s => s.classList.add('active'));
    }

    deactivateSpotlights() {
        document.querySelectorAll('.spotlight').forEach(s => s.classList.remove('active'));
    }

    // ========================================
    // V6 PRO: GESTION TIMER DEMO
    // ========================================
    startDemoTimer(durationSeconds) {
        // Arreter tout timer existant
        if (this.demoTimerInterval) {
            clearInterval(this.demoTimerInterval);
        }

        let remaining = durationSeconds;
        this.demoTimer.textContent = remaining;

        this.demoTimerInterval = setInterval(() => {
            remaining--;
            if (remaining >= 0) {
                this.demoTimer.textContent = remaining;
            }
            if (remaining <= 0) {
                clearInterval(this.demoTimerInterval);
                this.demoTimerInterval = null;
            }
        }, 1000);
    }

    stopDemoTimer() {
        if (this.demoTimerInterval) {
            clearInterval(this.demoTimerInterval);
            this.demoTimerInterval = null;
        }
    }

    // ========================================
    // GESTION AUDIO
    // ========================================
    getAudioForLevel(level) {
        const levelConfig = LEVELS[level];
        return document.getElementById(levelConfig.audioId);
    }

    stopAllAudio() {
        // V10: 3 pistes partagees par les 9 livelli
        document.querySelectorAll('audio[id^="audio-level-"]').forEach(audio => {
            audio.pause();
            audio.currentTime = 0;
        });
    }

    playLevelMusic() {
        this.stopAllAudio();
        this.currentAudio = this.getAudioForLevel(this.currentLevel);
        if (this.currentAudio) {
            this.currentAudio.currentTime = 0;
            this.currentAudio.play().catch(() => console.log('Audio blocked'));
        }
    }

    pauseMusic() {
        if (this.currentAudio) {
            this.currentAudio.pause();
        }
    }

    // ========================================
    // AFFICHAGE
    // ========================================
    updateLevelDisplay() {
        const levelInfo = LEVELS[this.currentLevel];
        const levelText = `LIVELLO ${this.currentLevel} - ${levelInfo.name.toUpperCase()}`;
        this.levelDisplay.textContent = levelText;
        if (this.levelDisplayGame) {
            this.levelDisplayGame.textContent = levelText;
        }
        this.musicInfo.textContent = `${levelInfo.music}`;
        this.demoLevelInfo.textContent = `Livello ${this.currentLevel} - Durata: ${levelInfo.duration}s - ${levelInfo.tiles} coppie`;
    }

    // V9: selecteur de personnages sur l'ecran d'accueil
    buildCharSelect() {
        document.querySelectorAll('#char-select .char-row').forEach(row => {
            const role = row.dataset.role;
            row.querySelectorAll('.char-thumb').forEach(b => b.remove());
            CHARACTERS[role].forEach(ch => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'char-thumb' + (selectedChars[role] === ch.id ? ' selected' : '');
                btn.title = ch.name;
                const img = document.createElement('img');
                img.src = ch.img;
                img.alt = ch.name;
                btn.appendChild(img);
                btn.addEventListener('click', () => {
                    selectedChars[role] = ch.id;
                    try {
                        localStorage.setItem('pizzica-chars', JSON.stringify(selectedChars));
                    } catch (e) { /* mode prive */ }
                    this.buildCharSelect();
                    this.createPreviewCouple();
                });
                row.appendChild(btn);
            });
        });
    }

    createPreviewCouple() {
        // Couple en position initiale sur l'ecran d'accueil
        const existingWheel = this.demoPreview.querySelector('.couple-wheel');
        if (existingWheel) existingWheel.remove();

        this.previewCouple = new Couple(this.demoPreview, 'preview', true, this.currentLevel);
        // V9: le preview danse tout de suite - c'est ici qu'on voit la danse
        // propre au personnage selectionne
        this.previewCouple.setAnimationClass('dancing');
    }

    createDanceFloor() {
        this.danceFloor.innerHTML = '';
        this.couples = [];

        // V10: 2 carreaux (Principiante), 3 (Intermedio) ou 4 (Avanzato).
        // La classe tiles-N pilote la grille CSS.
        const tileCount = tilesForLevel(this.currentLevel);
        this.danceFloor.classList.remove('tiles-2', 'tiles-3', 'tiles-4');
        this.danceFloor.classList.add(`tiles-${tileCount}`);

        for (let i = 0; i < tileCount; i++) {
            const tile = document.createElement('div');
            tile.className = 'tile';
            tile.id = `tile-${i}`;
            tile.dataset.index = i;
            tile.addEventListener('click', () => this.handleTileClick(i));

            this.danceFloor.appendChild(tile);

            // V6 PRO: Passer le niveau pour flip effect
            const couple = new Couple(tile, i, false, this.currentLevel);
            this.couples.push(couple);
        }
    }

    createDemoCouple() {
        const existingWheel = this.demoStage.querySelector('.couple-wheel');
        if (existingWheel) existingWheel.remove();

        this.demoCouple = new Couple(this.demoStage, 'demo', true, this.currentLevel);
    }

    // ========================================
    // PHASE DEMONSTRATION
    // ========================================
    startDemo() {
        // V6 PRO: Annuler toutes sequences en cours
        this.cancelAllSequences();

        this.btnPlay.disabled = true;
        this.result.style.display = 'none';
        this.isPlaying = true;

        // Generer nouvelle sequence aleatoire
        this.currentSequence = generateSequenceForLevel(this.currentLevel);

        console.log(`=== NIVEAU ${this.currentLevel} ===`);
        console.log(`Musique: ${LEVELS[this.currentLevel].music}`);
        console.log('Sequence:', this.currentSequence.map(s => {
            for (let key in STATE) {
                if (STATE[key] === s) return key;
            }
            return s;
        }).join(' -> '));

        // Activer les projecteurs
        this.activateSpotlights();

        // Jouer la musique
        this.playLevelMusic();

        // V6 PRO: Countdown de 3 secondes AVANT la demo
        this.countdown.style.display = 'block';
        let count = 3;
        this.countdown.textContent = count;

        const countInterval = setInterval(() => {
            count--;
            if (count > 0) {
                this.countdown.textContent = count;
            } else {
                clearInterval(countInterval);
                this.countdown.style.display = 'none';
                this.startDemoSequence();
            }
        }, 1000);
    }

    startDemoSequence() {
        // V7: masquer l'accueil (sinon il transparait a travers l'overlay
        // desormais transparent), puis afficher l'overlay AVANT de creer le
        // couple (la taille du carreau doit etre mesurable)
        this.homeScreen.style.display = 'none';
        this.demoOverlay.style.display = 'flex';
        this.createDemoCouple();

        this.progressBar.style.width = '0%';

        // V6 PRO: Demarrer le timer visible
        const levelDuration = LEVELS[this.currentLevel].duration;
        this.startDemoTimer(levelDuration);

        this.runSequence(this.demoCouple, this.currentSequence, 0, () => {
            this.stopDemoTimer();
            this.startCountdownToGame();
        });
    }

    replayDemo() {
        if (!this.isPlaying) return;

        // V6 PRO: Annuler toutes sequences en cours avant de rejouer
        this.cancelAllSequences();

        // V6 PRO: Countdown de 3 secondes avant de rejouer la demo
        this.countdown.style.display = 'block';
        let count = 3;
        this.countdown.textContent = count;

        const countInterval = setInterval(() => {
            count--;
            if (count > 0) {
                this.countdown.textContent = count;
            } else {
                clearInterval(countInterval);
                this.countdown.style.display = 'none';
                this.replayDemoSequence();
            }
        }, 1000);
    }

    replayDemoSequence() {
        this.demoCouple.reset();
        this.progressBar.style.width = '0%';

        if (this.currentAudio) {
            this.currentAudio.currentTime = 0;
        }

        // V6 PRO: Redemarrer le timer
        const levelDuration = LEVELS[this.currentLevel].duration;
        this.startDemoTimer(levelDuration);

        this.runSequence(this.demoCouple, this.currentSequence, 0, () => {
            this.stopDemoTimer();
            this.startCountdownToGame();
        });
    }

    /**
     * Rejouer la demo apres un echec (garde la meme sequence)
     */
    retryWithDemo() {
        // V6 PRO: Annuler toutes sequences en cours
        this.cancelAllSequences();

        this.result.style.display = 'none';
        this.btnPlay.disabled = true;
        this.isPlaying = true;

        // Reset l'affichage
        document.querySelectorAll('.tile').forEach(t => {
            t.classList.remove('selected-correct', 'selected-wrong', 'disco-active');
        });

        // Recreer les couples (le couple demo sera cree une fois l'overlay visible)
        this.createDanceFloor();

        // Activer les projecteurs
        this.activateSpotlights();

        // Jouer la musique
        this.playLevelMusic();

        // V6 PRO: Countdown de 3 secondes avant de montrer la demo
        this.countdown.style.display = 'block';
        let count = 3;
        this.countdown.textContent = count;

        const countInterval = setInterval(() => {
            count--;
            if (count > 0) {
                this.countdown.textContent = count;
            } else {
                clearInterval(countInterval);
                this.countdown.style.display = 'none';
                this.retryDemoSequence();
            }
        }, 1000);
    }

    retryDemoSequence() {
        // Afficher la demo avec la MEME sequence
        // V7: masquer l'ecran de jeu (les 4 carreaux transparaitraient),
        // overlay visible d'abord, puis creation du couple (mesure de taille)
        this.gameScreen.style.display = 'none';
        this.demoOverlay.style.display = 'flex';
        this.createDemoCouple();
        this.progressBar.style.width = '0%';

        // V6 PRO: Redemarrer le timer
        const levelDuration = LEVELS[this.currentLevel].duration;
        this.startDemoTimer(levelDuration);

        this.runSequence(this.demoCouple, this.currentSequence, 0, () => {
            this.stopDemoTimer();
            this.startCountdownToGame();
        });
    }

    // V6 PRO: Annuler toutes les sequences en cours
    cancelAllSequences() {
        this.sequenceTimeouts.forEach(timeout => clearTimeout(timeout));
        this.sequenceTimeouts = [];
        // V8: stopper aussi les timers internes des couples
        // (phase d'echange de pirouette G, emission d'etoiles)
        [this.previewCouple, this.demoCouple, this.comparisonDemoCouple,
            this.comparisonUserCouple, ...(this.couples || [])].forEach(c => {
            if (c) c.clearInternalTimers();
        });
    }

    runSequence(couple, sequence, index, onComplete) {
        if (index >= sequence.length) {
            if (onComplete) onComplete();
            return;
        }

        const state = sequence[index];
        const duration = couple.transitionTo(state);

        if (couple.id === 'demo') {
            const progress = ((index + 1) / sequence.length) * 100;
            this.progressBar.style.width = `${progress}%`;
        }

        const timeout = setTimeout(() => {
            this.runSequence(couple, sequence, index + 1, onComplete);
        }, duration);

        // V6 PRO: Tracker les timeouts
        this.sequenceTimeouts.push(timeout);
    }

    // ========================================
    // COUNTDOWN vers les 4 carreaux
    // ========================================
    startCountdownToGame() {
        // V6 PRO: Ne pas couper la musique - elle continue de la demo aux 4 carreaux

        this.demoOverlay.style.display = 'none';

        // Passer a l'ecran de jeu
        this.homeScreen.style.display = 'none';
        this.gameScreen.style.display = 'flex';

        // Creer la piste de danse
        this.createDanceFloor();

        this.countdown.style.display = 'block';

        let count = 3;
        this.countdown.textContent = count;

        const countInterval = setInterval(() => {
            count--;
            if (count > 0) {
                this.countdown.textContent = count;
            } else {
                clearInterval(countInterval);
                this.countdown.style.display = 'none';
                this.startGame();
            }
        }, 1000);
    }

    // ========================================
    // PHASE JEU
    // ========================================
    startGame() {
        // V6 PRO: La musique continue deja, pas besoin de la relancer
        // this.playLevelMusic();

        if (this.gameStatus) {
            this.gameStatus.textContent = 'Trova la coppia corretta!';
        }

        this.correctTileId = Math.floor(Math.random() * tilesForLevel(this.currentLevel));

        console.log('Correct tile ID:', this.correctTileId);

        // V6 PRO: Stocker les sequences pour la comparaison d'erreur
        this.allSequences = this.generateIntelligentSequences();
        const allSequences = this.allSequences;

        document.querySelectorAll('.tile').forEach(t => {
            t.classList.add('disco-active');
            t.classList.remove('selected-correct', 'selected-wrong');
        });

        this.couples.forEach(c => c.reset());

        this.runAllSequences(allSequences);
    }

    generateIntelligentSequences() {
        // V6 PRO: Divergence progressive - Les sequences commencent ensemble puis divergent
        const targetDuration = LEVELS[this.currentLevel].duration * 1000;
        const correctSeq = this.currentSequence;

        // Extraire le tronc commun initial (2-3 premiers etats)
        const commonTrunkLength = Math.min(3, Math.max(2, Math.floor(correctSeq.length * 0.25)));
        const commonTrunk = correctSeq.slice(0, commonTrunkLength);

        const midTrunkLength = Math.min(
            correctSeq.length - 2,
            commonTrunkLength + Math.max(1, Math.floor(correctSeq.length * 0.2))
        );
        const midTrunk = correctSeq.slice(0, midTrunkLength);

        const lateTrunkLength = Math.min(
            correctSeq.length - 1,
            midTrunkLength + Math.max(1, Math.floor(correctSeq.length * 0.3))
        );
        const lateTrunk = correctSeq.slice(0, lateTrunkLength);

        // V10: nombre de sequences = nombre de carreaux du livello.
        // 2 carreaux -> 1 erreur tardive (subtile); 3 -> mid + late;
        // 4 -> early + mid + late (comportement historique).
        const tileCount = tilesForLevel(this.currentLevel);
        const profiles = {
            2: [['late', lateTrunk]],
            3: [['mid', midTrunk], ['late', lateTrunk]],
            4: [['early', commonTrunk], ['mid', midTrunk], ['late', lateTrunk]]
        }[tileCount] || [['early', commonTrunk], ['mid', midTrunk], ['late', lateTrunk]];

        const sequences = profiles.map(([type, trunk]) =>
            this.buildDivergentSequence(trunk, targetDuration, type));

        // La bonne sequence est inseree a une position aleatoire
        const correctIndex = Math.floor(Math.random() * tileCount);
        sequences.splice(correctIndex, 0, [...correctSeq]);
        this.correctTileId = correctIndex;

        // Verification anti-doublons
        this.ensureUniqueSequences(sequences);

        console.log('=== DIVERGENCE PROGRESSIVE ===');
        console.log(`Carreaux: ${tileCount}`);
        console.log('Tronc commun initial:', this.seqToString(commonTrunk));
        console.log('Tronc median:', this.seqToString(midTrunk));
        console.log('Tronc tardif:', this.seqToString(lateTrunk));
        sequences.forEach((seq, i) => {
            console.log(`Tile ${i}: ${this.seqToString(seq)} ${i === this.correctTileId ? '✓ CORRECT' : ''}`);
        });

        return sequences;
    }

    buildDivergentSequence(trunk, targetDuration, divergenceType, avoidSeq = null) {
        const sequence = [...trunk];
        let totalDuration = sequence.reduce((sum, state) => sum + STATE_DURATION[state], 0);
        let currentState = sequence[sequence.length - 1];

        // Continuer la sequence avec une variation selon le type de divergence
        const maxAttempts = 20;
        let attempts = 0;

        while (totalDuration < targetDuration && attempts < maxAttempts) {
            const validNextStates = allowedNextStates(sequence, currentState);

            // Choisir le prochain etat avec une strategie selon le type
            let nextState;
            if (divergenceType === 'early') {
                // Divergence precoce: preferer des chemins alternatifs
                nextState = this.pickAlternativeState(validNextStates, currentState);
            } else if (divergenceType === 'mid') {
                // Divergence moyenne: melange equilibre
                nextState = validNextStates[Math.floor(Math.random() * validNextStates.length)];
            } else {
                // Divergence tardive: principalement suivre le schema, avec variations subtiles
                nextState = this.pickSubtleVariation(validNextStates, currentState);
            }

            sequence.push(nextState);
            totalDuration += STATE_DURATION[nextState];
            currentState = nextState;
            attempts++;
        }

        // Terminer proprement en position C
        while (currentState !== STATE.C) {
            const validNextStates = allowedNextStates(sequence, currentState);
            if (validNextStates.includes(STATE.C)) {
                sequence.push(STATE.C);
                currentState = STATE.C;
            } else {
                const nextState = validNextStates[0];
                sequence.push(nextState);
                currentState = nextState;
            }
        }

        // Si on doit eviter une autre sequence, ajouter une petite modification
        if (avoidSeq && this.sequencesEqual(sequence, avoidSeq)) {
            this.makeSequenceUnique(sequence, [avoidSeq]);
        }

        return sequence;
    }

    pickAlternativeState(validStates, currentState) {
        // Preferer les etats moins communs
        if (validStates.length > 1) {
            const weights = validStates.map(state => {
                // Donner moins de poids aux transitions "naturelles"
                if (currentState === STATE.A && state === STATE.B) return 0.3;
                if (currentState === STATE.B && state === STATE.A) return 0.3;
                return 1.0;
            });
            const totalWeight = weights.reduce((a, b) => a + b, 0);
            let random = Math.random() * totalWeight;
            for (let i = 0; i < validStates.length; i++) {
                random -= weights[i];
                if (random <= 0) return validStates[i];
            }
        }
        return validStates[Math.floor(Math.random() * validStates.length)];
    }

    pickSubtleVariation(validStates, currentState) {
        // 80% du temps, suivre le chemin "naturel", 20% varier
        if (Math.random() < 0.8 && validStates.length > 0) {
            // Preference pour les transitions communes
            if (currentState === STATE.A && validStates.includes(STATE.B)) return STATE.B;
            if (currentState === STATE.B && validStates.includes(STATE.A)) return STATE.A;
        }
        return validStates[Math.floor(Math.random() * validStates.length)];
    }

    applySubtleModification(sequence) {
        // Modifier legerement la sequence pour la rendre unique.
        // V8: l'alternative doit respecter la grammaire complete - cap des
        // croisements (allowedNextStates) ET transition valide vers l'etat
        // suivant (sinon on fabriquait des G->C ou 3 croisements de suite).
        if (sequence.length > 4) {
            const pos = sequence.length - 3;
            const currentState = sequence[pos];
            const following = sequence[pos + 2];
            const validStates = allowedNextStates(sequence.slice(0, pos + 1), currentState);
            const alternatives = validStates.filter(s =>
                s !== sequence[pos + 1] &&
                VALID_TRANSITIONS[s] && VALID_TRANSITIONS[s].includes(following));
            if (alternatives.length > 0) {
                sequence[pos + 1] = alternatives[0];
                return true;
            }
        }
        return false;
    }

    // V8: rend `sequence` differente de TOUTES les autres. La modification
    // subtile peut echouer ou creer une nouvelle collision (fuzz: ~0.5%);
    // le secours - toujours conforme a la grammaire car le C final accepte
    // une rotation A puis un retour en C - allonge jusqu'a unicite garantie.
    makeSequenceUnique(sequence, others) {
        const collides = () => others.some(o =>
            o !== sequence && this.sequencesEqual(sequence, o));
        if (!this.applySubtleModification(sequence) || collides()) {
            while (collides()) {
                sequence.push(STATE.A, STATE.C);
            }
        }
    }

    sequencesEqual(seq1, seq2) {
        if (seq1.length !== seq2.length) return false;
        for (let i = 0; i < seq1.length; i++) {
            if (seq1[i] !== seq2[i]) return false;
        }
        return true;
    }

    ensureUniqueSequences(sequences) {
        // Verifier et corriger les doublons.
        // V8: ne JAMAIS modifier la sequence correcte (elle doit rester
        // identique a la demo) - on modifie l'autre membre du doublon.
        for (let i = 0; i < sequences.length; i++) {
            for (let j = i + 1; j < sequences.length; j++) {
                if (this.sequencesEqual(sequences[i], sequences[j])) {
                    console.warn(`⚠️ Sequences ${i} et ${j} identiques, correction...`);
                    const target = (j === this.correctTileId) ? sequences[i] : sequences[j];
                    this.makeSequenceUnique(target, sequences);
                }
            }
        }
    }

    seqToString(seq) {
        return seq.map(s => {
            for (let key in STATE) {
                if (STATE[key] === s) return key;
            }
            return '?';
        }).join('-');
    }

    createSkipStateError(correctSeq) {
        const wrongSeq = [...correctSeq];
        for (let i = 1; i < wrongSeq.length - 2; i++) {
            if (wrongSeq[i] === STATE.C && i > 0 && i < wrongSeq.length - 1) {
                const prevState = wrongSeq[i - 1];
                const nextState = wrongSeq[i + 1];
                if ((prevState === STATE.A || prevState === STATE.B) &&
                    (nextState === STATE.A || nextState === STATE.B || nextState === STATE.E)) {
                    wrongSeq.splice(i, 1);
                    break;
                }
            }
        }
        return wrongSeq;
    }

    createSwapRotationError(correctSeq) {
        const wrongSeq = [...correctSeq];
        for (let i = 0; i < wrongSeq.length - 1; i++) {
            if (wrongSeq[i] === STATE.A && wrongSeq[i + 1] === STATE.B) {
                wrongSeq[i] = STATE.B;
                wrongSeq[i + 1] = STATE.A;
                break;
            } else if (wrongSeq[i] === STATE.B && wrongSeq[i + 1] === STATE.A) {
                wrongSeq[i] = STATE.A;
                wrongSeq[i + 1] = STATE.B;
                break;
            }
        }
        return wrongSeq;
    }

    createExtraRotationError(correctSeq) {
        const wrongSeq = [...correctSeq];
        for (let i = 0; i < wrongSeq.length; i++) {
            if (wrongSeq[i] === STATE.A || wrongSeq[i] === STATE.B) {
                const extraState = Math.random() > 0.5 ? STATE.A : STATE.B;
                wrongSeq.splice(i + 1, 0, extraState);
                break;
            }
        }
        return wrongSeq;
    }

    // V6 PRO: Nouvelles variations pour plus de diversité
    createReverseSequenceError(correctSeq) {
        // Inverser une partie de la sequence
        const wrongSeq = [...correctSeq];
        if (wrongSeq.length >= 4) {
            const start = Math.floor(wrongSeq.length / 3);
            const end = Math.floor(wrongSeq.length * 2 / 3);
            const segment = wrongSeq.slice(start, end).reverse();
            wrongSeq.splice(start, end - start, ...segment);
        }
        return wrongSeq;
    }

    createDoubleStateError(correctSeq) {
        // Doubler un etat specifique
        const wrongSeq = [...correctSeq];
        const pos = Math.floor(Math.random() * (wrongSeq.length - 1));
        wrongSeq.splice(pos, 0, wrongSeq[pos]);
        return wrongSeq;
    }

    createMixedError(correctSeq) {
        // Combiner plusieurs types d'erreurs
        let wrongSeq = [...correctSeq];

        // Swap une rotation
        for (let i = 0; i < wrongSeq.length - 1; i++) {
            if (wrongSeq[i] === STATE.A) {
                wrongSeq[i] = STATE.B;
                break;
            }
        }

        // Puis ajouter un etat supplementaire
        if (wrongSeq.length > 2) {
            const pos = Math.floor(wrongSeq.length / 2);
            const extraState = Math.random() > 0.5 ? STATE.A : STATE.B;
            wrongSeq.splice(pos, 0, extraState);
        }

        return wrongSeq;
    }

    shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }

    // V8: chaque carreau avance a son propre rythme (comme la demo) — plus de
    // lockstep par index qui figeait les carreaux rapides jusqu'a 1s en
    // attendant les croisements (G=2800ms / H=3000ms) des autres.
    runAllSequences(allSequences) {
        let remaining = allSequences.length;
        for (let i = 0; i < allSequences.length; i++) {
            const couple = this.couples[i];
            this.runSequence(couple, allSequences[i], 0, () => {
                // V9: des que CE carreau a fini, danse d'attente (sans etoiles)
                // - sinon la piroette magique infinie du C final se lirait
                // comme des elements de sequence supplementaires
                couple.stopAnimations();
                couple.setAnimationClass('dancing');
                remaining--;
                if (remaining === 0) this.finishGame();
            });
        }
    }

    // ========================================
    // V6 PRO: FEU D'ARTIFICE
    // ========================================
    launchFireworks() {
        const container = document.getElementById('fireworks-container');
        container.style.display = 'block';
        container.innerHTML = '';

        const colors = ['#ff0055', '#00ffcc', '#ffd700', '#0088ff', '#aa00ff'];

        // Lancer plusieurs feux d'artifice
        for (let i = 0; i < 15; i++) {
            setTimeout(() => {
                this.createFirework(container, colors);
            }, i * 200);
        }

        // Arreter apres 4 secondes
        setTimeout(() => {
            container.style.display = 'none';
            container.innerHTML = '';
        }, 4000);
    }

    createFirework(container, colors) {
        const x = Math.random() * window.innerWidth;
        const y = Math.random() * window.innerHeight * 0.6; // Partie superieure
        const color = colors[Math.floor(Math.random() * colors.length)];

        // Creer des particules
        for (let i = 0; i < 30; i++) {
            const particle = document.createElement('div');
            particle.className = 'firework-particle';
            particle.style.left = x + 'px';
            particle.style.top = y + 'px';
            particle.style.background = color;

            const angle = (Math.PI * 2 * i) / 30;
            const velocity = 50 + Math.random() * 100;
            const tx = Math.cos(angle) * velocity;
            const ty = Math.sin(angle) * velocity;

            particle.style.setProperty('--tx', tx + 'px');
            particle.style.setProperty('--ty', ty + 'px');

            container.appendChild(particle);

            setTimeout(() => particle.remove(), 1500);
        }
    }

    // ========================================
    // FIN DE JEU
    // ========================================
    finishGame() {
        // V6 PRO: Afficher "GO!" brievement (0.5 seconde)
        this.goMessage.style.display = 'block';
        setTimeout(() => {
            this.goMessage.style.display = 'none';
        }, 500);

        this.isGameActive = true;

        // Ne pas couper la musique - elle continue jusqu'a la selection
        this.deactivateSpotlights();

        if (this.gameStatus) {
            this.gameStatus.textContent = 'CLICCA SULLA COPPIA CORRETTA!';
        }

        document.querySelectorAll('.tile').forEach(t => t.classList.remove('disco-active'));

        // V9: les couples sont deja en danse d'attente (bascule par carreau
        // dans runAllSequences des la fin de chaque sequence)
    }

    handleTileClick(tileId) {
        if (!this.isGameActive) return;

        this.isGameActive = false;
        this.isPlaying = false;

        // Arreter la musique seulement apres la selection
        this.pauseMusic();

        // V6 PRO: Arreter les animations des danseurs
        this.couples.forEach(c => c.stopAnimations());

        console.log('Clicked tile:', tileId, 'Correct tile:', this.correctTileId);

        const tile = document.getElementById(`tile-${tileId}`);
        const resultContent = document.getElementById('result-content');

        if (tileId === this.correctTileId) {
            // VICTOIRE - V6 PRO: Feu d'artifice + messages italiens
            tile.classList.add('selected-correct');

            // Lancer les feux d'artifice
            this.launchFireworks();

            if (this.currentLevel >= CONFIG.MAX_LEVEL) {
                this.result.className = 'complete';
                resultContent.innerHTML = `
                    <h2 style="color: #ffd700;">HAI VINTO!! 🎉</h2>
                    <p>Fantastico! Hai completato tutti i ${CONFIG.MAX_LEVEL} livelli!</p>
                    <p class="level-info">Sei un vero campione della Pizzica! 🏆</p>
                `;
                this.btnNextLevel.style.display = 'none';
                this.btnRetryDemo.style.display = 'none';
                this.btnShowError.style.display = 'none';
                this.btnRestart.style.display = 'inline-block';
                this.btnRestart.textContent = 'GIOCA ANCORA';
            } else {
                this.result.className = 'win';
                resultContent.innerHTML = `
                    <h2 style="color: #00ff00;">HAI VINTO!! 🎊</h2>
                    <p>Bravissimo/a! Livello ${this.currentLevel} completato!</p>
                    <p class="level-info">Prossimo: Livello ${this.currentLevel + 1} - ${LEVELS[this.currentLevel + 1].name}</p>
                    <p style="color: var(--neon-cyan); font-size: 0.9rem;">${LEVELS[this.currentLevel + 1].music}</p>
                `;
                this.btnNextLevel.style.display = 'inline-block';
                this.btnRetryDemo.style.display = 'none';
                this.btnShowError.style.display = 'none';
                this.btnRestart.style.display = 'inline-block';
                this.btnRestart.textContent = 'RICOMINCIA';
            }

            this.result.style.display = 'block';

        } else {
            // ECHEC - Forcer la revision de la demo
            tile.classList.add('selected-wrong');
            document.getElementById(`tile-${this.correctTileId}`).classList.add('selected-correct');

            // V6 PRO: Stocker la selection de l'utilisateur pour l'analyse d'erreur
            this.userSelectedTileId = tileId;

            this.result.className = 'lose';
            resultContent.innerHTML = `
                <h2 style="color: #ff0000;">SBAGLIATO!</h2>
                <p>La coppia corretta era la n. ${this.correctTileId + 1}</p>
                <p class="level-info">Rivedi il modello per riprovare!</p>
            `;
            // Afficher le bouton pour comprendre l'erreur
            this.btnShowError.style.display = 'inline-block';
            this.btnNextLevel.style.display = 'none';
            this.btnRetryDemo.style.display = 'inline-block';
            this.btnRestart.style.display = 'none';
            this.result.style.display = 'block';
        }
    }

    nextLevel() {
        this.currentLevel++;
        this.result.style.display = 'none';
        this.btnNextLevel.style.display = 'none';
        this.btnRetryDemo.style.display = 'none';

        this.updateLevelDisplay();

        // Retour a l'ecran d'accueil pour le niveau suivant
        this.gameScreen.style.display = 'none';
        this.homeScreen.style.display = 'flex';

        this.resetGameState();

        setTimeout(() => {
            this.startDemo();
        }, 500);
    }

    restartGame() {
        this.currentLevel = 1;
        this.result.style.display = 'none';
        this.btnNextLevel.style.display = 'none';
        this.btnRetryDemo.style.display = 'none';
        this.stopAllAudio();
        this.deactivateSpotlights();

        // Retour a l'ecran d'accueil
        this.gameScreen.style.display = 'none';
        this.homeScreen.style.display = 'flex';

        this.updateLevelDisplay();
        this.resetGameState();
    }

    resetGameState() {
        this.btnPlay.disabled = false;
        this.isGameActive = false;
        this.isPlaying = false;
        this.statusText.textContent = 'Premi PLAY per iniziare';

        document.querySelectorAll('.tile').forEach(t => {
            t.classList.remove('selected-correct', 'selected-wrong', 'disco-active');
        });

        this.createPreviewCouple();
    }

    // ========================================
    // V6 PRO: COMPARAISON D'ERREUR
    // ========================================
    showErrorComparison() {
        // Cacher le resultat, afficher la comparaison
        this.result.style.display = 'none';
        this.comparisonOverlay.style.display = 'flex';

        // Annuler toutes sequences en cours
        this.cancelAllSequences();

        // Recuperer les sequences
        const correctSeq = this.allSequences[this.correctTileId];
        const userSeq = this.allSequences[this.userSelectedTileId];

        console.log('=== COMPARAISON ===');
        console.log('Correct:', this.seqToString(correctSeq));
        console.log('User:', this.seqToString(userSeq));

        // Trouver le premier point de divergence
        let divergenceIndex = -1;
        for (let i = 0; i < Math.max(correctSeq.length, userSeq.length); i++) {
            if (correctSeq[i] !== userSeq[i]) {
                divergenceIndex = i;
                break;
            }
        }

        console.log('Divergence at index:', divergenceIndex);

        // Creer les couples pour la comparaison
        this.comparisonDemoCouple = new Couple(this.comparisonDemo, 'comp-demo', true, this.currentLevel);
        this.comparisonUserCouple = new Couple(this.comparisonUser, 'comp-user', true, this.currentLevel);

        // Message initial
        this.comparisonMessage.textContent = 'Osserva attentamente le due sequenze...';

        // Jouer la musique
        this.playLevelMusic();

        // Countdown de 3 secondes
        this.countdown.style.display = 'block';
        let count = 3;
        this.countdown.textContent = count;

        const countInterval = setInterval(() => {
            count--;
            if (count > 0) {
                this.countdown.textContent = count;
            } else {
                clearInterval(countInterval);
                this.countdown.style.display = 'none';
                this.playComparisonSequences(correctSeq, userSeq, divergenceIndex);
            }
        }, 1000);
    }

    playComparisonSequences(correctSeq, userSeq, divergenceIndex) {
        // Jouer les sequences jusqu'au point de divergence
        this.runComparisonSync(correctSeq, userSeq, 0, divergenceIndex);
    }

    runComparisonSync(correctSeq, userSeq, currentIndex, divergenceIndex) {
        // Si on a atteint le point de divergence, montrer la difference
        if (currentIndex >= divergenceIndex) {
            this.showDivergence(correctSeq, userSeq, divergenceIndex);
            return;
        }

        // Jouer le meme etat sur les deux couples
        const state = correctSeq[currentIndex];
        const duration1 = this.comparisonDemoCouple.transitionTo(state);
        const duration2 = this.comparisonUserCouple.transitionTo(state);
        const maxDuration = Math.max(duration1, duration2);

        // Continuer apres la transition
        const timeout = setTimeout(() => {
            this.runComparisonSync(correctSeq, userSeq, currentIndex + 1, divergenceIndex);
        }, maxDuration);

        this.sequenceTimeouts.push(timeout);
    }

    showDivergence(correctSeq, userSeq, divergenceIndex) {
        // LES SEQUENCES SE SONT ARRETEES AU POINT DE DIVERGENCE
        // Stocker les donnees pour le replay
        this.divergenceData = { correctSeq, userSeq, divergenceIndex };

        // Arreter la musique pour l'effet dramatique
        this.pauseMusic();

        // Arreter toutes les animations des danseurs
        if (this.comparisonDemoCouple) {
            this.comparisonDemoCouple.stopAnimations();
        }
        if (this.comparisonUserCouple) {
            this.comparisonUserCouple.stopAnimations();
        }

        // Cacher le bouton replay initialement
        this.btnComparisonReplay.style.display = 'none';

        // Message vide au debut
        this.comparisonMessage.innerHTML = ``;

        // V8: fenetres derivees des durees reelles des etats (G=2800, H=3000...)
        this.playDivergentStates(correctSeq, userSeq, divergenceIndex, 0);
    }

    /**
     * V8: joue l'etat divergent cote demo puis cote joueur, en attendant a
     * chaque fois la duree REELLE retournee par transitionTo (les croisements
     * G/H durent plus que les 2500ms historiques). Tous les timeouts sont
     * traques dans sequenceTimeouts pour etre annulables.
     */
    playDivergentStates(correctSeq, userSeq, divergenceIndex, startDelay) {
        const tEcco = setTimeout(() => {
            this.eccoMessage.style.display = 'block';
            const tHide = setTimeout(() => {
                this.eccoMessage.style.display = 'none';
            }, 600);
            this.sequenceTimeouts.push(tHide);
            this.comparisonMessage.innerHTML = `<strong>ECCO L'ERRORE!</strong>`;
        }, startDelay + 500);
        this.sequenceTimeouts.push(tEcco);

        const tDemo = setTimeout(() => {
            if (!this.comparisonDemoCouple) return;
            let demoDur = CONFIG.MOVE_DURATION;
            if (divergenceIndex < correctSeq.length) {
                demoDur = this.comparisonDemoCouple.transitionTo(correctSeq[divergenceIndex]);
            }

            const tUser = setTimeout(() => {
                if (this.comparisonDemoCouple) {
                    this.comparisonDemoCouple.stopAnimations();
                }
                if (!this.comparisonUserCouple) return;
                let userDur = CONFIG.MOVE_DURATION;
                if (divergenceIndex < userSeq.length) {
                    userDur = this.comparisonUserCouple.transitionTo(userSeq[divergenceIndex]);
                }

                const tEnd = setTimeout(() => {
                    const correctStateName = this.getStateName(correctSeq[divergenceIndex]);
                    const userStateName = this.getStateName(userSeq[divergenceIndex]);

                    this.comparisonMessage.innerHTML = `
                        <strong>DIFFERENZA TROVATA!</strong><br>
                        ✓ Sequenza corretta: <span style="color: #00ff00;">${correctStateName}</span><br>
                        ✗ Tua scelta: <span style="color: #ff4444;">${userStateName}</span><br>
                        <span style="font-size: 0.9rem; color: #aaa;">Osserva bene la differenza!</span>
                    `;

                    if (this.comparisonUserCouple) {
                        this.comparisonUserCouple.stopAnimations();
                    }
                    this.btnComparisonReplay.style.display = 'inline-block';
                }, userDur + 250);
                this.sequenceTimeouts.push(tEnd);
            }, demoDur + 250);
            this.sequenceTimeouts.push(tUser);
        }, startDelay + 1500);
        this.sequenceTimeouts.push(tDemo);
    }

    replayDivergence() {
        if (!this.divergenceData) return;

        const { correctSeq, userSeq, divergenceIndex } = this.divergenceData;

        // Cacher le bouton pendant le replay
        this.btnComparisonReplay.style.display = 'none';

        // Message vide
        this.comparisonMessage.innerHTML = ``;

        // Reinitialiser les couples a la position avant la divergence.
        // V8: le repositionnement peut lui-meme etre un croisement (jusqu'a
        // 3000ms) - on attend sa duree reelle avant de rejouer la divergence.
        let resetDur = 0;
        if (divergenceIndex > 0) {
            resetDur = Math.max(
                this.comparisonDemoCouple.transitionTo(correctSeq[divergenceIndex - 1]),
                this.comparisonUserCouple.transitionTo(userSeq[divergenceIndex - 1])
            );
        }

        // Arreter les animations
        if (this.comparisonDemoCouple) {
            this.comparisonDemoCouple.stopAnimations();
        }
        if (this.comparisonUserCouple) {
            this.comparisonUserCouple.stopAnimations();
        }

        // V8: meme deroule que showDivergence, fenetres aux durees reelles
        this.playDivergentStates(correctSeq, userSeq, divergenceIndex, resetDur);
    }

    getStateName(state) {
        const names = {
            [STATE.A]: 'Rotazione avanti',
            [STATE.B]: 'Rotazione indietro',
            [STATE.C]: 'Piroetta sul posto ✦ (lontani)',
            [STATE.D]: 'Piroetta sul posto ✦ (vicini)',
            [STATE.E]: 'Traslazione avanti',
            [STATE.F]: 'Traslazione indietro',
            [STATE.G]: 'Incrocio: giri alternati ✦',
            [STATE.H]: 'Incrocio: rotazione insieme ✦',
            [STATE.P]: 'Uscita perpendicolare (oraria) ⤵',
            [STATE.Q]: 'Uscita perpendicolare (antioraria) ⤴'
        };
        return names[state] || 'Sconosciuto';
    }

    closeComparisonAndRetry() {
        // Fermer la comparaison
        this.comparisonOverlay.style.display = 'none';

        // Nettoyer les couples de comparaison
        // V8: stopper leurs timers internes (etoiles, phases G) AVANT de
        // detacher le DOM, sinon les intervalles tournent pour toujours
        if (this.comparisonDemoCouple) {
            this.comparisonDemoCouple.stopAnimations();
            this.comparisonDemo.innerHTML = '';
            this.comparisonDemoCouple = null;
        }
        if (this.comparisonUserCouple) {
            this.comparisonUserCouple.stopAnimations();
            this.comparisonUser.innerHTML = '';
            this.comparisonUserCouple = null;
        }

        // Annuler les timeouts
        this.cancelAllSequences();

        // Reprendre avec la demo
        this.retryWithDemo();
    }
}

// ============================================
// INITIALISATION
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    window.game = new PizzicaGame();

    // V7: certains Android bloquent l'autoplay de la video d'ambiance tant
    // que l'utilisateur n'a pas interagi. On reessaie a chaque toucher
    // jusqu'a ce que la lecture demarre vraiment.
    const unlockBgVideo = () => {
        const v = document.getElementById('bg-video');
        if (!v || !v.paused) {
            document.removeEventListener('pointerup', unlockBgVideo);
            return;
        }
        v.play().then(() => {
            document.removeEventListener('pointerup', unlockBgVideo);
        }).catch(() => { /* on retentera au prochain toucher */ });
    };
    document.addEventListener('pointerup', unlockBgVideo);
});

// V7: service worker (PWA / Trusted Web Activity pour le Play Store)
if ('serviceWorker' in navigator && location.protocol === 'https:') {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(() => {});
    });
}
