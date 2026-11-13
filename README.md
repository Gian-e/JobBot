# JobBot 🤖💼 (PWA + Web Push iOS)

Sistema inteligente de busca diária de vagas **Home Office** (com preferência para **moeda estrangeira** e salários **acima de R$ 12.000,00 BRL**), personalizado para o perfil profissional do **Gian** (`gian-e`).

---

## 🚀 Funcionalidades
1. **Busca Automatizada Diária (5 Plataformas):** Scraping real no **LinkedIn, Gupy, RemoteOK, WeWorkRemotely e Remotive** via `node-cron` e GitHub Actions.
2. **Filtro de Perfil & Salário:** Avalia o match com o currículo (Mid/Pleno e Sênior) e filtra apenas vagas acima de 12k BRL ou em moeda estrangeira (USD/EUR/GBP).
3. **WebApp (PWA) para iPhone com Web Push Nativo:** Instalável na Tela de Início do iOS (Safari) com suporte a notificações Push nativas (`web-push` + Service Worker) sempre que novas vagas forem encontradas.
4. **Deploy Unificado Gratuito:** Um único serviço Node.js serve o Frontend (PWA), a API, o Banco SQLite e o Scraper (pronto para Render ou Railway via `render.yaml` ou `Dockerfile`).

---

## 📲 Como Publicar e Instalar no iPhone

### 1. Publicar no Render ou Railway (Serviço Único)
1. Suba este repositório no seu **GitHub**.
2. Crie um novo **Web Service** no [Render](https://render.com) ou [Railway](https://railway.app) conectado ao repositório:
   - **Build Command:** `npm run build`
   - **Start Command:** `npm start`
   *(No Render, o arquivo `render.yaml` na raiz já configura tudo automaticamente via Blueprint).*

### 2. Ativar o Agendamento Diário no GitHub Actions
Para garantir que o servidor gratuito acorde todos os dias às **08:00 (Brasília)**, rode o scraper e envie a notificação pro seu iPhone:
1. No repositório do GitHub, vá em **Settings → Secrets and variables → Actions**.
2. Crie uma *Repository Secret* chamada `APP_URL` com a URL pública do seu app (ex: `https://jobbot-gian.onrender.com`).
3. O workflow `.github/workflows/daily-scrape.yml` rodará diariamente às 08h00 (e também pode ser disparado manualmente na aba **Actions**).

### 3. Instalar o WebApp e Ativar Notificações no iPhone (iOS 16.4+)
1. Abra a URL publicada (`https://...`) no **Safari** do seu iPhone.
2. Toque no botão **Compartilhar** (ícone de quadrado com seta para cima na barra inferior).
3. Role para baixo e toque em **"Adicionar à Tela de Início"** (*Add to Home Screen*) e confirme em **Adicionar**.
4. Abra o **JobBot** pelo ícone criado na tela inicial do iPhone.
5. No topo do app, toque em **"Ativar Notificações"**, permita os alertas do iOS e depois toque em **"Push Ativo (Testar)"** para receber uma notificação de teste imediata!

---

## ⚙️ Como Executar Localmente

### Modo Unificado (Produção Local)
```bash
npm run build
npm start
```
*(Acesse `http://localhost:3000`)*

### Modo Desenvolvimento
```bash
npm run dev:backend
npm run dev:frontend
```
*(O dashboard abrirá em `http://localhost:5173`)*
