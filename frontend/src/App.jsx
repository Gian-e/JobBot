import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Briefcase,
  Building,
  DollarSign,
  Calendar,
  ExternalLink,
  RefreshCw,
  Clock,
  Star,
  Globe,
  Bell,
  BellRing,
  Smartphone
} from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || '';
const FOREIGN_CURRENCIES = new Set(['USD', 'EUR', 'GBP']);
const MID_PLENO_REGEX = /pleno|mid[\s-]?level|\bmid\b|intermediate/i;
const PART_TIME_REGEX = /meio per[ií]odo|part[\s-]?time|4h|6h/i;

const FILTER_TABS = [
  { id: 'ALL', label: 'Todas as Vagas' },
  { id: 'MID_PLENO', label: 'Mid / Pleno' },
  { id: 'PART_TIME', label: 'Meio Período / 6h' },
  { id: 'USD', label: 'Estrangeiras (USD/EUR)' },
  { id: 'BRL', label: 'Nacionais (> 12k)' },
  { id: 'NEW', label: 'Novas' }
];

const isMidPleno = (job) => MID_PLENO_REGEX.test(job.title || '');
const isPartTimeOrReduced = (job) => PART_TIME_REGEX.test(job.work_hours || '');

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export default function App() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('ALL');
  const [pushSupported, setPushSupported] = useState(false);
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);
  const [iosNeedsInstall, setIosNeedsInstall] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const toastTimerRef = useRef(null);

  const showToast = useCallback((msg) => {
    setStatusMessage(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setStatusMessage(''), 4500);
  }, []);

  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/jobs`);
      const data = await res.json();
      setJobs(data.jobs || []);
    } catch (err) {
      console.error('Failed to fetch jobs', err);
    }
  }, []);

  useEffect(() => {
    fetchJobs();

    const isIos = /iphone|ipad|ipod/i.test(window.navigator.userAgent);
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true;

    if (isIos && !isStandalone) {
      setIosNeedsInstall(true);
    }

    if ('serviceWorker' in navigator && 'PushManager' in window) {
      setPushSupported(true);
      navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => reg.pushManager.getSubscription())
        .then((sub) => setPushSubscribed(Boolean(sub)))
        .catch((err) => console.error('SW registration error:', err));
    }

    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, [fetchJobs]);

  const enablePushNotifications = async () => {
    if (!pushSupported) {
      showToast('No iPhone, adicione primeiro à Tela de Início pelo Safari para ativar Push.');
      return;
    }

    setPushLoading(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        showToast('Permissão de notificação negada nas configurações do aparelho.');
        return;
      }

      const reg = await navigator.serviceWorker.ready;
      const keyRes = await fetch(`${API_BASE}/api/push/vapid-public-key`);
      const { publicKey } = await keyRes.json();

      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey)
        });
      }

      await fetch(`${API_BASE}/api/push/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sub)
      });

      setPushSubscribed(true);
      showToast('Notificações Push ativadas com sucesso no seu dispositivo!');
    } catch (err) {
      console.error('Failed to subscribe to push:', err);
      showToast('Erro ao ativar notificações. Verifique se o WebApp está na Tela de Início.');
    } finally {
      setPushLoading(false);
    }
  };

  const sendTestPush = async () => {
    try {
      await fetch(`${API_BASE}/api/push/test`, { method: 'POST' });
      showToast('Notificação de teste enviada!');
    } catch (err) {
      console.error('Failed to send test push:', err);
    }
  };

  const triggerScraper = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/jobs/scrape`, { method: 'POST' });
      const data = await res.json();
      await fetchJobs();
      if (typeof data?.newCount === 'number') {
        const removedMsg = data.removedClosedCount ? ` (${data.removedClosedCount} encerrada(s) removida(s))` : '';
        showToast(`Busca concluída: ${data.newCount} nova(s) vaga(s) aberta(s)!${removedMsg}`);
      }
    } catch (err) {
      console.error('Failed to run scraper', err);
    } finally {
      setLoading(false);
    }
  };

  const updateStatus = async (id, status) => {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, status } : j)));
    try {
      const res = await fetch(`${API_BASE}/api/jobs/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      if (!res.ok) throw new Error('Status update failed');
    } catch (err) {
      console.error('Failed to update status', err);
      fetchJobs();
    }
  };

  const stats = useMemo(() => {
    const total = jobs.length;
    if (total === 0) {
      return { total: 0, foreignCount: 0, avgSalaryBrl: 0, avgMatchScore: 0 };
    }

    let foreignCount = 0;
    let sumSalary = 0;
    let sumScore = 0;

    for (const j of jobs) {
      if (FOREIGN_CURRENCIES.has(j.currency)) foreignCount += 1;
      sumSalary += j.salary_brl || 0;
      sumScore += j.match_score || 0;
    }

    return {
      total,
      foreignCount,
      avgSalaryBrl: Math.round(sumSalary / total),
      avgMatchScore: Math.round(sumScore / total)
    };
  }, [jobs]);

  const filteredJobs = useMemo(() => {
    const base = filter === 'ALL'
      ? jobs
      : jobs.filter((job) => {
          if (filter === 'MID_PLENO') return isMidPleno(job);
          if (filter === 'PART_TIME') return isPartTimeOrReduced(job);
          if (filter === 'USD') return FOREIGN_CURRENCIES.has(job.currency);
          if (filter === 'BRL') return job.currency === 'BRL';
          if (filter === 'NEW') return job.status === 'New';
          return true;
        });

    return [...base].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || (b.id || 0) - (a.id || 0));
  }, [jobs, filter]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-4 flex flex-col sm:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-indigo-600 rounded-xl shadow-lg shadow-indigo-600/30">
              <Briefcase className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
                JobBot{' '}
                <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
                  Gian Profile
                </span>
              </h1>
              <p className="text-xs text-slate-400">
                Vagas Home Office (Mid/Pleno &amp; Sênior) &bull; &gt; R$ 12k/mês &bull; Moeda Estrangeira
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2.5">
            {pushSubscribed ? (
              <button
                onClick={sendTestPush}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 rounded-lg font-medium text-xs transition cursor-pointer"
                title="Enviar uma notificação de teste para o seu iPhone"
              >
                <BellRing className="w-4 h-4 text-emerald-400" />
                <span>Push Ativo (Testar)</span>
              </button>
            ) : (
              <button
                onClick={enablePushNotifications}
                disabled={pushLoading}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg font-medium text-xs transition cursor-pointer"
              >
                <Bell className="w-4 h-4 text-indigo-400" />
                <span>{pushLoading ? 'Ativando...' : 'Ativar Notificações'}</span>
              </button>
            )}

            <button
              onClick={triggerScraper}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800 text-white rounded-lg font-medium text-sm transition shadow-lg shadow-indigo-600/20 cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              {loading ? 'Buscando vagas...' : 'Buscar Vagas Agora'}
            </button>
          </div>
        </div>
      </header>

      {/* iPhone PWA Install Banner */}
      {iosNeedsInstall && (
        <div className="bg-indigo-950/80 border-b border-indigo-800/60 px-4 py-3">
          <div className="max-w-7xl mx-auto flex items-center gap-3 text-xs text-indigo-200">
            <Smartphone className="w-5 h-5 text-indigo-400 shrink-0" />
            <p>
              <strong>Dica para iPhone:</strong> Para receber notificações Push no iOS, toque no botão{' '}
              <strong>Compartilhar</strong> do Safari, selecione <strong>&ldquo;Adicionar à Tela de Início&rdquo;</strong> e abra o JobBot pelo ícone criado.
            </p>
          </div>
        </div>
      )}

      {/* Toast Feedback */}
      {statusMessage && (
        <div className="max-w-7xl w-full mx-auto px-4 pt-4">
          <div className="bg-indigo-600/20 border border-indigo-500/40 text-indigo-200 text-xs font-medium px-4 py-2.5 rounded-lg">
            {statusMessage}
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-8">
        {/* Stats & Filters */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-400 font-medium">Total de Vagas</p>
              <h3 className="text-2xl font-bold text-white mt-1">{stats.total}</h3>
            </div>
            <div className="p-3 bg-blue-500/10 text-blue-400 rounded-lg">
              <Briefcase className="w-5 h-5" />
            </div>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-400 font-medium">Moeda Estrangeira (USD)</p>
              <h3 className="text-2xl font-bold text-emerald-400 mt-1">{stats.foreignCount}</h3>
            </div>
            <div className="p-3 bg-emerald-500/10 text-emerald-400 rounded-lg">
              <Globe className="w-5 h-5" />
            </div>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-400 font-medium">Média Salarial (BRL)</p>
              <h3 className="text-2xl font-bold text-indigo-400 mt-1">
                R$ {stats.avgSalaryBrl.toLocaleString('pt-BR')}
              </h3>
            </div>
            <div className="p-3 bg-indigo-500/10 text-indigo-400 rounded-lg">
              <DollarSign className="w-5 h-5" />
            </div>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-400 font-medium">Match Médio CV</p>
              <h3 className="text-2xl font-bold text-amber-400 mt-1">{stats.avgMatchScore}%</h3>
            </div>
            <div className="p-3 bg-amber-500/10 text-amber-400 rounded-lg">
              <Star className="w-5 h-5" />
            </div>
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="flex gap-2 mb-6 border-b border-slate-800 pb-4 overflow-x-auto">
          {FILTER_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setFilter(tab.id)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition cursor-pointer whitespace-nowrap ${
                filter === tab.id
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                  : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Job Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredJobs.map((job) => (
            <div
              key={job.id}
              className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col justify-between hover:border-slate-700 transition shadow-xl"
            >
              <div>
                <div className="flex justify-between items-start gap-2 mb-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-semibold px-2.5 py-1 rounded-md bg-slate-800 text-indigo-400 border border-slate-700">
                      {job.platform}
                    </span>
                    {isMidPleno(job) && (
                      <span className="text-xs font-semibold px-2 py-1 rounded-md bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                        Mid / Pleno
                      </span>
                    )}
                  </div>
                  <span
                    className={`text-xs font-bold px-2 py-1 rounded-md shrink-0 ${
                      job.match_score >= 95
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                        : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                    }`}
                  >
                    Match {job.match_score}%
                  </span>
                </div>

                <h3 className="text-lg font-bold text-white mb-2 leading-snug">{job.title}</h3>

                <div className="space-y-1.5 mb-4 text-sm text-slate-300">
                  <div className="flex items-center gap-2">
                    <Building className="w-4 h-4 text-slate-400 shrink-0" />
                    <span className="font-medium text-slate-200">{job.company}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <DollarSign className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span className="text-emerald-400 font-semibold">{job.salary}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-sky-400 shrink-0" />
                    <span className="text-xs font-medium text-sky-300 bg-sky-500/10 border border-sky-500/20 px-2 py-0.5 rounded">
                      {job.work_hours || '8h/dia (Full-time)'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-slate-400 shrink-0" />
                    <span className="text-xs text-slate-400">Aberta em: {job.date}</span>
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-800 flex items-center justify-between gap-3">
                <select
                  value={job.status}
                  onChange={(e) => updateStatus(job.id, e.target.value)}
                  className="bg-slate-800 border border-slate-700 text-xs text-slate-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-indigo-500"
                >
                  <option value="New">Nova</option>
                  <option value="Applied">Inscrito</option>
                  <option value="Interviewing">Entrevista</option>
                  <option value="Rejected">Descartada</option>
                </select>

                <a
                  href={job.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-medium transition shadow-md shadow-indigo-600/20"
                >
                  <span>Ver Vaga</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>
          ))}
        </div>

        {filteredJobs.length === 0 && (
          <div className="text-center py-20">
            <p className="text-slate-400">Nenhuma vaga encontrada com os filtros selecionados.</p>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800 py-6 text-center text-xs text-slate-500">
        JobBot PWA v2.0 &bull; Configurado para o perfil de Gian &bull; Web Push iOS &amp; Busca Diária Automática
      </footer>
    </div>
  );
}
