# Official Playwright image ships Chromium and its OS dependencies.
FROM mcr.microsoft.com/playwright:v1.45.0-jammy
WORKDIR /usr/src/bot
COPY package.json ./
RUN npm install --omit=dev
COPY bot.js ./
CMD ["node", "bot.js"]
