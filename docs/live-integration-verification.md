# Cloudinary and Resend live integration verification

This runbook prepares the first controlled provider checks after deployment. It does not authorize deployment, provider calls, scheduler activation, or production writes by itself.

## Read-only readiness gate

Run the local preflight first:

```powershell
npm run integrations:preflight
```

The command validates server-only configuration, reads active Admin and actionable email-outbox recipient counts, and inspects the disabled scheduler workflow. It does not upload, send, dispatch, or change database records. It never prints recipient addresses, credentials, authorization headers, or connection strings.

Before an approved email test, put the student test address and every currently active Admin recipient in an ephemeral shell-only allowlist, then rerun the preflight:

```powershell
$env:LIVE_INTEGRATION_APPROVED_RECIPIENTS = '<approved-student>,<approved-admin-1>,<approved-admin-2>'
npm run integrations:preflight
```

Do not commit the allowlist or add it to Vercel. A `PASS` recipient gate means every active Admin and every currently actionable `PENDING` or `PROCESSING` outbox recipient is approved. It does not call Resend.

## First Cloudinary test

Prerequisites:

1. Deploy the exact reviewed Backend build and confirm `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, and the intended `CLOUDINARY_FOLDER` are configured server-side.
2. Use a dedicated, disposable JPEG, PNG, or WebP under 100 KB. The file must be static, valid, and contain no personal information. Do not use SVG, GIF, animation, or a production content image.
3. Sign in through the deployed Admin Dashboard as an active `ADMIN` or `SUPER_ADMIN`. Use the real trusted Admin origin and the normal HttpOnly session cookie. Do not copy the cookie into logs or a shared Postman environment.
4. Submit one multipart `POST /api/v1/admin/uploads/images` request with `resource=articles` and the disposable file. Let the browser or client generate the multipart boundary.

Expected result:

- HTTP `201` with the standard success envelope.
- A non-empty `assetId` and server-generated `publicId` under the configured folder.
- An HTTPS `secureUrl`, matching `jpg`, `png`, or `webp` format, positive byte count, width, and height.
- Fetching `secureUrl` returns the expected image. Record the response metadata and `publicId`, but never credentials or cookies.
- Do not attach the URL to a Country, University, Scholarship, Service, Article, or gallery during this provider-only check.

The Backend intentionally has no Cloudinary deletion endpoint or media library. After verification, the Project Owner must use the Cloudinary Media Library to find the exact returned `publicId`, confirm it is the disposable unattached test asset, and delete only that asset. The agent must not access the Cloudinary console. If CDN caching delays disappearance, confirm deletion in the Media Library rather than deleting any similarly named asset.

Invalid-file, authentication, origin, RBAC, provider-failure, 4,000,000-byte file, and 4,100,000-byte multipart boundaries remain local mocked/regression checks; do not reproduce destructive or oversized cases against production.

## First Resend delivery test

Prerequisites:

1. Deploy the reviewed Backend with `RESEND_API_KEY`, a Resend-verified `RESEND_FROM_EMAIL`, optional approved reply-to, and `CRON_SECRET` configured server-side.
2. Explicitly approve one student-controlled inbox and every active `ADMIN` and `SUPER_ADMIN` inbox. Run the recipient-allowlist preflight above and require `PASS`.
3. Require zero unapproved actionable outbox recipients. Do not dispatch an existing queue merely to test the provider.
4. Keep GitHub Actions `EMAIL_DISPATCH_ENABLED` absent or not equal to `true`; the first test uses the submission request's best-effort dispatch and, only if needed, one separately approved protected dispatcher request.

Execution sequence after separate live-test authorization:

1. Submit one clearly test-labelled Student Application through `POST /api/v1/applications`, using the approved student inbox and no demo-seed submission or invented production relationship.
2. Submit one clearly test-labelled General Inquiry through `POST /api/v1/inquiries`, using the same approved student inbox.
3. HTTP `201` proves database acceptance only. Through an approved read-only database inspection, confirm each submission atomically created one student notification plus one notification for every active Admin selected at transaction time.
4. Confirm notification idempotency keys are unique and the same keys remain on retries. Confirm `SENT` records have a provider message ID. Never print recipients, message bodies, secrets, or authorization headers.
5. Confirm the student and approved Admin inboxes received the correct Arabic messages. Confirm Resend accepted/delivered status in the owner-managed Resend dashboard using the provider message IDs.
6. If notifications remain pending and their recipients still pass the allowlist gate, make one separately authorized request to `GET /internal/cron/email-notifications` with the matching bearer secret. Record only HTTP status and aggregate counts.

The Backend records synchronous Resend acceptance as `SENT`; it does not implement Resend delivery/bounce webhooks. Actual delivery must therefore be confirmed in approved inboxes and the owner-managed Resend dashboard. Production failure injection is not safe: transient retry, four-attempt bounding, leases, inactive-Admin skipping, and duplicate prevention must continue to be verified with mocks and the gated PostgreSQL integration suite.

Application, inquiry, rate-limit, and outbox test rows have no public deletion API. Use visibly test-labelled data, close the records through the normal Admin workflow after verification, and retain the notification history. Do not use the reversible demo-seed submissions for live email tests.

## Scheduler gate

`.github/workflows/email-notifications.yml` has only `workflow_dispatch` active. The intended ten-minute schedule remains commented. Even manual runs skip dispatch unless the repository variable `EMAIL_DISPATCH_ENABLED` equals exact lowercase `true`. An enabled run also fails closed unless the GitHub Actions `CRON_SECRET` matches the deployed Backend secret.

Do not enable the schedule or configure GitHub Secrets during a provider test. Scheduler activation is a separate owner operation after successful manual delivery verification.
