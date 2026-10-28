import { getEmailConfig } from '../config/env.js'
import { EmailDispatcher } from './dispatcher.js'
import { PrismaEmailNotificationRepository } from './prisma-repository.js'
import { createEmailProvider } from './provider.js'
import type { EmailDispatchTrigger } from './types.js'

let productionDispatcher: EmailDispatchTrigger | undefined

export const getProductionEmailDispatcher = () => {
  if (!productionDispatcher) {
    productionDispatcher = new EmailDispatcher(
      new PrismaEmailNotificationRepository(),
      createEmailProvider(getEmailConfig()),
    )
  }
  return productionDispatcher
}
