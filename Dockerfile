FROM node:22-slim

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

ENV PORT=3001 \
    DB_PATH=/data/tradebot.db
VOLUME /data
EXPOSE 3001

CMD ["npm", "start"]
