# Worlds of Others

Imported browser strategy game using React, TypeScript, Vite, and Zustand.
Keep the existing project structure and stack.

## Running on Replit

- Runtime: Node.js 22 (22.12 or newer is required by Vitest).
- Dependencies are managed with npm and `package-lock.json`.
- Use the **Start application** workflow or run `npm run dev`.
- Vite serves on `0.0.0.0:5000` and allows Replit's proxied preview hosts.
- No API keys, database, or external services are required. Game saves are stored in the browser's localStorage.
- The 3D globe requires a WebGL-capable browser.

## Checks

- `npm test`: simulation unit tests.
- `npm run build`: TypeScript checks and production bundle in `dist/`.
- `npm run lint`: Oxlint checks.
