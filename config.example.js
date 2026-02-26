/**
 * Darkroom — API Key Configuration
 *
 * SETUP:
 *   1. Copy this file → config.js  (already in .gitignore — never committed)
 *   2. Get a Google Drive API key:
 *        https://console.cloud.google.com/
 *        → Create project → Enable "Google Drive API" → Credentials → API Key
 *   3. Restrict the key to your domain (HTTP referrers) for safety
 *   4. Paste it below
 *
 * ALTERNATIVELY: users can enter their API key in the Darkroom UI (⚙ Settings)
 * and it will be saved to localStorage — no file editing required.
 */
window.DARKROOM_CONFIG = {
  apiKey: 'YOUR_GOOGLE_DRIVE_API_KEY_HERE',
};
