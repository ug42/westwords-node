# Works on Fly.io, Koyeb, Google Cloud Run, Railway, etc.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY . .
USER node
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.js"]
