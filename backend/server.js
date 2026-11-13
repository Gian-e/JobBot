import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import sqlite3 from 'sqlite3';
import cron from 'node-cron';
import * as webpush from 'web-push';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
    scrapeJobs,
    checkIfJobUrlIsOpen,
    getCutoffDateIso,
    isJobDateOpen,
    matchesProfileFilter
} from './scraper.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.resolve(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'jobs.db');
const VAPID_FILE = path.join(DATA_DIR, 'vapid.json');
const VALID_STATUSES = new Set(['New', 'Applied', 'Interviewing', 'Rejected']);

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

function initVapidKeys() {
    if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
        return {
            publicKey: process.env.VAPID_PUBLIC_KEY,
            privateKey: process.env.VAPID_PRIVATE_KEY
        };
    }
    if (fs.existsSync(VAPID_FILE)) {
        try {
            const saved = JSON.parse(fs.readFileSync(VAPID_FILE, 'utf-8'));
            if (saved.publicKey && saved.privateKey) return saved;
        } catch {
            // Regenerate if corrupted
        }
    }
    const generated = webpush.generateVAPIDKeys();
    fs.writeFileSync(VAPID_FILE, JSON.stringify(generated, null, 2), 'utf-8');
    return generated;
}

const vapidKeys = initVapidKeys();
const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:gian@jobbot.app';
webpush.setVapidDetails(vapidSubject, vapidKeys.publicKey, vapidKeys.privateKey);

const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
        return;
    }
    console.log('Connected to SQLite database.');
    db.serialize(() => {
        db.run(`PRAGMA journal_mode = WAL`);
        db.run(`PRAGMA synchronous = NORMAL`);
        db.run(`CREATE TABLE IF NOT EXISTS jobs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT,
            company TEXT,
            location TEXT,
            salary TEXT,
            currency TEXT,
            salary_brl REAL,
            platform TEXT,
            url TEXT UNIQUE,
            date TEXT,
            match_score INTEGER,
            work_hours TEXT DEFAULT '8h/dia (Full-time)',
            status TEXT DEFAULT 'New'
        )`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_jobs_date_score ON jobs (date DESC, match_score DESC)`);
        db.run(`CREATE TABLE IF NOT EXISTS push_subscriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            endpoint TEXT UNIQUE,
            keys_p256dh TEXT,
            keys_auth TEXT,
            created_at TEXT
        )`);
    });
});

/**
 * Retorna o horário atual em Brasília (ex: "11h" ou "23h")
 */
function getBrtHourLabel() {
    try {
        const hour = new Intl.DateTimeFormat('pt-BR', {
            timeZone: 'America/Sao_Paulo',
            hour: '2-digit',
            hour12: false
        }).format(new Date());
        return `${hour}h`;
    } catch {
        return `${new Date().getHours()}h`;
    }
}

/**
 * Envia notificação Web Push para todos os dispositivos inscritos
 */
function sendPushNotificationToAll(payload) {
    return new Promise((resolve) => {
        db.all(`SELECT endpoint, keys_p256dh, keys_auth FROM push_subscriptions`, [], async (err, rows) => {
            if (err || !rows?.length) {
                return resolve({ sent: 0, total: 0 });
            }

            const message = JSON.stringify({
                title: payload.title || 'JobBot 🤖💼',
                body: payload.body || 'Novas vagas remotas disponíveis!',
                url: payload.url || '/',
                icon: '/icon-192.png',
                badge: '/icon-192.png'
            });

            let sent = 0;
            await Promise.all(
                rows.map(async (sub) => {
                    try {
                        await webpush.sendNotification(
                            {
                                endpoint: sub.endpoint,
                                keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth }
                            },
                            message
                        );
                        sent += 1;
                    } catch (pushErr) {
                        if (pushErr.statusCode === 404 || pushErr.statusCode === 410) {
                            db.run(`DELETE FROM push_subscriptions WHERE endpoint = ?`, [sub.endpoint]);
                        } else {
                            console.error('[WebPush] Error sending notification:', pushErr.message);
                        }
                    }
                })
            );

            resolve({ sent, total: rows.length });
        });
    });
}

/**
 * Verifica todas as vagas salvas no banco e apaga as que têm datas encerradas/antigas
 * ou cujas páginas já encerraram as inscrições ("Applications closed", 404, deadline vencido, etc.)
 */
function purgeClosedAndExpiredJobs() {
    return new Promise((resolve) => {
        const cutoffIso = getCutoffDateIso();
        const todayIso = new Date().toISOString().slice(0, 10);

        // 1. Remove imediatamente vagas com datas vencidas (< cutoff) ou inválidas
        db.run(
            `DELETE FROM jobs WHERE date IS NULL OR date < ? OR date > ?`,
            [cutoffIso, todayIso],
            function (dateDelErr) {
                const deletedByDate = !dateDelErr && this?.changes ? this.changes : 0;

                // 2. Verifica cada vaga restante para confirmar se a vaga ainda está aberta na plataforma
                db.all(`SELECT id, title, company, location, salary_brl, currency, url, date FROM jobs`, [], async (err, rows) => {
                    if (err || !rows?.length) {
                        if (deletedByDate > 0) {
                            console.log(`[JobBot] ${deletedByDate} vaga(s) com data encerrada removida(s).`);
                        }
                        return resolve({ removedCount: deletedByDate });
                    }

                    const idsToDelete = [];
                    const concurrency = 6;

                    for (let i = 0; i < rows.length; i += concurrency) {
                        const chunk = rows.slice(i, i + concurrency);
                        const results = await Promise.all(
                            chunk.map(async (row) => {
                                if (!isJobDateOpen(row.date) || !matchesProfileFilter(row)) {
                                    return row.id;
                                }
                                const stillOpen = await checkIfJobUrlIsOpen(row);
                                return stillOpen ? null : row.id;
                            })
                        );
                        for (const closedId of results) {
                            if (closedId !== null) idsToDelete.push(closedId);
                        }
                    }

                    if (idsToDelete.length === 0) {
                        if (deletedByDate > 0) {
                            console.log(`[JobBot] ${deletedByDate} vaga(s) com data encerrada removida(s).`);
                        }
                        return resolve({ removedCount: deletedByDate });
                    }

                    const placeholders = idsToDelete.map(() => '?').join(',');
                    db.run(`DELETE FROM jobs WHERE id IN (${placeholders})`, idsToDelete, function (delErr) {
                        const deletedByCheck = !delErr && this?.changes ? this.changes : 0;
                        const totalRemoved = deletedByDate + deletedByCheck;
                        console.log(`[JobBot] Limpeza concluída: ${totalRemoved} vaga(s) fechada(s)/expirada(s) apagada(s).`);
                        resolve({ removedCount: totalRemoved });
                    });
                });
            }
        );
    });
}

// Controle para evitar disparos duplicados de Push no mesmo ciclo (ex: cron interno + GitHub Actions juntos)
let lastScrapePushAt = 0;

/**
 * Persiste uma lista de vagas abertas no SQLite em transação única e dispara Push com o número de novas vagas
 */
function saveJobsToDatabase(jobs = [], { notifyOnNew = true, alwaysNotify = false } = {}) {
    return new Promise((resolve) => {
        const openValidJobs = (Array.isArray(jobs) ? jobs : []).filter(
            (job) => job?.url && isJobDateOpen(job.date)
        );

        db.all(`SELECT url FROM jobs`, [], (err, existingRows) => {
            if (err) {
                console.error('Error reading existing jobs:', err.message);
                return resolve({ processed: 0, newCount: 0 });
            }

            const existingUrls = new Set((existingRows || []).map((r) => r.url));
            const newJobs = [];

            db.serialize(() => {
                db.run(`BEGIN TRANSACTION`);

                const insertStmt = db.prepare(`
                    INSERT INTO jobs 
                    (title, company, location, salary, currency, salary_brl, platform, url, date, match_score, work_hours) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `);

                const updateStmt = db.prepare(`
                    UPDATE jobs
                    SET match_score = ?, salary = ?, salary_brl = ?, date = ?, work_hours = COALESCE(?, work_hours)
                    WHERE url = ?
                `);

                for (const job of openValidJobs) {
                    const workHours = job.work_hours || '8h/dia (Full-time)';
                    const salary = job.salary || 'A combinar';

                    if (!existingUrls.has(job.url)) {
                        existingUrls.add(job.url);
                        newJobs.push(job);
                        insertStmt.run([
                            job.title,
                            job.company,
                            job.location,
                            salary,
                            job.currency,
                            job.salary_brl,
                            job.platform,
                            job.url,
                            job.date,
                            job.match_score,
                            workHours
                        ]);
                    } else {
                        updateStmt.run([
                            job.match_score,
                            salary,
                            job.salary_brl,
                            job.date,
                            job.work_hours || null,
                            job.url
                        ]);
                    }
                }

                insertStmt.finalize();
                updateStmt.finalize();

                db.run(`COMMIT`, async (commitErr) => {
                    if (commitErr) {
                        console.error('Error committing jobs transaction:', commitErr.message);
                    }

                    const newCount = newJobs.length;
                    const nowMs = Date.now();
                    const recentlyNotified = nowMs - lastScrapePushAt < 5 * 60 * 1000;
                    const hourLabel = getBrtHourLabel();

                    if (newCount > 0 && (notifyOnNew || alwaysNotify)) {
                        lastScrapePushAt = nowMs;
                        const topJob = newJobs.reduce(
                            (best, cur) => ((cur.match_score || 0) > (best.match_score || 0) ? cur : best),
                            newJobs[0]
                        );

                        await sendPushNotificationToAll({
                            title: `🚀 JobBot (${hourLabel}): ${newCount} nova(s) vaga(s)!`,
                            body: `${newCount} nova(s) vaga(s) aberta(s) encontrada(s). Destaque: ${topJob.title} na ${topJob.company} • ${topJob.salary}`,
                            url: '/'
                        });
                    } else if (alwaysNotify && !recentlyNotified) {
                        lastScrapePushAt = nowMs;
                        await sendPushNotificationToAll({
                            title: `🔔 JobBot (${hourLabel}): 0 novas vagas`,
                            body: `Busca das ${hourLabel} concluída: 0 novas vagas abertas no momento (${existingUrls.size} vagas ativas no painel).`,
                            url: '/'
                        });
                    }

                    resolve({ processed: openValidJobs.length, newCount });
                });
            });
        });
    });
}

// Lock para evitar execuções concorrentes do worker
let activeScrapePromise = null;

async function runScraper({ alwaysNotify = false } = {}) {
    if (activeScrapePromise) {
        return activeScrapePromise;
    }

    activeScrapePromise = (async () => {
        console.log('[JobBot] Verificando vagas encerradas e buscando novas vagas abertas...');
        try {
            // 1. Apaga vagas com datas encerradas ou inscrições fechadas já salvas no banco
            const cleanup = await purgeClosedAndExpiredJobs();
            // 2. Coleta e valida novas vagas abertas
            const jobs = await scrapeJobs();
            const stats = await saveJobsToDatabase(jobs, { notifyOnNew: true, alwaysNotify });
            return {
                jobs,
                newCount: stats.newCount,
                removedClosedCount: cleanup.removedCount
            };
        } catch (err) {
            console.error('[JobBot] Error running scraper:', err.message);
            return { jobs: [], newCount: 0, removedClosedCount: 0 };
        } finally {
            activeScrapePromise = null;
        }
    })();

    return activeScrapePromise;
}

// Healthcheck
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Web Push Routes
app.get('/api/push/vapid-public-key', (req, res) => {
    db.get(`SELECT COUNT(*) as count FROM push_subscriptions`, [], (err, row) => {
        res.json({
            publicKey: vapidKeys.publicKey,
            subscriptionsCount: row ? row.count : 0
        });
    });
});

app.post('/api/push/subscribe', (req, res) => {
    const subscription = req.body;
    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
        return res.status(400).json({ error: 'Invalid push subscription payload.' });
    }

    const now = new Date().toISOString();
    db.run(
        `INSERT OR REPLACE INTO push_subscriptions (endpoint, keys_p256dh, keys_auth, created_at) VALUES (?, ?, ?, ?)`,
        [subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, now],
        async (err) => {
            if (err) return res.status(500).json({ error: err.message });

            await sendPushNotificationToAll({
                title: 'JobBot conectado no iPhone! 📲',
                body: 'Você receberá alertas às 11h e às 23h com o número de novas vagas abertas!',
                url: '/'
            });
            res.json({ message: 'Push subscription registered successfully!' });
        }
    );
});

app.post('/api/push/unsubscribe', (req, res) => {
    const { endpoint } = req.body || {};
    if (!endpoint) return res.status(400).json({ error: 'Endpoint is required.' });

    db.run(`DELETE FROM push_subscriptions WHERE endpoint = ?`, [endpoint], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Unsubscribed successfully.' });
    });
});

app.post('/api/push/test', async (req, res) => {
    const result = await sendPushNotificationToAll({
        title: '🔔 Notificação de Teste • JobBot',
        body: 'Seu WebApp no iPhone está configurado para avisar às 11h e 23h sobre novas vagas!',
        url: '/'
    });
    res.json({ message: 'Test notification dispatched.', ...result });
});

// Jobs Routes (ordenadas por data de abertura: mais recentes primeiro)
app.get('/api/jobs', (req, res) => {
    const cutoffIso = getCutoffDateIso();
    db.all(
        `SELECT * FROM jobs WHERE date >= ? ORDER BY date DESC, id DESC`,
        [cutoffIso],
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ jobs: rows });
        }
    );
});

app.post('/api/jobs/ingest', async (req, res) => {
    const jobs = req.body;
    if (!Array.isArray(jobs)) {
        return res.status(400).json({ error: 'Payload deve ser um array de vagas.' });
    }

    const stats = await saveJobsToDatabase(jobs, { notifyOnNew: true, alwaysNotify: false });
    res.json({ message: `${jobs.length} vagas processadas!`, ...stats });
});

app.post('/api/jobs/scrape', async (req, res) => {
    try {
        const result = await runScraper({ alwaysNotify: true });
        res.json({
            message: 'Scraping executed successfully!',
            processed: result.jobs.length,
            newCount: result.newCount,
            removedClosedCount: result.removedClosedCount
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.patch('/api/jobs/:id', (req, res) => {
    const { status } = req.body || {};
    const { id } = req.params;
    if (!VALID_STATUSES.has(status)) {
        return res.status(400).json({ error: 'Invalid status value.' });
    }

    db.run(`UPDATE jobs SET status = ? WHERE id = ?`, [status, id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Job status updated successfully' });
    });
});

// Serve Frontend build (PWA) in production / unified mode
const frontendDist = path.resolve(__dirname, '../frontend/dist');
if (fs.existsSync(frontendDist)) {
    app.use(express.static(frontendDist));
    app.get('*', (req, res, next) => {
        if (req.path.startsWith('/api')) return next();
        res.sendFile(path.join(frontendDist, 'index.html'));
    });
}

// Agendamento 2x por dia: às 11:00 e às 23:00 (Horário de Brasília - America/Sao_Paulo)
cron.schedule(
    '0 11,23 * * *',
    () => {
        runScraper({ alwaysNotify: true });
    },
    { timezone: 'America/Sao_Paulo' }
);

const server = app.listen(PORT, () => {
    console.log(`JobBot Backend & PWA server running on http://localhost:${PORT}`);
    // Ao iniciar, se o banco estiver vazio, executa a primeira varredura
    db.get(`SELECT COUNT(*) as count FROM jobs`, [], (err, row) => {
        if (!err && (!row || row.count === 0)) {
            runScraper({ alwaysNotify: false });
        } else {
            purgeClosedAndExpiredJobs();
        }
    });
});

function shutdown() {
    server.close(() => {
        db.close(() => process.exit(0));
    });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
