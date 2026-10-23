[CmdletBinding()]
param(
  [ValidatePattern('^(https://.+|http://(localhost|127\.0\.0\.1)(:\d+)?)$')]
  [string]$BaseUrl = 'https://tareeq-api.vercel.app',

  [ValidatePattern('^https?://')]
  [string]$PublicOrigin = 'https://tareeq-academy.com',

  [ValidatePattern('^https?://')]
  [string]$AdminOrigin = 'https://admin.tareeq-academy.com',

  [string]$OutputDirectory = (Join-Path (Split-Path -Parent $PSScriptRoot) 'reports'),

  [string]$ManifestPath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'reports\initial-seed-manifest.json'),

  [string]$EnvironmentFile = (Join-Path (Split-Path -Parent $PSScriptRoot) '.env'),

  [string]$BrowserReportPath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'reports\backend-browser-auth.json'),

  [switch]$Authenticated,

  [ValidateRange(5, 120)]
  [int]$TimeoutSeconds = 20
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($PSVersionTable.PSVersion.Major -lt 7) {
  throw 'PowerShell 7 or newer is required.'
}

$BaseUrl = $BaseUrl.TrimEnd('/')
$resources = @('countries', 'universities', 'scholarships', 'services', 'articles')
$checks = [System.Collections.Generic.List[object]]::new()
$requests = [System.Collections.Generic.List[object]]::new()

function Add-Check {
  param(
    [Parameter(Mandatory)][string]$Id,
    [Parameter(Mandatory)][string]$Category,
    [Parameter(Mandatory)][ValidateSet('PASS', 'FAIL', 'BLOCKED')][string]$Status,
    [Parameter(Mandatory)][string]$Expected,
    [Parameter(Mandatory)][string]$Actual,
    [Parameter(Mandatory)][string]$Evidence,
    [Parameter(Mandatory)][ValidateSet('NONE', 'DEPLOYMENT_FAILURE', 'CONTRACT_FAILURE', 'MISSING_PREREQUISITE')][string]$Classification,
    [bool]$Required = $true
  )

  $checks.Add([pscustomobject]@{
    id = $Id
    category = $Category
    status = $Status
    required = $Required
    classification = $Classification
    expected = $Expected
    actual = $Actual
    evidence = $Evidence
  })
}

function Test-Property {
  param([object]$Value, [string]$Name)
  return $null -ne $Value -and $Value.PSObject.Properties.Name -contains $Name
}

function Get-Header {
  param([object]$Response, [string]$Name)
  $value = $Response.Headers[$Name]
  if ($null -eq $value) { return $null }
  return [string]($value -join ', ')
}

function Invoke-ReadOnlyRequest {
  param(
    [Parameter(Mandatory)][ValidateSet('GET', 'POST', 'OPTIONS')][string]$Method,
    [Parameter(Mandatory)][string]$Path,
    [hashtable]$Headers = @{},
    [AllowNull()][string]$Body = $null,
    [AllowNull()][Microsoft.PowerShell.Commands.WebRequestSession]$WebSession = $null,
    [string]$Purpose = 'read-only verification'
  )

  $parameters = @{
    Uri = "$BaseUrl$Path"
    Method = $Method
    Headers = $Headers
    TimeoutSec = $TimeoutSeconds
    SkipHttpErrorCheck = $true
    UseBasicParsing = $true
    MaximumRedirection = 3
  }
  if ($null -ne $Body) {
    $parameters.Body = $Body
    $parameters.ContentType = 'application/json'
  }
  if ($null -ne $WebSession) {
    $parameters.WebSession = $WebSession
  }

  try {
    $response = Invoke-WebRequest @parameters
    $responseRequestId = Get-Header $response 'X-Request-Id'
    $result = [pscustomobject]@{
      method = $Method
      path = $Path
      purpose = $Purpose
      statusCode = [int]$response.StatusCode
      contentType = Get-Header $response 'Content-Type'
      requestIdPresent = -not [string]::IsNullOrWhiteSpace($responseRequestId)
      requestIdMatchesSupplied = if ($Headers.ContainsKey('X-Request-Id')) { $responseRequestId -eq [string]$Headers['X-Request-Id'] } else { $null }
      accessControlAllowOrigin = Get-Header $response 'Access-Control-Allow-Origin'
      accessControlAllowCredentials = Get-Header $response 'Access-Control-Allow-Credentials'
      accessControlAllowMethods = Get-Header $response 'Access-Control-Allow-Methods'
      body = [string]$response.Content
      transportError = $null
    }
  } catch {
    $result = [pscustomobject]@{
      method = $Method
      path = $Path
      purpose = $Purpose
      statusCode = 0
      contentType = $null
      requestIdPresent = $false
      requestIdMatchesSupplied = $null
      accessControlAllowOrigin = $null
      accessControlAllowCredentials = $null
      accessControlAllowMethods = $null
      body = ''
      transportError = $_.Exception.Message
    }
  }

  $requests.Add($result)
  return $result
}

function Get-LocalCredentialConfiguration {
  $names = @(
    'INITIAL_ADMIN_EMAIL',
    'INITIAL_ADMIN_PASSWORD',
    'INITIAL_SUPER_ADMIN_EMAIL',
    'INITIAL_SUPER_ADMIN_PASSWORD'
  )
  $values = @{}
  foreach ($name in $names) {
    if (-not [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name))) {
      $values[$name] = [Environment]::GetEnvironmentVariable($name)
    }
  }
  if (Test-Path -LiteralPath $EnvironmentFile) {
    foreach ($line in Get-Content -LiteralPath $EnvironmentFile) {
      if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
        $name = $Matches[1]
        if ($names -contains $name -and -not $values.ContainsKey($name)) {
          $value = $Matches[2].Trim()
          if (
            $value.Length -ge 2 -and
            (($value.StartsWith('"') -and $value.EndsWith('"')) -or
              ($value.StartsWith("'") -and $value.EndsWith("'")))
          ) {
            $value = $value.Substring(1, $value.Length - 2)
          }
          if (-not [string]::IsNullOrWhiteSpace($value)) { $values[$name] = $value }
        }
      }
    }
  }
  return $values
}

function Test-SuccessUserRole {
  param([object]$Body, [string]$Role)
  return (Test-Property $Body 'success') -and $Body.success -eq $true -and
    (Test-Property $Body 'data') -and (Test-Property $Body.data 'user') -and
    (Test-Property $Body.data.user 'role') -and $Body.data.user.role -eq $Role
}

function Convert-JsonBody {
  param([object]$Response)
  if ([string]::IsNullOrWhiteSpace($Response.body)) { return $null }
  try {
    return $Response.body | ConvertFrom-Json -Depth 100
  } catch {
    return $null
  }
}

function Test-ErrorEnvelope {
  param([object]$Body, [string]$Code)
  if (-not (Test-Property $Body 'success') -or $Body.success -ne $false) { return $false }
  if (-not (Test-Property $Body 'error')) { return $false }
  if (-not (Test-Property $Body.error 'code') -or $Body.error.code -ne $Code) { return $false }
  if (-not (Test-Property $Body.error 'message') -or [string]::IsNullOrWhiteSpace([string]$Body.error.message)) { return $false }
  if (-not (Test-Property $Body.error 'details')) { return $false }
  $serialized = $Body | ConvertTo-Json -Depth 20 -Compress
  return $serialized -notmatch '(?i)(stack trace|PrismaClient|postgresql://|DATABASE_URL|JWT_SECRET)'
}

function Test-PaginationEnvelope {
  param([object]$Body, [int]$ExpectedPage, [int]$ExpectedLimit)
  if (-not (Test-Property $Body 'success') -or $Body.success -ne $true) { return $false }
  if (-not (Test-Property $Body 'data')) { return $false }
  if (-not (Test-Property $Body.data 'items') -or -not (Test-Property $Body.data 'pagination')) { return $false }
  $pagination = $Body.data.pagination
  foreach ($name in @('page', 'limit', 'total', 'totalPages')) {
    if (-not (Test-Property $pagination $name)) { return $false }
  }
  if ([int]$pagination.page -ne $ExpectedPage -or [int]$pagination.limit -ne $ExpectedLimit) { return $false }
  if ([int]$pagination.total -lt 0 -or [int]$pagination.totalPages -lt 0) { return $false }
  $expectedPages = if ([int]$pagination.total -eq 0) { 0 } else { [int][Math]::Ceiling([double]$pagination.total / [int]$pagination.limit) }
  return [int]$pagination.totalPages -eq $expectedPages
}

function Get-OperationExampleState {
  param([object]$Operation)
  $responseExample = $false
  foreach ($responseProperty in $Operation.responses.PSObject.Properties) {
    $response = $responseProperty.Value
    if (Test-Property $response 'content') {
      foreach ($contentProperty in $response.content.PSObject.Properties) {
        if (Test-Property $contentProperty.Value 'example') { $responseExample = $true }
      }
    }
  }

  $requestExample = $true
  if (Test-Property $Operation 'requestBody') {
    $requestExample = $false
    if (Test-Property $Operation.requestBody 'content') {
      foreach ($contentProperty in $Operation.requestBody.content.PSObject.Properties) {
        if (Test-Property $contentProperty.Value 'example') { $requestExample = $true }
      }
    }
  }
  return [pscustomobject]@{ response = $responseExample; request = $requestExample }
}

$seedManifest = $null
$manifestLoadIssue = $null
if (Test-Path -LiteralPath $ManifestPath) {
  try {
    $seedManifest = Get-Content -Raw -LiteralPath $ManifestPath | ConvertFrom-Json -Depth 100
    if (
      -not (Test-Property $seedManifest 'schemaVersion') -or
      $seedManifest.schemaVersion -ne 1 -or
      -not (Test-Property $seedManifest 'content')
    ) {
      $manifestLoadIssue = 'Manifest schema version or content collection is invalid.'
      $seedManifest = $null
    }
  } catch {
    $manifestLoadIssue = 'Manifest JSON could not be parsed.'
    $seedManifest = $null
  }
} else {
  $manifestLoadIssue = 'Manifest file is absent.'
}

# Health and request correlation.
$correlationId = "tareeq-acceptance-$([guid]::NewGuid().ToString('N'))"
$health = Invoke-ReadOnlyRequest -Method GET -Path '/api/v1/health' -Headers @{ 'X-Request-Id' = $correlationId } -Purpose 'health and request-ID verification'
$healthBody = Convert-JsonBody $health
$healthPass = $health.statusCode -eq 200 -and
  (Test-Property $healthBody 'success') -and $healthBody.success -eq $true -and
  (Test-Property $healthBody 'data') -and (Test-Property $healthBody.data 'status') -and
  $healthBody.data.status -eq 'ok' -and $health.requestIdPresent -and $health.requestIdMatchesSupplied -eq $true
Add-Check -Id 'health.endpoint' -Category 'Health' -Status $(if ($healthPass) { 'PASS' } else { 'FAIL' }) `
  -Expected 'HTTP 200, success envelope, data.status=ok, and X-Request-Id.' `
  -Actual "HTTP $($health.statusCode); request ID present=$($health.requestIdPresent); supplied ID echoed=$($health.requestIdMatchesSupplied)." `
  -Evidence 'GET /api/v1/health used a synthetic correlation ID; response bodies are not retained in reports.' `
  -Classification $(if ($health.statusCode -eq 0 -or $health.statusCode -ge 500) { 'DEPLOYMENT_FAILURE' } elseif ($healthPass) { 'NONE' } else { 'CONTRACT_FAILURE' })

# OpenAPI document and exact operation contract.
$openApiResponse = Invoke-ReadOnlyRequest -Method GET -Path '/openapi.json' -Purpose 'OpenAPI verification'
$openApi = Convert-JsonBody $openApiResponse
$versionPass = $openApiResponse.statusCode -eq 200 -and (Test-Property $openApi 'openapi') -and $openApi.openapi -eq '3.1.0'
Add-Check -Id 'openapi.version' -Category 'Documentation' -Status $(if ($versionPass) { 'PASS' } else { 'FAIL' }) `
  -Expected 'OpenAPI 3.1.0 document over HTTPS.' -Actual "HTTP $($openApiResponse.statusCode); version=$(if (Test-Property $openApi 'openapi') { $openApi.openapi } else { 'unavailable' })." `
  -Evidence 'GET /openapi.json.' -Classification $(if ($openApiResponse.statusCode -eq 0 -or $openApiResponse.statusCode -ge 500) { 'DEPLOYMENT_FAILURE' } elseif ($versionPass) { 'NONE' } else { 'CONTRACT_FAILURE' })

$expectedOperations = [System.Collections.Generic.List[string]]::new()
$expectedOperations.Add('GET /api/v1/health')
foreach ($entry in @(
  'POST /api/v1/auth/login',
  'POST /api/v1/auth/refresh',
  'POST /api/v1/auth/logout',
  'GET /api/v1/auth/me',
  'POST /api/v1/auth/change-password'
)) { $expectedOperations.Add($entry) }
foreach ($resource in $resources) {
  foreach ($entry in @(
    "GET /api/v1/$resource",
    "GET /api/v1/$resource/{slug}",
    "GET /api/v1/admin/$resource",
    "GET /api/v1/admin/$resource/{id}",
    "POST /api/v1/admin/$resource",
    "PATCH /api/v1/admin/$resource/{id}"
  )) { $expectedOperations.Add($entry) }
}

$actualOperations = [System.Collections.Generic.List[string]]::new()
$documentationIssues = [System.Collections.Generic.List[string]]::new()
if ($null -ne $openApi -and (Test-Property $openApi 'paths')) {
  foreach ($pathProperty in $openApi.paths.PSObject.Properties) {
    foreach ($method in @('get', 'post', 'patch', 'put', 'delete')) {
      if ($pathProperty.Value.PSObject.Properties.Name -contains $method) {
        $operation = $pathProperty.Value.$method
        $operationName = "$($method.ToUpperInvariant()) $($pathProperty.Name)"
        $actualOperations.Add($operationName)
        if (-not (Test-Property $operation 'summary') -or [string]::IsNullOrWhiteSpace([string]$operation.summary)) { $documentationIssues.Add("$operationName missing summary") }
        if (-not (Test-Property $operation 'description') -or [string]::IsNullOrWhiteSpace([string]$operation.description)) { $documentationIssues.Add("$operationName missing description") }
        if (-not (Test-Property $operation 'tags') -or @($operation.tags).Count -eq 0) { $documentationIssues.Add("$operationName missing tags") }
        if (-not (Test-Property $operation 'responses')) {
          $documentationIssues.Add("$operationName missing responses")
        } else {
          $exampleState = Get-OperationExampleState $operation
          if (-not $exampleState.response) { $documentationIssues.Add("$operationName missing response example") }
          if (-not $exampleState.request) { $documentationIssues.Add("$operationName missing request example") }
        }
        if ($pathProperty.Name.StartsWith('/api/v1/admin/')) {
          $securityJson = if (Test-Property $operation 'security') { $operation.security | ConvertTo-Json -Depth 5 -Compress } else { '' }
          if ($securityJson -notmatch 'accessCookie') { $documentationIssues.Add("$operationName missing accessCookie security") }
        }
      }
    }
  }
}
$operationDifference = @(Compare-Object -ReferenceObject @($expectedOperations | Sort-Object) -DifferenceObject @($actualOperations | Sort-Object))
$operationPass = $actualOperations.Count -eq 36 -and $operationDifference.Count -eq 0
Add-Check -Id 'openapi.operations' -Category 'Documentation' -Status $(if ($operationPass) { 'PASS' } else { 'FAIL' }) `
  -Expected 'Exactly the approved 36 operations with no missing or unexpected operations.' `
  -Actual "$($actualOperations.Count) operations; differences=$($operationDifference.Count)." `
  -Evidence $(if ($operationDifference.Count -eq 0) { 'The live operation set exactly matches the approved health, authentication, and five-resource content surface.' } else { ($operationDifference | ForEach-Object { "$($_.SideIndicator) $($_.InputObject)" }) -join '; ' }) `
  -Classification $(if ($openApiResponse.statusCode -eq 0 -or $openApiResponse.statusCode -ge 500) { 'DEPLOYMENT_FAILURE' } elseif ($operationPass) { 'NONE' } else { 'CONTRACT_FAILURE' })

$documentationPass = $documentationIssues.Count -eq 0 -and $actualOperations.Count -eq 36
$documentationEvidence = if ($documentationIssues.Count -eq 0) {
  'All 36 live operations passed documentation metadata checks.'
} else {
  $issueLimit = [Math]::Min(10, $documentationIssues.Count)
  @($documentationIssues.GetRange(0, $issueLimit)) -join '; '
}
Add-Check -Id 'openapi.operation_documentation' -Category 'Documentation' -Status $(if ($documentationPass) { 'PASS' } else { 'FAIL' }) `
  -Expected 'Every operation has summary, description, tags, examples, responses, and Admin security where applicable.' `
  -Actual "$($documentationIssues.Count) documentation issue(s)." `
  -Evidence $documentationEvidence `
  -Classification $(if ($documentationPass) { 'NONE' } else { 'CONTRACT_FAILURE' })

# Scalar HTML availability only; manual rendering is intentionally owner-managed.
$scalar = Invoke-ReadOnlyRequest -Method GET -Path '/docs' -Purpose 'Scalar HTML availability'
$scalarPass = $scalar.statusCode -eq 200 -and $scalar.contentType -match 'text/html' -and $scalar.body -match 'Tareeq Academy API Reference' -and $scalar.body -match '/openapi.json'
Add-Check -Id 'scalar.endpoint' -Category 'Documentation' -Status $(if ($scalarPass) { 'PASS' } else { 'FAIL' }) `
  -Expected 'HTTP 200 HTML configured for the live OpenAPI document.' `
  -Actual "HTTP $($scalar.statusCode); content type=$($scalar.contentType)." `
  -Evidence 'GET /docs; interactive browser rendering is outside this automated verifier.' `
  -Classification $(if ($scalar.statusCode -eq 0 -or $scalar.statusCode -ge 500) { 'DEPLOYMENT_FAILURE' } elseif ($scalarPass) { 'NONE' } else { 'CONTRACT_FAILURE' })

# Public content reads, pagination, empty pages, validation, and not-found behavior.
$databaseFailures = [System.Collections.Generic.List[string]]::new()
foreach ($resource in $resources) {
  $list = Invoke-ReadOnlyRequest -Method GET -Path "/api/v1/$resource" -Purpose 'public database-backed collection read'
  $listBody = Convert-JsonBody $list
  $listPass = $list.statusCode -eq 200 -and (Test-PaginationEnvelope $listBody 1 12) -and $list.requestIdPresent
  if (-not $listPass) { $databaseFailures.Add("$resource HTTP $($list.statusCode)") }
  $itemCount = if ($null -ne $listBody -and (Test-Property $listBody 'data') -and (Test-Property $listBody.data 'items')) { @($listBody.data.items).Count } else { -1 }
  $total = if ($null -ne $listBody -and (Test-Property $listBody 'data') -and (Test-Property $listBody.data 'pagination')) { [int]$listBody.data.pagination.total } else { -1 }
  Add-Check -Id "content.$resource.list" -Category 'Public Content' -Status $(if ($listPass) { 'PASS' } else { 'FAIL' }) `
    -Expected 'HTTP 200 success envelope with page=1, limit=12, consistent totals, and request ID.' `
    -Actual "HTTP $($list.statusCode); items=$itemCount; total=$total; request ID present=$($list.requestIdPresent)." `
    -Evidence "Read-only GET /api/v1/$resource." `
    -Classification $(if ($list.statusCode -eq 0 -or $list.statusCode -ge 500) { 'DEPLOYMENT_FAILURE' } elseif ($listPass) { 'NONE' } else { 'CONTRACT_FAILURE' })

  $emptyPage = Invoke-ReadOnlyRequest -Method GET -Path "/api/v1/${resource}?page=1000000&limit=1" -Purpose 'empty-page pagination verification'
  $emptyBody = Convert-JsonBody $emptyPage
  $emptyPass = $emptyPage.statusCode -eq 200 -and (Test-PaginationEnvelope $emptyBody 1000000 1) -and @($emptyBody.data.items).Count -eq 0
  Add-Check -Id "content.$resource.empty_page" -Category 'Public Content' -Status $(if ($emptyPass) { 'PASS' } else { 'FAIL' }) `
    -Expected 'HTTP 200 with an empty items array and valid pagination on an out-of-range page.' `
    -Actual "HTTP $($emptyPage.statusCode); items=$(if ($null -ne $emptyBody -and (Test-Property $emptyBody 'data')) { @($emptyBody.data.items).Count } else { -1 })." `
    -Evidence "Read-only GET /api/v1/${resource}?page=1000000&limit=1." `
    -Classification $(if ($emptyPage.statusCode -eq 0 -or $emptyPage.statusCode -ge 500) { 'DEPLOYMENT_FAILURE' } elseif ($emptyPass) { 'NONE' } else { 'CONTRACT_FAILURE' })

  $invalid = Invoke-ReadOnlyRequest -Method GET -Path "/api/v1/${resource}?page=0" -Purpose 'query validation verification'
  $invalidBody = Convert-JsonBody $invalid
  $invalidDetailsPass = (Test-Property $invalidBody 'error') -and
    (Test-Property $invalidBody.error 'details') -and
    (Test-Property $invalidBody.error.details 'fields') -and
    (Test-Property $invalidBody.error.details.fields 'page') -and
    @($invalidBody.error.details.fields.page).Count -gt 0
  $invalidPass = $invalid.statusCode -eq 400 -and (Test-ErrorEnvelope $invalidBody 'VALIDATION_ERROR') -and $invalidDetailsPass -and $invalid.requestIdPresent
  Add-Check -Id "content.$resource.validation" -Category 'Validation' -Status $(if ($invalidPass) { 'PASS' } else { 'FAIL' }) `
    -Expected 'HTTP 400 standardized VALIDATION_ERROR with safe details and request ID.' `
    -Actual "HTTP $($invalid.statusCode); code=$(if ($null -ne $invalidBody -and (Test-Property $invalidBody 'error')) { $invalidBody.error.code } else { 'unavailable' })." `
    -Evidence "Read-only invalid query GET /api/v1/${resource}?page=0." `
    -Classification $(if ($invalid.statusCode -eq 0 -or $invalid.statusCode -ge 500) { 'DEPLOYMENT_FAILURE' } elseif ($invalidPass) { 'NONE' } else { 'CONTRACT_FAILURE' })

  $missing = Invoke-ReadOnlyRequest -Method GET -Path "/api/v1/$resource/tareeq-acceptance-not-found-20261020" -Purpose 'not-found verification'
  $missingBody = Convert-JsonBody $missing
  $missingPass = $missing.statusCode -eq 404 -and (Test-ErrorEnvelope $missingBody 'CONTENT_NOT_FOUND') -and $missing.requestIdPresent
  Add-Check -Id "content.$resource.not_found" -Category 'Not Found' -Status $(if ($missingPass) { 'PASS' } else { 'FAIL' }) `
    -Expected 'HTTP 404 standardized CONTENT_NOT_FOUND with request ID.' `
    -Actual "HTTP $($missing.statusCode); code=$(if ($null -ne $missingBody -and (Test-Property $missingBody 'error')) { $missingBody.error.code } else { 'unavailable' })." `
    -Evidence "Read-only lookup using a reserved nonexistent slug for $resource." `
    -Classification $(if ($missing.statusCode -eq 0 -or $missing.statusCode -ge 500) { 'DEPLOYMENT_FAILURE' } elseif ($missingPass) { 'NONE' } else { 'CONTRACT_FAILURE' })
}

# Seed-aware public verification is derived from the sanitized manifest.
if ($null -eq $seedManifest) {
  Add-Check -Id 'seed.manifest' -Category 'Seeded Content' -Status 'BLOCKED' `
    -Expected 'A valid sanitized seed manifest for exact seeded-content expectations.' `
    -Actual $manifestLoadIssue -Evidence "Expected manifest at $ManifestPath." `
    -Classification 'MISSING_PREREQUISITE'
} else {
  $manifestEntries = @($seedManifest.content)
  $manifestCounts = @{}
  foreach ($resource in $resources) {
    $manifestCounts[$resource] = @($manifestEntries | Where-Object { $_.resource -eq $resource }).Count
  }
  $manifestPass =
    $manifestCounts.countries -eq 3 -and
    $manifestCounts.universities -eq 6 -and
    $manifestCounts.scholarships -eq 3 -and
    $manifestCounts.services -eq 3 -and
    $manifestCounts.articles -eq 3
  Add-Check -Id 'seed.manifest' -Category 'Seeded Content' -Status $(if ($manifestPass) { 'PASS' } else { 'FAIL' }) `
    -Expected 'Sanitized manifest contains the approved 3/6/3/3/3 target records.' `
    -Actual "countries=$($manifestCounts.countries), universities=$($manifestCounts.universities), scholarships=$($manifestCounts.scholarships), services=$($manifestCounts.services), articles=$($manifestCounts.articles)." `
    -Evidence 'Manifest identifiers and relationships are used in memory; reports retain only aggregate evidence.' `
    -Classification $(if ($manifestPass) { 'NONE' } else { 'CONTRACT_FAILURE' })

  foreach ($entry in $manifestEntries) {
    $detail = Invoke-ReadOnlyRequest -Method GET -Path "/api/v1/$($entry.resource)/$($entry.slug)" -Purpose 'seed-manifest detail visibility verification'
    $detailBody = Convert-JsonBody $detail
    if ($entry.status -eq 'PUBLISHED') {
      $identityPass = $detail.statusCode -eq 200 -and
        (Test-Property $detailBody 'success') -and $detailBody.success -eq $true -and
        (Test-Property $detailBody 'data') -and
        $detailBody.data.id -eq $entry.id -and $detailBody.data.slug -eq $entry.slug
      $relationshipPass = $identityPass
      if ($identityPass) {
        foreach ($relationship in $entry.relationships.PSObject.Properties) {
          if (
            -not (Test-Property $detailBody.data $relationship.Name) -or
            $detailBody.data.($relationship.Name) -ne $relationship.Value
          ) { $relationshipPass = $false }
        }
      }
      if ($identityPass -and $entry.resource -eq 'scholarships') {
        $relationshipPass = $relationshipPass -and
          (Test-Property $detailBody.data 'effectiveApplicationStatus') -and
          $detailBody.data.effectiveApplicationStatus -eq 'CLOSED'
      }
      $detailPass = $identityPass -and $relationshipPass -and $detail.requestIdPresent
      Add-Check -Id "seed.$($entry.resource).$($entry.slug)" -Category 'Seeded Content' -Status $(if ($detailPass) { 'PASS' } else { 'FAIL' }) `
        -Expected 'Published seed returns its exact manifest UUID, slug, relationships, and expected computed state.' `
        -Actual "HTTP $($detail.statusCode); identity=$identityPass; relationships/state=$relationshipPass." `
        -Evidence "Public detail lookup for manifest slug $($entry.slug); UUID and response body are not copied into the report." `
        -Classification $(if ($detail.statusCode -eq 0 -or $detail.statusCode -ge 500) { 'DEPLOYMENT_FAILURE' } elseif ($detailPass) { 'NONE' } else { 'CONTRACT_FAILURE' })
    } else {
      $hiddenPass = $detail.statusCode -eq 404 -and (Test-ErrorEnvelope $detailBody 'CONTENT_NOT_FOUND')
      Add-Check -Id "seed.$($entry.resource).$($entry.slug)" -Category 'Draft Visibility' -Status $(if ($hiddenPass) { 'PASS' } else { 'FAIL' }) `
        -Expected 'DRAFT or ARCHIVED seed is hidden publicly with HTTP 404 CONTENT_NOT_FOUND.' `
        -Actual "HTTP $($detail.statusCode)." `
        -Evidence "Public detail lookup for unpublished manifest slug $($entry.slug)." `
        -Classification $(if ($detail.statusCode -eq 0 -or $detail.statusCode -ge 500) { 'DEPLOYMENT_FAILURE' } elseif ($hiddenPass) { 'NONE' } else { 'CONTRACT_FAILURE' })
    }
  }

  foreach ($resource in $resources) {
    $expectedPublished = @($manifestEntries | Where-Object { $_.resource -eq $resource -and $_.status -eq 'PUBLISHED' })
    $expectedHidden = @($manifestEntries | Where-Object { $_.resource -eq $resource -and $_.status -ne 'PUBLISHED' })
    $seedList = Invoke-ReadOnlyRequest -Method GET -Path "/api/v1/${resource}?limit=50" -Purpose 'seed-manifest collection verification'
    $seedListBody = Convert-JsonBody $seedList
    $items = @(
      if ($null -ne $seedListBody -and (Test-Property $seedListBody 'data')) { $seedListBody.data.items }
    )
    $visibleSlugs = @($items | ForEach-Object { $_.slug })
    $missingPublished = @($expectedPublished | Where-Object { $visibleSlugs -notcontains $_.slug })
    $visibleHidden = @($expectedHidden | Where-Object { $visibleSlugs -contains $_.slug })
    $collectionPass = $seedList.statusCode -eq 200 -and
      (Test-PaginationEnvelope $seedListBody 1 50) -and
      $missingPublished.Count -eq 0 -and $visibleHidden.Count -eq 0
    Add-Check -Id "seed.$resource.collection" -Category 'Seeded Content' -Status $(if ($collectionPass) { 'PASS' } else { 'FAIL' }) `
      -Expected 'Collection includes every PUBLISHED manifest record and excludes every unpublished manifest record.' `
      -Actual "HTTP $($seedList.statusCode); expected published=$($expectedPublished.Count); missing=$($missingPublished.Count); draft leaks=$($visibleHidden.Count)." `
      -Evidence "GET /api/v1/${resource}?limit=50 compared to the sanitized manifest." `
      -Classification $(if ($seedList.statusCode -eq 0 -or $seedList.statusCode -ge 500) { 'DEPLOYMENT_FAILURE' } elseif ($collectionPass) { 'NONE' } else { 'CONTRACT_FAILURE' })
  }

  foreach ($country in @($manifestEntries | Where-Object { $_.resource -eq 'countries' })) {
    $expectedUniversities = @($manifestEntries | Where-Object {
      $_.resource -eq 'universities' -and $_.relationships.countryId -eq $country.id -and $_.status -eq 'PUBLISHED'
    })
    $filtered = Invoke-ReadOnlyRequest -Method GET -Path "/api/v1/universities?country=$($country.slug)&limit=50" -Purpose 'seed country relationship filter verification'
    $filteredBody = Convert-JsonBody $filtered
    $filteredSlugs = @(
      if ($null -ne $filteredBody -and (Test-Property $filteredBody 'data')) { $filteredBody.data.items | ForEach-Object { $_.slug } }
    )
    $filterPass = $filtered.statusCode -eq 200 -and @($expectedUniversities | Where-Object { $filteredSlugs -notcontains $_.slug }).Count -eq 0
    Add-Check -Id "seed.universities.country_filter.$($country.slug)" -Category 'Filters/Pagination' -Status $(if ($filterPass) { 'PASS' } else { 'FAIL' }) `
      -Expected 'Country filter includes every published manifest university related to that country.' `
      -Actual "HTTP $($filtered.statusCode); expected=$($expectedUniversities.Count); returned=$($filteredSlugs.Count)." `
      -Evidence "GET /api/v1/universities?country=$($country.slug)&limit=50." `
      -Classification $(if ($filtered.statusCode -eq 0 -or $filtered.statusCode -ge 500) { 'DEPLOYMENT_FAILURE' } elseif ($filterPass) { 'NONE' } else { 'CONTRACT_FAILURE' })
  }

  $closedScholarships = @($manifestEntries | Where-Object { $_.resource -eq 'scholarships' -and $_.status -eq 'PUBLISHED' })
  $closedResponse = Invoke-ReadOnlyRequest -Method GET -Path '/api/v1/scholarships?applicationStatus=CLOSED&limit=50' -Purpose 'closed scholarship filter verification'
  $closedBody = Convert-JsonBody $closedResponse
  $closedSlugs = @(
    if ($null -ne $closedBody -and (Test-Property $closedBody 'data')) { $closedBody.data.items | ForEach-Object { $_.slug } }
  )
  $closedPass = $closedResponse.statusCode -eq 200 -and @($closedScholarships | Where-Object { $closedSlugs -notcontains $_.slug }).Count -eq 0
  Add-Check -Id 'seed.scholarships.closed_filter' -Category 'Filters/Pagination' -Status $(if ($closedPass) { 'PASS' } else { 'FAIL' }) `
    -Expected 'CLOSED filter includes all three published closed scholarship calls.' `
    -Actual "HTTP $($closedResponse.statusCode); expected=$($closedScholarships.Count); matched=$(@($closedScholarships | Where-Object { $closedSlugs -contains $_.slug }).Count)." `
    -Evidence 'GET /api/v1/scholarships?applicationStatus=CLOSED&limit=50.' `
    -Classification $(if ($closedResponse.statusCode -eq 0 -or $closedResponse.statusCode -ge 500) { 'DEPLOYMENT_FAILURE' } elseif ($closedPass) { 'NONE' } else { 'CONTRACT_FAILURE' })

  $openResponse = Invoke-ReadOnlyRequest -Method GET -Path '/api/v1/scholarships?applicationStatus=OPEN&limit=50' -Purpose 'open scholarship filter verification'
  $openBody = Convert-JsonBody $openResponse
  $openSlugs = @(
    if ($null -ne $openBody -and (Test-Property $openBody 'data')) { $openBody.data.items | ForEach-Object { $_.slug } }
  )
  $openPass = $openResponse.statusCode -eq 200 -and @($closedScholarships | Where-Object { $openSlugs -contains $_.slug }).Count -eq 0
  Add-Check -Id 'seed.scholarships.open_filter' -Category 'Filters/Pagination' -Status $(if ($openPass) { 'PASS' } else { 'FAIL' }) `
    -Expected 'OPEN filter excludes all closed 2026 seed calls.' `
    -Actual "HTTP $($openResponse.statusCode); closed seed leaks=$(@($closedScholarships | Where-Object { $openSlugs -contains $_.slug }).Count)." `
    -Evidence 'GET /api/v1/scholarships?applicationStatus=OPEN&limit=50.' `
    -Classification $(if ($openResponse.statusCode -eq 0 -or $openResponse.statusCode -ge 500) { 'DEPLOYMENT_FAILURE' } elseif ($openPass) { 'NONE' } else { 'CONTRACT_FAILURE' })

  $searchResponse = Invoke-ReadOnlyRequest -Method GET -Path '/api/v1/countries?search=Romania&limit=50' -Purpose 'seeded content search verification'
  $searchBody = Convert-JsonBody $searchResponse
  $searchPass = $searchResponse.statusCode -eq 200 -and $null -ne $searchBody -and @($searchBody.data.items | Where-Object { $_.slug -eq 'romania' }).Count -eq 1
  Add-Check -Id 'seed.countries.search' -Category 'Filters/Pagination' -Status $(if ($searchPass) { 'PASS' } else { 'FAIL' }) `
    -Expected 'Search returns the representative Romania seed record.' `
    -Actual "HTTP $($searchResponse.statusCode); match=$searchPass." `
    -Evidence 'GET /api/v1/countries?search=Romania&limit=50.' `
    -Classification $(if ($searchResponse.statusCode -eq 0 -or $searchResponse.statusCode -ge 500) { 'DEPLOYMENT_FAILURE' } elseif ($searchPass) { 'NONE' } else { 'CONTRACT_FAILURE' })

  $featuredResponse = Invoke-ReadOnlyRequest -Method GET -Path '/api/v1/countries?featured=true&limit=50' -Purpose 'seeded featured content verification'
  $featuredBody = Convert-JsonBody $featuredResponse
  $featuredSlugs = @(
    if ($null -ne $featuredBody -and (Test-Property $featuredBody 'data')) { $featuredBody.data.items | ForEach-Object { $_.slug } }
  )
  $featuredPass = $featuredResponse.statusCode -eq 200 -and @('romania', 'turkey', 'poland' | Where-Object { $featuredSlugs -notcontains $_ }).Count -eq 0
  Add-Check -Id 'seed.countries.featured' -Category 'Filters/Pagination' -Status $(if ($featuredPass) { 'PASS' } else { 'FAIL' }) `
    -Expected 'Featured filter includes the three featured destination seeds.' `
    -Actual "HTTP $($featuredResponse.statusCode); matched=$(@('romania', 'turkey', 'poland' | Where-Object { $featuredSlugs -contains $_ }).Count)." `
    -Evidence 'GET /api/v1/countries?featured=true&limit=50.' `
    -Classification $(if ($featuredResponse.statusCode -eq 0 -or $featuredResponse.statusCode -ge 500) { 'DEPLOYMENT_FAILURE' } elseif ($featuredPass) { 'NONE' } else { 'CONTRACT_FAILURE' })
}

# Repeat database-backed reads to detect the previously observed intermittent failure.
for ($round = 1; $round -le 2; $round++) {
  foreach ($resource in $resources) {
    $repeat = Invoke-ReadOnlyRequest -Method GET -Path "/api/v1/${resource}?limit=1" -Purpose 'database read stability verification'
    if ($repeat.statusCode -ne 200) { $databaseFailures.Add("repeat $round $resource HTTP $($repeat.statusCode)") }
  }
}
$databasePass = $databaseFailures.Count -eq 0
Add-Check -Id 'database.read_connectivity' -Category 'Database' -Status $(if ($databasePass) { 'PASS' } else { 'FAIL' }) `
  -Expected 'All 15 public database-backed collection reads return HTTP 200.' `
  -Actual "Failures=$($databaseFailures.Count)." `
  -Evidence $(if ($databasePass) { 'Five initial reads plus two repeat rounds completed without a database-facing HTTP failure.' } else { @($databaseFailures) -join '; ' }) `
  -Classification $(if ($databasePass) { 'NONE' } else { 'DEPLOYMENT_FAILURE' })

$concurrentTargets = @(
  for ($round = 1; $round -le 3; $round++) {
    foreach ($resource in $resources) {
      [pscustomobject]@{ round = $round; resource = $resource; path = "/api/v1/${resource}?limit=1" }
    }
  }
)
$concurrentResults = @($concurrentTargets | ForEach-Object -ThrottleLimit 5 -Parallel {
  try {
    $response = Invoke-WebRequest `
      -Uri "$($using:BaseUrl)$($_.path)" `
      -Method GET `
      -TimeoutSec $using:TimeoutSeconds `
      -SkipHttpErrorCheck `
      -UseBasicParsing `
      -MaximumRedirection 3
    $requestId = [string](($response.Headers['X-Request-Id'] -join ', '))
    [pscustomobject]@{
      round = $_.round
      resource = $_.resource
      path = $_.path
      statusCode = [int]$response.StatusCode
      requestId = $requestId
      transportError = $null
    }
  } catch {
    [pscustomobject]@{
      round = $_.round
      resource = $_.resource
      path = $_.path
      statusCode = 0
      requestId = ''
      transportError = $_.Exception.Message
    }
  }
})
$concurrentFailures = [System.Collections.Generic.List[string]]::new()
foreach ($result in $concurrentResults) {
  $requestIdPresent = -not [string]::IsNullOrWhiteSpace($result.requestId)
  $requests.Add([pscustomobject]@{
    method = 'GET'
    path = $result.path
    purpose = 'concurrent database read stability verification'
    statusCode = $result.statusCode
    contentType = $null
    requestIdPresent = $requestIdPresent
    requestIdMatchesSupplied = $null
    accessControlAllowOrigin = $null
    accessControlAllowCredentials = $null
    accessControlAllowMethods = $null
    body = ''
    transportError = $result.transportError
  })
  if ($result.statusCode -ne 200 -or -not $requestIdPresent) {
    $failureRequestId = if ($requestIdPresent) { $result.requestId } else { 'missing' }
    $concurrentFailures.Add("round $($result.round) $($result.resource) HTTP $($result.statusCode) requestId=$failureRequestId")
  }
}
$concurrentDatabasePass = $concurrentFailures.Count -eq 0
Add-Check -Id 'database.concurrent_read_stability' -Category 'Database' -Status $(if ($concurrentDatabasePass) { 'PASS' } else { 'FAIL' }) `
  -Expected 'Three concurrent rounds across all five public collections return HTTP 200 with request IDs.' `
  -Actual "Requests=$($concurrentResults.Count); failures=$($concurrentFailures.Count)." `
  -Evidence $(if ($concurrentDatabasePass) { 'All 15 concurrent read-only requests returned HTTP 200 with request IDs.' } else { @($concurrentFailures) -join '; ' }) `
  -Classification $(if ($concurrentDatabasePass) { 'NONE' } else { 'DEPLOYMENT_FAILURE' })

# Authentication, Admin authorization, CORS, and CSRF boundaries without credentials.
$me = Invoke-ReadOnlyRequest -Method GET -Path '/api/v1/auth/me' -Purpose 'anonymous authentication boundary'
$meBody = Convert-JsonBody $me
$mePass = $me.statusCode -eq 401 -and (Test-ErrorEnvelope $meBody 'AUTHENTICATION_REQUIRED')
Add-Check -Id 'auth.me_anonymous' -Category 'Authentication' -Status $(if ($mePass) { 'PASS' } else { 'FAIL' }) `
  -Expected 'Anonymous request receives HTTP 401 AUTHENTICATION_REQUIRED.' -Actual "HTTP $($me.statusCode)." `
  -Evidence 'GET /api/v1/auth/me without cookies.' -Classification $(if ($me.statusCode -eq 0 -or $me.statusCode -ge 500) { 'DEPLOYMENT_FAILURE' } elseif ($mePass) { 'NONE' } else { 'CONTRACT_FAILURE' })

foreach ($resource in $resources) {
  $admin = Invoke-ReadOnlyRequest -Method GET -Path "/api/v1/admin/$resource" -Purpose 'anonymous Admin authorization boundary'
  $adminBody = Convert-JsonBody $admin
  $adminPass = $admin.statusCode -eq 401 -and (Test-ErrorEnvelope $adminBody 'AUTHENTICATION_REQUIRED')
  Add-Check -Id "admin.$resource.anonymous" -Category 'Authorization' -Status $(if ($adminPass) { 'PASS' } else { 'FAIL' }) `
    -Expected 'Anonymous Admin request receives HTTP 401 AUTHENTICATION_REQUIRED.' -Actual "HTTP $($admin.statusCode)." `
    -Evidence "GET /api/v1/admin/$resource without cookies." `
    -Classification $(if ($admin.statusCode -eq 0 -or $admin.statusCode -ge 500) { 'DEPLOYMENT_FAILURE' } elseif ($adminPass) { 'NONE' } else { 'CONTRACT_FAILURE' })
}

$publicCorsFailures = [System.Collections.Generic.List[string]]::new()
foreach ($resource in $resources) {
  $publicRead = Invoke-ReadOnlyRequest -Method GET -Path "/api/v1/${resource}?limit=1" -Headers @{ Origin = $PublicOrigin } -Purpose 'student-origin public CORS read'
  if (
    $publicRead.statusCode -ne 200 -or
    $publicRead.accessControlAllowOrigin -ne $PublicOrigin -or
    -not [string]::IsNullOrWhiteSpace($publicRead.accessControlAllowCredentials)
  ) {
    $publicCorsFailures.Add("$resource HTTP $($publicRead.statusCode); exactOrigin=$($publicRead.accessControlAllowOrigin -eq $PublicOrigin); credentialsAbsent=$([string]::IsNullOrWhiteSpace($publicRead.accessControlAllowCredentials))")
  }
}
$publicCorsPass = $publicCorsFailures.Count -eq 0
Add-Check -Id 'security.public_cors_reads' -Category 'CORS/CSRF' -Status $(if ($publicCorsPass) { 'PASS' } else { 'FAIL' }) `
  -Expected 'The configured student origin can read all five public collections with exact ACAO and without credentialed CORS.' `
  -Actual "Failures=$($publicCorsFailures.Count)." `
  -Evidence $(if ($publicCorsPass) { 'All five public GET responses allowed the configured student origin and omitted Access-Control-Allow-Credentials.' } else { @($publicCorsFailures) -join '; ' }) `
  -Classification $(if ($publicCorsPass) { 'NONE' } elseif (@($publicCorsFailures | Where-Object { $_ -match 'HTTP (0|5\d\d)' }).Count -gt 0) { 'DEPLOYMENT_FAILURE' } else { 'CONTRACT_FAILURE' })

$publicReadPreflight = Invoke-ReadOnlyRequest -Method OPTIONS -Path '/api/v1/countries' -Headers @{
  Origin = $PublicOrigin
  'Access-Control-Request-Method' = 'GET'
} -Purpose 'student-origin public read preflight'
$publicReadPreflightPass = $publicReadPreflight.statusCode -eq 204 -and
  $publicReadPreflight.accessControlAllowOrigin -eq $PublicOrigin -and
  [string]::IsNullOrWhiteSpace($publicReadPreflight.accessControlAllowCredentials) -and
  $publicReadPreflight.accessControlAllowMethods -match '(^|,\s*)GET(\s*,|$)' -and
  $publicReadPreflight.accessControlAllowMethods -notmatch '(^|,\s*)POST(\s*,|$)'
Add-Check -Id 'security.public_cors_read_preflight' -Category 'CORS/CSRF' -Status $(if ($publicReadPreflightPass) { 'PASS' } else { 'FAIL' }) `
  -Expected 'Public preflight allows GET without credentials and does not advertise POST.' `
  -Actual "HTTP $($publicReadPreflight.statusCode); exact origin=$($publicReadPreflight.accessControlAllowOrigin -eq $PublicOrigin); credentials absent=$([string]::IsNullOrWhiteSpace($publicReadPreflight.accessControlAllowCredentials)); GET allowed=$($publicReadPreflight.accessControlAllowMethods -match '(^|,\s*)GET(\s*,|$)'); POST excluded=$($publicReadPreflight.accessControlAllowMethods -notmatch '(^|,\s*)POST(\s*,|$)')." `
  -Evidence 'OPTIONS /api/v1/countries from the configured student origin.' `
  -Classification $(if ($publicReadPreflight.statusCode -eq 0 -or $publicReadPreflight.statusCode -ge 500) { 'DEPLOYMENT_FAILURE' } elseif ($publicReadPreflightPass) { 'NONE' } else { 'CONTRACT_FAILURE' })

$untrustedPublicRead = Invoke-ReadOnlyRequest -Method GET -Path '/api/v1/countries?limit=1' -Headers @{ Origin = 'https://untrusted.invalid' } -Purpose 'untrusted public browser-origin read'
$untrustedPublicReadPass = $untrustedPublicRead.statusCode -eq 200 -and [string]::IsNullOrWhiteSpace($untrustedPublicRead.accessControlAllowOrigin)
Add-Check -Id 'security.public_cors_untrusted' -Category 'CORS/CSRF' -Status $(if ($untrustedPublicReadPass) { 'PASS' } else { 'FAIL' }) `
  -Expected 'The public resource remains HTTP-readable while an untrusted browser origin receives no ACAO permission.' `
  -Actual "HTTP $($untrustedPublicRead.statusCode); ACAO absent=$([string]::IsNullOrWhiteSpace($untrustedPublicRead.accessControlAllowOrigin))." `
  -Evidence 'GET /api/v1/countries from a reserved invalid origin.' `
  -Classification $(if ($untrustedPublicRead.statusCode -eq 0 -or $untrustedPublicRead.statusCode -ge 500) { 'DEPLOYMENT_FAILURE' } elseif ($untrustedPublicReadPass) { 'NONE' } else { 'CONTRACT_FAILURE' })

$trustedPreflight = Invoke-ReadOnlyRequest -Method OPTIONS -Path '/api/v1/auth/login' -Headers @{
  Origin = $AdminOrigin
  'Access-Control-Request-Method' = 'POST'
  'Access-Control-Request-Headers' = 'content-type'
} -Purpose 'trusted Admin-origin CORS preflight'
$trustedCorsPass = $trustedPreflight.statusCode -eq 204 -and $trustedPreflight.accessControlAllowOrigin -eq $AdminOrigin -and $trustedPreflight.accessControlAllowCredentials -eq 'true'
Add-Check -Id 'security.cors_trusted' -Category 'CORS/CSRF' -Status $(if ($trustedCorsPass) { 'PASS' } else { 'FAIL' }) `
  -Expected 'Trusted Admin-origin preflight returns 204, exact ACAO, and credentials=true.' `
  -Actual "HTTP $($trustedPreflight.statusCode); exact origin=$($trustedPreflight.accessControlAllowOrigin -eq $AdminOrigin); credentials=$($trustedPreflight.accessControlAllowCredentials)." `
  -Evidence 'OPTIONS /api/v1/auth/login; report excludes raw response headers other than evaluated booleans.' `
  -Classification $(if ($trustedPreflight.statusCode -eq 0 -or $trustedPreflight.statusCode -ge 500) { 'DEPLOYMENT_FAILURE' } elseif ($trustedCorsPass) { 'NONE' } else { 'CONTRACT_FAILURE' })

$publicOriginAuthPreflight = Invoke-ReadOnlyRequest -Method OPTIONS -Path '/api/v1/auth/login' -Headers @{
  Origin = $PublicOrigin
  'Access-Control-Request-Method' = 'POST'
  'Access-Control-Request-Headers' = 'content-type'
} -Purpose 'student origin excluded from credentialed authentication CORS'
$publicOriginAuthCorsPass = $publicOriginAuthPreflight.statusCode -eq 204 -and [string]::IsNullOrWhiteSpace($publicOriginAuthPreflight.accessControlAllowOrigin)
Add-Check -Id 'security.auth_cors_public_origin_rejected' -Category 'CORS/CSRF' -Status $(if ($publicOriginAuthCorsPass) { 'PASS' } else { 'FAIL' }) `
  -Expected 'The public student origin receives no credentialed authentication CORS permission.' `
  -Actual "HTTP $($publicOriginAuthPreflight.statusCode); ACAO absent=$([string]::IsNullOrWhiteSpace($publicOriginAuthPreflight.accessControlAllowOrigin))." `
  -Evidence 'OPTIONS /api/v1/auth/login from the configured public-only origin.' `
  -Classification $(if ($publicOriginAuthPreflight.statusCode -eq 0 -or $publicOriginAuthPreflight.statusCode -ge 500) { 'DEPLOYMENT_FAILURE' } elseif ($publicOriginAuthCorsPass) { 'NONE' } else { 'CONTRACT_FAILURE' })

$untrustedOrigin = 'https://untrusted.invalid'
$untrustedPreflight = Invoke-ReadOnlyRequest -Method OPTIONS -Path '/api/v1/auth/login' -Headers @{
  Origin = $untrustedOrigin
  'Access-Control-Request-Method' = 'POST'
  'Access-Control-Request-Headers' = 'content-type'
} -Purpose 'untrusted CORS preflight'
$untrustedCorsPass = $untrustedPreflight.statusCode -eq 204 -and [string]::IsNullOrWhiteSpace($untrustedPreflight.accessControlAllowOrigin)
Add-Check -Id 'security.cors_untrusted' -Category 'CORS/CSRF' -Status $(if ($untrustedCorsPass) { 'PASS' } else { 'FAIL' }) `
  -Expected 'Untrusted preflight does not receive Access-Control-Allow-Origin.' `
  -Actual "HTTP $($untrustedPreflight.statusCode); ACAO absent=$([string]::IsNullOrWhiteSpace($untrustedPreflight.accessControlAllowOrigin))." `
  -Evidence 'OPTIONS /api/v1/auth/login from a reserved invalid origin.' `
  -Classification $(if ($untrustedPreflight.statusCode -eq 0 -or $untrustedPreflight.statusCode -ge 500) { 'DEPLOYMENT_FAILURE' } elseif ($untrustedCorsPass) { 'NONE' } else { 'CONTRACT_FAILURE' })

$csrf = Invoke-ReadOnlyRequest -Method POST -Path '/api/v1/auth/login' -Headers @{ Origin = $untrustedOrigin } -Body '{}' -Purpose 'CSRF rejection before validation or handler execution'
$csrfBody = Convert-JsonBody $csrf
$csrfPass = $csrf.statusCode -eq 403 -and (Test-ErrorEnvelope $csrfBody 'CSRF_VALIDATION_FAILED')
Add-Check -Id 'security.csrf_untrusted' -Category 'CORS/CSRF' -Status $(if ($csrfPass) { 'PASS' } else { 'FAIL' }) `
  -Expected 'Untrusted state-changing request is rejected with HTTP 403 CSRF_VALIDATION_FAILED before handler execution.' `
  -Actual "HTTP $($csrf.statusCode)." `
  -Evidence 'POST /api/v1/auth/login used an untrusted origin and an empty body; it cannot authenticate or create a session.' `
  -Classification $(if ($csrf.statusCode -eq 0 -or $csrf.statusCode -ge 500) { 'DEPLOYMENT_FAILURE' } elseif ($csrfPass) { 'NONE' } else { 'CONTRACT_FAILURE' })

$loginEmail = "tareeq-acceptance-$([guid]::NewGuid().ToString('N'))@invalid.example"
$loginBody = @{ email = $loginEmail; password = 'AcceptanceOnlyPassword123!' } | ConvertTo-Json -Compress
$login = Invoke-ReadOnlyRequest -Method POST -Path '/api/v1/auth/login' -Headers @{ Origin = $AdminOrigin } -Body $loginBody -Purpose 'read-only authentication database lookup with guaranteed synthetic identity'
$loginJson = Convert-JsonBody $login
$loginPass = $login.statusCode -eq 401 -and (Test-ErrorEnvelope $loginJson 'INVALID_CREDENTIALS')
Add-Check -Id 'auth.invalid_credentials' -Category 'Authentication' -Status $(if ($loginPass) { 'PASS' } else { 'FAIL' }) `
  -Expected 'A unique nonexistent identity receives HTTP 401 INVALID_CREDENTIALS without creating a session.' `
  -Actual "HTTP $($login.statusCode)." `
  -Evidence 'Synthetic @invalid.example identity; no credential value or response body is retained.' `
  -Classification $(if ($login.statusCode -eq 0 -or $login.statusCode -ge 500) { 'DEPLOYMENT_FAILURE' } elseif ($loginPass) { 'NONE' } else { 'CONTRACT_FAILURE' })

if (-not $Authenticated.IsPresent) {
  Add-Check -Id 'admin.authenticated_roles' -Category 'Authorization' -Status 'BLOCKED' `
    -Expected 'Positive ADMIN and SUPER_ADMIN login, refresh, Admin reads, and logout in explicit authenticated mode.' `
    -Actual 'Authenticated mode was not requested.' `
    -Evidence 'Run with -Authenticated after the four INITIAL_* email/password values are securely configured. Default mode remains read-only.' `
    -Classification 'MISSING_PREREQUISITE' -Required $false
} else {
  $credentials = Get-LocalCredentialConfiguration
  $credentialNamesByRole = @{
    ADMIN = @('INITIAL_ADMIN_EMAIL', 'INITIAL_ADMIN_PASSWORD')
    SUPER_ADMIN = @('INITIAL_SUPER_ADMIN_EMAIL', 'INITIAL_SUPER_ADMIN_PASSWORD')
  }

  foreach ($role in @('ADMIN', 'SUPER_ADMIN')) {
    $requiredCredentialNames = $credentialNamesByRole[$role]
    $missingCredentialNames = @($requiredCredentialNames | Where-Object { -not $credentials.ContainsKey($_) })
    if ($missingCredentialNames.Count -gt 0) {
      Add-Check -Id "auth.$($role.ToLowerInvariant()).workflow" -Category 'Authentication' -Status 'BLOCKED' `
        -Expected "$role credentials securely configured for the explicit login/session workflow." `
        -Actual "Missing configuration: $($missingCredentialNames -join ', ')." `
        -Evidence 'No authentication request was attempted and no secret value was read into a report.' `
        -Classification 'MISSING_PREREQUISITE'
      continue
    }

    $session = [Microsoft.PowerShell.Commands.WebRequestSession]::new()
    $loginPayload = @{
      email = $credentials[$requiredCredentialNames[0]]
      password = $credentials[$requiredCredentialNames[1]]
    } | ConvertTo-Json -Compress
    $roleSlug = $role.ToLowerInvariant()
    $loginResponse = Invoke-ReadOnlyRequest -Method POST -Path '/api/v1/auth/login' -Headers @{ Origin = $AdminOrigin } -Body $loginPayload -WebSession $session -Purpose "$role authenticated login"
    $loginResponseBody = Convert-JsonBody $loginResponse
    $cookieNames = @($session.Cookies.GetCookies([uri]"$BaseUrl/api/v1/auth/me") | ForEach-Object { $_.Name })
    $loginPass = $loginResponse.statusCode -eq 200 -and
      (Test-SuccessUserRole $loginResponseBody $role) -and
      $loginResponse.accessControlAllowOrigin -eq $AdminOrigin -and
      $loginResponse.accessControlAllowCredentials -eq 'true' -and
      $cookieNames -contains 'tareeq_access' -and $cookieNames -contains 'tareeq_refresh'
    Add-Check -Id "auth.$roleSlug.login" -Category 'Authentication' -Status $(if ($loginPass) { 'PASS' } else { 'FAIL' }) `
      -Expected "HTTP 200, /auth user role $role, and both HttpOnly session cookies accepted by an isolated jar." `
      -Actual "HTTP $($loginResponse.statusCode); role correct=$(Test-SuccessUserRole $loginResponseBody $role); Admin CORS exact=$($loginResponse.accessControlAllowOrigin -eq $AdminOrigin); credentials allowed=$($loginResponse.accessControlAllowCredentials -eq 'true'); cookie names present=$($cookieNames.Count -ge 2)." `
      -Evidence 'Credential values, cookie values, user identity fields, and response bodies are excluded from reports.' `
      -Classification $(if ($loginResponse.statusCode -eq 0 -or $loginResponse.statusCode -ge 500) { 'DEPLOYMENT_FAILURE' } elseif ($loginPass) { 'NONE' } else { 'CONTRACT_FAILURE' })

    if (-not $loginPass) { continue }

    $credentialedPublicOrigin = Invoke-ReadOnlyRequest -Method POST -Path '/api/v1/auth/change-password' -Headers @{ Origin = $PublicOrigin } -Body '{}' -WebSession $session -Purpose "$role credentialed request from public-only origin"
    $credentialedPublicOriginBody = Convert-JsonBody $credentialedPublicOrigin
    $credentialedPublicOriginPass = $credentialedPublicOrigin.statusCode -eq 403 -and
      (Test-ErrorEnvelope $credentialedPublicOriginBody 'CSRF_VALIDATION_FAILED') -and
      [string]::IsNullOrWhiteSpace($credentialedPublicOrigin.accessControlAllowOrigin)
    Add-Check -Id "security.$roleSlug.credentialed_public_origin_rejected" -Category 'CORS/CSRF' -Status $(if ($credentialedPublicOriginPass) { 'PASS' } else { 'FAIL' }) `
      -Expected 'A credentialed state-changing request from the public-only origin is rejected with HTTP 403 CSRF_VALIDATION_FAILED and no ACAO.' `
      -Actual "HTTP $($credentialedPublicOrigin.statusCode); correct error=$(Test-ErrorEnvelope $credentialedPublicOriginBody 'CSRF_VALIDATION_FAILED'); ACAO absent=$([string]::IsNullOrWhiteSpace($credentialedPublicOrigin.accessControlAllowOrigin))." `
      -Evidence 'POST /api/v1/auth/change-password used the authenticated cookie jar and an empty body, so it cannot change a password even if the boundary regresses.' `
      -Classification $(if ($credentialedPublicOrigin.statusCode -eq 0 -or $credentialedPublicOrigin.statusCode -ge 500) { 'DEPLOYMENT_FAILURE' } elseif ($credentialedPublicOriginPass) { 'NONE' } else { 'CONTRACT_FAILURE' })

    $meResponse = Invoke-ReadOnlyRequest -Method GET -Path '/api/v1/auth/me' -Headers @{ Origin = $AdminOrigin } -WebSession $session -Purpose "$role current-user verification"
    $meResponseBody = Convert-JsonBody $meResponse
    $meRolePass = $meResponse.statusCode -eq 200 -and (Test-SuccessUserRole $meResponseBody $role)
    Add-Check -Id "auth.$roleSlug.me" -Category 'Authentication' -Status $(if ($meRolePass) { 'PASS' } else { 'FAIL' }) `
      -Expected "/auth/me returns the authoritative $role role for the saved cookie context." `
      -Actual "HTTP $($meResponse.statusCode); role correct=$(Test-SuccessUserRole $meResponseBody $role)." `
      -Evidence 'GET /api/v1/auth/me with an isolated in-memory cookie jar.' `
      -Classification $(if ($meResponse.statusCode -eq 0 -or $meResponse.statusCode -ge 500) { 'DEPLOYMENT_FAILURE' } elseif ($meRolePass) { 'NONE' } else { 'CONTRACT_FAILURE' })

    $refreshResponse = Invoke-ReadOnlyRequest -Method POST -Path '/api/v1/auth/refresh' -Headers @{ Origin = $AdminOrigin } -WebSession $session -Purpose "$role refresh-session rotation"
    $refreshResponseBody = Convert-JsonBody $refreshResponse
    $refreshPass = $refreshResponse.statusCode -eq 200 -and (Test-SuccessUserRole $refreshResponseBody $role)
    Add-Check -Id "auth.$roleSlug.refresh" -Category 'Authentication' -Status $(if ($refreshPass) { 'PASS' } else { 'FAIL' }) `
      -Expected 'Refresh credential rotates successfully and returns the same authoritative role.' `
      -Actual "HTTP $($refreshResponse.statusCode); role correct=$(Test-SuccessUserRole $refreshResponseBody $role)." `
      -Evidence 'POST /api/v1/auth/refresh; old and replacement cookie values are never inspected or retained.' `
      -Classification $(if ($refreshResponse.statusCode -eq 0 -or $refreshResponse.statusCode -ge 500) { 'DEPLOYMENT_FAILURE' } elseif ($refreshPass) { 'NONE' } else { 'CONTRACT_FAILURE' })

    $restoredMe = Invoke-ReadOnlyRequest -Method GET -Path '/api/v1/auth/me' -Headers @{ Origin = $AdminOrigin } -WebSession $session -Purpose "$role restored session verification"
    $restoredMeBody = Convert-JsonBody $restoredMe
    $restoredPass = $restoredMe.statusCode -eq 200 -and (Test-SuccessUserRole $restoredMeBody $role)
    Add-Check -Id "auth.$roleSlug.me_after_refresh" -Category 'Authentication' -Status $(if ($restoredPass) { 'PASS' } else { 'FAIL' }) `
      -Expected '/auth/me succeeds with the saved replacement-cookie context after refresh.' `
      -Actual "HTTP $($restoredMe.statusCode); role correct=$(Test-SuccessUserRole $restoredMeBody $role)." `
      -Evidence 'GET /api/v1/auth/me after rotating the same isolated session.' `
      -Classification $(if ($restoredMe.statusCode -eq 0 -or $restoredMe.statusCode -ge 500) { 'DEPLOYMENT_FAILURE' } elseif ($restoredPass) { 'NONE' } else { 'CONTRACT_FAILURE' })

    $adminReadFailures = [System.Collections.Generic.List[string]]::new()
    foreach ($resource in $resources) {
      $adminRead = Invoke-ReadOnlyRequest -Method GET -Path "/api/v1/admin/${resource}?limit=50" -Headers @{ Origin = $AdminOrigin } -WebSession $session -Purpose "$role Admin content read"
      $adminReadBody = Convert-JsonBody $adminRead
      if (
        $adminRead.statusCode -ne 200 -or
        -not (Test-PaginationEnvelope $adminReadBody 1 50) -or
        $adminRead.accessControlAllowOrigin -ne $AdminOrigin -or
        $adminRead.accessControlAllowCredentials -ne 'true'
      ) {
        $adminReadFailures.Add("$resource HTTP $($adminRead.statusCode)")
      }
    }
    $adminReadsPass = $adminReadFailures.Count -eq 0
    Add-Check -Id "admin.$roleSlug.content_reads" -Category 'Authorization' -Status $(if ($adminReadsPass) { 'PASS' } else { 'FAIL' }) `
      -Expected "$role can read all five approved Admin content collections." `
      -Actual "Failures=$($adminReadFailures.Count)." `
      -Evidence $(if ($adminReadsPass) { 'All five authenticated GET collection requests returned valid pagination envelopes.' } else { @($adminReadFailures) -join '; ' }) `
      -Classification $(if ($adminReadsPass) { 'NONE' } elseif (@($adminReadFailures | Where-Object { $_ -match 'HTTP (0|5\d\d)' }).Count -gt 0) { 'DEPLOYMENT_FAILURE' } else { 'CONTRACT_FAILURE' })

    if ($null -ne $seedManifest) {
      $unpublishedEntries = @($seedManifest.content | Where-Object { $_.status -ne 'PUBLISHED' })
      $adminDraftFailures = [System.Collections.Generic.List[string]]::new()
      foreach ($entry in $unpublishedEntries) {
        $draftRead = Invoke-ReadOnlyRequest -Method GET -Path "/api/v1/admin/$($entry.resource)/$($entry.id)" -Headers @{ Origin = $AdminOrigin } -WebSession $session -Purpose "$role Admin draft visibility"
        $draftReadBody = Convert-JsonBody $draftRead
        if (
          $draftRead.statusCode -ne 200 -or
          -not (Test-Property $draftReadBody 'data') -or
          $draftReadBody.data.id -ne $entry.id -or
          $draftReadBody.data.status -ne $entry.status
        ) {
          $adminDraftFailures.Add("$($entry.resource) HTTP $($draftRead.statusCode)")
        }
      }
      $adminDraftPass = $adminDraftFailures.Count -eq 0
      Add-Check -Id "admin.$roleSlug.draft_visibility" -Category 'Authorization' -Status $(if ($adminDraftPass) { 'PASS' } else { 'FAIL' }) `
        -Expected "$role can read every unpublished manifest record by UUID while public routes hide them." `
        -Actual "Checked=$($unpublishedEntries.Count); failures=$($adminDraftFailures.Count)." `
        -Evidence 'Authenticated Admin detail responses were matched to manifest IDs without copying IDs or bodies into reports.' `
        -Classification $(if ($adminDraftPass) { 'NONE' } elseif (@($adminDraftFailures | Where-Object { $_ -match 'HTTP (0|5\d\d)' }).Count -gt 0) { 'DEPLOYMENT_FAILURE' } else { 'CONTRACT_FAILURE' })
    }

    $logoutResponse = Invoke-ReadOnlyRequest -Method POST -Path '/api/v1/auth/logout' -Headers @{ Origin = $AdminOrigin } -WebSession $session -Purpose "$role logout and revocation"
    $logoutBody = Convert-JsonBody $logoutResponse
    $logoutPass = $logoutResponse.statusCode -eq 200 -and
      (Test-Property $logoutBody 'success') -and $logoutBody.success -eq $true
    Add-Check -Id "auth.$roleSlug.logout" -Category 'Authentication' -Status $(if ($logoutPass) { 'PASS' } else { 'FAIL' }) `
      -Expected 'Logout returns HTTP 200 and clears/revokes the current session.' `
      -Actual "HTTP $($logoutResponse.statusCode)." `
      -Evidence 'POST /api/v1/auth/logout using the isolated refreshed session.' `
      -Classification $(if ($logoutResponse.statusCode -eq 0 -or $logoutResponse.statusCode -ge 500) { 'DEPLOYMENT_FAILURE' } elseif ($logoutPass) { 'NONE' } else { 'CONTRACT_FAILURE' })

    $afterLogout = Invoke-ReadOnlyRequest -Method GET -Path '/api/v1/auth/me' -Headers @{ Origin = $AdminOrigin } -WebSession $session -Purpose "$role post-logout invalidation"
    $afterLogoutBody = Convert-JsonBody $afterLogout
    $invalidationPass = $afterLogout.statusCode -eq 401 -and (Test-ErrorEnvelope $afterLogoutBody 'AUTHENTICATION_REQUIRED')
    Add-Check -Id "auth.$roleSlug.logout_invalidation" -Category 'Authentication' -Status $(if ($invalidationPass) { 'PASS' } else { 'FAIL' }) `
      -Expected 'The same cookie context is unauthorized after logout.' `
      -Actual "HTTP $($afterLogout.statusCode)." `
      -Evidence 'GET /api/v1/auth/me after logout using the same isolated in-memory jar.' `
      -Classification $(if ($afterLogout.statusCode -eq 0 -or $afterLogout.statusCode -ge 500) { 'DEPLOYMENT_FAILURE' } elseif ($invalidationPass) { 'NONE' } else { 'CONTRACT_FAILURE' })
  }
}

# Every received API response must carry a request ID. Transport failures are already classified elsewhere.
$missingRequestIds = @($requests | Where-Object { $_.statusCode -gt 0 -and -not $_.requestIdPresent } | ForEach-Object { "$($_.method) $($_.path)" })
$requestIdPass = $missingRequestIds.Count -eq 0
Add-Check -Id 'contracts.request_ids' -Category 'Response Contracts' -Status $(if ($requestIdPass) { 'PASS' } else { 'FAIL' }) `
  -Expected 'Every received response carries X-Request-Id.' `
  -Actual "Missing on $($missingRequestIds.Count) response(s)." `
  -Evidence $(if ($requestIdPass) { "$($requests.Count) responses carried request IDs; values were not retained." } else { $missingRequestIds -join '; ' }) `
  -Classification $(if ($requestIdPass) { 'NONE' } else { 'CONTRACT_FAILURE' })

$requiredFailures = @($checks | Where-Object { $_.required -and $_.status -eq 'FAIL' })
$requiredBlocks = @($checks | Where-Object { $_.required -and $_.status -eq 'BLOCKED' })
$overallStatus = if ($requiredFailures.Count -gt 0) { 'FAIL' } elseif ($requiredBlocks.Count -gt 0) { 'BLOCKED' } else { 'PASS' }
$summary = [ordered]@{
  total = $checks.Count
  passed = @($checks | Where-Object status -eq 'PASS').Count
  failed = @($checks | Where-Object status -eq 'FAIL').Count
  blocked = @($checks | Where-Object status -eq 'BLOCKED').Count
  deploymentFailures = @($checks | Where-Object classification -eq 'DEPLOYMENT_FAILURE').Count
  contractFailures = @($checks | Where-Object classification -eq 'CONTRACT_FAILURE').Count
  missingPrerequisites = @($checks | Where-Object classification -eq 'MISSING_PREREQUISITE').Count
}

$httpCookieJarStatus = if (-not $Authenticated.IsPresent) {
  'BLOCKED'
} else {
  $httpAuthenticationChecks = @($checks | Where-Object {
    $_.id -match '^auth\.(admin|super_admin)\.(login|me|refresh|me_after_refresh|logout|logout_invalidation)$'
  })
  if (@($httpAuthenticationChecks | Where-Object status -eq 'FAIL').Count -gt 0) {
    'FAIL'
  } elseif (@($httpAuthenticationChecks | Where-Object status -eq 'BLOCKED').Count -gt 0 -or $httpAuthenticationChecks.Count -eq 0) {
    'BLOCKED'
  } else {
    'PASS'
  }
}

$browserVerification = [ordered]@{
  status = 'BLOCKED'
  browserEngine = 'Not executed'
  frontendOrigin = $AdminOrigin
  apiOrigin = $BaseUrl
  authenticationFlow = 'No valid sanitized browser report was available.'
  remainingFrontendIntegrationRisks = @(
    'Browser cookie persistence remains unverified.',
    'The local harness does not verify the real Admin Dashboard implementation.'
  )
}
if (Test-Path -LiteralPath $BrowserReportPath) {
  try {
    $browserReport = Get-Content -Raw -LiteralPath $BrowserReportPath | ConvertFrom-Json -Depth 100
    if (
      $browserReport.schemaVersion -eq 1 -and
      $browserReport.overallStatus -in @('PASS', 'FAIL', 'BLOCKED') -and
      $browserReport.frontendOrigin -eq $AdminOrigin -and
      $browserReport.apiOrigin -eq $BaseUrl
    ) {
      $browserVerification.status = $browserReport.browserCookiePersistence
      $browserVerification.browserEngine = $browserReport.browserEngine
      $browserVerification.frontendOrigin = $browserReport.frontendOrigin
      $browserVerification.apiOrigin = $browserReport.apiOrigin
      $browserVerification.authenticationFlow = $browserReport.authenticationFlow
      $browserVerification.remainingFrontendIntegrationRisks = @($browserReport.remainingFrontendIntegrationRisks)
    }
  } catch {
    $browserVerification.authenticationFlow = 'The browser report exists but could not be parsed or did not match this verifier target.'
  }
}

$report = [ordered]@{
  schemaVersion = 2
  generatedAtUtc = [DateTime]::UtcNow.ToString('o')
  baseUrl = $BaseUrl
  overallStatus = $overallStatus
  mode = if ($Authenticated.IsPresent) { 'AUTHENTICATED_SESSION' } else { 'READ_ONLY' }
  readOnly = -not $Authenticated.IsPresent
  corsVerification = [ordered]@{
    publicOrigin = $PublicOrigin
    adminOrigin = $AdminOrigin
    publicPolicy = 'Exact-origin, non-credentialed GET/HEAD/OPTIONS on public route category.'
    adminPolicy = 'Exact-origin credentialed CORS plus CSRF trusted-origin enforcement on Auth/Admin route categories.'
  }
  authenticationVerification = [ordered]@{
    httpCookieJar = $httpCookieJarStatus
    browserCookiePersistence = $browserVerification.status
    browserEngine = $browserVerification.browserEngine
    frontendOrigin = $browserVerification.frontendOrigin
    apiOrigin = $browserVerification.apiOrigin
    authenticationFlow = $browserVerification.authenticationFlow
    remainingFrontendIntegrationRisks = $browserVerification.remainingFrontendIntegrationRisks
  }
  safeguards = @(
    $(if ($Authenticated.IsPresent) { 'No account or content writes, migrations, cleanup, or destructive operations; only authorized login/refresh/logout session records may change.' } else { 'No database writes, migrations, cleanup, account creation, or destructive operations.' }),
    'No credentials, cookies, response bodies, raw request IDs, tokens, or secrets are stored in this report.',
    'Scalar browser rendering is intentionally excluded and owner-managed.'
  )
  summary = $summary
  checks = @($checks)
}

New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$reportStem = if ($Authenticated.IsPresent) { 'backend-acceptance-authenticated' } else { 'backend-acceptance' }
$jsonPath = Join-Path $OutputDirectory "$reportStem.json"
$markdownPath = Join-Path $OutputDirectory "$reportStem.md"
$report | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $jsonPath -Encoding utf8

$markdown = [System.Collections.Generic.List[string]]::new()
$markdown.Add('# Backend Post-Deployment Acceptance Report')
$markdown.Add('')
$markdown.Add("- Generated: $($report.generatedAtUtc)")
$markdown.Add("- Base URL: $BaseUrl")
$markdown.Add("- Overall: **$overallStatus**")
$markdown.Add("- Mode: **$($report.mode)**")
$markdown.Add("- Read-only execution: **$($report.readOnly)**")
$markdown.Add("- Public browser origin: $PublicOrigin")
$markdown.Add("- Admin browser origin: $AdminOrigin")
$markdown.Add("- Checks: $($summary.passed) PASS / $($summary.failed) FAIL / $($summary.blocked) BLOCKED")
$markdown.Add("- Failure classification: $($summary.deploymentFailures) deployment / $($summary.contractFailures) contract / $($summary.missingPrerequisites) missing prerequisite")
$markdown.Add('')
$markdown.Add('## Authentication Verification Modes')
$markdown.Add('')
$markdown.Add("- HTTP Cookie Jar: **$httpCookieJarStatus**")
$markdown.Add("- Browser Cookie Persistence: **$($browserVerification.status)**")
$markdown.Add("- Browser Engine: $($browserVerification.browserEngine)")
$markdown.Add("- Frontend Origin: $($browserVerification.frontendOrigin)")
$markdown.Add("- API Origin: $($browserVerification.apiOrigin)")
$markdown.Add("- Authentication Flow: $($browserVerification.authenticationFlow)")
$markdown.Add('')
$markdown.Add('### Remaining Frontend Integration Risks')
$markdown.Add('')
foreach ($risk in $browserVerification.remainingFrontendIntegrationRisks) { $markdown.Add("- $risk") }
$markdown.Add('')
$markdown.Add('| Status | Required | Category | Check | Actual | Classification |')
$markdown.Add('|---|---:|---|---|---|---|')
foreach ($check in $checks) {
  $actual = ([string]$check.actual).Replace('|', '\|').Replace("`r", ' ').Replace("`n", ' ')
  $markdown.Add("| $($check.status) | $($check.required) | $($check.category) | $($check.id) | $actual | $($check.classification) |")
}
$markdown.Add('')
$markdown.Add('## Evidence')
$markdown.Add('')
foreach ($check in $checks) {
  $evidence = ([string]$check.evidence).Replace("`r", ' ').Replace("`n", ' ')
  $markdown.Add("- **$($check.id) - $($check.status):** $evidence")
}
$markdown.Add('')
$markdown.Add('## Safeguards')
$markdown.Add('')
foreach ($item in $report.safeguards) { $markdown.Add("- $item") }
$markdown | Set-Content -LiteralPath $markdownPath -Encoding utf8

Write-Host "Overall: $overallStatus"
Write-Host "Checks: $($summary.passed) PASS / $($summary.failed) FAIL / $($summary.blocked) BLOCKED"
Write-Host "JSON: $jsonPath"
Write-Host "Markdown: $markdownPath"

if ($overallStatus -eq 'FAIL') { exit 1 }
if ($overallStatus -eq 'BLOCKED') { exit 2 }
