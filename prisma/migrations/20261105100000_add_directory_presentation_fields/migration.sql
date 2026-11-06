-- Additive presentation metadata only. Existing content remains unchanged.
ALTER TABLE "Country" ADD COLUMN "countryCode" VARCHAR(2);
ALTER TABLE "University" ADD COLUMN "logoUrl" TEXT;
ALTER TABLE "University" ADD COLUMN "logoAltAr" TEXT;
ALTER TABLE "University" ADD COLUMN "logoAltEn" TEXT;

CREATE UNIQUE INDEX "Country_countryCode_key" ON "Country"("countryCode");
ALTER TABLE "Country" ADD CONSTRAINT "Country_countryCode_uppercase"
  CHECK ("countryCode" IS NULL OR "countryCode" = UPPER("countryCode"));

ALTER TYPE "AuditResourceType" ADD VALUE 'MARKETING_PAGE_IMAGE';
CREATE TYPE "MarketingPageKey" AS ENUM ('HOME', 'DESTINATIONS');
CREATE TABLE "MarketingPageImage" (
  "id" UUID NOT NULL,
  "pageKey" "MarketingPageKey" NOT NULL,
  "heroImageUrl" TEXT,
  "heroImageAltAr" TEXT,
  "ctaImageUrl" TEXT,
  "ctaImageAltAr" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "MarketingPageImage_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MarketingPageImage_pageKey_key" ON "MarketingPageImage"("pageKey");
