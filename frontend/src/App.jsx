import React, { useState, useEffect } from 'react';
import { Briefcase, Building, DollarSign, Calendar, ExternalLink, RefreshCw, CheckCircle, Clock, Star, Globe } from 'lucide-react';

export default function App() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('ALL');

  const fetchJobs = async () => {
    try {
      const res = await fetch('http://localhost:3000/api/jobs');
      const data = await res.json();
      setJobs(data.jobs || []);
    } catch (err) {
      console.error('Failed to fetch jobs', err);
    }
  };

  useEffect(() => {
    fetchJobs();
  }, []);

  const triggerScraper = async () => {
    setLoading(true);
    try {
      await fetch('http://localhost:3000/api/jobs/scrape', { method: 'POST' });
      await fetchJobs();
    } catch (err) {
      console.error('Failed to run scraper', err);
    } finally {
      setLoading(false);
    }
  };

  const updateStatus = async (id, status) => {
    try {
      await fetch(`http://localhost:3000/api/jobs/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      fetchJobs();
    } catch (err) {
      console.error('Failed to update status', err);
    }
  };

  const isMidPleno = (job) => /pleno|mid[\s-]?level|\bmid\b|intermediate/i.test(job.title || '');
  const isPartTimeOrReduced = (job) => /meio per[ií]odo|part[\s-]?time|4h|6h/i.test(job.work_hours || '');

  const filteredJobs = jobs.filter(job => {
    if (filter === 'ALL') return true;
    if (filter === 'MID_PLENO') return isMidPleno(job);
    if (filter === 'PART_TIME') return isPartTimeOrReduced(job);
    if (filter === 'USD') return job.currency === 'USD' || job.currency === 'EUR' || job.currency === 'GBP';
    if (filter === 'BRL') return job.currency === 'BRL';
    if (filter === 'NEW') return job.status === 'New';
    return true;
  });

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
                JobBot <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">Gian Profile</span>
              </h1>
              <p className="text-xs text-slate-400">Vagas Home Office (Mid/Pleno &amp; Sênior) &bull; &gt; R$ 12k/mês &bull; Moeda Estrangeira</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
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

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-8">
        {/* Stats & Filters */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-400 font-medium">Total de Vagas</p>
              <h3 className="text-2xl font-bold text-white mt-1">{jobs.length}</h3>
            </div>
            <div className="p-3 bg-blue-500/10 text-blue-400 rounded-lg">
              <Briefcase className="w-5 h-5" />
            </div>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-400 font-medium">Moeda Estrangeira (USD)</p>
              <h3 className="text-2xl font-bold text-emerald-400 mt-1">{jobs.filter(j => j.currency === 'USD').length}</h3>
            </div>
            <div className="p-3 bg-emerald-500/10 text-emerald-400 rounded-lg">
              <Globe className="w-5 h-5" />
            </div>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-400 font-medium">Média Salarial (BRL)</p>
              <h3 className="text-2xl font-bold text-indigo-400 mt-1">
                R$ {jobs.length ? Math.round(jobs.reduce((acc, j) => acc + j.salary_brl, 0) / jobs.length).toLocaleString() : 0}
              </h3>
            </div>
            <div className="p-3 bg-indigo-500/10 text-indigo-400 rounded-lg">
              <DollarSign className="w-5 h-5" />
            </div>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-400 font-medium">Match Médio CV</p>
              <h3 className="text-2xl font-bold text-amber-400 mt-1">
                {jobs.length ? Math.round(jobs.reduce((acc, j) => acc + j.match_score, 0) / jobs.length) : 0}%
              </h3>
            </div>
            <div className="p-3 bg-amber-500/10 text-amber-400 rounded-lg">
              <Star className="w-5 h-5" />
            </div>
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="flex gap-2 mb-6 border-b border-slate-800 pb-4 overflow-x-auto">
          {['ALL', 'MID_PLENO', 'PART_TIME', 'USD', 'BRL', 'NEW'].map(tab => (
            <button
              key={tab}
              onClick={() => setFilter(tab)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition cursor-pointer whitespace-nowrap ${
                filter === tab
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                  : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
              }`}
            >
              {tab === 'ALL' && 'Todas as Vagas'}
              {tab === 'MID_PLENO' && 'Mid / Pleno'}
              {tab === 'PART_TIME' && 'Meio Período / 6h'}
              {tab === 'USD' && 'Estrangeiras (USD/EUR)'}
              {tab === 'BRL' && 'Nacionais (> 12k)'}
              {tab === 'NEW' && 'Novas'}
            </button>
          ))}
        </div>

        {/* Job Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredJobs.map(job => (
            <div key={job.id} className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col justify-between hover:border-slate-700 transition shadow-xl">
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
                  <span className={`text-xs font-bold px-2 py-1 rounded-md shrink-0 ${
                    job.match_score >= 95 ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                  }`}>
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
                    <span className="text-xs text-slate-400">Encontrada em: {job.date}</span>
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
        JobBot v1.0 &bull; Configurado para o perfil de Gian &bull; Execução Diária Automática
      </footer>
    </div>
  );
}
