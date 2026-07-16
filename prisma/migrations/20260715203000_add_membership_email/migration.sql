ALTER TABLE "shop_memberships" ADD COLUMN "user_email" TEXT;

UPDATE "shop_memberships" AS membership
SET "user_email" = lower(trim(invite."email"))
FROM "audit_logs" AS audit
JOIN "staff_invites" AS invite
  ON invite."id" = audit."entity_id"
 AND invite."shop_id" = audit."shop_id"
WHERE audit."action" = 'staff_invite_accepted'
  AND audit."entity_type" = 'staff_invite'
  AND audit."metadata"->>'membershipId' = membership."id"::text
  AND membership."shop_id" = audit."shop_id"
  AND membership."user_email" IS NULL;
