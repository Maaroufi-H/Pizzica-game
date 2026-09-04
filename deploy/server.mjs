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
    return 'public, max-age=300';
}

const server = createServer(async (req, res) => {
    try {
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
                    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(clean));
                } catch (e) {
                    res.writeHead(400, { 'Content-Type': 'text/plain' }).end('JSON non valido');
                }
            });
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
