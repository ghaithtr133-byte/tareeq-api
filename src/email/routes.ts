import { timingSafeEqual } from 'node:crypto'

import { Hono } from 'hono'

import type { AuthEnv } from '../auth/types.js'
import { errorResponse, successResponse } from '../shared/http.js'
import type { EmailDispatchTrigger } from './types.js'

const isAuthorizedCronRequest = (
  authorization: string | undefined,
  cronSecret: string | undefined,
) => {
  if (!authorization || !cronSecret) return false

  const actual = Buffer.from(authorization)
  const expected = Buffer.from(`Bearer ${cronSecret}`)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export const createEmailDispatchRoutes = (
  dispatcher: EmailDispatchTrigger,
  cronSecret: string | undefined,
) => {
  const routes = new Hono<AuthEnv>()

  routes.get('/internal/cron/email-notifications', async (c) => {
    c.header('Cache-Control', 'no-store')
    if (!isAuthorizedCronRequest(c.req.header('Authorization'), cronSecret)) {
      return errorResponse(
        c,
        401,
        'EMAIL_DISPATCH_UNAUTHORIZED',
        'Email dispatch authorization is required.',
      )
    }

    const summary = await dispatcher.dispatchPending(25)
    if (summary.unavailable) {
      return errorResponse(
        c,
        503,
        'EMAIL_PROVIDER_UNAVAILABLE',
        'Email delivery is not configured.',
      )
    }

    return c.json(successResponse(summary), 200)
  })

  return routes
}
