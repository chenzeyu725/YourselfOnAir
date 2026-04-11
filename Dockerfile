FROM node:20-alpine
WORKDIR /app

COPY package.json ./
COPY server.js ./
COPY api ./api
COPY public ./public

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["npm", "run", "start"]
