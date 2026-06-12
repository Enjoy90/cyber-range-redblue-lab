# Dockerfile aplikasi Node.js (Admin Feedback System)
# APA: bungkus app jadi container yang ringan & reproducible.
FROM node:20-slim

WORKDIR /usr/src/app

# Install dependency dulu (manfaatin layer cache Docker)
COPY package.json ./
RUN npm install --omit=dev

# Salin source code
COPY server.js ./

# Web app WAJIB jalan di port 3075 (sesuai brief)
EXPOSE 3075

# Direktori log forensik (di-mount sebagai volume dari host VM)
ENV LOG_DIR=/opt/admin/logs

CMD ["node", "server.js"]
