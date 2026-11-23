FROM node:22-bookworm-slim AS build
WORKDIR /src/api
COPY api/package.json ./
RUN npm install
COPY api/ ./
RUN npm run build

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /src/api/dist ./api/dist
COPY gateway/gt06 ./gateway/gt06
EXPOSE 5023/tcp 5024/tcp
USER node
CMD ["node", "gateway/gt06/server.js"]
