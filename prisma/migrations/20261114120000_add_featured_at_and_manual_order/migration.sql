-- TA-80 expansion phase: feature activation chronology is distinct from content
-- creation/update time. Existing featured rows intentionally retain NULL featuredAt:
-- their historical activation time is unknown. Public featured ordering places those
-- deterministic legacy fallbacks after rows with a real activation timestamp, then by
-- createdAt DESC and id ASC.
ALTER TABLE "Country" ADD COLUMN "featuredAt" TIMESTAMPTZ(3);
ALTER TABLE "University" ADD COLUMN "featuredAt" TIMESTAMPTZ(3);
ALTER TABLE "Scholarship" ADD COLUMN "featuredAt" TIMESTAMPTZ(3);
ALTER TABLE "Service" ADD COLUMN "featuredAt" TIMESTAMPTZ(3);
ALTER TABLE "Article" ADD COLUMN "featuredAt" TIMESTAMPTZ(3);

-- Compatibility bridge: retain the physical displayOrder columns and their existing
-- indexes. New code maps its internal manualOrder field to that same storage, while
-- old instances can continue reading and writing displayOrder during a rolling deploy.
-- There is no data rewrite, column rename, or synchronization trigger in this phase.

CREATE INDEX "Country_status_featured_featuredAt_createdAt_id_idx"
  ON "Country"("status", "featured", "featuredAt" DESC NULLS LAST, "createdAt" DESC, "id");
CREATE INDEX "University_countryId_status_featured_featuredAt_createdAt_id_idx"
  ON "University"("countryId", "status", "featured", "featuredAt" DESC NULLS LAST, "createdAt" DESC, "id");
CREATE INDEX "Scholarship_countryId_status_featured_featuredAt_createdAt_id_idx"
  ON "Scholarship"("countryId", "status", "featured", "featuredAt" DESC NULLS LAST, "createdAt" DESC, "id");
CREATE INDEX "Service_status_featured_featuredAt_createdAt_id_idx"
  ON "Service"("status", "featured", "featuredAt" DESC NULLS LAST, "createdAt" DESC, "id");
CREATE INDEX "Article_status_featured_featuredAt_createdAt_id_idx"
  ON "Article"("status", "featured", "featuredAt" DESC NULLS LAST, "createdAt" DESC, "id");
