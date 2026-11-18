FROM node:22-slim
ENV NODE_ENV=production \
    TZ=America/Sao_Paulo \
    DB_PATH=/app/data/rotas.db \
    PORT=3000
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY public ./public
RUN mkdir -p /app/data
EXPOSE 3000
CMD ["node", "--no-warnings", "src/server.js"]
