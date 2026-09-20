# VT-Hacks-14-Submission

Dorm.io is a Virginia Tech student marketplace for exchanging textbooks, furniture, clothing, dorm essentials, and other items within the campus community.

## Frontend

The frontend is a responsive React application built with Vite. It provides marketplace browsing and search, listing creation, saved items, buyer/seller messaging, profile settings, and the campus wallet and checkout experience. See [frontend/README.md](frontend/README.md) for local setup, scripts, and the current integration scope.

### Accessibility

The frontend was designed with particular attention to people who are color blind or legally blind. Rather than separating accessibility into a special mode, Dorm.io integrates color-safe visuals, spoken descriptions, keyboard navigation, and assistive-technology context into the main experience:

- **Read aloud:** The browser's Web Speech API speaks accessible descriptions for page content, controls, listings, and images on pointer hover or keyboard focus.
- **Speech preferences:** Users can control focus narration, voice, and reading speed. Preferences persist on the device.
- **Keyboard support:** Native controls, a `Ctrl+K`/`Cmd+K` search shortcut, and managed dialog focus support keyboard navigation.
- **Screen-reader context:** Semantic labels, alternative text, ARIA state, and status or alert roles provide additional context.
- **Color palette:** The interface uses IBM's **Color Blind Safe** palette as its foundation, including `#785EF0` as the primary accent. This palette was chosen to keep important actions and states distinguishable for users with common color-vision deficiencies. Color is reinforced with text, icons, borders, and control state rather than serving as the only visual cue.
- **Visual preferences:** The interface includes light and dark themes, visible focus indicators, and reduced-motion support.

Together, the palette and non-color cues help color-blind users distinguish interface states, while read aloud, keyboard support, and semantic context help legally blind users navigate and understand the marketplace. Read aloud depends on browser speech-synthesis support and complements, rather than replaces, standard assistive technology.

## Backend

The JavaScript backend includes a Nessie API wrapper and marketplace payment helpers. See [backend/README.md](backend/README.md) for setup and usage.

## How the frontend and backend connect

The React app calls relative `/api` URLs through `frontend/src/api.js`. During
development, Vite proxies these requests to the Node server on port 3001.
The server wires the HTTP handler to the JSON app store, Nessie client,
marketplace settlement service, translation service, and currency service.

| Feature | Source of truth and connection |
| --- | --- |
| Identity and profile | An HttpOnly session cookie identifies an app user. The JSON store maps that user to a Nessie customer, account, and merchant. |
| Wallet and checkout | Nessie account and ledger reads determine the balance. Purchases debit the buyer and credit the seller; the JSON store retains order and retry records. |
| Published listings | The API persists listings and ownership in the JSON store; the frontend merges these with bundled demo listings. |
| Messaging | Server-backed conversations live in backend memory and stream over server-sent events. Translation failures fall back to the original message. |
| Display currency | The backend caches exchange rates; the frontend converts displayed values while accounting remains in USD. |
| Local demo state | Favorites, sample purchases, external-payment reservations, preferences, and profile photos use browser storage. |

Wallet calculations are shared between the API and marketplace service. A failed
ledger read fails the wallet request instead of silently displaying an incomplete
balance. Payment checks and writes run through one queue in the single Node
process, preventing concurrent duplicate deposits and sales. Results are saved
before refreshing the displayed wallet, so retrying after a refresh failure does
not charge again. Frontend retries retain their checkout IDs while the relevant
UI remains mounted; a full reload does not preserve those pending IDs.

### Regression checks

Run `npm test` in `backend`, then `npm test` and `npm run build` in `frontend`.
Backend tests cover sessions, ownership, persistence, payment concurrency,
insufficient funds, retry recovery, upload boundaries, chat, and localization.
The React/jsdom regression exercises browsing, profiles, storage, messaging,
reservations, deposits, server-backed checkout, and payment retries.
External services are mocked in these tests; they do not verify live credentials
or current provider availability.

### Remaining demo limitations

- Selecting a matching display name can open that customer's wallet. This is
  demo identity selection, not production authentication.
- The JSON store and payment queue assume a single backend process. They do not
  provide database transactions or atomic settlement with Nessie. A crash or
  ambiguous upstream write failure can still require reconciliation.
- Seller-credit failures are recorded for reconciliation; there is no automatic
  reconciliation worker. Chat clears on backend restart.
- External-payment reservations and sample purchases are local to the browser.
  Production hosting needs an `/api` reverse proxy; the Vite development proxy
  does not configure a deployed site.

### Brainstorming
College student focused marketplace where you can sell old books, furniture, clothes, etc.

Potential Features:
- Customer/Buyer chats (Chats auto translate if language barrier exists)
- Picking location (Start with dmv schools in mock)
- language switch for pages
- Auto detect local currency by preference
- Remove Student Seller Spotlight Section
- Remove Virginia Tech Specific references: Virginia Tech Student Marketplace (opening box and bottom description, right at Virginia Tech (opening box), Just Hokies exchanging goods (opening box), Built for Virginia Tech (under A Student-First Community). 

Branches correlate to different campuses
