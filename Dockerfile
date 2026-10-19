# Single image: Next.js app + in-process background worker (uploads, ffmpeg, Telegram, AI).
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# ffmpeg-static downloads its static Linux binary (with libx264/libx265) during install.
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /app ./
RUN mkdir -p /data/storage /data/tmp && chown -R node:node /data
USER node
EXPOSE 3000
CMD ["sh", "-c", "node scripts/migrate.mjs && exec node_modules/.bin/next start"]
