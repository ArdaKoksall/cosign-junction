BEGIN;

ALTER TABLE "Proposal"
ADD COLUMN "connectedRehearsal" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "rehearsal" JSONB,
ADD CONSTRAINT "Proposal_rehearsal_payload_check"
CHECK (
  ("connectedRehearsal" AND "rehearsal" IS NOT NULL AND jsonb_typeof("rehearsal") = 'object')
  OR (NOT "connectedRehearsal" AND "rehearsal" IS NULL)
);

CREATE UNIQUE INDEX "Proposal_requestId_connectedRehearsal_key"
ON "Proposal"("requestId", "connectedRehearsal");

DROP INDEX "Proposal_requestId_key";

COMMIT;
