# Manual staff onboarding

Car Doc staff invitations currently use a manual onboarding flow. Automated invitation emails and self-service signup are intentionally deferred.

## Invite a staff member

1. Sign in as a shop owner or administrator.
2. Open **Settings → Staff**.
3. Enter the staff member's email address, choose a role, and create the invite. This creates a pending Car Doc invitation; it does not send an email or create an authentication account.
4. If the person does not already have a Car Doc login, an owner must create the user manually in the Supabase dashboard under **Authentication → Users**. Use exactly the same email address as the pending invite.
5. Give the user their login credentials through an appropriate secure channel.
6. The user signs in to Car Doc with the invited email address. Car Doc displays the pending shop invitation instead of the generic Access Pending page.
7. The user selects **Accept Invite**. Car Doc creates the shop membership and redirects the user to the dashboard.

If the signed-in email does not match a pending invite, the user remains on the Access Pending page. Owners and administrators can revoke pending invitations from **Settings → Staff**.
