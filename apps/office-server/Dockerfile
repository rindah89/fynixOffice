# fynixOffice server (suite BFF) — build from monorepo root:
#   docker build -f apps/office-server/Dockerfile -t fynixoffice-server .
#
# Joins the shared Docker network `fynix-suite` like HQ / DocFlow / Finance.

FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/agent-core packages/agent-core
COPY packages/ai-provider packages/ai-provider
COPY apps/office-server apps/office-server

# Install only the server workspace (+ its workspace deps)
RUN npm ci -w @fynixoffice/office-server -w @fynixoffice/ai-provider -w @fynixoffice/agent-core

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=4321 \
    OFFICE_BASE_URL=http://localhost:4321

COPY --from=build /app /app
WORKDIR /app/apps/office-server

USER node
EXPOSE 4321
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4321)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npx", "tsx", "src/index.ts"]
