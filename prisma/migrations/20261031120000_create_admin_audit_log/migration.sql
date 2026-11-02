-- CreateEnum
CREATE TYPE "AuditResourceType" AS ENUM (
    'COUNTRY',
    'UNIVERSITY',
    'SCHOLARSHIP',
    'SERVICE',
    'ARTICLE',
    'STUDENT_APPLICATION',
    'GENERAL_INQUIRY'
);

-- CreateTable
CREATE TABLE "AdminAuditLog" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "actorAdminId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "resourceType" "AuditResourceType" NOT NULL,
    "resourceId" UUID NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdminAuditLog_createdAt_id_idx" ON "AdminAuditLog"("createdAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "AdminAuditLog_actorAdminId_createdAt_id_idx" ON "AdminAuditLog"("actorAdminId", "createdAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "AdminAuditLog_action_createdAt_id_idx" ON "AdminAuditLog"("action", "createdAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "AdminAuditLog_resourceType_createdAt_id_idx" ON "AdminAuditLog"("resourceType", "createdAt" DESC, "id" DESC);

-- AddForeignKey
ALTER TABLE "AdminAuditLog" ADD CONSTRAINT "AdminAuditLog_actorAdminId_fkey" FOREIGN KEY ("actorAdminId") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
