# Label printer service for Coolify (Docker).
# Includes Chromium (for Puppeteer label rendering) and CUPS (to print to the
# Brother QL-1110NWB over the LAN via IPP). Runs on the same Mac as Coolify, so
# the container can reach the printer at 192.168.1.150.
FROM node:20-bookworm-slim

# System deps: CUPS (print pipeline), Chromium (PDF render), fonts.
RUN apt-get update && apt-get install -y --no-install-recommends \
      cups cups-client cups-bsd \
      chromium \
      fonts-liberation fonts-dejavu-core \
      ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

# Use the system Chromium instead of Puppeteer's bundled download.
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_ENV=production \
    DATA_DIR=/data

WORKDIR /app

# Install production deps first (better layer caching).
COPY package.json ./
RUN npm install --omit=dev

# App source.
COPY . .

RUN mkdir -p /data && chmod +x docker/entrypoint.sh

EXPOSE 8088

# entrypoint starts CUPS, registers the network printer, then runs the app.
ENTRYPOINT ["/app/docker/entrypoint.sh"]
