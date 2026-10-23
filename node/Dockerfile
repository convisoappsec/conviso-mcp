FROM node:22.23.4-alpine3.23

WORKDIR /app

COPY package.json ./

RUN npm install --production --no-audit --no-fund

COPY src ./src

ENV NODE_ENV=production

RUN addgroup -S app && adduser -S app -G app
USER app

ENTRYPOINT ["node", "src/conviso_mcp/server.js"]
