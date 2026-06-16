FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY public ./public
COPY index.html operational.html ./
COPY scripts ./scripts
COPY src ./src

ENV NODE_ENV=production
ENV PORT=80

EXPOSE 80

CMD ["node", "src/server.js"]
