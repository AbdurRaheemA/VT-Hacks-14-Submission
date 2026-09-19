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
