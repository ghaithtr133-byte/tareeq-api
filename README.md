# Tareeq Academy Backend

Standalone backend API for Tareeq Academy, an educational consulting platform. This repository currently contains only the approved project foundation and API documentation; business modules will be added through separately approved tasks.

## Technology stack

- Node.js 24
- TypeScript in strict mode
- Hono
- Zod and `@hono/zod-openapi`
- Scalar API Reference
- Vercel Functions

Prisma, Neon PostgreSQL, Resend, and Cloudinary are approved for future work but are intentionally not installed or configured in this task.

## Prerequisites

- Node.js 24.x
- npm 11.x

## Local setup

```sh
npm install
copy .env.example .env
npm run dev
```

On macOS or Linux, use `cp .env.example .env`. The current environment value is:

- `PORT`: local Node.js server port; defaults to `3000`.

No secrets are required by the current foundation.

## Commands

```sh
npm run dev        # Start the local server with file watching
npm run typecheck  # Check TypeScript types
npm run lint       # Run ESLint
npm test           # Run focused automated tests
npm run build      # Compile production output to dist/
npm start          # Run the compiled local Node.js entrypoint
```

## API and documentation

With the local server running:

- `GET http://localhost:3000/api/v1/health` — unauthenticated process health check.
- `GET http://localhost:3000/openapi.json` — generated OpenAPI 3.1 document.
- `GET http://localhost:3000/docs` — interactive Scalar API reference.

API endpoints return a consistent envelope. Successful responses use `{ "success": true, "data": ... }`; errors use `{ "success": false, "error": { "code": "...", "message": "...", "details": ... } }`.

## Vercel preparation

`src/index.ts` exports the Hono application as the default export, which is the entrypoint expected by Hono's current zero-configuration Vercel integration. The local Node.js server lives separately in `src/server.ts`, so it is not required by the Vercel runtime. Set the project runtime to Node.js 24 in Vercel and deploy the repository root. No `vercel.json` is currently necessary.

An actual production deployment is not part of this initialization task and has not been performed.

## Current limitations

- No database or Prisma setup.
- No authentication or authorization.
- No business-domain endpoints.
- No email, file upload, analytics, audit, or scheduled-job integrations.
- The health check reports process availability only and intentionally has no dependency checks.
