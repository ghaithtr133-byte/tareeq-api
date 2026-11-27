CREATE TABLE "GeminiSeoDailyQuota" (
  "day" DATE NOT NULL,
  "count" INTEGER NOT NULL,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GeminiSeoDailyQuota_pkey" PRIMARY KEY ("day")
);
