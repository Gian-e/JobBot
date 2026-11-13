FROM node:20-slim

WORKDIR /app

COPY package.json ./
COPY frontend/package*.json ./frontend/
COPY backend/package*.json ./backend/

RUN npm install --prefix frontend && npm install --omit=dev --prefix backend

COPY frontend ./frontend
RUN npm run build --prefix frontend && rm -rf frontend/node_modules

COPY backend ./backend

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "backend/server.js"]
