# FJ62 Garage

An installable web app (PWA) for tracking a 1988 Land Cruiser FJ62: service history, a maintenance schedule
that computes what is due by miles or months, watch items, mods with cost totals, specs and part numbers,
and invoice photos, all organized around a tappable 3D schematic truck.

**No truck data is stored in this repository.** The app starts empty; you import a private data file, and
everything (including photos) lives in the browser's IndexedDB on that device. Use More → Backup to export a
JSON file and import it on another device.

- `index.html`, `app.css`: page shell and styles
- `js/app.js`: UI, forms, backup/restore
- `js/logic.js`: zones and the due-date math
- `js/truck3d.js`: the three.js schematic truck (each part tagged with a system)
- `js/db.js`: IndexedDB storage
- `sw.js`: offline cache (bump `VERSION` when files change)
- `vendor/`: three.js r170 (MIT, see `vendor/THREE-LICENSE`)
- `js/ai.js`: AI invoice reading. Sends invoice photos from the browser to the Claude API (`claude-opus-5-5`, structured outputs) using the owner's own API key, which is stored only in IndexedDB on that device and never included in backups
- `vendor/anthropic-sdk.mjs`: the official `@anthropic-ai/sdk` 1.8.0 bundled for the browser with esbuild (MIT, see `vendor/ANTHROPIC-SDK-LICENSE`); loaded only when AI reading is used
