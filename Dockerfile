FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
# En Fly.io no existe DISABLE_BOT, así que bot_main.js corre normalmente
CMD ["node", "bot_main.js"]
