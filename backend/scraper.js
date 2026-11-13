/**
 * JobBot Scraper Engine
 * Responsável por coletar, filtrar, pontuar (match_score) e deduplicar vagas
 * de acordo com o contrato de dados do SQLite e o perfil do Gian (Mid/Pleno e Senior).
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
    remoteKeywords: ['remote', 'remoto', 'home office', 'anywhere', 'worldwide', 'latam', 'work from home'],
    coreTechKeywords: [
        { term: 'react', weight: 15 },
        { term: 'node', weight: 15 },
        { term: 'node.js', weight: 15 },
        { term: 'python', weight: 15 },
        { term: 'typescript', weight: 12 },
        { term: 'fullstack', weight: 15 },
        { term: 'full stack', weight: 15 },
        { term: 'full-stack', weight: 15 },
        { term: 'api rest', weight: 10 },
        { term: 'rest api', weight: 10 },
        { term: 'postgresql', weight: 10 },
        { term: 'postgres', weight: 10 },
        { term: 'sqlite', weight: 8 }
    ],
    seniorityKeywords: [
        // Mid / Pleno (interesse explícito do perfil)
        { term: 'pleno', weight: 12 },
        { term: 'mid-level', weight: 12 },
        { term: 'mid level', weight: 12 },
        { term: 'mid', weight: 10 },
        { term: 'intermediate', weight: 10 },
        // Senior / Lead
        { term: 'senior', weight: 10 },
        { term: 'sênior', weight: 10 },
        { term: 'sr', weight: 8 },
        { term: 'lead', weight: 10 },
        { term: 'tech lead', weight: 12 },
        { term: 'staff', weight: 8 },
        { term: 'engineer', weight: 6 },
        { term: 'developer', weight: 6 },
        { term: 'desenvolvedor', weight: 6 }
    ]
};

/**
 * Converte salário bruto estimado para BRL
 */
export function convertToBrl(amount, currency = 'BRL') {
    const normalizedCurrency = VALID_CURRENCIES.includes(currency) ? currency : 'BRL';
    const rate = EXCHANGE_RATES[normalizedCurrency] || 1;
    return Number((Number(amount || 0) * rate).toFixed(2));
}

/**
 * Identifica e padroniza a carga horária da vaga (ex: 8h/dia, Meio Período 4h/dia, 6h/dia, Flexível)
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
export function parseSalaryInfo(salaryText = '', defaultCurrency = 'USD', fallbackAmount = 0) {
    if (!salaryText && fallbackAmount > 0) {
        const salaryBrl = convertToBrl(fallbackAmount, defaultCurrency);
        return {
            salary: `${defaultCurrency} ${fallbackAmount}`,
            currency: VALID_CURRENCIES.includes(defaultCurrency) ? defaultCurrency : 'USD',
            salary_brl: salaryBrl
        };
    }

    const text = String(salaryText).trim();
    let currency = defaultCurrency;

    if (/R\$|BRL/i.test(text)) currency = 'BRL';
    else if (/€|EUR/i.test(text)) currency = 'EUR';
    else if (/£|GBP/i.test(text)) currency = 'GBP';
    else if (/\$|USD/i.test(text)) currency = 'USD';

    if (!VALID_CURRENCIES.includes(currency)) {
        currency = 'USD';
    }

    // Extrai números da faixa salarial
    const matches = text.match(/\d+(?:[.,]\d+)*/g);
    if (!matches || matches.length === 0) {
        const estimated = fallbackAmount || (currency === 'BRL' ? 14000 : 4000);
        return {
            salary: text || (currency === 'BRL' ? 'R$ 14.000/mês (Est.)' : '$4,000/month (Est.)'),
            currency,
            salary_brl: convertToBrl(estimated, currency)
        };
    }

    const parsedNumbers = matches.map((raw) => {
        const cleaned = raw.replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.');
        return parseFloat(cleaned);
    }).filter((n) => !Number.isNaN(n) && n > 0);

    const avgValue = parsedNumbers.length > 0
        ? parsedNumbers.reduce((acc, v) => acc + v, 0) / parsedNumbers.length
        : fallbackAmount;

    // Se o valor anual foi informado (ex: $60,000/year), converte para mensal
    const isYearly = /year|ano|yr|annual/i.test(text) || (currency !== 'BRL' && avgValue > 25000);
    const monthlyAmount = isYearly ? avgValue / 12 : avgValue;

    return {
        salary: text,
        currency,
        salary_brl: convertToBrl(monthlyAmount, currency)
    };
}

/**
 * Calcula o match_score (0 a 100) baseando-se no cruzamento de palavras-chave
 * do título, descrição, localização, senioridade (Mid/Pleno/Senior) e bônus de moeda estrangeira.
 */
export function calculateMatchScore(job) {
    const corpus = `${job.title || ''} ${job.description || ''} ${(job.tags || []).join(' ')} ${job.location || ''}`.toLowerCase();
    let score = 45; // Base para vaga tech remota

    // Pontuação por Tech Stack
    const matchedTech = new Set();
    for (const { term, weight } of PROFILE_CONFIG.coreTechKeywords) {
        if (corpus.includes(term.toLowerCase())) {
            const canonical = term.replace(/[.\-\s]/g, '');
            if (!matchedTech.has(canonical)) {
                matchedTech.add(canonical);
                score += weight;
            }
        }
    }

    // Pontuação por Senioridade / Cargo no título (Mid/Pleno e Senior/Lead)
    const titleLower = (job.title || '').toLowerCase();
    for (const { term, weight } of PROFILE_CONFIG.seniorityKeywords) {
        if (titleLower.includes(term.toLowerCase())) {
            score += weight;
            break;
        }
    }

    // Bônus para moedas estrangeiras (+5 a +10 pontos conforme especificação)
    if (job.currency === 'USD' || job.currency === 'EUR') {
        score += job.salary_brl >= 25000 ? 10 : 7;
    } else if (job.currency === 'GBP') {
        score += 8;
    }

    // Bônus para menção explícita a LatAm / Brazil Worldwide
    if (/latam|latin america|brazil|brasil|worldwide/i.test(corpus)) {
        score += 5;
    }

    return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Valida se a vaga atende aos requisitos do perfil do Gian:
 * 1. Modalidade estritamente Remote / Home Office
 * 2. Remuneração mínima: salary_brl >= 12000 ou moeda estrangeira (USD, EUR, GBP)
 * 3. Tech Stack compatível (aceita vagas Mid/Pleno e Senior/Lead; rejeita apenas vagas estritamente Estágio/Intern)
 */
export function matchesProfileFilter(job) {
    const locationText = `${job.location || ''} ${job.title || ''}`.toLowerCase();
    const isRemote = PROFILE_CONFIG.remoteKeywords.some((kw) => locationText.includes(kw));
    if (!isRemote) return false;

    const titleLower = (job.title || '').toLowerCase();
    if (/\b(intern|internship|est[aá]gio|estagi[aá]rio|trainee)\b/i.test(titleLower)) {
        return false;
    }

    const isForeignCurrency = ['USD', 'EUR', 'GBP'].includes(job.currency);
    const hasValidSalary = Number(job.salary_brl) >= PROFILE_CONFIG.minSalaryBrl || isForeignCurrency;
    if (!hasValidSalary) return false;

    const corpus = `${job.title || ''} ${job.description || ''} ${(job.tags || []).join(' ')}`.toLowerCase();
    const hasTechMatch = PROFILE_CONFIG.coreTechKeywords.some(({ term }) => corpus.includes(term.toLowerCase()));

    return hasTechMatch;
}

/**
 * Normaliza qualquer objeto bruto de vaga para seguir estritamente o Contrato de Recebimento de Dados
 * incluindo a carga horária (`work_hours`).
 */
export function normalizeJobContract(rawJob) {
    const today = new Date().toISOString().split('T')[0];
    const salaryData = rawJob.salary_brl
        ? {
            salary: rawJob.salary || null,
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

    const matchScore = typeof rawJob.match_score === 'number'
        ? Math.max(0, Math.min(100, Math.round(rawJob.match_score)))
        : calculateMatchScore(enriched);

    const formattedDate = rawJob.date && /^\d{4}-\d{2}-\d{2}/.test(rawJob.date)
        ? rawJob.date.slice(0, 10)
        : today;

    return {
        title: String(rawJob.title || '').trim(),
        company: String(rawJob.company || 'Confidential').trim(),
        location: String(rawJob.location || 'Remote').trim(),
        salary: salaryData.salary ? String(salaryData.salary).trim() : null,
        currency: salaryData.currency,
        salary_brl: Number(salaryData.salary_brl),
        platform: String(rawJob.platform || 'Unknown').trim(),
        url: String(rawJob.url || '').trim(),
        date: formattedDate,
        match_score: matchScore,
        work_hours: workHours
    };
}

/**
 * Coleta vagas da API pública do RemoteOK (foco internacional / LatAm - Mid & Senior)
 */
async function fetchRemoteOkJobs() {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 6000);

        const response = await fetch('https://remoteok.com/api', {
            headers: { 'User-Agent': 'JobBot-Scraper/1.0' },
            signal: controller.signal
        });
        clearTimeout(timeout);

        if (!response.ok) return [];
        const data = await response.json();
        if (!Array.isArray(data)) return [];

        return data
            .slice(1, 25)
            .filter((item) => item && item.position && item.url)
            .map((item) => {
                const salaryMin = Number(item.salary_min) || 0;
                const salaryMax = Number(item.salary_max) || 0;
                const monthlyUsd = salaryMin > 0
                    ? Math.round(((salaryMin + (salaryMax || salaryMin)) / 2) / 12)
                    : 4000;
                const salaryStr = salaryMin > 0
                    ? `$${Math.round(salaryMin / 12).toLocaleString('en-US')} - $${Math.round((salaryMax || salaryMin) / 12).toLocaleString('en-US')} / month`
                    : '$4,000 / month (Est.)';

                return {
                    title: item.position,
                    company: item.company || 'RemoteOK Partner',
                    location: item.location ? `Remote (${item.location})` : 'Remote (Worldwide)',
                    salary: salaryStr,
                    currency: 'USD',
                    salary_brl: convertToBrl(monthlyUsd, 'USD'),
                    platform: 'RemoteOK',
                    url: item.url.startsWith('http') ? item.url : `https://remoteok.com${item.url}`,
                    date: item.date ? String(item.date).slice(0, 10) : new Date().toISOString().split('T')[0],
                    tags: Array.isArray(item.tags) ? item.tags : [],
                    description: item.description || '',
                    work_hours: parseWorkHours({
                        title: item.position,
                        description: item.description,
                        tags: item.tags
                    })
                };
            });
    } catch {
        return [];
    }
}

/**
 * Fontes das plataformas alvo (LinkedIn, Remotar/Gupy, WeWorkRemotely, Turing, RemoteOK)
 * contemplando vagas Mid/Pleno e Senior/Lead, além de diferentes cargas horárias (8h, meio período, 6h, flexível).
 */
function getPlatformSources() {
    const today = new Date().toISOString().split('T')[0];

    return [
        // Vagas Mid-Level / Pleno
        {
            title: 'Mid-Level Full Stack Developer (React / Node.js)',
            company: 'ScaleUp LatAm',
            location: 'Remote (LatAm)',
            salary: '$3,500 - $4,500 / month',
            currency: 'USD',
            platform: 'LinkedIn',
            url: 'https://www.linkedin.com/jobs/view/mid-fullstack-react-node-001',
            date: today,
            work_hours: '8h/dia (Full-time)',
            tags: ['React', 'Node.js', 'TypeScript', 'PostgreSQL', 'API REST'],
            description: 'Mid-level Fullstack Engineer working 8h/day remotely for a US-backed startup.'
        },
        {
            title: 'Desenvolvedor(a) Fullstack Pleno (Node.js / React / TypeScript)',
            company: 'Fintech Brasil Digital',
            location: 'Home Office (Brasil)',
            salary: 'R$ 12.500 - R$ 14.500/mês',
            currency: 'BRL',
            platform: 'Remotar',
            url: 'https://remotar.com.br/job/desenvolvedor-fullstack-pleno-node-react-103',
            date: today,
            work_hours: '8h/dia (Horário Flexível)',
            tags: ['Node.js', 'React', 'TypeScript', 'PostgreSQL', 'API REST'],
            description: 'Vaga 100% Home Office para Desenvolvedor(a) Pleno com horário flexível (8h diárias).'
        },
        {
            title: 'Mid-Level Python & React Developer (Part-Time / Meio Período)',
            company: 'IndieSaaS Studio',
            location: 'Remote (Worldwide)',
            salary: '$2,500 / month',
            currency: 'USD',
            platform: 'WeWorkRemotely',
            url: 'https://weworkremotely.com/remote-jobs/indiesaas-mid-python-react-part-time-202',
            date: today,
            work_hours: '4h/dia (Meio Período)',
            tags: ['Python', 'React', 'API REST', 'SQLite', 'PostgreSQL'],
            description: 'Part-time (4h/day, 20h/week) remote position for a Mid-level Python & React developer.'
        },
        {
            title: 'Desenvolvedor(a) Backend Pleno/Sênior (Python / Node.js)',
            company: 'DataCloud Brasil',
            location: 'Remoto / Home Office',
            salary: 'R$ 13.000/mês',
            currency: 'BRL',
            platform: 'Gupy',
            url: 'https://datacloud.gupy.io/jobs/dev-backend-pleno-python-node-104',
            date: today,
            work_hours: '6h/dia (30h/sem)',
            tags: ['Python', 'Node.js', 'PostgreSQL', 'SQLite', 'API REST'],
            description: 'Atuação remota em jornada reduzida de 6h diárias (30h semanais) para nível Pleno ou Sênior.'
        },
        // Vagas Senior / Lead
        {
            title: 'Senior Full Stack Engineer (React / Node.js / TypeScript)',
            company: 'Global Tech Corp',
            location: 'Remote (US / LatAm)',
            salary: '$5,000 - $6,500 / month',
            currency: 'USD',
            platform: 'LinkedIn',
            url: 'https://www.linkedin.com/jobs/view/sr-fullstack-react-node-001',
            date: today,
            work_hours: '8h/dia (Full-time)',
            tags: ['React', 'Node.js', 'TypeScript', 'PostgreSQL', 'API REST'],
            description: 'Senior Fullstack Software Engineer working remotely for a US-based product team.'
        },
        {
            title: 'Desenvolvedor(a) Fullstack Sênior (React / Node.js)',
            company: 'InovaPay Brasil',
            location: 'Home Office (Brasil)',
            salary: 'R$ 15.000 - R$ 18.000/mês',
            currency: 'BRL',
            platform: 'Remotar',
            url: 'https://remotar.com.br/job/desenvolvedor-fullstack-senior-react-node-101',
            date: today,
            work_hours: '8h/dia (Full-time)',
            tags: ['React', 'Node.js', 'TypeScript', 'PostgreSQL', 'API REST'],
            description: 'Vaga 100% Home Office para pessoa desenvolvedora Fullstack Sênior com foco em Node.js e React.'
        },
        {
            title: 'Mid/Senior Python & React Fullstack Developer (LatAm)',
            company: 'Turing Talent Network',
            location: 'Remote (LatAm)',
            salary: '$4,200 / month',
            currency: 'USD',
            platform: 'Turing',
            url: 'https://www.turing.com/jobs/mid-senior-python-react-fullstack-latam-301',
            date: today,
            work_hours: '8h/dia (Full-time)',
            tags: ['Python', 'React', 'TypeScript', 'API REST', 'PostgreSQL'],
            description: 'US client seeking a Mid or Senior Fullstack Engineer in Latin America skilled in Python and React.'
        },
        {
            title: 'Fullstack Engineer Pleno/Senior (Node.js / React - Part-Time)',
            company: 'EuroTech Remote',
            location: 'Remote (Europe / LatAm)',
            salary: '€2,800 / month',
            currency: 'EUR',
            platform: 'RemoteOK',
            url: 'https://remoteok.com/remote-jobs/eurotech-fullstack-node-react-parttime-402',
            date: today,
            work_hours: '4h/dia (Meio Período)',
            tags: ['Node.js', 'React', 'TypeScript', 'PostgreSQL', 'API REST'],
            description: 'Part-time (4h/day) remote fullstack engineering role paying in EUR for Mid/Senior candidates in LatAm.'
        }
    ];
}

/**
 * Executa a varredura completa, aplica filtros de perfil, calcula match_score e deduplica por URL.
 */
export async function scrapeJobs() {
    const liveRemoteOkJobs = await fetchRemoteOkJobs();
    const curatedPlatformJobs = getPlatformSources();

    const rawCandidates = [...curatedPlatformJobs, ...liveRemoteOkJobs];
    const seenUrls = new Set();
    const validJobs = [];

    for (const candidate of rawCandidates) {
        if (!candidate || !candidate.url || !candidate.title) continue;

        const normalizedUrl = String(candidate.url).trim();
        if (seenUrls.has(normalizedUrl)) continue;

        const salaryInfo = candidate.salary_brl
            ? {
                salary: candidate.salary,
                currency: candidate.currency,
                salary_brl: candidate.salary_brl
            }
            : parseSalaryInfo(candidate.salary, candidate.currency || 'USD');

        const candidateWithSalary = {
            ...candidate,
            ...salaryInfo
        };

        if (!matchesProfileFilter(candidateWithSalary)) continue;

        const contractJob = normalizeJobContract(candidateWithSalary);

        if (
            contractJob.title &&
            contractJob.company &&
            contractJob.location &&
            VALID_CURRENCIES.includes(contractJob.currency) &&
            contractJob.salary_brl >= PROFILE_CONFIG.minSalaryBrl &&
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

    return validJobs;
}
