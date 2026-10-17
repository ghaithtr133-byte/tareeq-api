# Tareeq Academy Backend Agent Guide

## Architecture

This repository is an independently deployed Node.js 24 backend implemented as a modular monolith with Hono and TypeScript. Keep modules cohesive inside this application and introduce module boundaries only when an approved feature needs them. `src/app.ts` assembles the application, `src/auth/` contains administrative authentication and authorization, `src/database/` owns the Prisma runtime client, `src/routes/` contains other implemented route definitions, `src/shared/` contains shared HTTP conventions, `src/config/` owns runtime configuration, `src/index.ts` is the Vercel entrypoint, and `src/server.ts` is the local Node.js entrypoint. Prisma schema and versioned migrations live under `prisma/`.

Do not create placeholder modules, speculative abstractions, or empty future-feature directories.

## Authority and workflow

Project Leadership owns architecture, API contracts, business requirements, scope, priorities, and acceptance. Work must correspond to an approved Linear task. Inspect the repository and working tree before changing files, implement only the active task, run its required verification, review the final diff, and report evidence. Only Project Leadership can approve task completion; an agent may mark work ready for review but may not declare the Linear task approved or complete.

When a requirement genuinely needs a leadership decision, stop the affected change and report `BLOCKED — LEAD DECISION REQUIRED` with the problem, reason, impact, options, recommendation, and exact decision needed.

## Approved technology restrictions

- Runtime: Node.js 24.
- Language: strict TypeScript.
- HTTP framework: Hono.
- Validation and API description: Zod and OpenAPI using the approved Hono integration.
- Interactive reference: official Scalar Hono integration.
- Database: Prisma ORM with Neon PostgreSQL and versioned migrations.
- Hosting target: Vercel Functions.
- npm is the package manager unless Project Leadership approves a change.
- Lock exact dependency versions.

Resend and Cloudinary may be introduced only by tasks that explicitly authorize them. Do not add frameworks, infrastructure, or dependencies for anticipated work.

## API conventions

- Public API endpoints use the `/api/v1` prefix.
- Success responses use `{ "success": true, "data": ... }`.
- Error responses use `{ "success": false, "error": { "code": "...", "message": "...", "details": ... } }`.
- Use appropriate HTTP status codes and centralized safe error handling.
- Define implemented endpoints with the Zod/OpenAPI route pattern so runtime validation and documentation remain aligned.
- Serve the OpenAPI document at `/openapi.json` and Scalar at `/docs`.
- Do not expose stack traces, secrets, or sensitive internal details in responses.
- Administrative authentication uses host-only HttpOnly cookies, signed 15-minute access JWTs, rotating hashed refresh sessions, explicit origin/CORS controls, and exactly `ADMIN` and `SUPER_ADMIN` roles.
- Never return password hashes or authentication credentials in JSON, log them, or persist plaintext refresh credentials.
- Use versioned Prisma migrations against explicitly identified development databases; never use destructive commands or `prisma db push` as a migration substitute.

Report any proposed change to an approved API contract to Project Leadership before implementing it. Do not silently change paths, envelopes, status codes, request/response schemas, or documented behavior.

## Scope and change control

Make the smallest maintainable change that satisfies the approved task. Do not refactor unrelated code, implement future tasks, or alter approved architecture independently. Preserve existing developer comments, TODOs, unrelated modifications, and work in progress. Never remove or rewrite them merely for cleanup.

## Verification

Run typecheck, lint, production build, and focused automated tests for every implementation task unless the task explicitly sets different checks. Exercise the relevant HTTP behavior and documentation output. Review `git diff` and `git status` for scope, secrets, and unrelated changes. Report every required check as PASS, FAIL, or BLOCKED with the command and evidence; never claim an unexecuted check passed.

Do not commit, push, deploy, or begin another Linear task without explicit authorization.
