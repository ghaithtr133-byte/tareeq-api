-- Additive authentication-security version. Existing accounts start at version 0,
-- allowing explicitly supported legacy access tokens until a security event occurs.
ALTER TABLE "AdminUser"
ADD COLUMN "authVersion" INTEGER NOT NULL DEFAULT 0;
