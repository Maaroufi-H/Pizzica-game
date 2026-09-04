/**
 * Pizzica Master - serveur statique minimal pour apps.marofai.site
 * - support des requetes Range (seek audio/mp4)
 * - aucun listing de repertoire, aucune donnee sensible
 * Lancement: PORT=3020 node deploy/server.mjs  (racine servie = dossier parent)
 * ROOT_DIR=/chemin  pour servir une autre racine (ex: multi-versions v1/v2/v3)
 */
import { createServer } from 'node:http';
import { promises as fsp, createReadStream } from 'node:fs';
import { join, resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(process.env.ROOT_DIR || fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.env.PORT || 3020);
const HOST = process.env.HOST || '127.0.0.1';

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.mp3': 'audio/mpeg',
    '.mp4': 'video/mp4',
    '.woff2': 'font/woff2',
    '.txt': 'text/plain; charset=utf-8',
};

// cache long pour les gros medias immuables, court pour le code du jeu
function cacheControl(ext, name) {
    if (name === 'dance-config.json') return 'no-store';
    if (['.mp3', '.mp4', '.png', '.webp', '.jpg', '.jpeg'].includes(ext)) {
        return 'public, max-age=86400';
    }
    // V22: html/css/js/json sempre rivalidati (il browser mostrava per 5 min la vecchia versione)
    if (['.html', '.css', '.js', '.mjs', '.json', '.webmanifest'].includes(ext)) return 'no-cache';
    return 'public, max-age=300';
}

// V22: pool Postgres (Railway) creato al primo uso; senza variabili o senza modulo -> null (503)
let pgPool = null, pgTried = false;
async function getPool() {
    if (pgPool || pgTried) return pgPool;
    pgTried = true;
    const e = process.env;
    if (!e.RAILWAY_PG_PROXY || !e.POSTGRES_USER) return null;
    try {
        const pg = (await import('pg')).default;
        pgPool = new pg.Pool({ host: e.RAILWAY_PG_PROXY, port: +e.RAILWAY_PG_PROXY_PORT, user: e.POSTGRES_USER,
            password: e.RAILWAY_PG_PASSWORD, database: e.POSTGRES_DB, ssl: { rejectUnauthorized: false }, max: 3 });
        await pgPool.query(`create table if not exists pizzica_players (
            key text primary key, name text not null, level int not null default 1, best_level int not null default 1,
            games int not null default 0, created_at timestamptz not null default now(), updated_at timestamptz not null default now())`);
    } catch (err) { console.error('postgres non disponibile:', err.message); pgPool = null; }
    return pgPool;
}

const server = createServer(async (req, res) => {
    try {
        // V22: giocatori — nome, livello da riprendere, record. Postgres Railway (la base di
        // marofai.site), variabili in /etc/pizzica-game/db.env; modulo 'pg' in app/node_modules.
        if (req.method === 'POST' && (req.url === '/api/player/login' || req.url === '/api/player/progress')) {
            let body = '';
            req.on('data', (c) => { body += c; if (body.length > 2000) req.destroy(); });
            req.on('end', async () => {
                try {
                    const pool = await getPool();
                    if (!pool) { res.writeHead(503, { 'Content-Type': 'text/plain' }).end('base dati non configurata'); return; }
                    const data = JSON.parse(body || '{}');
                    const name = String(data.name || '').replace(/\s+/g, ' ').trim().slice(0, 24);
                    if (!/^[\p{L}\p{N} _.'\-]{2,24}$/u.test(name)) { res.writeHead(400, { 'Content-Type': 'text/plain' }).end('nome non valido'); return; }
                    const key = name.toLowerCase();
                    let row;
                    if (req.url === '/api/player/login') {
                        row = (await pool.query(
                            `insert into pizzica_players (key, name) values ($1, $2)
                             on conflict (key) do update set updated_at = now()
                             returning name, level, best_level, games`, [key, name])).rows[0];
                    } else {
                        const level = Math.max(1, Math.min(99, parseInt(data.level, 10) || 1));
                        const completed = data.completed === true;
                        row = (await pool.query(
                            `update pizzica_players set level = $2, best_level = greatest(best_level, $3),
                             games = games + $4, updated_at = now() where key = $1
                             returning name, level, best_level, games`, [key, level, completed ? 99 : Math.max(1, level - 1), completed ? 1 : 0])).rows[0];
                        if (!row) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('giocatore sconosciuto'); return; }
                    }
                    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(row));
                } catch (e) {
                    console.error('player api:', e.message);
                    res.writeHead(500, { 'Content-Type': 'text/plain' }).end('errore base dati');
                }
            });
            return;
        }
        if (/^\/(node_modules|package(-lock)?\.json)(\/|$)/.test(req.url)) { res.writeHead(404).end(); return; }
        // V20: la racine renvoie une redirection HTTP (302, jamais mise en cache) vers la
        // version courante lue dans <ROOT>/CURRENT — un cache (proxy, navigateur, app
        // Android) ne peut plus garder une vieille page d'accueil pointant sur une vieille version.
        if (req.url === '/' || req.url.startsWith('/?') || req.url === '/index.html') {
            let cur = '';
            try { cur = (await fsp.readFile(join(ROOT, 'CURRENT'), 'utf8')).trim(); } catch (e) { cur = ''; }
            if (/^v\d+$/.test(cur)) {
                res.writeHead(302, { Location: `/${cur}/`, 'Cache-Control': 'no-store' }).end();
                return;
            }
        }
        // V24: sauvegarde de la matrice des mouvements (admin), token obligatoire
        if (req.method === 'POST' && req.url === '/api/dance-config') {
            const token = process.env.ADMIN_TOKEN || '';
            if (!token || req.headers['x-admin-token'] !== token) {
                res.writeHead(401, { 'Content-Type': 'text/plain' }).end('token non valido');
                return;
            }
            let body = '';
            req.on('data', (c) => { body += c; if (body.length > 20000) req.destroy(); });
            req.on('end', async () => {
                try {
                    const cfg = JSON.parse(body);
                    const clean = { man: {}, woman: {} };
                    for (const role of ['man', 'woman']) {
                        for (const [k, v] of Object.entries(cfg[role] || {})) {
                            if (/^[A-Z_]{1,8}$/.test(k) && /^[mw]\d{1,2}$/.test(String(v))) clean[role][k] = String(v);
                        }
                    }
                    await fsp.writeFile(join(ROOT, 'dance-config.json'), JSON.stringify(clean, null, 2));
                    // V21: storico delle matrici salvate (nome, data, contenuto), ultime 60
                    const name = String(cfg.name || '').replace(/[^\w\s\-.àèéìòù]/g, '').slice(0, 40).trim() || 'senza nome';
                    let hist = [];
                    try { hist = JSON.parse(await fsp.readFile(join(ROOT, 'dance-history.json'), 'utf8')); } catch (e) { hist = []; }
                    if (!Array.isArray(hist)) hist = [];
                    hist.unshift({ name, at: new Date().toISOString(), man: clean.man, woman: clean.woman });
                    await fsp.writeFile(join(ROOT, 'dance-history.json'), JSON.stringify(hist.slice(0, 60), null, 1));
                    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(clean));
                } catch (e) {
                    res.writeHead(400, { 'Content-Type': 'text/plain' }).end('JSON non valido');
                }
            });
            return;
        }
        // V22: progresso dei giocatori per l'amministrazione (token obbligatorio)
        if (req.method === 'GET' && req.url.split('?')[0] === '/api/players') {
            const token = process.env.ADMIN_TOKEN || '';
            if (!token || req.headers['x-admin-token'] !== token) { res.writeHead(401, { 'Content-Type': 'text/plain' }).end('token non valido'); return; }
            try {
                const pool = await getPool();
                if (!pool) { res.writeHead(503, { 'Content-Type': 'text/plain' }).end('base dati non configurata'); return; }
                const r = await pool.query('select name, level, best_level, games, created_at, updated_at from pizzica_players order by updated_at desc limit 500');
                res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(r.rows));
            } catch (e) { res.writeHead(500, { 'Content-Type': 'text/plain' }).end('errore base dati'); }
            return;
        }
        // V21: lettura dello storico (pubblico: contiene solo nomi di movimenti)
        if (req.method === 'GET' && req.url.split('?')[0] === '/api/dance-history') {
            let hist = '[]';
            try { hist = await fsp.readFile(join(ROOT, 'dance-history.json'), 'utf8'); } catch (e) { hist = '[]'; }
            res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(hist);
            return;
        }
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.writeHead(405, { Allow: 'GET, HEAD, POST' }).end();
            return;
        }

        let pathname;
        try {
            pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
        } catch {
            res.writeHead(400).end();
            return;
        }
        if (pathname.endsWith('/')) pathname += 'index.html';

        const filePath = resolve(join(ROOT, pathname));
        // anti path-traversal + jamais servir .git ni deploy/ (a n'importe
        // quelle profondeur: en multi-versions chaque checkout a les siens)
        const segments = filePath.split(sep);
        if (!filePath.startsWith(ROOT + sep) ||
            segments.includes('.git') ||
            segments.includes('deploy')) {
            res.writeHead(404).end('Not found');
            return;
        }

        let st;
        try {
            st = await fsp.stat(filePath);
        } catch {
            res.writeHead(404).end('Not found');
            return;
        }
        if (!st.isFile()) {
            res.writeHead(404).end('Not found');
            return;
        }

        const ext = extname(filePath).toLowerCase();
        const headers = {
            'Content-Type': MIME[ext] || 'application/octet-stream',
            'Accept-Ranges': 'bytes',
            'Cache-Control': cacheControl(ext, filePath.split(sep).pop()),
        };

        const range = req.headers.range;
        if (range) {
            const m = /^bytes=(\d*)-(\d*)$/.exec(range);
            let start, end;
            if (m && (m[1] !== '' || m[2] !== '')) {
                if (m[1] === '') {           // bytes=-N : N derniers octets
                    const n = Number(m[2]);
                    start = Math.max(0, st.size - n);
                    end = st.size - 1;
                } else {
                    start = Number(m[1]);
                    end = m[2] === '' ? st.size - 1 : Math.min(Number(m[2]), st.size - 1);
                }
            }
            if (start === undefined || start >= st.size || start > end) {
                res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }).end();
                return;
            }
            headers['Content-Range'] = `bytes ${start}-${end}/${st.size}`;
            headers['Content-Length'] = end - start + 1;
            res.writeHead(206, headers);
            if (req.method === 'HEAD') { res.end(); return; }
            createReadStream(filePath, { start, end }).pipe(res);
            return;
        }

        headers['Content-Length'] = st.size;
        res.writeHead(200, headers);
        if (req.method === 'HEAD') { res.end(); return; }
        createReadStream(filePath).pipe(res);
    } catch (err) {
        console.error(err);
        if (!res.headersSent) res.writeHead(500);
        res.end();
    }
});

server.listen(PORT, HOST, () => {
    console.log(`Pizzica Master sert ${ROOT} sur http://${HOST}:${PORT}`);
});
