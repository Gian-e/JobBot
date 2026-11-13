FROM node:20-slim

WORKDIR /app

# Instala Python3 + requests para suportar tanto o scraper JS quanto o Python
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-requests \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json ./
COPY frontend/package*.json ./frontend/
COPY backend/package*.json ./backend/

RUN npm install --prefix frontend && npm install --prefix backend

COPY . .

RUN npm run build --prefix frontend

EXPOSE 3000

CMD ["node", "backend/server.js"]
