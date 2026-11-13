# JobBot 🤖💼 (PWA + Web Push iOS)

Sistema inteligente de busca diária de vagas **Home Office** (com preferência para **moeda estrangeira** e salários **acima de R$ 12.000,00 BRL**), personalizado para o perfil profissional do **Gian** (`gian-e`).

---

## ⚙️ Como Executar Localmente (pela raiz `\JobBot`)

### Opção 1: Rodar Front + Back simultaneamente (Desenvolvimento)
Direto na raiz `C:\Workspace\JobBot`, execute **qualquer um** dos comandos abaixo:

```powershell
npm run dev
```
ou no Windows PowerShell / CMD:
```powershell
.\start.ps1
# ou
.\start.bat
```
- O script verifica/instala dependências automaticamente se necessário e sobe:
  - **Backend API & Scraper:** `http://localhost:3000`
  - **Frontend Dashboard (Vite):** `http://localhost:5173`

### Opção 2: Modo Unificado de Produção (Porta única)
```powershell
npm run build
npm start
```
- Acesse tudo em `http://localhost:3000`.

---

## ☁️ Instruções de Deploy 100% Gratuito (Render + GitHub Actions)

### Passo 1: Subir o código no GitHub
Na raiz `C:\Workspace\JobBot`, envie o projeto para um repositório no seu GitHub:
```bash
git init
git add .
git commit -m "feat: JobBot fullstack otimizado"
git branch -M main
git remote add origin https://github.com/SEU_USUARIO/jobbot.git
git push -u origin main
```

### Passo 2: Hospedar Gratuitamente no Render.com
O projeto já possui o arquivo `render.yaml` e `Dockerfile` configurados para rodar **Frontend (PWA) + Backend (API + SQLite + Scraper)** em **um único Web Service gratuito**:

1. Crie uma conta gratuita em [render.com](https://render.com) usando seu login do GitHub.
2. No painel do Render, clique em **New +** → **Blueprint** (ou **Web Service**).
   - **Usando Blueprint (Automático):** Selecione o repositório `jobbot`. O Render lerá o arquivo `render.yaml` e configurará tudo sozinho no plano `Free`.
   - **Usando Web Service Manual:**
     - **Runtime:** `Node`
     - **Build Command:** `npm run build`
     - **Start Command:** `npm start`
     - **Instance Type:** `Free`
3. Aguarde o término do build (~2 minutos) e copie a URL pública gerada (ex: `https://jobbot-gian.onrender.com`).

> **Dica (Persistência das chaves VAPID no plano Free):**
> Para evitar que as chaves de Web Push mudem quando o container gratuito reiniciar, rode `npm run generate-vapid` localmente e adicione `VAPID_PUBLIC_KEY` e `VAPID_PRIVATE_KEY` na aba **Environment** do Render.

### Passo 3: Acordar o Servidor Diariamente via GitHub Actions (Grátis)
No plano gratuito do Render, o servidor hiberna após 15 minutos sem acesso. O workflow `.github/workflows/daily-scrape.yml` já está pronto para acordar o servidor todos os dias às **08:00 (horário de Brasília)**, rodar o scraper e disparar o Push para o seu iPhone:

1. No seu repositório do GitHub, acesse **Settings** → **Secrets and variables** → **Actions**.
2. Clique em **New repository secret**:
   - **Name:** `APP_URL`
   - **Secret:** `https://jobbot-gian.onrender.com` *(sua URL do Render sem barra no final)*
3. Pronto! Você também pode testar imediatamente indo na aba **Actions** → **Daily JobBot Scrape & iPhone Push** → **Run workflow**.

### Passo 4: Instalar o WebApp e Ativar Push no iPhone (iOS 16.4+)
1. Abra a URL do Render (`https://...`) no **Safari** do iPhone.
2. Toque em **Compartilhar** (ícone na barra inferior) → **Adicionar à Tela de Início** → **Adicionar**.
3. Abra o aplicativo **JobBot** pelo ícone criado na tela inicial.
4. Toque no botão **"Ativar Notificações"**, permita os alertas do iOS e depois toque em **"Push Ativo (Testar)"** para receber uma notificação de teste na hora.
