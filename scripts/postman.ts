import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateRawSync } from 'node:zlib'

import { app } from '../src/app.js'

type JsonRecord = Record<string, unknown>

type OpenApiParameter = {
  name: string
  in: 'path' | 'query' | string
  required?: boolean
  description?: string
  schema?: JsonRecord
}

type OpenApiMedia = {
  example?: unknown
  schema?: unknown
}

type OpenApiOperation = {
  summary?: string
  description?: string
  parameters?: OpenApiParameter[]
  requestBody?: {
    required?: boolean
    content?: Record<string, OpenApiMedia>
  }
  responses: Record<string, {
    description?: string
    content?: Record<string, OpenApiMedia>
  }>
  security?: Array<Record<string, unknown>>
}

type OpenApiDocument = {
  openapi: string
  info: { title: string; version: string; description?: string }
  paths: Record<string, Partial<Record<HttpMethod, OpenApiOperation>>>
}

type HttpMethod = 'get' | 'post' | 'patch' | 'put' | 'delete'

type OperationEntry = {
  method: HttpMethod
  path: string
  operation: OpenApiOperation
}

type PostmanItem = {
  name: string
  request?: JsonRecord
  response?: JsonRecord[]
  event?: JsonRecord[]
  item?: PostmanItem[]
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(scriptDirectory, '..')
const postmanDirectory = join(repositoryRoot, 'docs', 'postman')
const postmanZipPath = join(repositoryRoot, 'docs', 'postman.zip')
const deploymentModulePath = join(repositoryRoot, 'src', 'generated', 'postman-downloads.ts')

const files = {
  collection: join(postmanDirectory, 'tareeq-api.postman_collection.json'),
  smoke: join(postmanDirectory, 'tareeq-api.read-only-smoke.postman_collection.json'),
  localEnvironment: join(postmanDirectory, 'tareeq-api.local.postman_environment.json'),
  vercelEnvironment: join(postmanDirectory, 'tareeq-api.vercel.postman_environment.json'),
} as const

const collectionSchema = 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
const methods: HttpMethod[] = ['get', 'post', 'patch', 'put', 'delete']
const resources = ['countries', 'universities', 'scholarships', 'services', 'articles'] as const
const submissionResources = ['applications', 'inquiries'] as const

const folderNames = [
  'System',
  'Authentication',
  'Public — Countries',
  'Public — Universities',
  'Public — Scholarships',
  'Public — Services',
  'Public — Articles',
  'Public — Applications',
  'Public — Inquiries',
  'Admin — Content Management',
  'Admin — Applications',
  'Admin — Inquiries',
] as const

const variableDefaults = [
  { key: 'baseUrl', value: 'http://localhost:3000', description: 'Backend origin without a trailing slash.' },
  { key: 'origin', value: 'http://localhost:3001', description: 'Trusted Admin Origin header used by authenticated POST/PATCH requests.' },
  { key: 'publicOrigin', value: 'http://localhost:3001', description: 'Allowed Public Website Origin header used by student submission requests.' },
  { key: 'adminEmail', value: 'replace-with-authorized-admin@example.invalid', description: 'Set locally; never commit a real account email.' },
  { key: 'adminPassword', value: 'replace-with-authorized-admin-password', description: 'Set locally; never commit a real password.' },
  { key: 'newAdminPassword', value: 'replace-with-new-admin-password', description: 'Manual password-change placeholder.' },
  { key: 'countrySlug', value: 'study-in-germany' },
  { key: 'countryId', value: '9879d0a4-9b7e-48d1-850a-da51be9de671' },
  { key: 'universitySlug', value: 'example-university' },
  { key: 'universityId', value: '88008b68-b698-4725-93e9-801537e7797c' },
  { key: 'scholarshipSlug', value: 'example-scholarship' },
  { key: 'scholarshipId', value: '9f414dec-fcbc-49dd-994f-086d2ef40e1f' },
  { key: 'serviceSlug', value: 'university-consulting' },
  { key: 'serviceId', value: 'b2b21ee5-f955-46ca-972f-6b6b81aa4a3d' },
  { key: 'articleSlug', value: 'study-guide' },
  { key: 'articleId', value: 'b2b21ee5-f955-46ca-972f-6b6b81aa4a3d' },
  { key: 'applicationId', value: 'b7fc1a1b-7878-4f97-9431-58baaf8c493e' },
  { key: 'inquiryId', value: '6de33e44-6cb8-4514-a35d-e1a9c2fbb8f3' },
] as const

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const getOpenApiDocument = async () => {
  const response = await app.request('/openapi.json')
  if (!response.ok) throw new Error(`Could not generate OpenAPI document: HTTP ${response.status}.`)
  return await response.json() as OpenApiDocument
}

const operationEntries = (document: OpenApiDocument): OperationEntry[] =>
  Object.entries(document.paths).flatMap(([path, pathItem]) =>
    methods.flatMap((method) => {
      const operation = pathItem[method]
      return operation ? [{ method, path, operation }] : []
    }),
  )

const resourceForPath = (path: string) =>
  resources.find((resource) => path === `/api/v1/${resource}` || path.startsWith(`/api/v1/${resource}/`) || path === `/api/v1/admin/${resource}` || path.startsWith(`/api/v1/admin/${resource}/`))

const submissionResourceForPath = (path: string) =>
  submissionResources.find((resource) => path === `/api/v1/${resource}` || path.startsWith(`/api/v1/${resource}/`) || path === `/api/v1/admin/${resource}` || path.startsWith(`/api/v1/admin/${resource}/`))

const folderFor = (entry: OperationEntry) => {
  if (entry.path === '/api/v1/health') return 'System'
  if (entry.path.startsWith('/api/v1/auth/')) return 'Authentication'
  const submissionResource = submissionResourceForPath(entry.path)
  if (submissionResource) {
    const label = submissionResource[0]?.toUpperCase() + submissionResource.slice(1)
    return entry.path.startsWith('/api/v1/admin/') ? `Admin — ${label}` : `Public — ${label}`
  }
  const resource = resourceForPath(entry.path)
  if (!resource) throw new Error(`No Postman folder mapping for ${entry.method.toUpperCase()} ${entry.path}.`)
  const label = resource[0]?.toUpperCase() + resource.slice(1)
  return entry.path.startsWith('/api/v1/admin/') ? 'Admin — Content Management' : `Public — ${label}`
}

const operationRank = (entry: OperationEntry) => {
  if (entry.path.startsWith('/api/v1/auth/')) {
    const ranks: Record<string, number> = {
      '/api/v1/auth/login': 1,
      '/api/v1/auth/me': 2,
      '/api/v1/auth/refresh': 3,
      '/api/v1/auth/logout': 4,
      '/api/v1/auth/change-password': 5,
    }
    return ranks[entry.path] ?? 99
  }
  const submissionResource = submissionResourceForPath(entry.path)
  if (submissionResource) {
    const hasParameter = entry.path.includes('{')
    const methodRanks: Record<HttpMethod, number> = { get: hasParameter ? 2 : 1, post: 1, patch: 3, put: 4, delete: 5 }
    return submissionResources.indexOf(submissionResource) * 10 + methodRanks[entry.method]
  }
  const hasParameter = entry.path.includes('{')
  const methodRanks: Record<HttpMethod, number> = { get: hasParameter ? 2 : 1, post: 3, patch: 4, put: 5, delete: 6 }
  const resource = resourceForPath(entry.path)
  const resourceRank = resource ? resources.indexOf(resource) * 10 : 0
  return resourceRank + methodRanks[entry.method]
}

const parameterValue = (parameter: OpenApiParameter) => {
  const namedValues: Record<string, string> = {
    page: '1',
    limit: '12',
    search: 'الدراسة',
    featured: 'true',
    country: '{{countrySlug}}',
    university: '{{universitySlug}}',
    studyLevel: 'MASTERS',
    fundingType: 'FULL',
    applicationStatus: 'OPEN',
  }
  if (namedValues[parameter.name]) return namedValues[parameter.name]
  const schema = parameter.schema ?? {}
  const value = schema.example ?? schema.default ?? (Array.isArray(schema.enum) ? schema.enum[0] : undefined)
  return value === undefined ? `replace-${parameter.name}` : String(value)
}

const environmentVariableForPath = (path: string, parameterName: string) => {
  const submissionResource = submissionResourceForPath(path)
  if (submissionResource && parameterName === 'id') {
    return submissionResource === 'applications' ? '{{applicationId}}' : '{{inquiryId}}'
  }
  const resource = resourceForPath(path)
  if (!resource) return `{{${parameterName}}}`
  const singular = resource.endsWith('ies')
    ? `${resource.slice(0, -3)}y`
    : resource.endsWith('s') ? resource.slice(0, -1) : resource
  const suffix = parameterName === 'slug' ? 'Slug' : 'Id'
  return `{{${singular}${suffix}}}`
}

const replaceBodyPlaceholders = (path: string, value: unknown): unknown => {
  if (Array.isArray(value)) return value.map((item) => replaceBodyPlaceholders(path, item))
  if (!isRecord(value)) return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (path === '/api/v1/auth/login' && key === 'email') return [key, '{{adminEmail}}']
    if (path === '/api/v1/auth/login' && key === 'password') return [key, '{{adminPassword}}']
    if (path === '/api/v1/auth/change-password' && key === 'currentPassword') return [key, '{{adminPassword}}']
    if (path === '/api/v1/auth/change-password' && key === 'newPassword') return [key, '{{newAdminPassword}}']
    const relationshipVariables: Record<string, string> = {
      countryId: '{{countryId}}',
      universityId: '{{universityId}}',
      scholarshipId: '{{scholarshipId}}',
    }
    if (relationshipVariables[key] && item !== null) return [key, relationshipVariables[key]]
    return [key, replaceBodyPlaceholders(path, item)]
  }))
}

const authDescription = (entry: OperationEntry) => {
  if (entry.path.startsWith('/api/v1/admin/')) return 'Authentication: Postman must hold a valid host-only HttpOnly access cookie for an ADMIN or SUPER_ADMIN.'
  if (entry.path === '/api/v1/auth/login') return 'Authentication: none. Provide an authorized email/password manually; Postman stores returned HttpOnly cookies for the host.'
  if (entry.path === '/api/v1/auth/refresh') return 'Authentication: rotating HttpOnly refresh cookie managed by Postman.'
  if (entry.path === '/api/v1/auth/logout') return 'Authentication: optional refresh cookie managed by Postman.'
  if (entry.path === '/api/v1/auth/me' || entry.path === '/api/v1/auth/change-password') return 'Authentication: HttpOnly access cookie managed by Postman.'
  return 'Authentication: none.'
}

const isManualOperation = (entry: OperationEntry) => entry.method !== 'get'

const buildUrl = (entry: OperationEntry) => {
  const parameters = entry.operation.parameters ?? []
  const pathParameters = parameters.filter((parameter) => parameter.in === 'path')
  const queryParameters = parameters.filter((parameter) => parameter.in === 'query')
  const postmanPath = entry.path.replaceAll(/\{([^}]+)\}/g, ':$1')
  const url: JsonRecord = {
    raw: `{{baseUrl}}${postmanPath}`,
    host: ['{{baseUrl}}'],
    path: postmanPath.slice(1).split('/'),
  }
  if (queryParameters.length > 0) {
    url.query = queryParameters.map((parameter) => ({
      key: parameter.name,
      value: parameterValue(parameter),
      description: parameter.description ?? '',
      disabled: !parameter.required,
    }))
  }
  if (pathParameters.length > 0) {
    url.variable = pathParameters.map((parameter) => ({
      key: parameter.name,
      value: environmentVariableForPath(entry.path, parameter.name),
      description: parameter.description ?? '',
    }))
  }
  return url
}

const buildRequest = (entry: OperationEntry) => {
  const media = entry.operation.requestBody?.content?.['application/json']
  const headers: JsonRecord[] = [{ key: 'Accept', value: 'application/json', type: 'text' }]
  if (media) headers.push({ key: 'Content-Type', value: 'application/json', type: 'text' })
  if (entry.method === 'post' || entry.method === 'patch') {
    const isPublicSubmission = entry.method === 'post' && submissionResourceForPath(entry.path) !== undefined && !entry.path.startsWith('/api/v1/admin/')
    headers.push({
      key: 'Origin',
      value: isPublicSubmission ? '{{publicOrigin}}' : '{{origin}}',
      type: 'text',
      description: isPublicSubmission
        ? 'Required by the public submission CORS policy when sent from a browser.'
        : 'Required by the Backend CSRF origin check for authenticated state-changing requests.',
    })
  }

  const warning = isManualOperation(entry)
    ? 'MANUAL OPERATION: do not run this request through routine Collection Runner verification. It may create data, change data, rotate/revoke sessions, or change an administrator password.'
    : 'Read-only operation.'
  const responses = Object.entries(entry.operation.responses)
    .map(([code, response]) => `${code}: ${response.description ?? 'Documented response.'}`)
    .join('\n')
  const request: JsonRecord = {
    method: entry.method.toUpperCase(),
    header: headers,
    url: buildUrl(entry),
    description: `${entry.operation.description ?? ''}\n\n${authDescription(entry)}\n\n${warning}\n\nExpected responses:\n${responses}`,
  }
  if (media?.example !== undefined) {
    request.body = {
      mode: 'raw',
      raw: JSON.stringify(replaceBodyPlaceholders(entry.path, media.example), null, 2),
      options: { raw: { language: 'json' } },
    }
  }
  return request
}

const responseStatus = (code: number) => {
  const values: Record<number, string> = {
    200: 'OK', 201: 'Created', 400: 'Bad Request', 401: 'Unauthorized',
    403: 'Forbidden', 404: 'Not Found', 409: 'Conflict', 413: 'Content Too Large',
    415: 'Unsupported Media Type', 429: 'Too Many Requests',
  }
  return values[code] ?? 'Documented Response'
}

const buildResponses = (entry: OperationEntry, request: JsonRecord) =>
  Object.entries(entry.operation.responses).flatMap(([codeText, response]) => {
    const example = response.content?.['application/json']?.example
    const code = Number(codeText)
    if (!Number.isInteger(code) || example === undefined) return []
    return [{
      name: `${code} ${response.description ?? responseStatus(code)}`,
      originalRequest: structuredClone(request),
      status: responseStatus(code),
      code,
      _postman_previewlanguage: 'json',
      header: [{ key: 'Content-Type', value: 'application/json' }],
      cookie: [],
      body: JSON.stringify(example, null, 2),
    }]
  })

const buildItem = (entry: OperationEntry): PostmanItem => {
  const request = buildRequest(entry)
  const prefix = isManualOperation(entry) ? '[MANUAL] ' : ''
  return {
    name: `${prefix}${entry.operation.summary ?? `${entry.method.toUpperCase()} ${entry.path}`}`,
    request,
    response: buildResponses(entry, request),
  }
}

const collectionVariables = (
  baseUrl = 'http://localhost:3000',
  origin = 'http://localhost:3001',
  publicOrigin = 'http://localhost:3001',
) =>
  variableDefaults.map((variable) => ({
    key: variable.key,
    value: variable.key === 'baseUrl'
      ? baseUrl
      : variable.key === 'origin'
        ? origin
        : variable.key === 'publicOrigin' ? publicOrigin : variable.value,
    type: 'string',
    ...('description' in variable ? { description: variable.description } : {}),
  }))

const buildCollection = (document: OpenApiDocument) => {
  const entries = operationEntries(document)
  const folders = folderNames.map((name) => ({
    name,
    item: entries
      .filter((entry) => folderFor(entry) === name)
      .sort((left, right) => operationRank(left) - operationRank(right))
      .map(buildItem),
  }))
  return {
    info: {
      _postman_id: '2d719ea1-6403-4a3d-8f61-50d6867ca5b9',
      name: 'Tareeq Academy API — Complete',
      description: 'Generated deterministically from the Backend OpenAPI 3.1 document. Import a supplied environment and let Postman manage host-only HttpOnly cookies. Do not run this full Collection with Collection Runner: requests labeled [MANUAL] can mutate production data or authentication state. Use the separate read-only smoke Collection for routine automation. The API does not return Bearer tokens.',
      schema: collectionSchema,
    },
    auth: { type: 'noauth' },
    variable: collectionVariables(),
    item: folders,
  }
}

const smokeTestEvent = {
  listen: 'test',
  script: {
    type: 'text/javascript',
    exec: [
      "pm.test('HTTP 200', function () { pm.response.to.have.status(200); });",
      "pm.test('JSON success envelope', function () { const body = pm.response.json(); pm.expect(body.success).to.eql(true); });",
      "pm.test('Request ID present', function () { pm.expect(pm.response.headers.has('X-Request-Id')).to.eql(true); });",
    ],
  },
}

const buildSmokeCollection = (document: OpenApiDocument) => {
  const safePaths = new Set(['/api/v1/health', ...resources.map((resource) => `/api/v1/${resource}`)])
  const items = operationEntries(document)
    .filter((entry) => entry.method === 'get' && safePaths.has(entry.path))
    .map((entry) => ({ ...buildItem(entry), event: [smokeTestEvent] }))
  return {
    info: {
      _postman_id: 'c4b7aa62-2c6a-43e8-802b-6de33de4a544',
      name: 'Tareeq Academy API — Read-Only Smoke',
      description: 'Safe for routine Collection Runner use. Contains only Health and the five public list GET requests. It performs no authentication, writes, migrations, cleanup, or destructive operations.',
      schema: collectionSchema,
    },
    auth: { type: 'noauth' },
    variable: collectionVariables(),
    item: [{ name: 'Read-Only Smoke', item: items }],
  }
}

const buildEnvironment = (kind: 'local' | 'vercel') => {
  const local = kind === 'local'
  const values = collectionVariables(
    local ? 'http://localhost:3000' : 'https://api.tareeq-academy.com',
    local ? 'http://localhost:3001' : 'https://admin.tareeq-academy.com',
    local ? 'http://localhost:3001' : 'https://tareeq-academy.com',
  ).map((variable) => ({ key: variable.key, value: variable.value, type: 'default', enabled: true }))
  return {
    id: local ? '1ccbd13e-034b-445e-8438-d86cd5824b72' : 'ac7ba828-8019-4d44-9754-94637fc62d0e',
    name: local ? 'Tareeq API — Local' : 'Tareeq API — Vercel',
    values,
    _postman_variable_scope: 'environment',
    _postman_exported_using: 'Tareeq API deterministic OpenAPI generator',
  }
}

const buildArtifacts = (document: OpenApiDocument) => ({
  [files.collection]: buildCollection(document),
  [files.smoke]: buildSmokeCollection(document),
  [files.localEnvironment]: buildEnvironment('local'),
  [files.vercelEnvironment]: buildEnvironment('vercel'),
})

const serialize = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  }
  return value >>> 0
})

const crc32 = (data: Buffer) => {
  let value = 0xffffffff
  for (const byte of data) value = (value >>> 8) ^ (crcTable[(value ^ byte) & 0xff] ?? 0)
  return (value ^ 0xffffffff) >>> 0
}

const createZip = (entries: Array<{ name: string; content: string }>) => {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const content = Buffer.from(entry.content, 'utf8')
    const compressed = deflateRawSync(content, { level: 9 })
    const checksum = crc32(content)
    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(0x04034b50, 0)
    localHeader.writeUInt16LE(20, 4)
    localHeader.writeUInt16LE(0x0800, 6)
    localHeader.writeUInt16LE(8, 8)
    localHeader.writeUInt16LE(0, 10)
    localHeader.writeUInt16LE(0x0021, 12)
    localHeader.writeUInt32LE(checksum, 14)
    localHeader.writeUInt32LE(compressed.length, 18)
    localHeader.writeUInt32LE(content.length, 22)
    localHeader.writeUInt16LE(name.length, 26)
    localHeader.writeUInt16LE(0, 28)
    localParts.push(localHeader, name, compressed)

    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(0x02014b50, 0)
    centralHeader.writeUInt16LE(20, 4)
    centralHeader.writeUInt16LE(20, 6)
    centralHeader.writeUInt16LE(0x0800, 8)
    centralHeader.writeUInt16LE(8, 10)
    centralHeader.writeUInt16LE(0, 12)
    centralHeader.writeUInt16LE(0x0021, 14)
    centralHeader.writeUInt32LE(checksum, 16)
    centralHeader.writeUInt32LE(compressed.length, 20)
    centralHeader.writeUInt32LE(content.length, 24)
    centralHeader.writeUInt16LE(name.length, 28)
    centralHeader.writeUInt16LE(0, 30)
    centralHeader.writeUInt16LE(0, 32)
    centralHeader.writeUInt16LE(0, 34)
    centralHeader.writeUInt16LE(0, 36)
    centralHeader.writeUInt32LE(0, 38)
    centralHeader.writeUInt32LE(offset, 42)
    centralParts.push(centralHeader, name)

    offset += localHeader.length + name.length + compressed.length
  }

  const centralDirectory = Buffer.concat(centralParts)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralDirectory.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)

  return Buffer.concat([...localParts, centralDirectory, end])
}

const buildDownloadArtifacts = (artifacts: ReturnType<typeof buildArtifacts>) => {
  const entryPaths = [
    ['postman/tareeq-api.postman_collection.json', files.collection],
    ['postman/tareeq-api.read-only-smoke.postman_collection.json', files.smoke],
    ['postman/tareeq-api.local.postman_environment.json', files.localEnvironment],
    ['postman/tareeq-api.vercel.postman_environment.json', files.vercelEnvironment],
  ] as const
  const entries = entryPaths.map(([name, path]) => ({
    name,
    content: serialize(artifacts[path]),
  }))
  const zip = createZip(entries)
  const collection = Buffer.from(serialize(artifacts[files.collection]), 'utf8')
  const deploymentModule = [
    '// Generated by scripts/postman.ts. Do not edit manually.',
    `export const postmanCollectionDeflateBase64 = '${deflateRawSync(collection, { level: 9 }).toString('base64')}'`,
    `export const postmanDownloadZipBase64 = '${zip.toString('base64')}'`,
    '',
  ].join('\n')
  return { zip, deploymentModule, entries }
}

const generate = async (document: OpenApiDocument) => {
  await mkdir(postmanDirectory, { recursive: true })
  await mkdir(dirname(deploymentModulePath), { recursive: true })
  const artifacts = buildArtifacts(document)
  for (const [path, value] of Object.entries(artifacts)) await writeFile(path, serialize(value), 'utf8')
  const downloads = buildDownloadArtifacts(artifacts)
  await writeFile(postmanZipPath, downloads.zip)
  await writeFile(deploymentModulePath, downloads.deploymentModule, 'utf8')
  console.log(`Generated Postman artifacts from ${operationEntries(document).length} OpenAPI operations.`)
  for (const path of Object.keys(artifacts)) console.log(path)
  console.log(postmanZipPath)
  console.log(deploymentModulePath)
}

const collectionRequests = (items: unknown[]): JsonRecord[] => items.flatMap((item) => {
  if (!isRecord(item)) return []
  const nested = Array.isArray(item.item) ? collectionRequests(item.item) : []
  return isRecord(item.request) ? [item, ...nested] : nested
})

const requestOperationKey = (item: JsonRecord) => {
  if (!isRecord(item.request) || typeof item.request.method !== 'string' || !isRecord(item.request.url) || typeof item.request.url.raw !== 'string') return null
  const normalizedPath = item.request.url.raw
    .replace(/^\{\{baseUrl\}\}/, '')
    .split('?')[0]
    ?.replaceAll(/:([^/]+)/g, '{$1}')
  return normalizedPath ? `${item.request.method.toUpperCase()} ${normalizedPath}` : null
}

const assertCollectionStructure = (value: unknown, expectedName: string) => {
  if (!isRecord(value) || !isRecord(value.info) || value.info.schema !== collectionSchema || value.info.name !== expectedName || !Array.isArray(value.item)) {
    throw new Error(`${expectedName} is not a valid Postman Collection v2.1 structure.`)
  }
  for (const item of collectionRequests(value.item)) {
    if (!isRecord(item.request) || typeof item.request.method !== 'string' || !isRecord(item.request.url) || typeof item.request.url.raw !== 'string') {
      throw new Error(`${expectedName} contains a request without a valid method or URL.`)
    }
  }
}

const assertEnvironmentStructure = (value: unknown, expectedName: string) => {
  if (!isRecord(value) || value.name !== expectedName || value._postman_variable_scope !== 'environment' || !Array.isArray(value.values)) {
    throw new Error(`${expectedName} is not a valid Postman environment structure.`)
  }
}

const secretPatterns = [
  /postgres(?:ql)?:\/\//i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /(?:DATABASE_URL|DIRECT_DATABASE_URL|JWT_SECRET|INITIAL_(?:ADMIN|SUPER_ADMIN)_(?:EMAIL|PASSWORD|ID))\s*[=:]\s*[^\s"']+/i,
  /tareeq_(?:access|refresh)=[^;\s]+/i,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
]

const assertSanitizedCredentialVariables = (
  value: unknown,
  property: 'variable' | 'values',
  artifactName: string,
) => {
  if (!isRecord(value) || !Array.isArray(value[property])) {
    throw new Error(`${artifactName} does not contain its expected variables.`)
  }
  const variables = new Map(value[property].flatMap((item) =>
    isRecord(item) && typeof item.key === 'string' && typeof item.value === 'string'
      ? [[item.key, item.value] as const]
      : [],
  ))
  const expected = {
    adminEmail: 'replace-with-authorized-admin@example.invalid',
    adminPassword: 'replace-with-authorized-admin-password',
    newAdminPassword: 'replace-with-new-admin-password',
  }
  for (const [key, placeholder] of Object.entries(expected)) {
    if (variables.get(key) !== placeholder) {
      throw new Error(`${artifactName} contains a non-sanitized ${key} value.`)
    }
  }
}

const check = async (document: OpenApiDocument) => {
  const expectedArtifacts = buildArtifacts(document)
  const actualArtifacts: Record<string, unknown> = {}
  for (const path of Object.keys(expectedArtifacts)) {
    let text: string
    try {
      text = await readFile(path, 'utf8')
    } catch {
      throw new Error(`Missing Postman artifact: ${path}. Run npm run postman:generate.`)
    }
    if (secretPatterns.some((pattern) => pattern.test(text))) throw new Error(`Potential secret or Backend-only credential found in ${path}.`)
    try {
      actualArtifacts[path] = JSON.parse(text) as unknown
    } catch {
      throw new Error(`Invalid JSON in ${path}. Run npm run postman:generate.`)
    }
  }

  const collection = actualArtifacts[files.collection]
  const smoke = actualArtifacts[files.smoke]
  assertCollectionStructure(collection, 'Tareeq Academy API — Complete')
  assertCollectionStructure(smoke, 'Tareeq Academy API — Read-Only Smoke')
  assertEnvironmentStructure(actualArtifacts[files.localEnvironment], 'Tareeq API — Local')
  assertEnvironmentStructure(actualArtifacts[files.vercelEnvironment], 'Tareeq API — Vercel')
  assertSanitizedCredentialVariables(collection, 'variable', 'Complete Collection')
  assertSanitizedCredentialVariables(smoke, 'variable', 'Read-only smoke Collection')
  assertSanitizedCredentialVariables(actualArtifacts[files.localEnvironment], 'values', 'Local environment')
  assertSanitizedCredentialVariables(actualArtifacts[files.vercelEnvironment], 'values', 'Vercel environment')

  if (!isRecord(collection) || !Array.isArray(collection.item)) throw new Error('Complete Collection items are unavailable.')
  const requests = collectionRequests(collection.item)
  const actualKeys = requests.map(requestOperationKey).filter((key): key is string => key !== null).sort()
  const expectedKeys = operationEntries(document).map((entry) => `${entry.method.toUpperCase()} ${entry.path}`).sort()
  const missing = expectedKeys.filter((key) => !actualKeys.includes(key))
  const obsolete = actualKeys.filter((key) => !expectedKeys.includes(key))
  if (requests.length !== 44 || missing.length > 0 || obsolete.length > 0) {
    throw new Error(`Postman operation mismatch. Expected 44, found ${requests.length}. Missing: ${missing.join(', ') || 'none'}. Obsolete: ${obsolete.join(', ') || 'none'}.`)
  }

  for (const [path, expected] of Object.entries(expectedArtifacts)) {
    const actual = actualArtifacts[path]
    if (serialize(actual) !== serialize(expected)) {
      const staleOperations = path === files.collection && isRecord(actual) && Array.isArray(actual.item)
        ? collectionRequests(actual.item).filter((item) => {
          const key = requestOperationKey(item)
          if (!key) return true
          const expectedCollection = expected as ReturnType<typeof buildCollection>
          const expectedItem = collectionRequests(expectedCollection.item).find((candidate) => requestOperationKey(candidate) === key)
          return serialize(item) !== serialize(expectedItem)
        }).map((item) => requestOperationKey(item) ?? 'invalid request').slice(0, 10)
        : []
      throw new Error(`Stale Postman artifact: ${path}.${staleOperations.length > 0 ? ` Changed operations: ${staleOperations.join(', ')}.` : ''} Run npm run postman:generate.`)
    }
  }

  const expectedDownloads = buildDownloadArtifacts(expectedArtifacts)
  let actualZip: Buffer
  let actualDeploymentModule: string
  try {
    actualZip = await readFile(postmanZipPath)
    actualDeploymentModule = await readFile(deploymentModulePath, 'utf8')
  } catch {
    throw new Error('Missing downloadable Postman artifacts. Run npm run postman:generate.')
  }
  if (!actualZip.equals(expectedDownloads.zip)) {
    throw new Error(`Stale Postman ZIP: ${postmanZipPath}. Run npm run postman:generate.`)
  }
  if (actualDeploymentModule !== expectedDownloads.deploymentModule) {
    throw new Error(`Stale deployed Postman downloads: ${deploymentModulePath}. Run npm run postman:generate.`)
  }

  if (!isRecord(smoke) || !Array.isArray(smoke.item)) throw new Error('Smoke Collection items are unavailable.')
  const smokeRequests = collectionRequests(smoke.item)
  if (smokeRequests.length !== 6 || smokeRequests.some((item) => !isRecord(item.request) || item.request.method !== 'GET')) {
    throw new Error('Read-only smoke Collection must contain exactly six GET requests.')
  }

  console.log('Postman synchronization PASS')
  console.log(`OpenAPI operations: ${expectedKeys.length}`)
  console.log(`Complete Collection requests: ${requests.length}`)
  console.log(`Read-only smoke requests: ${smokeRequests.length}`)
  console.log(`Folders: ${folderNames.length}`)
  console.log(`Download ZIP entries: ${expectedDownloads.entries.length}`)
  console.log('Deployment downloads: synchronized')
  console.log('Credential and secret scan: PASS')
  console.log('Structure: Postman Collection Format v2.1')
}

const main = async () => {
  const command = process.argv[2]
  if (command !== 'generate' && command !== 'check') throw new Error('Usage: tsx scripts/postman.ts <generate|check>')
  const document = await getOpenApiDocument()
  if (document.openapi !== '3.1.0') throw new Error(`Expected OpenAPI 3.1.0, received ${document.openapi}.`)
  if (operationEntries(document).length !== 44) throw new Error(`Expected 44 OpenAPI operations, received ${operationEntries(document).length}.`)
  if (command === 'generate') await generate(document)
  else await check(document)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
