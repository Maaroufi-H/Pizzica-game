# Strumenti del motore di movimenti (V16–V21)

* `bvh_dancer.py` — motion capture CMU (BVH) → scheletro → sprite; foulard simulato (`--hanky`), composizione (`--upper`), filtro giri (`--maxyaw`).
* `pose_extract.py` — video → pose 3D per immagine (MediaPipe PoseLandmarker, modello `pose_landmarker_full.task` da scaricare).
* `video_dancer.py` — pose video → scheletro del gioco, ciclo di passo, selezione di boucle distinte, export a tempo (`--man` / `--woman`), medley.
* `bpm.py` — tempo (bpm) e primo battito di un file audio.
* `build_man_sprite.py` — normalizzazione delle immagini (corpo 156 px su tela 160) usata dagli sprite V16–V20.

Vedi `docs/DANZA.md` §3–§7.
