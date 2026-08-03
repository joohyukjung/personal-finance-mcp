FROM node:22-bookworm-slim AS builder

# sqlite3는 네이티브 바이너리 애드온(node-gyp). Alpine(musl)은 prebuilt 바이너리
# 호환성 문제가 잦아서 glibc 기반 Debian slim 이미지를 사용. prebuilt 바이너리가 없는
# 아키텍처를 대비해 컴파일 도구도 같이 설치.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .

FROM node:22-bookworm-slim AS release

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8000

COPY --from=builder /app/src ./src
COPY --from=builder /app/package.json ./package.json
# builder 스테이지에서 이미 컴파일된 node_modules(sqlite3 네이티브 바이너리 포함)를
# 그대로 복사 — release 스테이지에서 다시 npm install하면 build-essential이 없어
# 네이티브 컴파일이 실패할 수 있어 재설치 대신 복사로 대체.
COPY --from=builder /app/node_modules ./node_modules

EXPOSE 8000

# Goover MCP Hub 게이트웨이 연동용: 원본 stdio 엔트리포인트(src/index.js) 대신
# HTTP 브릿지(src/http-server.js)를 실행. stdio로 직접 붙이고 싶으면
# `docker run -i <image> node src/index.js` 로 오버라이드 가능.
CMD ["node", "src/http-server.js"]