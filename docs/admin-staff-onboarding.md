# Staff onboarding

Staff accounts are created through authorized PlumWorks invitations. Public Supabase Auth signup must be disabled. Do not create general-purpose accounts through a public registration form.

## Invite a staff member

1. Sign in as an OWNER or ADMIN with `manage_staff` permission.
2. Open **Admin → Staff**, enter the staff member's real email address, choose an allowed role, and send the invitation.
3. PlumWorks records the pending `StaffInvite` and its audit event, then asks Supabase Auth to send the invitation email. A successful API response confirms that Supabase accepted the request, not inbox delivery. If delivery cannot be confirmed, the pending invitation remains and the page reports an error; resolve email configuration/rate limits and submit the same email and role to retry.
4. The recipient follows the email link. Supabase Auth verifies the link and establishes a session through `/auth/callback`.
5. PlumWorks checks for a pending invitation matching the authenticated, confirmed Auth email. The recipient chooses a password; that password is sent directly to Supabase Auth and is not stored by PlumWorks.
6. After password setup, the recipient accepts the invitation. The server rechecks the invitation ID, pending status, confirmed email, email match, and existing membership protections before creating the `ShopMembership`, marking the invitation accepted, and writing the audit event.
7. The new member can then sign in using email and password. Authentication alone never grants shop access; a valid active membership is required.

OWNER/ADMIN permissions, current-shop scope, and OWNER role restrictions apply to creating and revoking invitations. Removing a membership blocks PlumWorks access but does not delete the Supabase Auth account.

### Retries and existing accounts

- Repeating the same pending email/role reuses the invitation ID without creating another invitation or creation audit event. Concurrent submissions preserve one pending record, but may request multiple emails; use the newest valid email link. Email delivery is not exactly-once.
- Supabase's invite endpoint reuses unconfirmed identities, including an identity left by a partially successful request. A delivery error never deletes or recreates the Auth user. Retry after correcting delivery errors or waiting for rate limits.
- For an already-confirmed Auth account, Supabase returns `email_exists`. PlumWorks keeps the pending shop invitation and explicitly reports that no invitation email was sent. Tell the recipient to sign in using their existing account (or use **Forgot password**), then complete `/invite`. This also supports removed former staff and recipients who confirmed their email but abandoned onboarding. No automatic password reset is sent.
- Change a pending invitation's role by revoking it and inviting again. Only OWNER can manage OWNER invitations. Reopening a revoked or accepted invitation issues a fresh acceptance ID; active shop members cannot be re-invited. The acceptance transaction independently checks membership by Auth UUID.

## Supabase configuration

- Disable public signup in Supabase Auth.
- Enable email confirmation and configure production SMTP.
- Set the exact Site URL and allow the production `/auth/callback` URL used by invitation and recovery emails. Add localhost or staging callback URLs only to the matching non-production project.
  Set `NEXT_PUBLIC_SITE_URL` to the PlumWorks application origin and allow these complete callback URLs (substitute that origin):
  - `https://<application-origin>/auth/callback?flow=invite&next=%2Finvite`
  - `https://<application-origin>/auth/callback?next=%2Fupdate-password`
- In the **Invite user** email template, link directly to the server callback with the invite token hash so the server can establish its cookie session. The template link should be:

  ```html
  <a href="{{ .RedirectTo }}&amp;token_hash={{ .TokenHash }}&amp;type=invite">Accept invitation</a>
  ```

  `RedirectTo` is the fixed `/auth/callback?flow=invite&next=%2Finvite` URL passed by PlumWorks. Keep the password recovery email template and its recovery callback behavior intact. Supabase documents that default email links can return a session in URL fragments, which servers cannot read, and supports server-side verification using `token_hash` and `type` ([email template guide](https://supabase.com/docs/guides/auth/auth-email-templates)).
- Configure `SUPABASE_SERVICE_ROLE_KEY` only as a server-side environment variable for the PlumWorks server. Never expose it to client code, logs, or public configuration.
  The existing variable name is retained. The installed Supabase SDK passes the key to the Auth API without assuming a JWT; a matching project server secret (`sb_secret_...`) can also be supplied in this server-only variable. Never place either privileged key in `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

## Password recovery

Users can select **Forgot password?** on the login page, submit their email, follow the recovery message, and choose a new password on `/update-password`. Responses do not reveal whether an account exists. Recovery and invitation callbacks share `/auth/callback`; the route accepts only the fixed internal destinations `/update-password` and `/invite`.

Invitations require `token_hash` with `type=invite`; invitation PKCE codes are not accepted. Recovery retains its PKCE code exchange and requires the SDK's recovery verifier context. Conflicting/duplicate callback parameters fail closed. `RedirectTo` already contains `?flow=invite&next=%2Finvite`, so the template's appended `&amp;token_hash` is intentional.

An existing owner's later controlled email change must update the same Supabase Auth UUID. Membership access resolves by UUID, so recreating the owner is neither required nor safe; denormalized membership email and historical audit labels are not identity authorities.
