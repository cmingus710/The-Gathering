# Directory and privacy: administrator guide

A short guide for membership administrators. The technical design is in [architecture.md](architecture.md#member-directory-and-privacy-phase-2).

## Who appears in the directory

- Everyone **approved** appears automatically, unless they have hidden their listing.
- **Pending** and **suspended** accounts never appear. Suspending someone removes them from the directory immediately, and reinstating them brings them back with their previous choices.
- The directory is visible only to signed-in approved members. It is never public, and it can't be exported or bulk-downloaded.
- Only adult accounts exist. Children are not listed, and youth accounts are not enabled.

## What members share

| Detail | Default |
| --- | --- |
| Name and preferred name | Shown while listed |
| Photo | Shown (members can hide it; initials appear instead) |
| City and state | Shown, if the member enters them |
| Ministry interests, short bio | Shown |
| Household | Shown only when every adult involved shares it |
| Directory email, phone, street address, birthday | **Hidden until the member shares them** |

Members change these under **Profile → Directory privacy** and can check the result with **Preview my directory profile**. The sign-in email is never shown in the directory. The "directory email" is a separate, optional address, and changing it doesn't change how someone signs in.

## What administrators can do

From **Admin → Members** (requires the Membership administrator or Super administrator role):

- **Search and filter** by name or sign-in email, and by status (pending, approved, suspended, all).
- **See directory visibility:** an "In directory" or "Hidden from directory" badge for approved members. Hidden members still appear in the admin list.
- **Correct a profile** (open the member, then "Profile details"): names, phone, directory email, address, bio, birthday, or remove an inappropriate photo.
  - Make corrections only at the member's request or to fix a clear error.
  - Each save is written to the **Audit log** as "profile.admin_updated" with the changed field names and who made the change. Values are never recorded.
- **Privacy choices can't be changed by administrators.** If a member asks to be hidden, guide them to Profile → Directory privacy. If they can't do it themselves, contact the super administrator.
- Membership status and roles are still managed separately (Approve/Suspend and Roles). Members can't change their own status or roles, and the last active super administrator can't be removed.
- A super administrator's profile can be edited only by another super administrator.

**Content editors** have no access to member profiles or private details. **Admin → Ministry interests** manages the options members can choose: add, rename, reorder, and archive. Archiving hides an option from members without deleting anyone's earlier choice. Changes are audited.

## Households

- An adult creates a household and invites other adults they find in the directory. Each person joins only by accepting.
- Invitations:
  - appear only in the app; **no email is sent**;
  - expire after 14 days, can be withdrawn, and can be answered only once.
- Being in a household doesn't let anyone see another member's hidden details or sign in to their account, and it doesn't make anyone a guardian.
- Administrators don't create or change households.

## Photos

- Photos are stored privately, resized, and stripped of hidden data such as location.
- Removing or replacing a photo deletes the old one. A copy already open on someone's screen can keep displaying for **up to 5 minutes**, after which its link expires.

## Things to avoid

- Don't copy directory details into spreadsheets, emails, or bulk lists. The app deliberately has no export.
- Don't use real member information in tests, screenshots, or bug reports. Use synthetic `example.test` accounts.
