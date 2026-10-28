-- CreateEnum
CREATE TYPE "StudentApplicationType" AS ENUM ('UNIVERSITY_ADMISSION', 'SCHOLARSHIP_ASSISTANCE');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('NEW', 'IN_REVIEW', 'RESOLVED', 'CLOSED');

-- CreateTable
CREATE TABLE "StudentApplication" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "applicationType" "StudentApplicationType" NOT NULL,
    "scholarshipId" UUID,
    "countryId" UUID,
    "universityId" UUID,
    "studyLevel" TEXT,
    "intendedMajor" TEXT,
    "fullName" TEXT NOT NULL,
    "email" CITEXT NOT NULL,
    "phone" TEXT,
    "message" TEXT NOT NULL,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'NEW',
    "internalNote" TEXT,
    "privacyAcceptedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "StudentApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeneralInquiry" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "fullName" TEXT NOT NULL,
    "email" CITEXT NOT NULL,
    "phone" TEXT,
    "subject" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'NEW',
    "internalNote" TEXT,
    "privacyAcceptedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "GeneralInquiry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicSubmissionRateLimit" (
    "scope" TEXT NOT NULL,
    "identifierHash" CHAR(64) NOT NULL,
    "windowStartedAt" TIMESTAMPTZ(3) NOT NULL,
    "count" INTEGER NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PublicSubmissionRateLimit_pkey" PRIMARY KEY ("scope", "identifierHash", "windowStartedAt")
);

-- CreateIndex
CREATE INDEX "StudentApplication_status_createdAt_id_idx" ON "StudentApplication"("status", "createdAt", "id");

-- CreateIndex
CREATE INDEX "StudentApplication_applicationType_status_createdAt_id_idx" ON "StudentApplication"("applicationType", "status", "createdAt", "id");

-- CreateIndex
CREATE INDEX "StudentApplication_scholarshipId_idx" ON "StudentApplication"("scholarshipId");

-- CreateIndex
CREATE INDEX "StudentApplication_countryId_idx" ON "StudentApplication"("countryId");

-- CreateIndex
CREATE INDEX "StudentApplication_universityId_idx" ON "StudentApplication"("universityId");

-- CreateIndex
CREATE INDEX "GeneralInquiry_status_createdAt_id_idx" ON "GeneralInquiry"("status", "createdAt", "id");

-- CreateIndex
CREATE INDEX "PublicSubmissionRateLimit_expiresAt_idx" ON "PublicSubmissionRateLimit"("expiresAt");

-- AddForeignKey
ALTER TABLE "StudentApplication" ADD CONSTRAINT "StudentApplication_scholarshipId_fkey" FOREIGN KEY ("scholarshipId") REFERENCES "Scholarship"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentApplication" ADD CONSTRAINT "StudentApplication_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentApplication" ADD CONSTRAINT "StudentApplication_universityId_fkey" FOREIGN KEY ("universityId") REFERENCES "University"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
