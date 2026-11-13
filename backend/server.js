import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import sqlite3 from 'sqlite3';
import cron from 'node-cron';
import fs from 'fs';
import path from 'path';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const DB_PATH = path.resolve('data/jobs.db');

// Ensure data dir exists
if (!fs.existsSync(path.dirname(DB_PATH))) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
}

const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('Error opening database', err.message);
    } else {
        console.log('Connected to SQLite database.');
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
            status TEXT DEFAULT 'New'
        )`);
    }
});

// API Routes
app.get('/api/jobs', (req, res) => {
    db.all(`SELECT * FROM jobs ORDER BY date DESC, match_score DESC`, [], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json({ jobs: rows });
    });
});

// POST /api/jobs/ingest
app.post('/api/jobs/ingest', (req, res) => {
    const jobs = req.body; // Array de vagas seguindo o contrato acima
    if (!Array.isArray(jobs)) {
        return res.status(400).json({ error: 'Payload deve ser um array de vagas.' });
    }

    const stmt = db.prepare(`
        INSERT OR IGNORE INTO jobs 
        (title, company, location, salary, currency, salary_brl, platform, url, date, match_score) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    jobs.forEach(job => {
        stmt.run([
            job.title, job.company, job.location, job.salary,
            job.currency, job.salary_brl, job.platform, job.url,
            job.date, job.match_score
        ]);
    });

    stmt.finalize((err) => {
        if (err) {
            console.error('Error finalizing statement:', err.message);
        }
    });
    res.json({ message: `${jobs.length} vagas processadas!` });
});

app.post('/api/jobs/scrape', (req, res) => {
    // Mock scraper trigger for demonstration / manual run
    runScraper();
    res.json({ message: 'Scraping executed successfully!' });
});

app.patch('/api/jobs/:id', (req, res) => {
    const { status } = req.body;
    const { id } = req.params;
    db.run(`UPDATE jobs SET status = ? WHERE id = ?`, [status, id], function(err) {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json({ message: 'Job status updated successfully' });
    });
});

// Scraper function (simulated intelligent search for remote jobs paying > 12k BRL or foreign currency)
function runScraper() {
    console.log('[JobBot] Running daily job search...');
    
    // Sample mock jobs matching user profile (Gian, Software Engineer / Fullstack, Remote, > 12k BRL / Foreign currency)
    const sampleJobs = [
        {
            title: 'Senior Full Stack Engineer (Remote)',
            company: 'Global Tech Corp',
            location: 'Remote (US)',
            salary: '$5,000 / month',
            currency: 'USD',
            salary_brl: 25000,
            platform: 'LinkedIn',
            url: 'https://www.linkedin.com/jobs/view/sample-1',
            date: new Date().toISOString().split('T')[0],
            match_score: 98
        },
        {
            title: 'Desenvolvedor Backend Senior Node.js/Python',
            company: 'Inova Brasil',
            location: 'Home Office',
            salary: 'R$ 15.000 - R$ 18.000',
            currency: 'BRL',
            salary_brl: 16500,
            platform: 'Gulpy / Remotar',
            url: 'https://remotar.com.br/job/sample-2',
            date: new Date().toISOString().split('T')[0],
            match_score: 92
        },
        {
            title: 'Software Engineer - Remote LatAm',
            company: 'Silicon Valley Startup',
            location: 'Remote',
            salary: '$4,500 / month',
            currency: 'USD',
            salary_brl: 22500,
            platform: 'LinkedIn',
            url: 'https://www.linkedin.com/jobs/view/sample-3',
            date: new Date().toISOString().split('T')[0],
            match_score: 95
        }
    ];

    sampleJobs.forEach(job => {
        db.run(`INSERT OR IGNORE INTO jobs (title, company, location, salary, currency, salary_brl, platform, url, date, match_score) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [job.title, job.company, job.location, job.salary, job.currency, job.salary_brl, job.platform, job.url, job.date, job.match_score],
            (err) => {
                if (err) console.error('Error inserting job:', err.message);
            }
        );
    });
}

// Schedule cron job to run every day at 08:00 AM
cron.schedule('0 8 * * *', () => {
    runScraper();
});

app.listen(PORT, () => {
    console.log(`JobBot Backend running on port ${PORT}`);
    // Run once on start for instant testing
    runScraper();
});
