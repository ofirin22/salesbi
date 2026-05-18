# Sales Import Backend

Node.js/Express service that handles large CSV imports (70k+ rows) for the Base44 sales dashboard.

## Deploy to Railway

### 1. Push to GitHub
```bash
cd railway-backend
git init
git add .
git commit -m "Initial backend"
gh repo create sales-import-backend --private --push --source .
```

### 2. Deploy on Railway
1. Go to [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo**
2. Select your `sales-import-backend` repo
3. Click **Add Plugin → PostgreSQL** (Railway provisions `DATABASE_URL` automatically)
4. Go to **Variables** and add:

| Variable | Value |
|---|---|
| `IMPORT_API_SECRET` | Any strong random string |
| `BASE44_API_URL` | `https://api.base44.app/api/apps/YOUR_APP_ID` |
| `BASE44_SERVICE_TOKEN` | Your Base44 service token |

5. Railway redeploys automatically on every push.

### 3. Connect to Base44 Frontend
In your Base44 app settings → Environment Variables, add:

| Variable | Value |
|---|---|
| `VITE_IMPORT_API_URL` | Your Railway service URL (e.g. `https://xxx.railway.app`) |
| `VITE_IMPORT_API_SECRET` | Same secret as above |

## API Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | None | Health + DB status check |
| `POST` | `/import` | ✅ | Upload CSV file, returns `jobId` |
| `GET` | `/status/:jobId` | ✅ | Poll import progress |
| `GET` | `/jobs` | ✅ | List recent import jobs |

Auth: `x-import-secret: <IMPORT_API_SECRET>` header.

## Local Development
```bash
npm install
DATABASE_URL=postgres://... IMPORT_API_SECRET=secret BASE44_API_URL=... BASE44_SERVICE_TOKEN=... npm run dev
``