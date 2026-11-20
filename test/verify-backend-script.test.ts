import { spawn, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const scriptPath = resolve('scripts/verify-backend.ps1')
const defaultPaths = {
  outputDirectory: resolve('reports'),
  manifestPath: resolve('reports', 'initial-seed-manifest.json'),
  environmentFile: resolve('.env'),
  browserReportPath: resolve('reports', 'backend-browser-auth.json'),
}

const runSmoke = (host: string, hostArguments: string[], arguments_: string[] = []) => {
  const result = spawnSync(host, [
    ...hostArguments,
    '-File', scriptPath,
    '-SmokeDefaultPaths',
    ...arguments_,
  ], { cwd: process.cwd(), encoding: 'utf8' })
  if (result.error) throw result.error
  expect(result.status, result.stderr).toBe(0)
  return JSON.parse(result.stdout) as typeof defaultPaths
}

const hosts = [
  { executable: 'powershell.exe', arguments: ['-NoProfile', '-ExecutionPolicy', 'Bypass'] },
  { executable: 'pwsh', arguments: ['-NoProfile'] },
]

let server: Server
let baseUrl = ''

const runDiagnostic = (host: typeof hosts[number], mode: '-DiagnosticGetPath' | '-DiagnosticDownloadPath', path: string, target = baseUrl) => new Promise<Record<string, unknown>>((resolveRun, rejectRun) => {
  const child = spawn(host.executable, [
    ...host.arguments,
    '-File', scriptPath,
    '-BaseUrl', target,
    mode, path,
  ], { cwd: process.cwd() })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
  child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
  child.on('error', rejectRun)
  child.on('close', (code) => {
    try {
      expect(code, stderr).toBe(0)
      resolveRun(JSON.parse(stdout) as Record<string, unknown>)
    } catch (error) {
      rejectRun(error)
    }
  })
})

describe.skipIf(process.platform !== 'win32')('verify-backend PowerShell compatibility', () => {
  beforeAll(async () => {
    const zip = readFileSync(resolve('docs/postman.zip'))
    server = createServer((request, response) => {
      response.setHeader('X-Request-Id', 'local-verifier-test')
      if (request.url === '/json') {
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ success: true, data: { status: 'ok' } }))
      } else if (request.url === '/unauthorized') {
        response.writeHead(401, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ success: false, error: { code: 'AUTHENTICATION_REQUIRED' } }))
      } else if (request.url === '/forbidden') {
        response.writeHead(403, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ success: false, error: { code: 'FORBIDDEN' } }))
      } else if (request.url === '/zip') {
        response.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="tareeq-api-postman.zip"' })
        response.end(zip)
      } else if (request.url === '/transport-failure') {
        request.socket.destroy()
      } else {
        response.writeHead(404, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ success: false, error: { code: 'CONTENT_NOT_FOUND' } }))
      }
    })
    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('The local verifier test server did not expose a TCP port.')
    baseUrl = `http://127.0.0.1:${address.port}`
    if ((await fetch(`${baseUrl}/json`)).status !== 200) throw new Error('The local verifier test server is unavailable.')
  })

  afterAll(async () => {
    await new Promise<void>((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()))
  })

  it('initializes repository-relative defaults in Windows PowerShell 5.1', () => {
    expect(runSmoke('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass'])).toEqual(defaultPaths)
  })

  it('initializes repository-relative defaults in PowerShell 7 and preserves explicit overrides', () => {
    expect(runSmoke('pwsh', ['-NoProfile'])).toEqual(defaultPaths)
    const customOutput = resolve('temporary-verifier-output')
    const customManifest = resolve('temporary-manifest.json')
    const customEnvironment = resolve('temporary.env')
    const customBrowserReport = resolve('temporary-browser-report.json')
    expect(runSmoke('pwsh', ['-NoProfile'], [
      '-OutputDirectory', customOutput,
      '-ManifestPath', customManifest,
      '-EnvironmentFile', customEnvironment,
      '-BrowserReportPath', customBrowserReport,
    ])).toEqual({
      outputDirectory: customOutput,
      manifestPath: customManifest,
      environmentFile: customEnvironment,
      browserReportPath: customBrowserReport,
    })
  }, 15_000)

  it('preserves JSON HTTP responses, real 401/403/404 statuses, and transport failures in both hosts', async () => {
    for (const host of hosts) {
      const success = await runDiagnostic(host, '-DiagnosticGetPath', '/json')
      expect(success.statusCode, JSON.stringify(success)).toBe(200)
      expect(success).toMatchObject({ requestIdPresent: true, jsonParsed: true, transportErrorType: null })
      await expect(runDiagnostic(host, '-DiagnosticGetPath', '/unauthorized')).resolves.toMatchObject({ statusCode: 401, errorCode: 'AUTHENTICATION_REQUIRED', transportErrorType: null })
      await expect(runDiagnostic(host, '-DiagnosticGetPath', '/forbidden')).resolves.toMatchObject({ statusCode: 403, errorCode: 'FORBIDDEN', transportErrorType: null })
      await expect(runDiagnostic(host, '-DiagnosticGetPath', '/missing')).resolves.toMatchObject({ statusCode: 404, errorCode: 'CONTENT_NOT_FOUND', transportErrorType: null })
      const unavailable = await runDiagnostic(host, '-DiagnosticGetPath', '/transport-failure')
      expect(unavailable.statusCode).toBe(0)
      expect(unavailable.transportErrorType).toEqual(expect.any(String))
      expect(unavailable.transportReason).toEqual(expect.any(String))
    }
  }, 30_000)

  it('keeps Postman ZIP downloads binary-safe in both hosts', async () => {
    for (const host of hosts) {
      const download = await runDiagnostic(host, '-DiagnosticDownloadPath', '/zip')
      expect(download.statusCode, JSON.stringify(download)).toBe(200)
      expect(download).toMatchObject({
        statusCode: 200,
        requestIdPresent: true,
        zipSignature: '50-4B-03-04',
        zipValid: true,
        zipEntries: 4,
        transportErrorType: null,
      })
    }
  }, 30_000)

  it('retains blocked OpenAPI prerequisites as deployment dependencies instead of contract failures', async () => {
    const outputDirectory = resolve(tmpdir(), `tareeq-verifier-${Date.now()}`)
    const child = spawn('pwsh', [
      '-NoProfile', '-File', scriptPath,
      '-BaseUrl', baseUrl,
      '-OutputDirectory', outputDirectory,
      '-TimeoutSeconds', '5',
    ], { cwd: process.cwd() })
    const result = await new Promise<{ code: number | null, stdout: string, stderr: string }>((resolveRun, rejectRun) => {
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
      child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
      child.on('error', rejectRun)
      child.on('close', (code) => resolveRun({ code, stdout, stderr }))
    })
    expect(result.code, `${result.stdout}\n${result.stderr}`).toBe(1)
    expect(() => readFileSync(resolve(outputDirectory, 'backend-acceptance.json'), 'utf8'), `${result.stdout}\n${result.stderr}`).not.toThrow()
    const report = JSON.parse(readFileSync(resolve(outputDirectory, 'backend-acceptance.json'), 'utf8')) as { checks: Array<{ id: string; status: string; classification: string }> }
    for (const id of ['openapi.operations', 'openapi.operation_documentation', 'openapi.country_study_guide_contract', 'openapi.scholarship_detail_collections']) {
      expect(report.checks.find((check) => check.id === id)).toMatchObject({ status: 'BLOCKED', classification: 'DEPLOYMENT_FAILURE' })
    }
  }, 30_000)
})
