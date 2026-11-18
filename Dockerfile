# 스터디온에듀 앱 이미지. 컨테이너 안에서 마이그레이션·시드를 돌릴 수 있게 node_modules를 그대로 둔다.
FROM node:22-bookworm-slim AS base
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

FROM deps AS build
COPY . .
# 빌드 때는 DB에 붙지 않는다. Prisma가 주소 형식만 확인하므로 가짜 값을 넣는다.
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
# 개발용 패키지도 남긴다: 서버에서 prisma(마이그레이션)·tsx(시드)를 그대로 쓴다.
RUN npm run build

FROM base AS run
ENV NODE_ENV=production PORT=3000
COPY --from=build --chown=node:node /app ./
RUN chmod +x docker-entrypoint.sh
USER node
EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]
