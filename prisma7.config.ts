import 'dotenv/config'

import { defineConfig } from 'prisma/config'

const configuredDatabaseUrl =
  process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL
const isDatabaseCommand = process.argv.some((argument) =>
  ['migrate', 'db', 'studio'].includes(argument),
)

if (!configuredDatabaseUrl && isDatabaseCommand) {
  throw new Error(
    'DIRECT_DATABASE_URL or DATABASE_URL is required for database-changing Prisma commands.',
  )
}

const databaseUrl =
  configuredDatabaseUrl ??
  'postgresql://placeholder:placeholder@localhost:5432/tareeq'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: databaseUrl,
  },
})
