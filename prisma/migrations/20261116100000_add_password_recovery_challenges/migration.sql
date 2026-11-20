-- Additive password-recovery state. OTPs and reset authorizations are stored
-- only as keyed hashes; existing administrators and sessions are untouched.
CREATE TABLE "PasswordRecoveryChallenge" (
    "id" UUID NOT NULL,
    "adminUserId" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "otpHash" CHAR(64) NOT NULL,
    "resetAuthorizationHash" CHAR(64),
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "verifiedAt" TIMESTAMPTZ(3),
    "authorizationExpiresAt" TIMESTAMPTZ(3),
    "consumedAt" TIMESTAMPTZ(3),
    "invalidatedAt" TIMESTAMPTZ(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "PasswordRecoveryChallenge_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PasswordRecoveryRateLimit" (
    "scope" VARCHAR(64) NOT NULL,
    "identifierHash" CHAR(64) NOT NULL,
    "windowStartedAt" TIMESTAMPTZ(3) NOT NULL,
    "count" INTEGER NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "PasswordRecoveryRateLimit_pkey" PRIMARY KEY ("scope", "identifierHash", "windowStartedAt")
);

ALTER TABLE "PasswordRecoveryChallenge"
ADD CONSTRAINT "PasswordRecoveryChallenge_adminUserId_fkey"
FOREIGN KEY ("adminUserId") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "PasswordRecoveryChallenge_adminUserId_createdAt_id_idx"
ON "PasswordRecoveryChallenge"("adminUserId", "createdAt" DESC, "id");
CREATE INDEX "PasswordRecoveryChallenge_email_createdAt_id_idx"
ON "PasswordRecoveryChallenge"("email", "createdAt" DESC, "id");
CREATE INDEX "PasswordRecoveryChallenge_expiresAt_idx"
ON "PasswordRecoveryChallenge"("expiresAt");
CREATE INDEX "PasswordRecoveryChallenge_authorizationExpiresAt_idx"
ON "PasswordRecoveryChallenge"("authorizationExpiresAt");
CREATE INDEX "PasswordRecoveryRateLimit_expiresAt_idx"
ON "PasswordRecoveryRateLimit"("expiresAt");
