# Dockerfile admin-bot (Playwright + Chromium sudah include)
# Image resmi Playwright membawa Chromium + semua dependency OS-nya,
# jadi bot headless jalan stabil tanpa setup tambahan.
FROM mcr.microsoft.com/playwright:v1.45.0-jammy

WORKDIR /usr/src/bot

COPY package.json ./
RUN npm install --omit=dev

COPY bot.js ./

CMD ["node", "bot.js"]
