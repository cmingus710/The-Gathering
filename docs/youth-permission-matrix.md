# Youth & families: permission and consent matrix

Phase 10. Every rule is enforced in the database (SECURITY DEFINER functions that recheck the caller on each call; the `youth` schema is closed to clients). The interface only mirrors it. "Not found" is returned for anything a person may not see, including records that don't exist.

## By role

| | Verified guardian (per permission) | Independent youth | Youth leader (assigned group) | Family admin | Youth ministry admin | Forms admin | Event personnel | Consent reviewer | Safeguarding | Policy admin | Super admin | Household member / other adult |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| See a child's profile | their child | self | name + participation in their groups | ✓ | names (enrollment) | — | names (their event) | names (photo linking) | — | — | — | — |
| Date of birth (if collected) | with *update profile* | — | — | ✓ (view logged) | — | — | — | — | — | — | — | — |
| Request a guardianship | ✓ (any approved adult) | — | — | — (can't review own) | — | — | — | — | — | — | — | ✓ request only |
| Verify / pause / revoke guardianship, restrict child | — | — | — | ✓ (never own) | — | — | — | — | — | — | assign roles only | — |
| Update child profile | *update profile* | — | — | ✓ | — | — | — | — | — | — | — | — |
| Enroll / remove from group | remove only (*update profile*) | — | if *manage enrollment* | — | ✓ (`youth.enroll`) | — | — | — | — | — | — | — |
| Roster (names, participation) | — | — | their groups | — | ✓ | — | — | — | — | — | — | — |
| Register / cancel for events | *register* | self, if policy + event allow and no forms/details | — | — | — | — | — | — | — | — | — | — |
| Give / decline / withdraw permission forms | *permission forms* | — | — | — | — | — | — | — | — | — | — | — |
| Attendee list + consent status | — | — | their groups' events | — | ✓ | ✓ | their event | — | — | — | — | — |
| Event logistics (emergency, pickup, notes) | own child's entry (*register*) | — | only if designated | — | — | — | ✓ (logged) | — | — | — | — | — |
| Photo consent decisions | *photo consent* | — | — | — | — | — | — | — | — | — | — | — |
| Link photos to children; resolve consent reviews | — | — | — | — | — | — | — | ✓ | — | — | — | — |
| Announcements | read (*receive updates*) | read | publish if *can publish* | — | publish all (`youth.publish`) | — | — | — | — | — | — | — |
| Discussions (policy) | read if policy = read | read + reply | start, reply, hide, lock | — | — | — | — | — | — | — | — | — |
| Review reports | — | report | their groups, never about themselves | — | — | — | — | — | ✓ incl. about leaders outside their own groups | — | — | report if reader |
| Practice for a child (recorded on child) | *practice* | own practice | — | — | — | — | — | — | — | — | — | — |
| Progress summary | *view progress*; independent youth only if they share | own | — | — | — | — | — | — | — | — | — | — |
| Learn & Play: edit, preview, publish activities | — | — | — | — | — | — | — | — | — | — | — (needs the Youth activity editor role) | — |
| Learn & Play: play and save progress | for a child profile without its own account (*practice*), chosen explicitly | self | — | — | — | — | — | — | — | — | — | — |
| Learn & Play: progress | that child (*practice*); counts only with *view progress* | own | never | never | never | never | never | never | never | never | never | never |
| Journals, answers, reflections | never | own | never | never | never | never | never | never | never | never | never | never |
| Youth account invite | *manage account* (authorizes) | — | — | ✓ | — | — | — | — | — | — | — | — |
| Policy draft / approve | — | — | — | — | — | — | — | — | — | ✓ (second person approves) | — | — |
| Adult transition | — | confirms | — | start/complete (different person completes) | — | — | — | — | — | — | — | — |
| Finance, roles, membership, prayer/care confidential | unchanged by any youth role | never | never | never | never | never | never | never | never | never | super admin as before | — |

Guardian permissions are per child and per capability: *update profile, register, permission forms, photo consent, view progress, practice, manage account, receive updates*. All start off at verification; the family administrator chooses each.

## Messaging

No direct messages involve youth: community messaging requires approved adult accounts on both sides and an explicit eligibility record, and youth accounts are refused. The Youth area has no private messages, no one-person groups (discussions need three enrolled children and the policy's leader count), no replies by notification, and no profile message actions. Adult transition never grants messaging eligibility.

## Consent states

| Permission form state | Meaning | Registration |
| --- | --- | --- |
| Permission given | Latest decision is *granted* for the current version (or an earlier version followed only by non-material versions), by a guardian still verified with *permission forms* | Allowed |
| Needs a decision | No decision, or the deciding guardian is no longer verified/allowed | Refused |
| Needs renewed permission | A material version was published after the decision | Kept; organizers see it; guardians notified |
| Declined / Withdrawn | Latest decision declined, or withdrawn (record kept) | Upcoming places canceled, waitlist promoted |

| Photo consent state (member galleries, per event if set) | Meaning | Publication |
| --- | --- | --- |
| Allowed | Every verified guardian with *photo consent* who decided has allowed | Allowed |
| No decision yet | No current guardian decision | Blocked |
| Not allowed / Withdrawn | Declined, or withdrawn | Blocked; published photos hidden for review |
| Guardians disagree | Current guardians decided differently | Blocked; published photos hidden for review |

Public use is a separate scope, recorded only when the policy allows it; member-gallery consent never implies it.
