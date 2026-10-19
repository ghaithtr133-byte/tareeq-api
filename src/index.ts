import type { Hono } from 'hono'

import { app } from './app.js'
import type { AuthEnv } from './auth/types.js'

// Vercel detects Hono applications from a direct `hono` import in this entrypoint.
// OpenAPIHono extends Hono, so this preserves the single application instance.
const vercelApp: Hono<AuthEnv> = app

export default vercelApp
