FROM node:22-alpine AS build
WORKDIR /workspace

COPY package.json package-lock.json tsconfig.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/domain/package.json packages/domain/package.json
RUN npm ci

COPY apps apps
COPY packages packages
RUN npm run build

FROM node:22-alpine AS production
ENV NODE_ENV=production
WORKDIR /app

RUN addgroup -S familyhub && adduser -S -G familyhub -u 10001 familyhub
COPY --from=build /workspace/package.json /workspace/package-lock.json ./
COPY --from=build /workspace/apps/api/package.json apps/api/package.json
COPY --from=build /workspace/apps/web/package.json apps/web/package.json
COPY --from=build /workspace/packages/config/package.json packages/config/package.json
COPY --from=build /workspace/packages/contracts/package.json packages/contracts/package.json
COPY --from=build /workspace/packages/database/package.json packages/database/package.json
COPY --from=build /workspace/packages/domain/package.json packages/domain/package.json
RUN npm ci --omit=dev --workspace @familyhub/api --workspace @familyhub/config --workspace @familyhub/contracts --workspace @familyhub/database

COPY --from=build /workspace/apps/api/dist apps/api/dist
COPY --from=build /workspace/apps/web/dist apps/web/dist
COPY --from=build /workspace/packages/config/dist packages/config/dist
COPY --from=build /workspace/packages/contracts/dist packages/contracts/dist
COPY --from=build /workspace/packages/database/dist packages/database/dist
COPY --from=build /workspace/packages/database/migrations packages/database/migrations

RUN mkdir -p /data/attachments && chown -R familyhub:familyhub /data
USER familyhub
EXPOSE 3000
CMD ["sh", "-c", "node apps/api/dist/migrate.js && exec node apps/api/dist/index.js"]
