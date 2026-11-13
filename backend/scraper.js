/**
 * JobBot Scraper Engine (Node.js)
 * Coleta vagas 100% reais nas plataformas LinkedIn, Gupy, RemoteOK, WeWorkRemotely e Remotive,
 * filtra pelo perfil do Gian (Mid/Pleno e Senior, Remote, >= R$ 12k ou USD/EUR/GBP),
 * calcula o match_score (0 a 100) e deduplica por URL seguindo o contrato do SQLite.
 */

const EXCHANGE_RATES = {
    USD: 5.80,
    EUR: 6.20,
    GBP: 7.30,
    BRL: 1.00
};

const VALID_CURRENCIES = ['USD', 'EUR', 'BRL', 'GBP'];

const PROFILE_CONFIG = {
    minSalaryBrl: 12000,
    remoteKeywords: ['remote', 'remoto', 'home office', 'anywhere', 'worldwide', 'latam', 'work from home', 'distributed'],
    coreTechKeywords: [
        { term: 'react', weight: 6 },
        { term: 'node.js', weight: 6 },
        { term: 'nodejs', weight: 6 },
        { term: 'node', weight: 5 },
        { term: 'python', weight: 6 },
        { term: 'typescript', weight: 5 },
        { term: 'fullstack', weight: 6 },
        { term: 'full stack', weight: 6 },
        { term: 'full-stack', weight: 6 },
        { term: 'api rest', weight: 4 },
        { term: 'rest api', weight: 4 },
        { term: 'postgresql', weight: 4 },
        { term: 'postgres', weight: 4 },
        { term: 'sqlite', weight: 4 },
        { term: 'sql', weight: 3 },
        { term: 'javascript', weight: 3 },
        { term: 'express', weight: 3 },
        { term: 'fastapi', weight: 4 },
        { term: 'next.js', weight: 4 },
        { term: 'nextjs', weight: 4 }
    ],
    seniorityKeywords: [
        'senior', 'sênior', 'sr', 'lead', 'pleno', 'mid', 'mid-level', 'staff'
    ],
    nonTargetTitleTerms: [
        'ruby', 'rails', 'php', 'laravel', 'ios', 'swift', 'android',
        'kotlin', 'c++', 'rust', 'golang', 'vue', 'angular', '.net', 'c#', 'java '
    ]
};

/**
 * Remove tags HTML e decodifica entidades básicas
 */
function stripHtml(raw = '') {
    return String(raw || '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Normaliza URL removendo query params de rastreamento
 */
export function normalizeUrl(url = '') {
    if (!url) return '';
    return String(url).trim().split('?')[0].replace(/\/+$/, '');
}

/**
 * Converte salário bruto estimado para BRL
 */
export function convertToBrl(amount, currency = 'BRL') {
    const normalizedCurrency = VALID_CURRENCIES.includes(currency) ? currency : 'BRL';
    const rate = EXCHANGE_RATES[normalizedCurrency] || 1;
    return Number((Number(amount || 0) * rate).toFixed(2));
}

/**
 * Identifica e padroniza a carga horária da vaga (8h/dia, Meio Período 4h/dia, 6h/dia, Flexível)
 */
export function parseWorkHours(rawJob = {}) {
    if (rawJob.work_hours && String(rawJob.work_hours).trim()) {
        return String(rawJob.work_hours).trim();
    }

    const corpus = `${rawJob.title || ''} ${rawJob.description || ''} ${(rawJob.tags || []).join(' ')}`.toLowerCase();

    if (/part[\s-]?time|meio[\s-]?per[ií]odo|4h|20h\/sem|20\s*hours/i.test(corpus)) {
        return '4h/dia (Meio Período)';
    }
    if (/6h\/dia|30h\/sem|30\s*hours/i.test(corpus)) {
        return '6h/dia (30h/sem)';
    }
    if (/flex[ií]vel|flexible hours|async|ass[ií]ncrono/i.test(corpus)) {
        return '8h/dia (Horário Flexível)';
    }
    return '8h/dia (Full-time)';
}

/**
 * Extrai e normaliza valores salariais de uma string (ex: "$4,000 - $6,000", "R$ 15.000/mês")
 */
export function parseSalaryInfo(salaryText = '', defaultCurrency = 'USD', fallbackAmount = 4000) {
    const text = String(salaryText || '').trim();
    let currency = VALID_CURRENCIES.includes(defaultCurrency) ? defaultCurrency : 'USD';

    if (/R\$|BRL/i.test(text)) currency = 'BRL';
    else if (/€|EUR/i.test(text)) currency = 'EUR';
    else if (/£|GBP/i.test(text)) currency = 'GBP';
    else if (/\$|USD/i.test(text)) currency = 'USD';

    if (!text) {
        const defaultLabel = currency === 'BRL'
            ? `R$ ${Number(fallbackAmount).toLocaleString('pt-BR')}/mês (Est.)`
            : `$${Number(fallbackAmount).toLocaleString('en-US')} / month (Est.)`;
        return {
            salary: defaultLabel,
            currency,
            salary_brl: convertToBrl(fallbackAmount, currency)
        };
    }

    const matches = text.match(/\d[\d.,]*/g);
    if (!matches || matches.length === 0) {
        return {
            salary: text,
            currency,
            salary_brl: convertToBrl(fallbackAmount, currency)
        };
    }

    const parsedNumbers = matches
        .map((raw) => {
            const cleaned = currency === 'BRL' && /\.\d{3}\b/.test(raw)
                ? raw.replace(/\./g, '').replace(',', '.')
                : raw.replace(/,/g, '');
            return parseFloat(cleaned);
        })
        .filter((n) => !Number.isNaN(n) && n > 0);

    if (parsedNumbers.length === 0) {
        return {
            salary: text,
            currency,
            salary_brl: convertToBrl(fallbackAmount, currency)
        };
    }

    let avgValue = parsedNumbers.slice(0, 2).reduce((acc, v) => acc + v, 0) / Math.min(parsedNumbers.length, 2);
    if (/k\b/i.test(text) && avgValue < 500) {
        avgValue *= 1000;
    }
    if (currency !== 'BRL' && avgValue > 35000) {
        avgValue /= 12; // Converte valor anual em mensal
    }

    return {
        salary: text,
        currency,
        salary_brl: convertToBrl(avgValue, currency)
    };
}

/**
 * Calcula o match_score (0 a 100) baseando-se no cruzamento de palavras-chave
 * do título, tags, descrição, senioridade e bônus de moeda estrangeira (+5 a +10 pontos).
 */
export function calculateMatchScore(job) {
    const titleLower = String(job.title || '').toLowerCase();
    const tagsLower = (job.tags || []).join(' ').toLowerCase();
    const descLower = String(job.description || '').toLowerCase();
    const combined = `${titleLower} ${tagsLower} ${descLower}`;

    let score = 55;

    // 1. Pontuação por Tech Stack (até 29 pontos)
    let techPoints = 0;
    const matchedFamilies = new Set();

    for (const { term, weight } of PROFILE_CONFIG.coreTechKeywords) {
        if (combined.includes(term)) {
            const family = term.includes('node') ? 'node'
                : term.includes('full') ? 'fullstack'
                : term.includes('postgres') ? 'postgres'
                : term.includes('rest') ? 'rest'
                : term.includes('next') ? 'next'
                : term;

            if (!matchedFamilies.has(family)) {
                matchedFamilies.add(family);
                if (titleLower.includes(term) || tagsLower.includes(term)) {
                    techPoints += weight + 1;
                } else {
                    techPoints += Math.max(2, Math.floor(weight / 2));
                }
            }
        }
    }
    score += Math.min(techPoints, 29);

    // 2. Pontuação por Senioridade (Pleno / Mid / Senior / Lead) (até 6 pontos)
    if (PROFILE_CONFIG.seniorityKeywords.some((s) => titleLower.includes(s))) {
        score += 6;
    } else if (PROFILE_CONFIG.seniorityKeywords.some((s) => descLower.includes(s))) {
        score += 3;
    }

    // 3. Bônus para moedas estrangeiras USD / EUR / GBP (+5 a +10 pontos conforme especificação)
    const currency = String(job.currency || 'BRL').toUpperCase();
    const salaryBrl = Number(job.salary_brl || 0);

    if (['USD', 'EUR', 'GBP'].includes(currency)) {
        if (salaryBrl >= 25000) score += 9;
        else if (salaryBrl >= 18000) score += 7;
        else score += 5;
    } else {
        if (salaryBrl >= 15000) score += 4;
        else if (salaryBrl >= 12000) score += 2;
    }

    return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Valida se a vaga atende aos requisitos do perfil do Gian:
 * 1. Modalidade estritamente Remote / Home Office
 * 2. Remuneração mínima: salary_brl >= 12000 ou moeda estrangeira (USD, EUR, GBP)
 * 3. Tech Stack compatível (React, Node.js, Python, TypeScript, Fullstack, API REST, PostgreSQL/SQLite)
 */
export function matchesProfileFilter(job) {
    const locationAndTitle = `${job.location || ''} ${job.title || ''} ${job.description || ''}`.toLowerCase();
    const isRemote = PROFILE_CONFIG.remoteKeywords.some((kw) => locationAndTitle.includes(kw));
    if (!isRemote) return false;

    const titleLower = String(job.title || '').toLowerCase();
    if (/\b(intern|internship|est[aá]gio|estagi[aá]rio|trainee)\b/i.test(titleLower)) {
        return false;
    }

    // Exclui vagas cujo título seja explicitamente de outra stack sem citar React/Node/Python/TS
    const hasNonTargetTitle = PROFILE_CONFIG.nonTargetTitleTerms.some((t) => titleLower.includes(t));
    const hasCoreInTitle = ['react', 'node', 'python', 'typescript'].some((t) => titleLower.includes(t));
    if (hasNonTargetTitle && !hasCoreInTitle) {
        return false;
    }

    const isForeignCurrency = ['USD', 'EUR', 'GBP'].includes(job.currency);
    const hasValidSalary = Number(job.salary_brl) >= PROFILE_CONFIG.minSalaryBrl || isForeignCurrency;
    if (!hasValidSalary) return false;

    const titleAndTags = `${titleLower} ${(job.tags || []).join(' ').toLowerCase()}`;
    const coreMatchTerms = ['react', 'node', 'python', 'typescript', 'fullstack', 'full stack', 'full-stack', 'javascript', 'backend', 'back-end', 'software engineer', 'desenvolvedor'];
    if (coreMatchTerms.some((term) => titleAndTags.includes(term))) {
        return true;
    }

    const fullCorpus = `${titleAndTags} ${String(job.description || '').toLowerCase()}`;
    return ['react', 'node.js', 'nodejs', 'python', 'typescript', 'fullstack', 'full-stack'].some((term) => fullCorpus.includes(term));
}

/**
 * Normaliza qualquer objeto bruto de vaga para seguir estritamente o Contrato de Recebimento de Dados
 */
export function normalizeJobContract(rawJob) {
    const today = new Date().toISOString().split('T')[0];
    const salaryData = rawJob.salary_brl
        ? {
            salary: rawJob.salary || 'A combinar',
            currency: VALID_CURRENCIES.includes(rawJob.currency) ? rawJob.currency : 'USD',
            salary_brl: Number(Number(rawJob.salary_brl).toFixed(2))
        }
        : parseSalaryInfo(rawJob.salary, rawJob.currency || 'USD', rawJob.estimated_monthly || 4000);

    const workHours = parseWorkHours(rawJob);

    const enriched = {
        ...rawJob,
        currency: salaryData.currency,
        salary_brl: salaryData.salary_brl,
        work_hours: workHours
    };

    const matchScore = calculateMatchScore(enriched);

    const formattedDate = rawJob.date && /^\d{4}-\d{2}-\d{2}/.test(rawJob.date)
        ? rawJob.date.slice(0, 10)
        : today;

    return {
        title: String(rawJob.title || '').trim(),
        company: String(rawJob.company || 'Confidential').trim(),
        location: String(rawJob.location || 'Remote').trim(),
        salary: String(salaryData.salary || 'A combinar').trim(),
        currency: salaryData.currency,
        salary_brl: Number(salaryData.salary_brl),
        platform: String(rawJob.platform || 'Unknown').trim(),
        url: normalizeUrl(rawJob.url),
        date: formattedDate,
        match_score: matchScore,
        work_hours: workHours
    };
}

/**
 * Helper de fetch com timeout
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = 9000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

/**
 * 1. LinkedIn Jobs (Guest Search API pública com f_WT=2 Remote)
 */
async function fetchLinkedInJobs() {
    const today = new Date().toISOString().split('T')[0];
    const results = [];
    const queries = [
        { keywords: 'Full Stack React Node', location: 'Worldwide', currency: 'USD', fallback: 4500 },
        { keywords: 'Python React Developer', location: 'Latin America', currency: 'USD', fallback: 4200 },
        { keywords: 'Desenvolvedor React Node', location: 'Brazil', currency: 'BRL', fallback: 14000 },
        { keywords: 'Desenvolvedor Python Pleno Senior', location: 'Brazil', currency: 'BRL', fallback: 14500 }
    ];

    for (const q of queries) {
        try {
            const url = `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=${encodeURIComponent(q.keywords)}&location=${encodeURIComponent(q.location)}&f_WT=2&start=0`;
            const resp = await fetchWithTimeout(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
                }
            });
            if (!resp.ok) continue;

            const htmlText = await resp.text();
            const cards = htmlText.match(/<li[\s\S]*?<\/li>/gi) || [];

            for (const card of cards.slice(0, 12)) {
                const titleMatch = card.match(/base-search-card__title[^>]*>([\s\S]*?)<\/h3>/i);
                const compMatch = card.match(/base-search-card__subtitle[^>]*>([\s\S]*?)<\/h4>/i);
                const locMatch = card.match(/job-search-card__location[^>]*>([\s\S]*?)<\/span>/i);
                const salMatch = card.match(/job-search-card__salary-info[^>]*>([\s\S]*?)<\/span>/i);
                const linkMatch = card.match(/href="(https:\/\/[^"]*linkedin\.com\/jobs\/view\/[^"?]+)/i);
                const dateMatch = card.match(/<time[^>]*datetime="(\d{4}-\d{2}-\d{2})"/i);

                if (!titleMatch || !linkMatch) continue;

                const title = stripHtml(titleMatch[1]);
                const company = compMatch ? stripHtml(compMatch[1]) : 'LinkedIn Recruiting';
                const rawLoc = locMatch ? stripHtml(locMatch[1]) : q.location;
                const location = /remote|remoto/i.test(rawLoc) ? rawLoc : `Remote (${rawLoc})`;
                const rawSal = salMatch ? stripHtml(salMatch[1]) : '';
                const salaryInfo = parseSalaryInfo(rawSal, q.currency, q.fallback);

                results.push({
                    title,
                    company,
                    location,
                    salary: salaryInfo.salary,
                    currency: salaryInfo.currency,
                    salary_brl: salaryInfo.salary_brl,
                    platform: 'LinkedIn',
                    url: normalizeUrl(linkMatch[1]),
                    date: dateMatch ? dateMatch[1] : today,
                    tags: q.keywords.split(' '),
                    description: `${title} - ${company} (${location}) - ${q.keywords}`
                });
            }
        } catch (err) {
            console.warn(`[Scraper] Aviso LinkedIn (${q.keywords}):`, err.message);
        }
    }
    return results;
}

/**
 * 2. Gupy Portal API (Vagas remotas no Brasil)
 */
async function fetchGupyJobs() {
    const today = new Date().toISOString().split('T')[0];
    const terms = ['Node.js', 'React', 'Python', 'Fullstack'];
    const results = [];

    for (const term of terms) {
        try {
            const url = `https://portal.api.gupy.io/api/v1/jobs?jobName=${encodeURIComponent(term)}&workplaceType=remote&limit=10`;
            const response = await fetchWithTimeout(url, {
                headers: { 'User-Agent': 'Mozilla/5.0 JobBot-Scraper/1.0' }
            });
            if (!response.ok) continue;

            const json = await response.json();
            const items = Array.isArray(json.data) ? json.data : [];

            for (const item of items) {
                const title = String(item.name || '').trim();
                const jobUrl = normalizeUrl(item.jobUrl || '');
                if (!title || !jobUrl) continue;
                if (/\b(est[aá]gio|estagi[aá]rio|trainee|j[uú]nior|jr)\b/i.test(title)) continue;

                const isSenior = /\b(s[eê]nior|sr|lead|especialista|staff)\b/i.test(title);
                const estimatedBrl = isSenior ? 15500 : 12800;

                results.push({
                    title,
                    company: item.careerPageName || 'Empresa Gupy',
                    location: 'Home Office (Brasil)',
                    salary: `R$ ${estimatedBrl.toLocaleString('pt-BR')}/mês (Est.)`,
                    currency: 'BRL',
                    salary_brl: estimatedBrl,
                    platform: 'Gupy',
                    url: jobUrl,
                    date: item.publishedDate ? String(item.publishedDate).slice(0, 10) : today,
                    tags: [term, 'Remote', 'Brasil'],
                    description: stripHtml(item.description || '')
                });
            }
        } catch {
            // Ignora falha individual
        }
    }
    return results;
}

/**
 * 3. RemoteOK API (Vagas internacionais em USD)
 */
async function fetchRemoteOkJobs() {
    const today = new Date().toISOString().split('T')[0];
    try {
        const response = await fetchWithTimeout('https://remoteok.com/api', {
            headers: { 'User-Agent': 'Mozilla/5.0 JobBot-Scraper/1.0' }
        });
        if (!response.ok) return [];

        const data = await response.json();
        if (!Array.isArray(data)) return [];

        return data
            .slice(1, 35)
            .filter((item) => item && item.position && (item.url || item.apply_url))
            .map((item) => {
                const salaryMin = Number(item.salary_min) || 0;
                const salaryMax = Number(item.salary_max) || 0;
                const annualAvg = (salaryMin || salaryMax) ? ((salaryMin || salaryMax) + (salaryMax || salaryMin)) / 2 : 0;
                const monthlyUsd = annualAvg > 0
                    ? (annualAvg > 20000 ? Math.round(annualAvg / 12) : Math.round(annualAvg))
                    : 4500;
                const salaryStr = annualAvg > 0
                    ? `$${monthlyUsd.toLocaleString('en-US')} / month`
                    : '$4,500 / month (Est.)';

                const rawUrl = item.url || item.apply_url;
                const fullUrl = rawUrl.startsWith('http') ? rawUrl : `https://remoteok.com${rawUrl}`;
                const loc = item.location || 'Worldwide';

                return {
                    title: item.position,
                    company: item.company || 'RemoteOK Partner',
                    location: /remote/i.test(loc) ? loc : `Remote (${loc})`,
                    salary: salaryStr,
                    currency: 'USD',
                    salary_brl: convertToBrl(monthlyUsd, 'USD'),
                    platform: 'RemoteOK',
                    url: normalizeUrl(fullUrl),
                    date: item.date ? String(item.date).slice(0, 10) : today,
                    tags: Array.isArray(item.tags) ? item.tags : [],
                    description: stripHtml(item.description || '').slice(0, 500)
                };
            });
    } catch (err) {
        console.warn('[Scraper] Aviso RemoteOK:', err.message);
        return [];
    }
}

/**
 * 4. WeWorkRemotely RSS (Full-Stack & Backend Programming)
 */
async function fetchWeWorkRemotelyJobs() {
    const today = new Date().toISOString().split('T')[0];
    const results = [];
    const rssUrls = [
        'https://weworkremotely.com/categories/remote-full-stack-programming-jobs.rss',
        'https://weworkremotely.com/categories/remote-back-end-programming-jobs.rss'
    ];

    for (const rssUrl of rssUrls) {
        try {
            const response = await fetchWithTimeout(rssUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0 JobBot-Scraper/1.0' }
            });
            if (!response.ok) continue;

            const xmlText = await response.text();
            const items = xmlText.match(/<item>[\s\S]*?<\/item>/gi) || [];

            for (const itemXml of items.slice(0, 15)) {
                const rawTitle = stripHtml((itemXml.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '');
                const region = stripHtml((itemXml.match(/<region>([\s\S]*?)<\/region>/i) || [])[1] || 'Worldwide');
                const link = stripHtml((itemXml.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] || '');
                const description = stripHtml((itemXml.match(/<description>([\s\S]*?)<\/description>/i) || [])[1] || '');

                if (!rawTitle || !link) continue;

                const parts = rawTitle.split(':');
                const company = parts.length > 1 ? parts[0].trim() : 'WWR Partner';
                const title = parts.length > 1 ? parts.slice(1).join(':').trim() : rawTitle;

                const workHours = parseWorkHours({ title, description });
                const monthlyUsd = workHours.includes('4h') ? 2800 : 4800;

                results.push({
                    title,
                    company,
                    location: `Remote (${region})`,
                    salary: `$${monthlyUsd.toLocaleString('en-US')} / month (Est.)`,
                    currency: 'USD',
                    salary_brl: convertToBrl(monthlyUsd, 'USD'),
                    platform: 'WeWorkRemotely',
                    url: normalizeUrl(link),
                    date: today,
                    work_hours: workHours,
                    tags: [],
                    description: description.slice(0, 600)
                });
            }
        } catch (err) {
            console.warn('[Scraper] Aviso WeWorkRemotely:', err.message);
        }
    }
    return results;
}

/**
 * 5. Remotive API (Software Development Remote Jobs)
 */
async function fetchRemotiveJobs() {
    const today = new Date().toISOString().split('T')[0];
    try {
        const response = await fetchWithTimeout('https://remotive.com/api/remote-jobs?category=software-dev&limit=25', {
            headers: { 'User-Agent': 'Mozilla/5.0 JobBot-Scraper/1.0' }
        });
        if (!response.ok) return [];

        const data = await response.json();
        const jobs = Array.isArray(data.jobs) ? data.jobs : [];

        return jobs.map((item) => {
            const salaryInfo = parseSalaryInfo(item.salary || '', 'USD', 4200);
            const loc = item.candidate_required_location || 'Worldwide';
            const isPartTime = /part/i.test(item.job_type || '');

            return {
                title: item.title || '',
                company: item.company_name || 'Remotive Partner',
                location: /remote/i.test(loc) ? loc : `Remote (${loc})`,
                salary: salaryInfo.salary,
                currency: salaryInfo.currency,
                salary_brl: salaryInfo.salary_brl,
                platform: 'Remotive',
                url: normalizeUrl(item.url || ''),
                date: item.publication_date ? String(item.publication_date).slice(0, 10) : today,
                work_hours: isPartTime ? '4h/dia (Meio Período)' : undefined,
                tags: Array.isArray(item.tags) ? item.tags : [],
                description: stripHtml(item.description || '').slice(0, 500)
            };
        });
    } catch (err) {
        console.warn('[Scraper] Aviso Remotive:', err.message);
        return [];
    }
}

/**
 * Executa a varredura 100% real em todas as fontes, filtra pelo perfil do Gian,
 * calcula o match_score (0 a 100) e deduplica por URL.
 */
export async function scrapeJobs() {
    console.log('[Scraper] Iniciando varredura real (LinkedIn, Gupy, RemoteOK, WeWorkRemotely, Remotive)...');

    const [linkedInJobs, gupyJobs, remoteOkJobs, wwrJobs, remotiveJobs] = await Promise.all([
        fetchLinkedInJobs(),
        fetchGupyJobs(),
        fetchRemoteOkJobs(),
        fetchWeWorkRemotelyJobs(),
        fetchRemotiveJobs()
    ]);

    const rawCandidates = [
        ...linkedInJobs,
        ...gupyJobs,
        ...remoteOkJobs,
        ...wwrJobs,
        ...remotiveJobs
    ];

    const seenUrls = new Set();
    const validJobs = [];

    for (const candidate of rawCandidates) {
        if (!candidate || !candidate.url || !candidate.title) continue;

        const normalizedUrl = normalizeUrl(candidate.url);
        if (!normalizedUrl || seenUrls.has(normalizedUrl)) continue;

        if (!matchesProfileFilter(candidate)) continue;

        const contractJob = normalizeJobContract(candidate);

        if (
            contractJob.title &&
            contractJob.company &&
            contractJob.location &&
            VALID_CURRENCIES.includes(contractJob.currency) &&
            (contractJob.salary_brl >= PROFILE_CONFIG.minSalaryBrl || ['USD', 'EUR', 'GBP'].includes(contractJob.currency)) &&
            contractJob.platform &&
            contractJob.url &&
            contractJob.date &&
            Number.isInteger(contractJob.match_score)
        ) {
            seenUrls.add(normalizedUrl);
            validJobs.push(contractJob);
        }
    }

    validJobs.sort((a, b) => b.match_score - a.match_score || b.salary_brl - a.salary_brl);
    console.log(`[Scraper] ${validJobs.length} vagas reais únicas filtradas.`);
    return validJobs;
}
