# Settings, appearance, phone navigation, notifications, and contact links (Phase 13)

## Settings

- **Desktop:** the account button at the bottom left of the sidebar (always visible; the menu above it scrolls on its own) opens Settings, Profile, Notification settings, Directory and privacy, Appearance (Light, Dark, System), and Sign out. Escape or a click outside closes it.
- **Phones and tablets:** the profile button in the top right opens **Settings**, and **More → Settings** does the same.
- **Settings page** (`/settings`): profile links; account and sign-in (sign-in email, membership, the sign-in methods linked to the account, change password, sign out); notification preferences and **this device's** push status (the same control as Notification settings); appearance; directory privacy and preview; **roles and access** (read-only).
- **Roles are read-only.** The page lists the member's roles and what they allow. Nobody can grant themselves a role; role changes stay in Administration → Members (`roles.manage`) and are enforced by `admin_grant_role` / `admin_revoke_role` in the database.

### Appearance

Reuses the existing theme system: the choice is saved per device in the `theme` cookie and rendered into `<html data-theme>` on the server, so the first paint is correct (no flash, no blocking script). **System** follows the device's light/dark setting through CSS, including when it changes while the app is open. Phase 13 fixed one gap: choosing System after load now restores the light/dark `theme-color` pair, so the browser bar follows the device too. Spotify and other embeds keep their own styling (they're third-party frames).

## Phone bottom navigation

The bar was already a full-width bar at `bottom: 0` with the safe-area inset as padding inside it (Phase 11). Phase 13 hardening, with no device-specific offsets:

- The bar's background continues below its bottom edge, so a pulled-past-the-end page (rubber-band) or the iOS 26.0 Safari bug that draws fixed elements a few pixels too high (WebKit 297779, fixed in iOS 26.1) can't show a gap of page content beneath the tabs.
- While a text field is focused on a touch device, the bar slides out of the way so it never covers the field or sits on the keyboard; it returns when the field loses focus.
- Unchanged: routes, labels, icons, active states, the More menu, content clearance (`--dock-clearance`), the mini-player offset, the desktop sidebar.

Safari's own toolbar sits outside the web page's viewport; the app can't paint or move it.

## Notification bell

The bell in the phone header opens a compact panel with the 8 most recent notifications: an abbreviated title, relative time, a clear unread marker (text for screen readers, a dot and bold text visually), the unread count, **Mark all as read**, and **View all notifications**.

- **Opening the panel marks nothing read.** A notification is marked read when it's opened, through `/notifications/open/<id>`, which rechecks access before redirecting (unchanged). Mark all as read affects only the signed-in member's notifications.
- **Glance-safe previews.** Prayer, care, messages, youth, and moderation notifications show a generic label in the panel ("Prayer update", "New message"…) because their titles can name a request, a child, or a report. The full page still shows them after the access recheck. No destination URL is sent to the panel. Giving never creates notifications.
- **Live:** while the panel is open, a Realtime signal or a changed unread count refetches the list in place.
- **States:** loading placeholders, an empty state, and an error with Try again.
- **Accessibility:** the trigger exposes `aria-expanded`; Space and Enter toggle it; Escape closes and returns focus; clicking outside closes; the panel stays within the screen on phones (16 px insets, scrolls internally) and is 24 rem wide from 640 px.
- Without JavaScript the bell is a plain link to the full Notifications page.

API: `GET /api/community/notifications/recent` (private, no-store; 401/403 when signed out or no longer approved), built on `community_notifications` (re-filtered by current access in the database).

## Clickable contact information

Wherever the viewer may already see a field:

| Field | Actions |
| --- | --- |
| Phone | The number links to `tel:`; separate **Call** and **Text** (`sms:`) buttons |
| Email | `mailto:` link and an **Email** button |
| Street address | **Map** and **Directions** (Google Maps URLs, `api=1`), and **Apple Maps** (`maps.apple.com`) |

- Values come only from the privacy-filtered directory query (`directory_member`), where hidden fields are `null`, so nothing hidden can reach an `href`, label, or the page source. Directory opt-out still hides the whole profile.
- The stored phone number is shown exactly as typed. Only the link is normalized: digits and a leading `+`, with the `(0)` trunk digit after a country code dropped (`+44 (0)20 …` dials `+4420…`), 7–15 digits.
- `mailto:` is built only for plain addresses (no `?`, `&`, `#`, `%`, quotes, or angle brackets).
- Map links are HTTPS, fully encoded, and open in a new tab. A website can't choose the phone's default navigation app, so Google and Apple options are both offered.
- Also: the church address on the welcome page has **Get directions**; phone numbers on Administration → Members are `tel:` links. Editing forms are unchanged and separate from these actions.
