# Loop — the campus marketplace

A responsive Vite + React marketplace for Virginia Tech students, with a warm orange and sage theme.

## Run locally

```sh
npm install
npm run dev
```

Open the local address printed by Vite (usually http://localhost:5173).

```sh
npm run build
npm run preview
npm test
```

## Features

- Search, category filters, condition and price filters, and sorting.
- Listing details, saved items, and photo uploads for new listings.
- Local seller conversations and pickup coordination.
- A demo wallet starting at $500, simulated purchases, and transaction history.
- Responsive navigation, keyboard-accessible dialogs, and reduced-motion support.
- Listings, saved items, messages, and purchases persist in this browser's local storage.

## Nessie integration boundary

This is a frontend demo. No real payments, identity verification, external messaging, or Nessie API calls are made. The demo models a customer wallet, sellers as merchants, and purchases as transactions. Checkout deducts demo funds and marks a listing sold locally.

For a live integration, route customer/account, merchant, and purchase operations through the backend. Keep the Nessie API key on the server. Replace the local purchase operation with an authenticated backend request, and make balance validation and purchase creation atomic on the server.

Images are illustrative Unsplash photos and fonts load from Google Fonts; both require an internet connection. New listing photos are stored locally. Clear the site's browser storage to reset demo data.
