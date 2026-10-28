-- CreateEnum
CREATE TYPE "EmailNotificationType" AS ENUM ('APPLICATION_ADMIN', 'APPLICATION_STUDENT', 'INQUIRY_ADMIN', 'INQUIRY_STUDENT');

-- CreateEnum
CREATE TYPE "EmailNotificationState" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "EmailNotification" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "type" "EmailNotificationType" NOT NULL,
    "state" "EmailNotificationState" NOT NULL DEFAULT 'PENDING',
    "applicationId" UUID,
    "inquiryId" UUID,
    "adminUserId" UUID,
    "recipient" CITEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "providerMessageId" TEXT,
    "lastErrorCode" TEXT,
    "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL,
    "retryUntil" TIMESTAMPTZ(3) NOT NULL,
    "leaseUntil" TIMESTAMPTZ(3),
    "sentAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "EmailNotification_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "EmailNotification_exactly_one_submission_check" CHECK (
      (("applicationId" IS NOT NULL)::integer + ("inquiryId" IS NOT NULL)::integer) = 1
    )
);

-- CreateIndex
CREATE UNIQUE INDEX "EmailNotification_idempotencyKey_key" ON "EmailNotification"("idempotencyKey");

-- CreateIndex
CREATE INDEX "EmailNotification_state_nextAttemptAt_retryUntil_idx" ON "EmailNotification"("state", "nextAttemptAt", "retryUntil");

-- CreateIndex
CREATE INDEX "EmailNotification_state_leaseUntil_idx" ON "EmailNotification"("state", "leaseUntil");

-- CreateIndex
CREATE INDEX "EmailNotification_applicationId_idx" ON "EmailNotification"("applicationId");

-- CreateIndex
CREATE INDEX "EmailNotification_inquiryId_idx" ON "EmailNotification"("inquiryId");

-- CreateIndex
CREATE INDEX "EmailNotification_adminUserId_idx" ON "EmailNotification"("adminUserId");

-- AddForeignKey
ALTER TABLE "EmailNotification" ADD CONSTRAINT "EmailNotification_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "StudentApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailNotification" ADD CONSTRAINT "EmailNotification_inquiryId_fkey" FOREIGN KEY ("inquiryId") REFERENCES "GeneralInquiry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailNotification" ADD CONSTRAINT "EmailNotification_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
