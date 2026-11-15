UPDATE "Proposal" AS proposal
SET "rehearsal" = jsonb_set(
  proposal."rehearsal",
  '{requestedDeadline}',
  to_jsonb(to_char(request."deadline" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
)
FROM "PurchaseRequest" AS request
WHERE proposal."requestId" = request."id"
  AND proposal."connectedRehearsal"
  AND NOT (proposal."rehearsal" ? 'requestedDeadline');
