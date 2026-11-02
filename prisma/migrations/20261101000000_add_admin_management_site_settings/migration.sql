-- AlterEnum
ALTER TYPE "AuditResourceType" ADD VALUE IF NOT EXISTS 'ADMIN_USER';
ALTER TYPE "AuditResourceType" ADD VALUE IF NOT EXISTS 'SITE_SETTINGS';

-- CreateTable
CREATE TABLE "SiteSettings" (
    "id" UUID NOT NULL,
    "academyNameAr" TEXT,
    "academyNameEn" TEXT,
    "contactEmail" CITEXT,
    "contactPhone" TEXT,
    "addressAr" TEXT,
    "addressEn" TEXT,
    "facebookUrl" TEXT,
    "instagramUrl" TEXT,
    "linkedinUrl" TEXT,
    "youtubeUrl" TEXT,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SiteSettings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SiteSettings_singleton_id_check" CHECK ("id" = '00000000-0000-4000-8000-000000000009'::uuid)
);
