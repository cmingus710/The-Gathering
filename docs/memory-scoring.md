# Scripture memory: scoring and the review schedule (Phase 9)

How practice is checked, what each result means, and how reviews are scheduled. Everything here runs in the database (`supabase/migrations/20261027000300_memory_practice.sql`), against the session the server created, so a device can't submit its own score, review step, or badge.

## What a practice records

Each completed activity stores separate facts (`memory.attempts`). They are never folded into one "mastery" score.

| Fact | Meaning |
| --- | --- |
| Completed | The member finished the activity. |
| Accuracy | 0–100%, for scored activities only (missing words, word order, type the verse). Read & repeat, flashcards, and self-check have none. |
| Hints | Counted on the server when shown (next word, a filled blank, a placed piece, opening words). Read & repeat "show every word" counts as a look. |
| Confidence | What the member reported: Not yet, Partly, Mostly, Word for word. Optional for scored activities; required for flashcards and self-check. |
| Result | Recalled, Partly recalled, Needs more practice, or Practiced (see below). |
| Review step | Before and after, and the next review date. |

## Comparing words

Text is split into words at spaces. A dash or hyphen joining two words (`world—that`, `one-and-only`) separates them for comparison, but the source's spacing and poetry line breaks are kept for display, so the scripture is never altered.

Every comparison:

- normalizes Unicode (NFC), so `é` typed as `e` + accent equals `é`;
- treats curly and straight apostrophes and quotation marks as the same, and every dash as a hyphen;
- compares words, never letters: a different, added, or missing word is never accepted.

Member-configurable (Practice settings, and per activity for typing):

| Setting | Default | Effect |
| --- | --- | --- |
| Ignore capital letters | On | `god` matches `God`. Uses Unicode case rules. |
| Ignore punctuation | On | Punctuation (including apostrophes) is ignored, so `dont` matches `don't`. Off: `didn't` must be typed with its apostrophe. |

**Contractions:** a contraction is one word. `do not` never matches `don't`, in either setting, because it changes the wording.

**Verse numbers and references (typing only):** numbers the member types that equal a verse number in the passage (and that the passage itself doesn't contain) are set aside, as is the reference typed at the start or end (book name + chapter:verse, for example `John 3:16–17`). The result says when this happened. Reference practice is separate: flashcards can show the verse and ask for the reference.

## Scoring by activity

| Activity | How it's scored |
| --- | --- |
| Read & repeat | Not scored. Records how far words were hidden and how often they were shown again. |
| Flashcards | Self-assessed after flipping. The hidden side is fetched only when flipped. |
| Missing words | Each blank compared with the hidden word (punctuation around a blank is shown, so it's never required; case follows settings). Accuracy = correct blanks ÷ blanks. |
| Word order | A position is right when the piece placed there reads the same as the piece that belongs there, so identical pieces (`the world` three times) are interchangeable. Every piece still has its own id. Accuracy = right positions ÷ pieces. |
| Type the verse | Word-by-word alignment (longest common subsequence). Accuracy = matched words ÷ (passage words + unmatched words typed). A changed word counts once as missing and once as extra. Feedback marks missing, extra, and changed words, and shows the member's own text unchanged. |
| Self-check | Self-assessed after revealing. Records only what the member reports and never claims to prove memorization. No microphone, recording, or voice scoring. |

### Difficulty

| | Missing words | Word order |
| --- | --- | --- |
| Guided | About 15% of words hidden; one choice per distinct word (a repeated word shows ×2, so no two choices are interchangeable) | Phrases of 4 words |
| Growing | About 30% hidden; choices plus up to 3 other words from the passage (never one that matches a blank) | Pairs |
| Challenge | About 45% hidden; typed answers | Single words |

Hidden words increase a little (5% per step, up to 20%) as a verse moves along the schedule. Blanks prefer words of three or more letters. At most 24 pieces and 12 blanks; longer parts use bigger pieces.

### Result

| Result | Scored activities | Self-assessed activities |
| --- | --- | --- |
| Recalled (strong) | 100%, no hints, and confidence (if given) Mostly or Word for word | Word for word, no hints |
| Partly recalled | 80% or more (hints allowed) | Mostly, or Word for word with hints |
| Needs more practice | Below 80% | Partly or Not yet |
| Practiced | Read & repeat | |

## Learning and recall activities

Recall activities move a verse along the schedule: type the verse, self-check, flashcards, and the Challenge versions of missing words and word order. Learning activities (read & repeat, choice-based missing words, phrase/pair word order) help members get to know a verse; a strong result moves a **new** verse to step 1 ("learning") and no further.

## The review schedule

Each verse (`memory.cards`) has a step from 0 to 7 and a next-review date in the member's own calendar.

| Step | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Next review after | today | 1 day | 2 days | 4 days | 7 days | 14 days | 30 days | 60 days |
| Stage | New | Learning | Learning | Reviewing | Reviewing | Reviewing | Well known | Well known |

After a recall activity:

| When | Recalled | Partly recalled | Needs more practice |
| --- | --- | --- | --- |
| Due (or overdue) | next step | same step, back in half the interval (at least 1 day) | back one step, tomorrow |
| Not yet due (early) | no change ("reviewed early") | no change | back one step, tomorrow |

- **One change per verse per day.** Later practice the same day is counted but doesn't move the schedule, so cramming can't jump a verse ahead.
- **Missed days never lower anything.** An overdue verse simply waits; recalling it advances it normally.
- **Review-ready** means a verse reached step 3 at least once (recalled on three separate review days). It stays earned after a hard day. Nothing is ever labelled permanently mastered; well-known verses still return every 30–60 days.
- **Pausing** stops reminders and changes nothing else.

### Time zones and daylight saving

"Today" is the date in the member's practice time zone (Practice settings; otherwise their notification time zone, otherwise the church's). Due dates are calendar dates and intervals are added in days, so a daylight-saving change can't move a review, and changing time zones only changes which date is "today". Assignment windows use the collection's time zone (the church's).

## Text versions

A memory passage is a captured version of one reference in one translation: exact text, the translation's text version, and a SHA-256 content hash. Practice is always scored against the version the member was practicing. When the source text changes (a reviewed re-import) or the church updates a collection verse, the member sees "This verse's text has been updated" and decides: switching starts a fresh card (practice of one wording isn't practice of another) while the earlier card and its history are kept as "earlier text". Translations are never switched silently.

## Submissions, retries, and devices

- A session is submitted once. A retry (for example after a lost response) returns the stored result and records nothing new; two devices submitting the same session at the same moment record one attempt (row lock).
- Sessions expire after a day (abandoned activities record nothing). A verse removed or replaced since the session started returns "conflict" and records nothing.
- Different sessions on different devices are separate practices; the schedule's one-change-per-day rule keeps them consistent.
- The page shows "Saved" only after the server confirms. Temporary failures retry with backoff (1, 2, 5, 10, 30 s), offline waits for the connection, and an expired sign-in keeps the answer on the page until the member signs in and retries. Nothing is stored in the browser.
- Rate limits: 200 starts, 300 hints, and 120 submissions per 10 minutes per member.

## Badges

Awarded only inside submission, once per member (and per collection for "Collection explored"), with `on conflict do nothing`, so retries can't duplicate them. Clients have no function that writes awards.

| Badge | When |
| --- | --- |
| First steps | First completed activity |
| Steady practice | 10 activities |
| Faithful practice | 50 activities |
| Coming back | Practice on 3 different days |
| Ten days of practice | Practice on 10 different days (not necessarily in a row) |
| Recited | A self-check "word for word", or a typed verse at 100% without hints |
| Taking root | A verse reaches review-ready |
| Hidden in my heart | Five verses review-ready |
| Explorer | All six activities tried |
| Collection explored | Every verse of a collection practiced at least once |

There are no streaks, speed badges, or rankings.
