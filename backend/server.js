import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import sqlite3 from 'sqlite3';
import cron from 'node-cron';
import * as webpush from 'web-push';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { scrapeJobs } from './scraper.js';

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
 * Persiste uma lista de vagas no SQLite em transação única e dispara Push para vagas novas
 */
function saveJobsToDatabase(jobs = [], notifyOnNew = true) {
    return new Promise((resolve) => {
        if (!Array.isArray(jobs) || jobs.length === 0) {
            return resolve({ processed: 0, newCount: 0 });
        }

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
                    SET match_score = ?, salary = ?, salary_brl = ?, work_hours = COALESCE(?, work_hours)
                    WHERE url = ?
                `);

                for (const job of jobs) {
                    if (!job?.url) continue;
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
                    if (notifyOnNew && newJobs.length > 0) {
                        const topJob = newJobs.reduce((best, cur) =>
                            (cur.match_score || 0) > (best.match_score || 0) ? cur : best
                        , newJobs[0]);

                        await sendPushNotificationToAll({
                            title: `🚀 ${newJobs.length} nova(s) vaga(s) Home Office!`,
                            body: `Destaque (${topJob.match_score}% Match): ${topJob.title} na ${topJob.company} • ${topJob.salary}`,
                            url: '/'
                        });
                    }
                    resolve({ processed: jobs.length, newCount: newJobs.length });
                });
            });
        });
    });
}

// Lock para evitar execuções concorrentes do scraper
let activeScrapePromise = null;

async function runScraper() {
    if (activeScrapePromise) {
        return activeScrapePromise;
    }

    activeScrapePromise = (async () => {
        console.log('[JobBot] Running job search...');
        try {
            const jobs = await scrapeJobs();
            const stats = await saveJobsToDatabase(jobs, true);
            return { jobs, newCount: stats.newCount };
        } catch (err) {
            console.error('[JobBot] Error running scraper:', err.message);
            return { jobs: [], newCount: 0 };
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
                body: 'Você receberá alertas sempre que surgirem novas vagas Home Office > 12k BRL ou USD/EUR.',
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
        body: 'Seu WebApp no iPhone está configurado e pronto para avisar sobre novas vagas diárias!',
        url: '/'
    });
    res.json({ message: 'Test notification dispatched.', ...result });
});

// Jobs Routes
app.get('/api/jobs', (req, res) => {
    db.all(`SELECT * FROM jobs ORDER BY date DESC, match_score DESC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ jobs: rows });
    });
});

app.post('/api/jobs/ingest', async (req, res) => {
    const jobs = req.body;
    if (!Array.isArray(jobs)) {
        return res.status(400).json({ error: 'Payload deve ser um array de vagas.' });
    }

    const stats = await saveJobsToDatabase(jobs, true);
    res.json({ message: `${jobs.length} vagas processadas!`, ...stats });
});

app.post('/api/jobs/scrape', async (req, res) => {
    try {
        const result = await runScraper();
        res.json({
            message: 'Scraping executed successfully!',
            processed: result.jobs.length,
            newCount: result.newCount
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

// Schedule cron job to run every day at 08:00 AM (America/Sao_Paulo)
cron.schedule('0 8 * * *', () => runScraper(), { timezone: 'America/Sao_Paulo' });

const server = app.listen(PORT, () => {
    console.log(`JobBot Backend & PWA server running on http://localhost:${PORT}`);
    runScraper();
});

function shutdown() {
    server.close(() => {
        db.close(() => process.exit(0));
    });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
