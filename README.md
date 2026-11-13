# JobBot 🤖💼

Sistema inteligente de busca diária de vagas **Home Office** (com preferência para **moeda estrangeira** e salários **acima de R$ 12.000,00 BRL**), personalizado para o perfil profissional do **Gian** (`gian-e`).

---

## 🚀 Funcionalidades
1. **Busca Automatizada Diária:** Scraping/Agendamento (`node-cron`) para coletar novas oportunidades no LinkedIn, Gulpy, Remotar e plataformas parceiras.
2. **Filtro de Perfil & Salário:** Avalia o match com o currículo e filtra apenas vagas acima de 12k BRL ou em moeda estrangeira (USD/EUR).
3. **Dashboard Web Moderno:** Interface limpa em React + Tailwind CSS para visualizar título, empresa, salário, data, score de match e link de inscrição, além de controlar o status (*Nova, Inscrito, Entrevista*).
4. **Pronto para Hospedagem Gratuita:** Backend leve (Node.js/Express + SQLite) e Frontend estático (Vite/React) prontos para deploy no Render, Railway, Vercel ou Netlify.

---

## ⚙️ Como Executar Localmente

### 1. Iniciar o Backend
```bash
cd backend
npm install
npm run dev
```
*(O servidor rodará na porta `3000`)*

### 2. Iniciar o Frontend (Dashboard)
```bash
cd frontend
npm install
npm run dev
```
*(O dashboard abrirá em `http://localhost:5173`)*
