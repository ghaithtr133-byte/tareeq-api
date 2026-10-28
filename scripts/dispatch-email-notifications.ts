import 'dotenv/config'

import { disconnectPrisma } from '../src/database/client.js'
import { getProductionEmailDispatcher } from '../src/email/runtime.js'

const run = async () => {
  const result = await getProductionEmailDispatcher().dispatchPending(25)
  console.log(JSON.stringify(result))
  if (result.unavailable) process.exitCode = 2
}

try {
  await run()
} finally {
  await disconnectPrisma()
}
