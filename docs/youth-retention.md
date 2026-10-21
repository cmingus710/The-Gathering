# Youth & families: retention, deletion, and adult transition

Phase 10. **Nothing is deleted automatically unless the approved church policy says so**, and no cleanup has been run against existing data. Destructive cleanup beyond what's listed here needs a reviewed policy and explicit authorization.

## Retention and deletion

| Record | Kept | Deleted when |
| --- | --- | --- |
| Child profile (`youth.children`) | While active; archived profiles are kept for history | Not automatically. Archiving ends enrollments and upcoming places. Permanent deletion is a manual, reviewed decision (deleting cascades to the child's guardianships, consents, logistics, practice, and history). |
| Date of birth (`youth.child_private`) | Only if the policy collects it | A guardian or family administrator clears it; it goes with the child profile |
| Guardian requests | Requester sees their last year | Not automatically; deleted with the requester's account |
| Guardianships and family history (`youth.family_log`, actions and states only) | Ended and revoked relationships are kept as history | A guardian's account deletion removes their guardianships (history rows remain without the person); child deletion removes everything |
| Permission-form consents | Every decision and withdrawal, with form version | With the child or the event series |
| Photo consents and reviews | Every decision and withdrawal | With the child; reviews with the photo |
| Event logistics | Until the event series is deleted, or `logistics_retention_days` after the event's last date when the policy sets it (deleted by the scheduler) | As stated; never copied elsewhere |
| Logistics / private-data / evidence access log | Who viewed and when (counts, no values) | Not automatically |
| Learning progress: child profile practice (`youth.practice_*`) | While the child profile exists | Moves to the youth's own account at activation; deleted with the child |
| Learning progress: independent youth | As Phase 8/9 (owner-only) | The youth deletes it (memory settings) or their account is deleted |
| Discussion posts | Author deletion erases text (placeholder kept) | With the discussion/group |
| Report evidence snapshots | Until resolved + 180 days | Cleared by the scheduler 180 days after resolution |
| Youth notifications | As other notifications (read ones after 180 days) | Unread ones are dropped as soon as they no longer apply |
| Practice sessions (temporary) | 2 days (open) / 30 days (submitted) | Scheduler |

**Account deletion:** a deleted youth account leaves the child profile guardian-managed (the account record is marked "account deleted"); the youth's own learning history goes with their account. A deleted guardian's relationships end; their consent decisions stop counting (photos are re-checked).

## Adult transition

Requires `adult_transition` in the approved policy. Never automatic on a date, and never self-service.

1. A family administrator starts it on the child's page after reassessing eligibility under the current policy and confirming the person's identity and account ownership (both checkboxes required).
2. The youth confirms from **Youth → My account** by typing "this is my account". The page explains what changes.
3. A **different** family administrator completes it by typing "complete transition".

Effects: the account becomes an adult account; guardian relationships end (guardians no longer see anything); youth group enrollments and upcoming youth event places end; progress sharing ends; personal learning history (memory, Bible reading, journal) stays with the person; directory listing stays off until they choose it; **direct messaging is not granted** (a membership administrator decides that separately); adult features then follow the normal rules. The child profile is marked "transitioned" and kept as history.

## Access changes take effect at once

Every read is rechecked, so these apply to pages, files, Realtime, and notifications immediately: guardian suspension or revocation, child restriction, youth account suspension, leader role removal or unassignment, leaving a group, consent withdrawal, policy changes (turning off independent accounts deactivates youth accounts until re-enabled). Queued email and push are rechecked when claimed; unread notices that no longer apply are deleted. Realtime is adult-only (the member channel requires an approved adult), so youth accounts receive no Realtime signals.
