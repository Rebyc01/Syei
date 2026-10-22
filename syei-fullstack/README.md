# SYEI — Full-stack website (clean hosting package v1.1.0)

SYEI combines visual discovery, an AI chat assistant, an authorized movie catalog (including Kannywood categories), public-archive search, and an AI code builder in one Node.js application.

## What works when configured

- **Accounts:** email/password registration and login, bcrypt password hashing, server-side sessions, SQLite session storage, rate limits.
- **Discovery:** live Wikimedia Commons image search with source links and displayed attribution/licence metadata.
- **AI assistant:** real OpenAI Responses API calls. The API key remains on the server.
- **Movies:** searchable catalog loaded from `data/movies.json`; you supply titles/URLs you have rights to distribute. Kannywood is supported as a category, not bundled with pirated titles.
- **Search:** live Internet Archive metadata search.
- **Downloads:** deliberately restricted server proxy for direct HTTPS files from Wikimedia Commons and Internet Archive; HTML item pages are not treated as direct downloads. Users remain responsible for checking rights.
- **AI code builder:** generates a code draft from a project prompt using OpenAI. It does not execute generated code.

## Requirements

- Node.js 22 LTS or newer
- npm
- An OpenAI API key for live AI features (usage is billed separately by OpenAI)
- Internet connection for Wikimedia Commons and Internet Archive searches

## Run locally

1. Extract the ZIP and open a terminal in the `syei-fullstack` folder.
2. Install dependencies:

   ```bash
   npm install
   ```

3. Copy `.env.example` to `.env`:

   **Windows PowerShell**
   ```powershell
   Copy-Item .env.example .env
   ```

   **macOS/Linux**
   ```bash
   cp .env.example .env
   ```

4. Edit `.env`. Set `OPENAI_API_KEY`, select an available model for your API account in `OPENAI_MODEL`, and replace `SESSION_SECRET` with a random secret of 32+ characters. Never put the API key in `public/` or commit `.env`.
5. Optional: copy `data/movies.example.json` to `data/movies.json` and replace the sample with licensed titles and official watch/download URLs. Keep `rights` populated with a licence or rights-holder reference.
6. Start the server:

   ```bash
   npm start
   ```

7. Visit `http://localhost:3000`. Register an account to use AI and personal saved items.

Use Node.js 22 LTS or newer. The built-in `node:sqlite` module is used when available; a small JSON fallback is included for accounts/saves.

## Movie catalog schema

`data/movies.json` is an array. Each entry supports:

```json
{
  "id": "unique-id",
  "title": "Film title",
  "category": "Kannywood",
  "year": 2025,
  "language": "Hausa",
  "poster": "https://example.com/poster.jpg",
  "description": "Short synopsis",
  "watchUrl": "https://rights-holder.example/watch",
  "downloadUrl": "",
  "rights": "Licence or rights-holder reference"
}
```

Only publish content you own or are licensed to stream/promote. The sample movie is a placeholder and will not play.

## Deploy to Railway (instead of Render)

This repository includes `railway.json` and `.nvmrc` for a Node.js 22 deployment.

1. Push the contents of this folder to the root of your GitHub repository.
2. In Railway, create a new project and choose deployment from your GitHub repository.
3. Confirm the start command is `npm start`. The project file already specifies it.
4. Add variables in Railway: `NODE_ENV=production`, `COOKIE_SECURE=true`, and `SESSION_SECRET` (a random secret at least 32 characters long). Add `OPENAI_API_KEY` and `OPENAI_MODEL` only if you want AI features.
5. Generate a public domain in Railway's networking settings.
6. For persistent accounts, saves, and sessions across redeploys, configure a persistent volume at the actual runtime `data` directory. Without persistent storage, local SQLite/session files may be lost on redeploy or restart.

Do not commit `.env`, API keys, database files, or movie catalogues containing content you do not have permission to distribute.

## External services and accounts

| Feature | Provider | Configuration |
|---|---|---|
| Real AI chat + code builder | OpenAI API | `OPENAI_API_KEY`, `OPENAI_MODEL`; API billing/limits apply |
| Image discovery | Wikimedia Commons API | No key required for this search path; respect file-level licences and attribution |
| Universal public-archive search | Internet Archive Advanced Search API | No key required for search; verify item rights individually |
| Kannywood and other movie playback | Your rights holder / licensed provider | Supply authorized URLs in `data/movies.json`; no catalogue is bundled |
| Production hosting | Your hosting provider | Node.js runtime, HTTPS, persistent disk or external DB/session store, environment secrets |

## Security and production notes

- Never expose OpenAI keys to browser JavaScript.
- Use HTTPS in production and set `COOKIE_SECURE=true`, `NODE_ENV=production`, and a strong `SESSION_SECRET`.
- Use persistent storage. The included SQLite files need a persistent disk; ephemeral serverless storage will lose them. For multi-instance deployment, replace SQLite sessions/database with managed Postgres/Redis or another shared store.
- Configure backups, monitoring, email verification, password reset, privacy policy, terms, and abuse/cost controls before a public launch.
- Rate limits are basic in-memory limits; use a shared rate-limit store for multi-instance hosting.
- This starter is not a third-party streaming subscription integration and cannot guarantee universal availability. It intentionally does not bypass DRM, access controls, paywalls, or source restrictions.
- Code generated by the AI builder is untrusted output. Review it before executing; do not run it on a production server.
- Do not commit `.env`, session databases, user data, or licensed catalogues to public repositories.

## Troubleshooting

- `AI is not configured yet`: add the API key to `.env` and restart.
- `model not found` or permission error: set `OPENAI_MODEL` to a model enabled for your OpenAI API account.
- Images/search fail: verify internet access and try a broader query.
- Database error: use Node.js 22+ and check that `data/` is writable.
