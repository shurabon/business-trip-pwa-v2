FROM node:20-slim

# Установка LibreOffice (для конвертации в PDF при необходимости) и шрифтов
RUN apt-get update && apt-get install -y --no-install-recommends \
    libreoffice-calc \
    libreoffice-writer \
    fonts-dejavu \
    fonts-liberation \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY server.js ./
RUN mkdir -p /app/templates

EXPOSE 4000

ENV PORT=4000
CMD ["node", "server.js"]
