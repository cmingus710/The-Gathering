# Giving: finance administration guide

For finance administrators. Setup and Stripe configuration are in [giving-setup.md](giving-setup.md).

> **Test mode.** In this phase every payment is a Stripe test payment, and pages show a "Test mode" badge. No real money moves.

## Who can do what

| Capability | Finance administrator | Finance viewer |
| --- | --- | --- |
| `finance.view`: contributions, totals, recurring gifts, statements | ✓ | ✓ |
| `finance.record`: record, correct, and reverse cash and check gifts; link donors | ✓ | |
| `finance.export`: CSV export | ✓ | |
| `finance.manage`: funds, giving settings, reconciliation, email retries | ✓ | |
| `finance.refund`: refunds | ✓ | |

- **Finance access must be assigned explicitly** in Admin → Members → (member) → Roles. Super administrators don't get finance access automatically. They can assign a finance role, including to themselves, and every grant and removal is in the audit log.
- **Removal is immediate.** Removing the role or suspending the member ends finance access on the next request.
- **Other roles never see contribution data:** membership administrators, content editors, group leaders, and members.

## Totals

Admin → Giving shows, for the chosen dates (church time zone):

- **Gross received:** gifts with confirmed payment, plus cash and check gifts. Pending, failed, canceled, and reversed entries are excluded.
- **Refunded / lost to disputes:** refunds and lost disputes completed in the period.
- **Processing fees:** the actual fees Stripe reported. A gift whose fee Stripe hasn't reported yet shows **Pending**. Fees are never estimated, and cash and check gifts have none.
- **Net proceeds:** gross minus fees, refunds, and lost disputes.
- **Net proceeds are not bank deposits.** Stripe pays out on its own schedule and combines days. Payouts and transfers are not gifts and aren't recorded. Use Stripe's Payouts report for bank reconciliation.

## Cash and check gifts

- **Recording:** Admin → Giving → Record cash/check. Enter the donor (a member account, a name, or leave unidentified), date received, amount, fund, method, an optional check number, and an optional internal note.
  - Never enter bank account or routing numbers, and don't upload check images.
  - Submitting the same form twice records the gift once.
- **Corrections:** open the gift and use **Correct this entry**. The original is kept, marked reversed with your reason, and linked to the corrected entry. **Reverse** (for a returned check or an entry made in error) keeps the entry in history but stops counting it.
- **Member history:** a cash or check gift appears in a member's giving history only after it is linked to their account.

## Online gifts

- A gift is recorded only when Stripe confirms payment, never because someone reached the thank-you page. Delayed payment methods show **Pending** until confirmed.
- **Refunds** (`finance.refund`):
  - Open the gift, enter the amount (full or partial), and confirm.
  - The refund goes back to the donor's original payment method and they're emailed.
  - Stripe's processing fee isn't returned.
  - Refunds made directly in the Stripe Dashboard are picked up automatically.
- **Disputes** (chargebacks) appear on the gift. A lost dispute is subtracted from totals and shown as an adjustment on the donor's statement.
- **Recurring gifts:** Admin → Giving → Recurring lists each commitment.
  - Donors change the amount, update the card, or cancel from their own giving page. Changes affect future gifts only.
  - Pause and resume aren't offered.

## Guest gifts

- Guests don't need an account. Their acknowledgment email includes a **gift reference**.
- A guest gift is never attached to an account just because the email matches. A member can add it from Your giving → "Add a gift you made as a guest" by entering the reference. It works only if the gift was made with their own sign-in email.
- Finance can also link a guest gift to a member after confirming who gave it; this is audited.

## Emails

Acknowledgments, failed recurring payment notices, cancellation confirmations, and refund notices are sent through Resend from the Gathering sender.

- Each is sent at most once per gift or event.
- Reconcile & email lists any that failed, with a **Retry** button.
- In test mode, emails are marked [TEST] and only go to the allow-listed test addresses; others are shown as "suppressed".
- The acknowledgment wording comes from Admin → Giving → Settings. Don't add tax-deductibility language unless the church has approved it.

## Annual statements

- **Finance can generate a PDF** for any member and year (Admin → Giving → Statements). It covers:
  - only gifts received in that calendar year (church time zone);
  - refunds and lost disputes as adjustments, and totals.
- **Statements are drafts until approved.** Until the legal organization name, address, tax ID, and approved acknowledgment wording are entered and marked approved in Settings:
  - statements are watermarked DRAFT;
  - members can't download them.
- **No bulk emailing:** statements are never emailed in bulk.

## Exports and reconciliation

- **Export:** Contributions → Export CSV exports the current filters. Spreadsheet formulas are neutralized. Exports are audited, but the audit records only the row count.
- **Reconciliation:** if Stripe and the app ever disagree (for example after a webhook outage), run Reconcile & email for the affected dates. It only adds what's missing and updates what changed; it never creates duplicates.

## Audit

Finance actions are in Admin → Audit log:
- manual gifts recorded, corrected, and reversed;
- donor links, refunds requested, and exports;
- fund and setting changes, and email retries.

Each entry records the action, the actor, and the record id. Amounts, names, emails, and notes are never recorded.
