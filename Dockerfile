# Production image for the DevHunt app server.
FROM node:18-alpine

WORKDIR /app

# install only production deps first (better layer caching)
COPY package*.json ./
RUN npm install --omit=dev

# app source
COPY . .

ENV PORT=4000
EXPOSE 4000

CMD ["node", "server.js"]
