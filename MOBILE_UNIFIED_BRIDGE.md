# Mobile Unified Signal Bridge

This Vite project now offers `ws://<host>:5173/api/mobile-iex`, secured by an independent read-only `MOBILE_IEX_ACCESS_TOKEN` from local `.env`.

It shares existing Alpaca IEX relay signals; no second upstream trade feed connection is opened. Mobile sends an `Authorization: Bearer <token>` header and receives WebSocket frames `{type: 'snapshot' | 'signal' | 'update', data: {...}}`.

Use the companion `Crypto_Whale_Radar_Mobile_Unified_Signals_Patch.zip` in the existing Android project. See `README_SETUP.md` inside the mobile patch archive.

You must keep this PC server running and reachable by USB reverse or private Wi-Fi for mobile ETF alerts. This bridge is not an internet hosted notification service. Do not expose your development Vite server directly on the public Internet.

Your existing `.env` file was not included in this ZIP; retain it. Add `MOBILE_IEX_ACCESS_TOKEN` with a strong random value separate from all Alpaca keys.
