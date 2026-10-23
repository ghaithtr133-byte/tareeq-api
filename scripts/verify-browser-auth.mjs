/* global process, console, fetch, URL, setTimeout */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const FRONTEND_ORIGIN = 'http://localhost:3001'
const API_ORIGIN = 'http://localhost:3002'
const REPORT_DIRECTORY = resolve(process.cwd(), 'reports')
const JSON_REPORT_PATH = resolve(REPORT_DIRECTORY, 'backend-browser-auth.json')
const MARKDOWN_REPORT_PATH = resolve(REPORT_DIRECTORY, 'backend-browser-auth.md')
const AUTH_COOKIE_NAMES = new Set(['tareeq_access', 'tareeq_refresh'])
const CONTENT_RESOURCES = [
  'countries',
  'universities',
  'scholarships',
  'services',
  'articles',
]

class MissingPrerequisiteError extends Error {}

const checks = []
let backendProcess
let browser
let harnessServer
let browserEngine = 'Unavailable'

const addCheck = (id, role, status, actual) => {
  checks.push({ id, role, status, actual })
}

const wait = (milliseconds) =>
  new Promise((resolveWait) => setTimeout(resolveWait, milliseconds))

const waitForApi = async () => {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (backendProcess?.exitCode !== null) {
      throw new MissingPrerequisiteError(
        'The local Backend process exited before becoming healthy.',
      )
    }
    try {
      const response = await fetch(`${API_ORIGIN}/api/v1/health`)
      if (response.status === 200) return
    } catch {
      // The local server may still be starting.
    }
    await wait(250)
  }
  throw new MissingPrerequisiteError(
    'The local Backend did not become healthy on localhost:3002.',
  )
}

const listen = (server, port) =>
  new Promise((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(port, 'localhost', resolveListen)
  })

const closeServer = (server) =>
  new Promise((resolveClose) => {
    if (!server?.listening) {
      resolveClose()
      return
    }
    server.close(() => resolveClose())
  })

const stopBackend = async () => {
  if (!backendProcess || backendProcess.exitCode !== null) return
  backendProcess.kill()
  await Promise.race([
    new Promise((resolveExit) => backendProcess.once('exit', resolveExit)),
    wait(2_000),
  ])
}

const loadPlaywright = () => {
  const require = createRequire(import.meta.url)
  const explicitModulePath = process.env.PLAYWRIGHT_MODULE_PATH?.trim()
  try {
    return explicitModulePath
      ? require(explicitModulePath)
      : require('playwright')
  } catch {
    throw new MissingPrerequisiteError(
      'Playwright is unavailable. Install it as a development dependency or set PLAYWRIGHT_MODULE_PATH to an existing Playwright package directory.',
    )
  }
}

const browserRequest = (page, path, options = {}) =>
  page.evaluate(
    async ({ apiOrigin, requestPath, requestOptions }) => {
      const response = await fetch(`${apiOrigin}${requestPath}`, {
        credentials: 'include',
        ...requestOptions,
      })
      let body = null
      try {
        body = await response.json()
      } catch {
        // Status and browser-managed cookies remain sufficient evidence.
      }
      return {
        status: response.status,
        role: body?.data?.user?.role ?? null,
      }
    },
    { apiOrigin: API_ORIGIN, requestPath: path, requestOptions: options },
  )

const verifyRole = async (role, email, password) => {
  const context = await browser.newContext()
  const page = await context.newPage()
  try {
    await page.goto(FRONTEND_ORIGIN, { waitUntil: 'domcontentloaded' })

    const login = await browserRequest(page, '/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    addCheck(
      'login',
      role,
      login.status === 200 && login.role === role ? 'PASS' : 'FAIL',
      `HTTP ${login.status}; role correct=${login.role === role}.`,
    )

    const cookies = (await context.cookies(
      `${API_ORIGIN}/api/v1/auth/me`,
    )).filter((cookie) => AUTH_COOKIE_NAMES.has(cookie.name))
    const cookieNames = new Set(cookies.map(({ name }) => name))
    const accepted =
      cookieNames.has('tareeq_access') && cookieNames.has('tareeq_refresh')
    addCheck(
      'cookies.accepted',
      role,
      accepted ? 'PASS' : 'FAIL',
      `Browser stored both expected authentication cookie names=${accepted}.`,
    )
    const attributesCorrect =
      cookies.length === 2 &&
      cookies.every(
        ({ httpOnly, sameSite, secure, domain }) =>
          httpOnly && sameSite === 'Lax' && !secure && domain === 'localhost',
      )
    addCheck(
      'cookies.attributes',
      role,
      attributesCorrect ? 'PASS' : 'FAIL',
      `HttpOnly/Lax/development-Secure/host attributes correct=${attributesCorrect}.`,
    )

    const me = await browserRequest(page, '/api/v1/auth/me')
    addCheck(
      'me',
      role,
      me.status === 200 && me.role === role ? 'PASS' : 'FAIL',
      `HTTP ${me.status}; role correct=${me.role === role}.`,
    )

    await page.reload({ waitUntil: 'domcontentloaded' })
    const restored = await browserRequest(page, '/api/v1/auth/me')
    addCheck(
      'reload.persistence',
      role,
      restored.status === 200 && restored.role === role ? 'PASS' : 'FAIL',
      `HTTP ${restored.status} after frontend reload; role correct=${restored.role === role}.`,
    )

    const refresh = await browserRequest(page, '/api/v1/auth/refresh', {
      method: 'POST',
    })
    addCheck(
      'refresh',
      role,
      refresh.status === 200 && refresh.role === role ? 'PASS' : 'FAIL',
      `HTTP ${refresh.status}; role correct=${refresh.role === role}.`,
    )

    const adminStatuses = {}
    for (const resource of CONTENT_RESOURCES) {
      const result = await browserRequest(
        page,
        `/api/v1/admin/${resource}?page=1&limit=1`,
      )
      adminStatuses[resource] = result.status
    }
    const adminReadsPass = Object.values(adminStatuses).every(
      (status) => status === 200,
    )
    addCheck(
      'admin.content_reads',
      role,
      adminReadsPass ? 'PASS' : 'FAIL',
      `Five protected Admin GET responses succeeded=${adminReadsPass}.`,
    )

    const logout = await browserRequest(page, '/api/v1/auth/logout', {
      method: 'POST',
    })
    addCheck(
      'logout',
      role,
      logout.status === 200 ? 'PASS' : 'FAIL',
      `HTTP ${logout.status}.`,
    )

    const afterLogout = await browserRequest(page, '/api/v1/auth/me')
    addCheck(
      'logout.invalidation',
      role,
      afterLogout.status === 401 ? 'PASS' : 'FAIL',
      `HTTP ${afterLogout.status} after logout.`,
    )

    const remainingCookies = (await context.cookies(
      `${API_ORIGIN}/api/v1/auth/me`,
    )).filter((cookie) => AUTH_COOKIE_NAMES.has(cookie.name))
    addCheck(
      'cookies.cleared',
      role,
      remainingCookies.length === 0 ? 'PASS' : 'FAIL',
      `Authentication cookies remaining after logout=${remainingCookies.length}.`,
    )
  } finally {
    await context.close()
  }
}

const execute = async () => {
  const requiredCredentials = [
    'INITIAL_ADMIN_EMAIL',
    'INITIAL_ADMIN_PASSWORD',
    'INITIAL_SUPER_ADMIN_EMAIL',
    'INITIAL_SUPER_ADMIN_PASSWORD',
  ]
  if (requiredCredentials.some((name) => !process.env[name]?.trim())) {
    throw new MissingPrerequisiteError(
      'The four INITIAL_* email/password variables are not configured.',
    )
  }
  const allowedOrigins = (process.env.AUTH_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
  if (!allowedOrigins.includes(FRONTEND_ORIGIN)) {
    throw new MissingPrerequisiteError(
      'AUTH_ALLOWED_ORIGINS does not include http://localhost:3001.',
    )
  }

  harnessServer = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? '/', FRONTEND_ORIGIN)
    if (requestUrl.pathname !== '/') {
      response.writeHead(404)
      response.end()
      return
    }
    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/html; charset=utf-8',
    })
    response.end(
      '<!doctype html><html><head><meta charset="utf-8"><title>Tareeq browser authentication verification</title></head><body><h1>Tareeq browser authentication verification</h1></body></html>',
    )
  })
  try {
    await listen(harnessServer, 3001)
  } catch {
    throw new MissingPrerequisiteError(
      'The temporary browser harness could not listen on localhost:3001.',
    )
  }

  backendProcess = spawn(process.execPath, ['dist/server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PORT: '3002',
    },
    stdio: 'ignore',
    windowsHide: true,
  })
  await waitForApi()

  const { chromium } = loadPlaywright()
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true })
  } catch {
    throw new MissingPrerequisiteError(
      'Playwright could not launch installed Google Chrome through channel "chrome".',
    )
  }
  browserEngine = `Google Chrome ${browser.version()}`

  await verifyRole(
    'ADMIN',
    process.env.INITIAL_ADMIN_EMAIL,
    process.env.INITIAL_ADMIN_PASSWORD,
  )
  await verifyRole(
    'SUPER_ADMIN',
    process.env.INITIAL_SUPER_ADMIN_EMAIL,
    process.env.INITIAL_SUPER_ADMIN_PASSWORD,
  )
}

let prerequisiteIssue = null
try {
  await execute()
} catch (error) {
  if (error instanceof MissingPrerequisiteError) {
    prerequisiteIssue = error.message
    addCheck('browser.prerequisite', 'BOTH', 'BLOCKED', error.message)
  } else {
    addCheck(
      'browser.execution',
      'BOTH',
      'FAIL',
      'The browser verification stopped on an unexpected sanitized error.',
    )
  }
} finally {
  if (browser) await browser.close()
  await stopBackend()
  await closeServer(harnessServer)
}

const summary = {
  total: checks.length,
  passed: checks.filter(({ status }) => status === 'PASS').length,
  failed: checks.filter(({ status }) => status === 'FAIL').length,
  blocked: checks.filter(({ status }) => status === 'BLOCKED').length,
}
const overallStatus =
  summary.failed > 0 ? 'FAIL' : summary.blocked > 0 ? 'BLOCKED' : 'PASS'
const report = {
  schemaVersion: 1,
  generatedAtUtc: new Date().toISOString(),
  overallStatus,
  browserCookiePersistence: overallStatus,
  browserEngine,
  browserChannel: 'chrome',
  frontendOrigin: FRONTEND_ORIGIN,
  apiOrigin: API_ORIGIN,
  authenticationFlow:
    'Playwright-controlled Google Chrome fetch requests with credentials enabled and browser-managed HttpOnly cookies; no Cookie header was constructed.',
  scope:
    'Local same-site browser cookie-policy compatibility; not full Admin Dashboard integration.',
  prerequisiteIssue,
  summary,
  checks,
  safeguards: [
    'Passwords, tokens, cookie values, emails, database URLs, and response bodies are excluded from this report.',
    'SameSite=Lax, HttpOnly, credentialed CORS, and CSRF Origin enforcement remained enabled.',
    'Only login, refresh, read-only Admin GET requests, and logout were exercised.',
  ],
  remainingFrontendIntegrationRisks: [
    'The local harness does not verify the real Admin Dashboard implementation.',
    'Production DNS, TLS, CORS configuration, and shared-site subdomains require separate deployment verification.',
  ],
}

await mkdir(REPORT_DIRECTORY, { recursive: true })
await writeFile(JSON_REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
const markdown = [
  '# Backend Browser Authentication Report',
  '',
  `- Generated: ${report.generatedAtUtc}`,
  `- Browser Cookie Persistence: **${report.browserCookiePersistence}**`,
  `- Browser Engine: ${report.browserEngine}`,
  `- Frontend Origin: ${report.frontendOrigin}`,
  `- API Origin: ${report.apiOrigin}`,
  `- Authentication Flow: ${report.authenticationFlow}`,
  `- Scope: ${report.scope}`,
  `- Checks: ${summary.passed} PASS / ${summary.failed} FAIL / ${summary.blocked} BLOCKED`,
  '',
  '| Status | Role | Check | Actual |',
  '|---|---|---|---|',
  ...checks.map(
    ({ status, role, id, actual }) =>
      `| ${status} | ${role} | ${id} | ${actual.replaceAll('|', '\\|')} |`,
  ),
  '',
  '## Remaining Frontend Integration Risks',
  '',
  ...report.remainingFrontendIntegrationRisks.map((risk) => `- ${risk}`),
  '',
  '## Safeguards',
  '',
  ...report.safeguards.map((safeguard) => `- ${safeguard}`),
  '',
]
await writeFile(MARKDOWN_REPORT_PATH, markdown.join('\n'), 'utf8')

console.log(`Browser Cookie Persistence: ${overallStatus}`)
console.log(`Browser Engine: ${browserEngine}`)
console.log(
  `Checks: ${summary.passed} PASS / ${summary.failed} FAIL / ${summary.blocked} BLOCKED`,
)
console.log(`JSON: ${JSON_REPORT_PATH}`)
console.log(`Markdown: ${MARKDOWN_REPORT_PATH}`)

if (overallStatus === 'FAIL') process.exitCode = 1
if (overallStatus === 'BLOCKED') process.exitCode = 2
