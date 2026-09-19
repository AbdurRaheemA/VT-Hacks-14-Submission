# Dorm.io - Vite + React

Responsive React conversion of `Figma HTML/index.html`, its CSS, and all 17 supplied PNG assets. The original export is retained as a design reference. The app uses semantic components and responsive layouts in place of fixed absolute positioning and missing background images.

## Run

From the frontend folder:

```sh
npm install
npm run dev
```

Open the local URL Vite prints, usually http://localhost:5173. Stop existing dev servers before reinstalling dependencies on Windows.

```sh
npm test
npm run build
npm run preview
```

## Conversion map

- `src/components/Marketplace.jsx`: header, search, categories, hero, trust strip, product cards, trending grid, new-arrivals carousel, spotlights, app banner, footer.
- `src/assets/images/`: local listing, hero, profile, and promotional photos used throughout the app.
- `src/figmaAssets.js`: maps legacy design keys to local JPG assets that Vite fingerprints in production.
- `src/data.js`: 13 sample listings with the exported prices, seller names, campus labels, and images.
- `src/dorm.css`: responsive purple theme with Figtree and Outfit typography.
- `src/App.jsx`: navigation, filtering, favorites, photo uploads, messaging, wallet, checkout, and dialogs.
- `src/styles.css`: shared dialog, form, wallet, and messaging styles, themed by dorm.css.

Search supports Ctrl+K / Cmd+K. Post free items with a $0 price and browse them under Free Stuff. App-store and spotlight buttons open explanatory dialogs because those external products are not live.

Use the moon/sun button in the header to switch themes. Profile settings keep your photo visible and let you change your photo, name, year, bio, and preferred pickup spot. Profile edits apply when you save; theme changes apply immediately. Both persist on this device. Uploaded profile photos must be JPG, PNG, or WebP under 1 MB.

## Current integration scope

The frontend now creates or resumes a backend app-user session. Each app user is
mapped to one Nessie customer, checking account, and seller merchant. Profile
metadata, owned listings, orders, and payment idempotency records are persisted
by the backend. Wallet purchases of server-backed user listings settle from the
buyer's mapped account into the seller's mapped account.

Sample design listings, messages, favorites, payment preferences, transaction
presentation, and uploaded profile photos still use browser storage under
`dormio-v1-*`. Sample-listing checkout remains a local demo because those
fictional sellers do not have Nessie customers. Payments and student
verification are simulated. Mobile apps, spotlight sellers, and partnerships
are design concepts.

All images are bundled locally. Google Fonts requires internet, with system font fallbacks. No Figma plugin or account is required.

Dorm.io is exclusively for Virginia Tech. Campus labels are fixed to Virginia Tech, including previously saved listings and profiles. The sustainability spotlight is a demo concept.

## Campus wallet payment options

The wallet and checkout show Stripe, Venmo, PayPal, Cash App, cash at pickup, and the existing demo wallet. A preferred method and optional personal payment identifiers are stored locally. Saving an identifier does not link or verify a provider account.

Venmo, PayPal, Cash App, and cash create local pending reservations. No demo
balance is deducted, no external payment is initiated, and buyers can message
the seller or cancel the reservation from wallet activity. Demo-wallet
purchases of server-backed listings settle through Nessie; sample design
listings retain the local demo flow. Stripe is visible with a setup dialog but
checkout is disabled until a real integration exists.

For real marketplace payments, use server-side [Stripe Connect](https://docs.stripe.com/connect) seller onboarding and [Checkout](https://docs.stripe.com/payments/checkout/quickstarts), or the provider's own integration (for example [PayPal/Venmo](https://developer.paypal.com/venmo/)). Store provider credentials on the backend and confirm payment via verified webhooks before marking an order paid. This checkout has no payment-provider backend or configured credentials.
