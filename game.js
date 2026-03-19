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
    // V6 PRO: Etats statiques durent 2 secondes pour etre bien visibles
    PAUSE_DURATION: 2000,
    TILE_COUNT: 4,
    MAX_LEVEL: 5
};

// ============================================
// CONFIGURATION DES NIVEAUX (NOUVELLE DUREE)
// Niveau 1 = 10s, +5s par niveau
// ============================================
const LEVELS = {
    1: {
        duration: 10,
        name: 'Principiante',
        music: 'Pizzicarella',
        audioId: 'audio-level-1'
    },
    2: {
        duration: 15,
        name: 'Facile',
        music: 'Beppe Junior - Pizzica Tarantata',
        audioId: 'audio-level-2'
    },
    3: {
        duration: 20,
        name: 'Medio',
        music: 'Pizzica Salento BTQ',
        audioId: 'audio-level-3'
    },
    4: {
        duration: 25,
        name: 'Difficile',
        music: 'Pizzicarella',
        audioId: 'audio-level-4'
    },
    5: {
        duration: 30,
        name: 'Esperto',
        music: 'Beppe Junior - Pizzica Tarantata',
        audioId: 'audio-level-5'
    }
};

// ============================================
// DEFINITION DES ETATS
// ============================================
const STATE = {
    A: 'ROTATION_FORWARD',
    B: 'ROTATION_BACKWARD',
    C: 'HUB_FAR',
    D: 'POSITION_CLOSE',
    E: 'TRANSLATE_FORWARD',
    F: 'TRANSLATE_BACKWARD'
};

// ============================================
// TRANSITIONS VALIDES
// ============================================
const VALID_TRANSITIONS = {
    [STATE.C]: [STATE.E, STATE.A, STATE.B],
    [STATE.E]: [STATE.D],
    [STATE.D]: [STATE.F],
    [STATE.F]: [STATE.C],
    [STATE.A]: [STATE.B, STATE.C],
    [STATE.B]: [STATE.A, STATE.C]
};

const STATE_DURATION = {
    [STATE.C]: CONFIG.PAUSE_DURATION,
    [STATE.D]: CONFIG.PAUSE_DURATION,
    [STATE.E]: CONFIG.MOVE_DURATION,
    [STATE.F]: CONFIG.MOVE_DURATION,
    [STATE.A]: CONFIG.MOVE_DURATION,
    [STATE.B]: CONFIG.MOVE_DURATION
};

// ============================================
// GENERATEUR DE SEQUENCES
// ============================================
function generateRandomSequence(targetDurationMs) {
    let sequence = [STATE.C];
    let totalDuration = STATE_DURATION[STATE.C];
    let currentState = STATE.C;

    while (totalDuration < targetDurationMs) {
        const validNextStates = VALID_TRANSITIONS[currentState];
        const nextState = validNextStates[Math.floor(Math.random() * validNextStates.length)];
        sequence.push(nextState);
        totalDuration += STATE_DURATION[nextState];
        currentState = nextState;
    }

    while (currentState !== STATE.C) {
        const validNextStates = VALID_TRANSITIONS[currentState];
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

        // Rayons pour la demo un peu plus grands
        this.radiusFar = isDemo ? 55 : CONFIG.RADIUS_FAR;
        this.radiusClose = isDemo ? 24 : CONFIG.RADIUS_CLOSE;
        this.dancerSize = isDemo ? 48 : CONFIG.DANCER_SIZE;

        this.currentState = STATE.C;
        this.wheelAngle = 0;
        this.radius = this.radiusFar;

        this.wheel = null;
        this.manWrapper = null;
        this.womanWrapper = null;

        this.createDOM();
        this.applyPosition(true);
    }

    createDOM() {
        this.wheel = document.createElement('div');
        this.wheel.className = 'couple-wheel';

        this.manWrapper = document.createElement('div');
        this.manWrapper.className = 'dancer-wrapper man-wrapper';
        const manImg = document.createElement('img');
        // Images dans le meme dossier
        manImg.src = 'man.png';
        manImg.className = 'dancer';
        manImg.alt = 'Man';
        this.manWrapper.appendChild(manImg);

        this.womanWrapper = document.createElement('div');
        this.womanWrapper.className = 'dancer-wrapper woman-wrapper';
        const womanImg = document.createElement('img');
        // Images dans le meme dossier
        womanImg.src = 'woman.png';
        womanImg.className = 'dancer';
        womanImg.alt = 'Woman';
        this.womanWrapper.appendChild(womanImg);

        this.wheel.appendChild(this.manWrapper);
        this.wheel.appendChild(this.womanWrapper);
        this.container.appendChild(this.wheel);
    }

    applyPosition(instant = false) {
        const duration = instant ? '0ms' : `${CONFIG.MOVE_DURATION}ms`;

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
                if (prevState === STATE.D || prevState === STATE.F) {
                    duration = CONFIG.PAUSE_DURATION;
                }
                // V6 PRO: ETAT STATIQUE - agiter les bras (2 secondes)
                this.setAnimationClass('static-state');
                break;

            case STATE.D:
                this.radius = this.radiusClose;
                duration = CONFIG.PAUSE_DURATION;
                // V6 PRO: ETAT STATIQUE - agiter les bras (2 secondes)
                this.setAnimationClass('static-state');
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
        }

        this.applyPosition();
        return duration;
    }

    // V6 PRO: Methodes pour gerer les animations dynamiques
    clearAnimationClasses() {
        const classes = ['dancing', 'rotating', 'translating', 'close', 'flip', 'static-state'];
        classes.forEach(cls => {
            this.manWrapper.classList.remove(cls);
            this.womanWrapper.classList.remove(cls);
        });
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
        this.createPreviewCouple();
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
        for (let i = 1; i <= CONFIG.MAX_LEVEL; i++) {
            const audio = document.getElementById(`audio-level-${i}`);
            if (audio) {
                audio.pause();
                audio.currentTime = 0;
            }
        }
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
        this.demoLevelInfo.textContent = `Livello ${this.currentLevel} - Durata: ${levelInfo.duration}s`;
    }

    createPreviewCouple() {
        // Couple en position initiale sur l'ecran d'accueil
        const existingWheel = this.demoPreview.querySelector('.couple-wheel');
        if (existingWheel) existingWheel.remove();

        this.previewCouple = new Couple(this.demoPreview, 'preview', true, this.currentLevel);
    }

    createDanceFloor() {
        this.danceFloor.innerHTML = '';
        this.couples = [];

        for (let i = 0; i < CONFIG.TILE_COUNT; i++) {
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
        // Creer le couple demo
        this.createDemoCouple();

        // Afficher l'overlay de demo
        this.demoOverlay.style.display = 'flex';
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

        // Recreer les couples
        this.createDanceFloor();
        this.createDemoCouple();

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
        this.demoOverlay.style.display = 'flex';
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

        this.correctTileId = Math.floor(Math.random() * CONFIG.TILE_COUNT);

        console.log('Correct tile ID:', this.correctTileId);

        // V6 PRO: Stocker les sequences pour la comparaison d'erreur
        this.allSequences = this.generateIntelligentSequences();
        const allSequences = this.allSequences;

        document.querySelectorAll('.tile').forEach(t => {
            t.classList.add('disco-active');
            t.classList.remove('selected-correct', 'selected-wrong');
        });

        this.couples.forEach(c => c.reset());

        this.runAllSequences(allSequences, 0);
    }

    generateIntelligentSequences() {
        // V6 PRO: Divergence progressive - Les sequences commencent ensemble puis divergent
        const targetDuration = LEVELS[this.currentLevel].duration * 1000;
        const correctSeq = this.currentSequence;

        // Extraire le tronc commun initial (2-3 premiers etats)
        const commonTrunkLength = Math.min(3, Math.max(2, Math.floor(correctSeq.length * 0.25)));
        const commonTrunk = correctSeq.slice(0, commonTrunkLength);

        // Construire les 4 sequences avec divergence progressive
        const sequences = [];

        // TILE 1: Diverge en premier (apres le tronc commun)
        const seq1 = this.buildDivergentSequence(commonTrunk, targetDuration, 'early');
        sequences.push(seq1);

        // TILES 2, 3, 4: Partagent un segment commun supplementaire
        const midTrunkLength = Math.min(
            correctSeq.length - 2,
            commonTrunkLength + Math.max(1, Math.floor(correctSeq.length * 0.2))
        );
        const midTrunk = correctSeq.slice(0, midTrunkLength);

        // TILE 2: Diverge en second
        const seq2 = this.buildDivergentSequence(midTrunk, targetDuration, 'mid');
        sequences.push(seq2);

        // TILES 3 & 4: Tres similaires, divergent presque a la fin
        const lateTrunkLength = Math.min(
            correctSeq.length - 1,
            midTrunkLength + Math.max(1, Math.floor(correctSeq.length * 0.3))
        );
        const lateTrunk = correctSeq.slice(0, lateTrunkLength);

        const seq3 = this.buildDivergentSequence(lateTrunk, targetDuration, 'late');
        const seq4 = this.buildDivergentSequence(lateTrunk, targetDuration, 'late', seq3); // Eviter seq3

        sequences.push(seq3);
        sequences.push(seq4);

        // La sequence correcte est l'une des deux dernieres (3 ou 4)
        const correctIndex = Math.random() < 0.5 ? 2 : 3;
        sequences[correctIndex] = [...correctSeq];
        this.correctTileId = correctIndex;

        // Verification anti-doublons
        this.ensureUniqueSequences(sequences);

        console.log('=== DIVERGENCE PROGRESSIVE ===');
        console.log('Tronc commun initial:', this.seqToString(commonTrunk));
        console.log('Tronc median (tiles 2-4):', this.seqToString(midTrunk));
        console.log('Tronc tardif (tiles 3-4):', this.seqToString(lateTrunk));
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
            const validNextStates = VALID_TRANSITIONS[currentState];

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
            const validNextStates = VALID_TRANSITIONS[currentState];
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
            this.applySubtleModification(sequence);
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
        // Modifier legerement la sequence pour la rendre unique
        if (sequence.length > 4) {
            const pos = sequence.length - 3;
            const currentState = sequence[pos];
            const validStates = VALID_TRANSITIONS[currentState];
            if (validStates.length > 1) {
                // Trouver une alternative differente
                const alternatives = validStates.filter(s => s !== sequence[pos + 1]);
                if (alternatives.length > 0) {
                    sequence[pos + 1] = alternatives[0];
                }
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
        // Verifier et corriger les doublons
        for (let i = 0; i < sequences.length; i++) {
            for (let j = i + 1; j < sequences.length; j++) {
                if (this.sequencesEqual(sequences[i], sequences[j])) {
                    console.warn(`⚠️ Sequences ${i} et ${j} identiques, correction...`);
                    this.applySubtleModification(sequences[j]);
                    // Re-verifier
                    if (this.sequencesEqual(sequences[i], sequences[j])) {
                        // Si toujours identiques, modifier plus drastiquement
                        if (sequences[j].length > 5) {
                            const pos = sequences[j].length - 4;
                            sequences[j].splice(pos, 1); // Supprimer un etat
                        }
                    }
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

    runAllSequences(allSequences, index) {
        const maxLength = Math.max(...allSequences.map(s => s.length));

        if (index >= maxLength) {
            this.finishGame();
            return;
        }

        let maxDuration = 0;

        for (let i = 0; i < CONFIG.TILE_COUNT; i++) {
            const sequence = allSequences[i];
            const state = index < sequence.length ? sequence[index] : sequence[sequence.length - 1];
            const duration = this.couples[i].transitionTo(state);
            maxDuration = Math.max(maxDuration, duration);
        }

        setTimeout(() => {
            this.runAllSequences(allSequences, index + 1);
        }, maxDuration);
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

        this.couples.forEach(c => c.transitionTo(STATE.C));
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

        // Attendre un peu, puis afficher "ECCO!"
        setTimeout(() => {
            // 1. Afficher "ECCO!" brievement
            this.eccoMessage.style.display = 'block';
            setTimeout(() => {
                this.eccoMessage.style.display = 'none';
            }, 600);

            // Message
            this.comparisonMessage.innerHTML = `<strong>ECCO L'ERRORE!</strong>`;
        }, 500);

        // 2. DEMO montre l'etat correct
        setTimeout(() => {
            if (divergenceIndex < correctSeq.length) {
                this.comparisonDemoCouple.transitionTo(correctSeq[divergenceIndex]);
            }
        }, 1500);

        // 3. DEMO s'arrete, puis USER montre l'etat incorrect
        setTimeout(() => {
            // Arreter demo
            if (this.comparisonDemoCouple) {
                this.comparisonDemoCouple.stopAnimations();
            }

            // Demarrer user choice
            if (divergenceIndex < userSeq.length) {
                this.comparisonUserCouple.transitionTo(userSeq[divergenceIndex]);
            }

            // Afficher le message final et le bouton replay
            setTimeout(() => {
                const correctStateName = this.getStateName(correctSeq[divergenceIndex]);
                const userStateName = this.getStateName(userSeq[divergenceIndex]);

                this.comparisonMessage.innerHTML = `
                    <strong>DIFFERENZA TROVATA!</strong><br>
                    ✓ Sequenza corretta: <span style="color: #00ff00;">${correctStateName}</span><br>
                    ✗ Tua scelta: <span style="color: #ff4444;">${userStateName}</span><br>
                    <span style="font-size: 0.9rem; color: #aaa;">Osserva bene la differenza!</span>
                `;

                // Arreter user choice aussi
                if (this.comparisonUserCouple) {
                    this.comparisonUserCouple.stopAnimations();
                }

                // Afficher le bouton pour revoir la difference
                this.btnComparisonReplay.style.display = 'inline-block';
            }, 2500);
        }, 4000);
    }

    replayDivergence() {
        if (!this.divergenceData) return;

        const { correctSeq, userSeq, divergenceIndex } = this.divergenceData;

        // Cacher le bouton pendant le replay
        this.btnComparisonReplay.style.display = 'none';

        // Message vide
        this.comparisonMessage.innerHTML = ``;

        // Reinitialiser les couples a la position avant la divergence
        if (divergenceIndex > 0) {
            this.comparisonDemoCouple.transitionTo(correctSeq[divergenceIndex - 1]);
            this.comparisonUserCouple.transitionTo(userSeq[divergenceIndex - 1]);
        }

        // Arreter les animations
        if (this.comparisonDemoCouple) {
            this.comparisonDemoCouple.stopAnimations();
        }
        if (this.comparisonUserCouple) {
            this.comparisonUserCouple.stopAnimations();
        }

        // Attendre un peu (simuler que les sequences jouent jusqu'au point de divergence)
        // puis afficher "ECCO!"
        setTimeout(() => {
            // Afficher "ECCO!" brievement
            this.eccoMessage.style.display = 'block';
            setTimeout(() => {
                this.eccoMessage.style.display = 'none';
            }, 600);

            // Message
            this.comparisonMessage.innerHTML = `<strong>ECCO L'ERRORE!</strong>`;
        }, 500);

        // Rejouer la sequence de divergence - DEMO d'abord
        setTimeout(() => {
            if (divergenceIndex < correctSeq.length) {
                this.comparisonDemoCouple.transitionTo(correctSeq[divergenceIndex]);
            }
        }, 1500);

        // Puis USER choice
        setTimeout(() => {
            // Arreter demo
            if (this.comparisonDemoCouple) {
                this.comparisonDemoCouple.stopAnimations();
            }

            // Demarrer user
            if (divergenceIndex < userSeq.length) {
                this.comparisonUserCouple.transitionTo(userSeq[divergenceIndex]);
            }

            setTimeout(() => {
                const correctStateName = this.getStateName(correctSeq[divergenceIndex]);
                const userStateName = this.getStateName(userSeq[divergenceIndex]);

                this.comparisonMessage.innerHTML = `
                    <strong>DIFFERENZA TROVATA!</strong><br>
                    ✓ Sequenza corretta: <span style="color: #00ff00;">${correctStateName}</span><br>
                    ✗ Tua scelta: <span style="color: #ff4444;">${userStateName}</span><br>
                    <span style="font-size: 0.9rem; color: #aaa;">Osserva bene la differenza!</span>
                `;

                // Arreter user choice
                if (this.comparisonUserCouple) {
                    this.comparisonUserCouple.stopAnimations();
                }

                this.btnComparisonReplay.style.display = 'inline-block';
            }, 2500);
        }, 4000);
    }

    getStateName(state) {
        const names = {
            [STATE.A]: 'Rotazione avanti',
            [STATE.B]: 'Rotazione indietro',
            [STATE.C]: 'Posizione lontana',
            [STATE.D]: 'Posizione vicina',
            [STATE.E]: 'Traslazione avanti',
            [STATE.F]: 'Traslazione indietro'
        };
        return names[state] || 'Sconosciuto';
    }

    closeComparisonAndRetry() {
        // Fermer la comparaison
        this.comparisonOverlay.style.display = 'none';

        // Nettoyer les couples de comparaison
        if (this.comparisonDemoCouple) {
            this.comparisonDemo.innerHTML = '';
            this.comparisonDemoCouple = null;
        }
        if (this.comparisonUserCouple) {
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
});
