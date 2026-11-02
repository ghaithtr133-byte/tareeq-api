-- CreateEnum
CREATE TYPE "AnalyticsEventType" AS ENUM (
    'PAGE_VIEW',
    'CTA_CLICK',
    'ENGAGEMENT',
    'APPLICATION_SUBMITTED',
    'INQUIRY_SUBMITTED'
);

-- CreateEnum
CREATE TYPE "AnalyticsCtaId" AS ENUM (
    'APPLY_NOW',
    'REQUEST_CONSULTATION',
    'CONTACT_US',
    'VIEW_UNIVERSITY',
    'VIEW_SCHOLARSHIP',
    'VIEW_SERVICE'
);

-- CreateEnum
CREATE TYPE "AnalyticsEngagementType" AS ENUM (
    'SCROLL_50',
    'SCROLL_90',
    'ACTIVE_30_SECONDS',
    'ACTIVE_60_SECONDS'
);

-- CreateTable
CREATE TABLE "AnalyticsEvent" (
    "id" UUID NOT NULL,
    "visitorId" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "type" "AnalyticsEventType" NOT NULL,
    "path" VARCHAR(500) NOT NULL,
    "targetPath" VARCHAR(500),
    "referrerHost" VARCHAR(253),
    "referrerPath" VARCHAR(500),
    "utmSource" VARCHAR(100),
    "utmMedium" VARCHAR(100),
    "utmCampaign" VARCHAR(100),
    "utmContent" VARCHAR(100),
    "utmTerm" VARCHAR(100),
    "ctaId" "AnalyticsCtaId",
    "engagementType" "AnalyticsEngagementType",
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AnalyticsEvent_shape_check" CHECK (
      ("type" = 'PAGE_VIEW' AND "ctaId" IS NULL AND "engagementType" IS NULL AND "targetPath" IS NULL) OR
      ("type" = 'CTA_CLICK' AND "ctaId" IS NOT NULL AND "engagementType" IS NULL) OR
      ("type" = 'ENGAGEMENT' AND "ctaId" IS NULL AND "engagementType" IS NOT NULL AND "targetPath" IS NULL) OR
      ("type" IN ('APPLICATION_SUBMITTED', 'INQUIRY_SUBMITTED') AND "ctaId" IS NULL AND "engagementType" IS NULL AND "targetPath" IS NULL)
    )
);

-- CreateIndex
CREATE INDEX "AnalyticsEvent_occurredAt_id_idx" ON "AnalyticsEvent"("occurredAt" DESC, "id" DESC);
CREATE INDEX "AnalyticsEvent_sessionId_occurredAt_id_idx" ON "AnalyticsEvent"("sessionId", "occurredAt", "id");
CREATE INDEX "AnalyticsEvent_type_occurredAt_idx" ON "AnalyticsEvent"("type", "occurredAt" DESC);
CREATE INDEX "AnalyticsEvent_path_occurredAt_idx" ON "AnalyticsEvent"("path", "occurredAt" DESC);
CREATE INDEX "AnalyticsEvent_utmSource_utmMedium_occurredAt_idx" ON "AnalyticsEvent"("utmSource", "utmMedium", "occurredAt" DESC);
