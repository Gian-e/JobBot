/**
 * JobBot Scraper Engine (Node.js)
 * Coleta vagas reais nas plataformas LinkedIn, Gupy, RemoteOK, WeWorkRemotely e Remotive,
 * valida se as vagas continuam abertas (data recente, deadline ativo e página sem aviso de encerramento),
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
const FOREIGN_CURRENCIES = new Set(['USD', 'EUR', 'GBP']);

// Idade máxima permitida para uma vaga ser considerada ativa/recente (em dias)
export const MAX_JOB_AGE_DAYS = 21;

const PROFILE_CONFIG = {
    minSalaryBrl: 12000,
    remoteKeywords: ['remote', 'remoto', 'home office', 'anywhere', 'worldwide', 'latam', 'work from home', 'distributed'],
    coreTechKeywords: [
        { term: 'react', weight: 6, family: 'react' },
        { term: 'node.js', weight: 6, family: 'node' },
        { term: 'nodejs', weight: 6, family: 'node' },
        { term: 'node', weight: 5, family: 'node' },
        { term: 'python', weight: 6, family: 'python' },
        { term: 'typescript', weight: 5, family: 'typescript' },
        { term: 'fullstack', weight: 6, family: 'fullstack' },
        { term: 'full stack', weight: 6, family: 'fullstack' },
        { term: 'full-stack', weight: 6, family: 'fullstack' },
        { term: 'api rest', weight: 4, family: 'rest' },
        { term: 'rest api', weight: 4, family: 'rest' },
        { term: 'postgresql', weight: 4, family: 'postgres' },
        { term: 'postgres', weight: 4, family: 'postgres' },
        { term: 'sqlite', weight: 4, family: 'sqlite' },
        { term: 'sql', weight: 3, family: 'sql' },
        { term: 'javascript', weight: 3, family: 'javascript' },
        { term: 'express', weight: 3, family: 'express' },
        { term: 'fastapi', weight: 4, family: 'fastapi' },
        { term: 'next.js', weight: 4, family: 'next' },
        { term: 'nextjs', weight: 4, family: 'next' }
    ],
    seniorityKeywords: ['senior', 'sênior', 'sr', 'lead', 'pleno', 'mid', 'mid-level', 'staff'],
    nonTargetTitleTerms: [
        'ruby', 'rails', 'php', 'laravel', 'ios', 'swift', 'android',
        'kotlin', 'c++', 'rust', 'golang', 'vue', 'angular', '.net', 'c#', 'java '
    ],
    coreTitleTerms: ['react', 'node', 'python', 'typescript'],
    coreMatchTerms: [
        'react', 'node', 'python', 'typescript', 'fullstack', 'full stack',
        'full-stack', 'javascript', 'backend', 'back-end', 'software engineer', 'desenvolvedor'
    ],
    coreCorpusTerms: ['react', 'node.js', 'nodejs', 'python', 'typescript', 'fullstack', 'full-stack']
};

const HTML_ENTITIES = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'"
};

const INTERN_REGEX = /\b(intern|internship|est[aá]gio|estagi[aá]rio|trainee)\b/i;
const JUNIOR_OR_INTERN_REGEX = /\b(est[aá]gio|estagi[aá]rio|trainee|j[uú]nior|jr)\b/i;
const SENIOR_REGEX = /\b(s[eê]nior|sr|lead|especialista|staff)\b/i;

// Padrões textuais e de HTML que indicam que a vaga foi encerrada/fechada
const CLOSED_JOB_PAGE_REGEX = new RegExp(
    [
        'applications\\s+closed',
        'no\\s+longer\\s+accepting\\s+applications',
        'inscri[cç][oõ]es\\s+encerradas',
        'n[aã]o\\s+aceita\\s+mais\\s+candidaturas',
        'candidaturas\\s+encerradas',
        'vaga\\s+encerrada',
        'vaga\\s+fechada',
        'esta\\s+vaga\\s+n[aã]o\\s+est[aá]\\s+mais\\s+dispon[ií]vel',
        'this\\s+job\\s+is\\s+no\\s+longer\\s+available',
        'this\\s+position\\s+has\\s+been\\s+filled',
        'position\\s+has\\s+been\\s+filled',
        'job\\s+has\\s+expired',
        'closed-job__icon',
        '"isPublished"\\s*:\\s*false',
        '"status"\\s*:\\s*"(?:closed|expired|inactive|canceled)"'
    ].join('|'),
    'i'
);

function getTodayIso() {
    return new Date().toISOString().slice(0, 10);
}

/**
 * Calcula a data limite mínima (YYYY-MM-DD) para vagas abertas/recentes
 */
export function getCutoffDateIso(maxAgeDays = MAX_JOB_AGE_DAYS) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - maxAgeDays);
    return d.toISOString().slice(0, 10);
}

/**
 * Verifica se uma data (YYYY-MM-DD ou string parseável) está dentro da janela de vagas ativas
 */
export function isJobDateOpen(dateInput, maxAgeDays = MAX_JOB_AGE_DAYS) {
    if (!dateInput) return false;
    const raw = String(dateInput).trim();
    const isoMatch = raw.match(/^(\d{4}-\d{2}-\d{2})/);
    let dateIso = isoMatch ? isoMatch[1] : '';

    if (!dateIso) {
        const parsed = new Date(raw);
        if (Number.isNaN(parsed.getTime())) return false;
        dateIso = parsed.toISOString().slice(0, 10);
    }

    const cutoffIso = getCutoffDateIso(maxAgeDays);
    const todayIso = getTodayIso();
    return dateIso >= cutoffIso && dateIso <= todayIso;
}

/**
 * Verifica se um deadline (applicationDeadline / validThrough) ainda não venceu
 */
export function isDeadlineStillOpen(deadlineInput) {
    if (!deadlineInput) return true;
    const raw = String(deadlineInput).trim();
    const isoMatch = raw.match(/^(\d{4}-\d{2}-\d{2})/);
    if (isoMatch) {
        return isoMatch[1] >= getTodayIso();
    }
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return true;
    return parsed.getTime() >= Date.now() - 86400000;
}

/**
 * Remove tags HTML e decodifica entidades básicas
 */
function stripHtml(raw = '') {
    return String(raw || '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&(?:amp|lt|gt|quot|#39);/g, (m) => HTML_ENTITIES[m] || m)
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

    const corpus = `${rawJob.title || ''} ${rawJob.description || ''} ${(rawJob.tags || []).join(' ')}`;

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
    if (!matches) {
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

    const count = Math.min(parsedNumbers.length, 2);
    let avgValue = (parsedNumbers[0] + (count === 2 ? parsedNumbers[1] : 0)) / count;

    if (/k\b/i.test(text) && avgValue < 500) {
        avgValue *= 1000;
    }
    if (currency !== 'BRL' && avgValue > 35000) {
        avgValue /= 12;
    }

    return {
        salary: text,
        currency,
        salary_brl: convertToBrl(avgValue, currency)
    };
}

/**
 * Calcula o match_score (0 a 100) baseando-se no cruzamento de palavras-chave
 * do título, tags, descrição, senioridade e bônus de moeda estrangeira.
 */
export function calculateMatchScore(job) {
    const titleLower = String(job.title || '').toLowerCase();
    const tagsLower = (job.tags || []).join(' ').toLowerCase();
    const descLower = String(job.description || '').toLowerCase();
    const combined = `${titleLower} ${tagsLower} ${descLower}`;

    let score = 55;
    let techPoints = 0;
    const matchedFamilies = new Set();

    for (const { term, weight, family } of PROFILE_CONFIG.coreTechKeywords) {
        if (!matchedFamilies.has(family) && combined.includes(term)) {
            matchedFamilies.add(family);
            techPoints += (titleLower.includes(term) || tagsLower.includes(term))
                ? weight + 1
                : Math.max(2, Math.floor(weight / 2));
        }
    }
    score += Math.min(techPoints, 29);

    if (PROFILE_CONFIG.seniorityKeywords.some((s) => titleLower.includes(s))) {
        score += 6;
    } else if (PROFILE_CONFIG.seniorityKeywords.some((s) => descLower.includes(s))) {
        score += 3;
    }

    const currency = String(job.currency || 'BRL').toUpperCase();
    const salaryBrl = Number(job.salary_brl || 0);

    if (FOREIGN_CURRENCIES.has(currency)) {
        if (salaryBrl >= 25000) score += 9;
        else if (salaryBrl >= 18000) score += 7;
        else score += 5;
    } else if (salaryBrl >= 15000) {
        score += 4;
    } else if (salaryBrl >= 12000) {
        score += 2;
    }

    return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Valida se a vaga atende aos requisitos do perfil do Gian e não contém aviso de vaga fechada
 */
export function matchesProfileFilter(job) {
    const titleLower = String(job.title || '').toLowerCase();
    if (INTERN_REGEX.test(titleLower)) return false;

    const descLower = String(job.description || '').toLowerCase();
    if (CLOSED_JOB_PAGE_REGEX.test(titleLower) || CLOSED_JOB_PAGE_REGEX.test(descLower)) {
        return false;
    }

    if (job.date && !isJobDateOpen(job.date)) {
        return false;
    }

    if (job.applicationDeadline && !isDeadlineStillOpen(job.applicationDeadline)) {
        return false;
    }

    const locationLower = String(job.location || '').toLowerCase();
    const locationAndTitle = `${locationLower} ${titleLower} ${descLower}`;

    if (!PROFILE_CONFIG.remoteKeywords.some((kw) => locationAndTitle.includes(kw))) {
        return false;
    }

    const hasNonTargetTitle = PROFILE_CONFIG.nonTargetTitleTerms.some((t) => titleLower.includes(t));
    if (hasNonTargetTitle && !PROFILE_CONFIG.coreTitleTerms.some((t) => titleLower.includes(t))) {
        return false;
    }

    const hasValidSalary = Number(job.salary_brl) >= PROFILE_CONFIG.minSalaryBrl || FOREIGN_CURRENCIES.has(job.currency);
    if (!hasValidSalary) return false;

    const titleAndTags = `${titleLower} ${(job.tags || []).join(' ').toLowerCase()}`;
    if (PROFILE_CONFIG.coreMatchTerms.some((term) => titleAndTags.includes(term))) {
        return true;
    }

    const fullCorpus = `${titleAndTags} ${descLower}`;
    return PROFILE_CONFIG.coreCorpusTerms.some((term) => fullCorpus.includes(term));
}

/**
 * Normaliza qualquer objeto bruto de vaga para seguir o Contrato de Recebimento de Dados
 */
export function normalizeJobContract(rawJob) {
    const today = getTodayIso();
    const salaryData = rawJob.salary_brl
        ? {
            salary: rawJob.salary || 'A combinar',
            currency: VALID_CURRENCIES.includes(rawJob.currency) ? rawJob.currency : 'USD',
            salary_brl: Number(Number(rawJob.salary_brl).toFixed(2))
        }
        : parseSalaryInfo(rawJob.salary, rawJob.currency || 'USD', rawJob.estimated_monthly || 4000);

    const workHours = parseWorkHours(rawJob);
    const matchScore = calculateMatchScore({
        ...rawJob,
        currency: salaryData.currency,
        salary_brl: salaryData.salary_brl,
        work_hours: workHours
    });

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
async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Verifica ativamente se a URL da vaga continua aberta e com data/deadline válidos
 */
export async function checkIfJobUrlIsOpen(job) {
    if (!job?.url) return false;
    if (job.date && !isJobDateOpen(job.date)) return false;
    if (job.applicationDeadline && !isDeadlineStillOpen(job.applicationDeadline)) return false;

    try {
        const resp = await fetchWithTimeout(
            job.url,
            {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                    'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7'
                },
                redirect: 'follow'
            },
            6500
        );

        if (resp.status === 404 || resp.status === 410) {
            return false;
        }

        // Se houve redirecionamento para home/lista genérica sem a vaga (ex: Gupy/WWR/Remotive expirada)
        const finalUrl = String(resp.url || '').toLowerCase();
        if (
            finalUrl &&
            (/\/jobs\/?$|\/remote-jobs\/?$|expired|closed|not-found|404/.test(finalUrl)) &&
            !finalUrl.includes(normalizeUrl(job.url).toLowerCase().split('/').pop())
        ) {
            return false;
        }

        if (!resp.ok) {
            // Se bloqueou por rate-limit (429/999 no LinkedIn), mantém se a data for recente
            return isJobDateOpen(job.date);
        }

        const html = await resp.text();
        if (!html) return false;

        // 1. Checa avisos explícitos de vaga encerrada ("Applications closed", "No longer accepting applications", "Inscrições encerradas", etc.)
        if (CLOSED_JOB_PAGE_REGEX.test(html)) {
            return false;
        }

        // 2. Checa deadline expirado no JSON-LD ou __NEXT_DATA__ (applicationDeadline / validThrough)
        const deadlineMatch = html.match(/"(?:applicationDeadline|validThrough)"\s*:\s*"(\d{4}-\d{2}-\d{2}[^"]*)"/i);
        if (deadlineMatch && !isDeadlineStillOpen(deadlineMatch[1])) {
            return false;
        }

        // 3. Checa data de publicação real embutida na página (datePosted / publishedDate)
        const postedMatch = html.match(/"(?:datePosted|publishedDate)"\s*:\s*"(\d{4}-\d{2}-\d{2})/i);
        if (postedMatch && !isJobDateOpen(postedMatch[1])) {
            return false;
        }

        // 4. Checa texto explícito "Published on MONTH DD, YYYY" (ex: Gupy em inglês "Published on OCTOBER 28, 2025")
        const publishedOnTextMatch = html.match(/Published\s+on\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})/i);
        if (publishedOnTextMatch && !isJobDateOpen(publishedOnTextMatch[1])) {
            return false;
        }

        return true;
    } catch {
        // Em caso de timeout de rede pontual, confia na validação rigorosa de data recente
        return isJobDateOpen(job.date);
    }
}

/**
 * Filtra uma lista de vagas verificando em lotes paralelos se continuam abertas
 */
export async function filterOpenJobs(jobs = [], concurrency = 6) {
    const preFiltered = jobs.filter(
        (j) => j && j.url && (!j.date || isJobDateOpen(j.date)) && (!j.applicationDeadline || isDeadlineStillOpen(j.applicationDeadline))
    );

    const openJobs = [];
    for (let i = 0; i < preFiltered.length; i += concurrency) {
        const chunk = preFiltered.slice(i, i + concurrency);
        const checks = await Promise.all(
            chunk.map(async (job) => {
                const isOpen = await checkIfJobUrlIsOpen(job);
                return isOpen ? job : null;
            })
        );
        for (const item of checks) {
            if (item) openJobs.push(item);
        }
    }
    return openJobs;
}

/**
 * 1. LinkedIn Jobs (Guest Search API pública com f_WT=2 Remote e f_TPR=r604800 últimos 7 dias)
 */
async function fetchLinkedInJobs() {
    const queries = [
        { keywords: 'Full Stack React Node', location: 'Worldwide', currency: 'USD', fallback: 4500 },
        { keywords: 'Python React Developer', location: 'Latin America', currency: 'USD', fallback: 4200 },
        { keywords: 'Desenvolvedor React Node', location: 'Brazil', currency: 'BRL', fallback: 14000 },
        { keywords: 'Desenvolvedor Python Pleno Senior', location: 'Brazil', currency: 'BRL', fallback: 14500 }
    ];

    const batches = await Promise.all(
        queries.map(async (q) => {
            try {
                // f_WT=2 (Remoto) + f_TPR=r604800 (Publicadas nos últimos 7 dias)
                const url = `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=${encodeURIComponent(q.keywords)}&location=${encodeURIComponent(q.location)}&f_WT=2&f_TPR=r604800&start=0`;
                const resp = await fetchWithTimeout(url, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
                    }
                });
                if (!resp.ok) return [];

                const htmlText = await resp.text();
                const cards = htmlText.match(/<li[\s\S]*?<\/li>/gi) || [];
                const parsed = [];

                for (const card of cards.slice(0, 10)) {
                    const titleMatch = card.match(/base-search-card__title[^>]*>([\s\S]*?)<\/h3>/i);
                    const linkMatch = card.match(/href="(https:\/\/[^"]*linkedin\.com\/jobs\/view\/[^"?]+)/i);
                    const dateMatch = card.match(/datetime="(\d{4}-\d{2}-\d{2})"/i);
                    if (!titleMatch || !linkMatch || !dateMatch) continue;

                    const jobDate = dateMatch[1];
                    if (!isJobDateOpen(jobDate)) continue;

                    const compMatch = card.match(/base-search-card__subtitle[^>]*>([\s\S]*?)<\/h4>/i);
                    const locMatch = card.match(/job-search-card__location[^>]*>([\s\S]*?)<\/span>/i);
                    const salMatch = card.match(/job-search-card__salary-info[^>]*>([\s\S]*?)<\/span>/i);

                    const title = stripHtml(titleMatch[1]);
                    const company = compMatch ? stripHtml(compMatch[1]) : 'LinkedIn Recruiting';
                    const rawLoc = locMatch ? stripHtml(locMatch[1]) : q.location;
                    const location = /remote|remoto/i.test(rawLoc) ? rawLoc : `Remote (${rawLoc})`;
                    const salaryInfo = parseSalaryInfo(salMatch ? stripHtml(salMatch[1]) : '', q.currency, q.fallback);

                    parsed.push({
                        title,
                        company,
                        location,
                        salary: salaryInfo.salary,
                        currency: salaryInfo.currency,
                        salary_brl: salaryInfo.salary_brl,
                        platform: 'LinkedIn',
                        url: normalizeUrl(linkMatch[1]),
                        date: jobDate,
                        tags: q.keywords.split(' '),
                        description: `${title} - ${company} (${location}) - ${q.keywords}`
                    });
                }
                return parsed;
            } catch (err) {
                console.warn(`[Scraper] Aviso LinkedIn (${q.keywords}):`, err.message);
                return [];
            }
        })
    );

    return batches.flat();
}

/**
 * 2. Gupy Portal API (Vagas remotas no Brasil - valida isPublished, publishedDate e applicationDeadline)
 */
async function fetchGupyJobs() {
    const terms = ['Node.js', 'React', 'Python', 'Fullstack'];

    const batches = await Promise.all(
        terms.map(async (term) => {
            try {
                const url = `https://portal.api.gupy.io/api/v1/jobs?jobName=${encodeURIComponent(term)}&workplaceType=remote&limit=10`;
                const response = await fetchWithTimeout(url, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Accept': 'application/json'
                    }
                });
                if (!response.ok) return [];

                const contentType = response.headers.get('content-type') || '';
                if (!contentType.includes('application/json')) return [];

                const json = await response.json();
                const items = Array.isArray(json.data) ? json.data : [];
                const parsed = [];

                for (const item of items) {
                    if (item.isPublished === false) continue;

                    const publishedDate = item.publishedDate ? String(item.publishedDate).slice(0, 10) : '';
                    if (!isJobDateOpen(publishedDate)) continue;
                    if (!isDeadlineStillOpen(item.applicationDeadline)) continue;

                    const title = String(item.name || '').trim();
                    const jobUrl = normalizeUrl(item.jobUrl || '');
                    if (!title || !jobUrl || JUNIOR_OR_INTERN_REGEX.test(title)) continue;

                    const estimatedBrl = SENIOR_REGEX.test(title) ? 15500 : 12800;

                    parsed.push({
                        title,
                        company: item.careerPageName || 'Empresa Gupy',
                        location: 'Home Office (Brasil)',
                        salary: `R$ ${estimatedBrl.toLocaleString('pt-BR')}/mês (Est.)`,
                        currency: 'BRL',
                        salary_brl: estimatedBrl,
                        platform: 'Gupy',
                        url: jobUrl,
                        date: publishedDate,
                        applicationDeadline: item.applicationDeadline || null,
                        tags: [term, 'Remote', 'Brasil'],
                        description: stripHtml(item.description || '')
                    });
                }
                return parsed;
            } catch {
                return [];
            }
        })
    );

    return batches.flat();
}

/**
 * 3. RemoteOK API (Vagas internacionais em USD com validação de data)
 */
async function fetchRemoteOkJobs() {
    try {
        const response = await fetchWithTimeout('https://remoteok.com/api', {
            headers: { 'User-Agent': 'Mozilla/5.0 JobBot-Scraper/1.0' }
        });
        if (!response.ok) return [];

        const data = await response.json();
        if (!Array.isArray(data)) return [];

        return data
            .slice(1, 35)
            .filter((item) => {
                if (!item || !item.position || (!item.url && !item.apply_url)) return false;
                const itemDate = item.date ? String(item.date).slice(0, 10) : '';
                return isJobDateOpen(itemDate);
            })
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
                    date: String(item.date).slice(0, 10),
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
 * 4. WeWorkRemotely RSS (Full-Stack & Backend Programming com parsing de <pubDate>)
 */
async function fetchWeWorkRemotelyJobs() {
    const today = getTodayIso();
    const rssUrls = [
        'https://weworkremotely.com/categories/remote-full-stack-programming-jobs.rss',
        'https://weworkremotely.com/categories/remote-back-end-programming-jobs.rss'
    ];

    const batches = await Promise.all(
        rssUrls.map(async (rssUrl) => {
            try {
                const response = await fetchWithTimeout(rssUrl, {
                    headers: { 'User-Agent': 'Mozilla/5.0 JobBot-Scraper/1.0' }
                });
                if (!response.ok) return [];

                const xmlText = await response.text();
                const items = xmlText.match(/<item>[\s\S]*?<\/item>/gi) || [];
                const parsed = [];

                for (const itemXml of items.slice(0, 15)) {
                    const rawTitle = stripHtml((itemXml.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '');
                    const link = stripHtml((itemXml.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] || '');
                    if (!rawTitle || !link) continue;

                    const pubDateRaw = stripHtml((itemXml.match(/<pubDate>([\s\S]*?)<\/pubDate>/i) || [])[1] || '');
                    const parsedPubDate = pubDateRaw ? new Date(pubDateRaw) : null;
                    const jobDate = parsedPubDate && !Number.isNaN(parsedPubDate.getTime())
                        ? parsedPubDate.toISOString().slice(0, 10)
                        : today;

                    if (!isJobDateOpen(jobDate)) continue;

                    const region = stripHtml((itemXml.match(/<region>([\s\S]*?)<\/region>/i) || [])[1] || 'Worldwide');
                    const description = stripHtml((itemXml.match(/<description>([\s\S]*?)<\/description>/i) || [])[1] || '');

                    const parts = rawTitle.split(':');
                    const company = parts.length > 1 ? parts[0].trim() : 'WWR Partner';
                    const title = parts.length > 1 ? parts.slice(1).join(':').trim() : rawTitle;

                    const workHours = parseWorkHours({ title, description });
                    const monthlyUsd = workHours.includes('4h') ? 2800 : 4800;

                    parsed.push({
                        title,
                        company,
                        location: `Remote (${region})`,
                        salary: `$${monthlyUsd.toLocaleString('en-US')} / month (Est.)`,
                        currency: 'USD',
                        salary_brl: convertToBrl(monthlyUsd, 'USD'),
                        platform: 'WeWorkRemotely',
                        url: normalizeUrl(link),
                        date: jobDate,
                        work_hours: workHours,
                        tags: [],
                        description: description.slice(0, 600)
                    });
                }
                return parsed;
            } catch (err) {
                console.warn('[Scraper] Aviso WeWorkRemotely:', err.message);
                return [];
            }
        })
    );

    return batches.flat();
}

/**
 * 5. Remotive API (Software Development Remote Jobs com validação de data)
 */
async function fetchRemotiveJobs() {
    try {
        const response = await fetchWithTimeout('https://remotive.com/api/remote-jobs?category=software-dev&limit=25', {
            headers: { 'User-Agent': 'Mozilla/5.0 JobBot-Scraper/1.0' }
        });
        if (!response.ok) return [];

        const data = await response.json();
        const jobs = Array.isArray(data.jobs) ? data.jobs : [];

        return jobs
            .filter((item) => {
                const pubDate = item?.publication_date ? String(item.publication_date).slice(0, 10) : '';
                return isJobDateOpen(pubDate);
            })
            .map((item) => {
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
                    date: String(item.publication_date).slice(0, 10),
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
 * Executa a varredura real em todas as fontes em paralelo, filtra pelo perfil do Gian,
 * verifica ativamente se cada vaga segue aberta e deduplica por URL.
 */
export async function scrapeJobs() {
    console.log('[Scraper] Iniciando varredura real (LinkedIn, Gupy, RemoteOK, WeWorkRemotely, Remotive)...');

    const batches = await Promise.all([
        fetchLinkedInJobs(),
        fetchGupyJobs(),
        fetchRemoteOkJobs(),
        fetchWeWorkRemotelyJobs(),
        fetchRemotiveJobs()
    ]);

    const rawCandidates = batches.flat();
    const seenUrls = new Set();
    const profileMatched = [];

    for (const candidate of rawCandidates) {
        if (!candidate?.url || !candidate?.title) continue;

        const normalizedUrl = normalizeUrl(candidate.url);
        if (!normalizedUrl || seenUrls.has(normalizedUrl)) continue;
        if (!matchesProfileFilter(candidate)) continue;

        seenUrls.add(normalizedUrl);
        profileMatched.push({ ...candidate, url: normalizedUrl });
    }

    // Verifica ativamente se as vagas filtradas estão abertas e com prazo válido
    const verifiedOpenCandidates = await filterOpenJobs(profileMatched, 6);
    const validJobs = verifiedOpenCandidates.map((c) => normalizeJobContract(c));

    // Ordena por data de abertura (mais recentes primeiro), desempatando por match_score e salário
    validJobs.sort((a, b) => b.date.localeCompare(a.date) || b.match_score - a.match_score || b.salary_brl - a.salary_brl);
    console.log(`[Scraper] ${validJobs.length} vagas abertas confirmadas (de ${profileMatched.length} candidatas).`);
    return validJobs;
}
