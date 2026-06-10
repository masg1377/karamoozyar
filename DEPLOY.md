# KarAmoozYar — Windows VPS Deployment Guide

**VPS IP:** `185.255.88.13`  
**Architecture:** PostgreSQL + Redis + MinIO run in Docker. API + Web run on the host via PM2.

---

## Port Map

| Service         | Host Port | Accessible From         |
|----------------|-----------|-------------------------|
| Frontend (Web)  | 9100      | Public (open in firewall) |
| Backend (API)   | 9101      | Public (open in firewall) |
| MinIO API       | 9000      | Public (open — needed for presigned URLs) |
| MinIO Console   | 9001      | Public (restrict if you want) |
| PostgreSQL      | 9432      | Localhost only (127.0.0.1) |
| Redis           | 9379      | Localhost only (127.0.0.1) |

**If you have a domain:** Replace all `185.255.88.13` references with your domain (e.g. `karamooz.example.ir`).  
URLs with IP only:
- Frontend → `http://185.255.88.13:9100`
- API → `http://185.255.88.13:9101/api/v1`
- MinIO Console → `http://185.255.88.13:9001`

Do **not** run a separate IIS or nginx site. Frontend and backend run on their own ports. No reverse proxy needed unless you want HTTPS later.

---

## Step 1 — Install Docker Desktop + WSL2

Open PowerShell **as Administrator** and run:

```powershell
# Check if Docker is already installed
docker --version
docker compose version
```

If not installed:
1. Download Docker Desktop from https://www.docker.com/products/docker-desktop/
2. During install, enable WSL2 backend (default option)
3. After install, open Docker Desktop, go to Settings → Resources → WSL Integration → enable your distro
4. Verify:
```powershell
docker --version
# Expected: Docker version 25+ 
docker compose version
# Expected: Docker Compose version v2+
```

---

## Step 2 — Install Node.js

```powershell
# Check if already installed
node --version
# Must be >= 20.x

npm --version
```

If not installed or version < 20:
1. Download Node.js 20 LTS from https://nodejs.org/en/download
2. Run installer, accept defaults
3. Verify:
```powershell
node --version   # v20.x.x or higher
npm --version
```

---

## Step 3 — Install pnpm

```powershell
# Check if already installed
pnpm --version
# Must be >= 9.x

# Install if missing
npm install -g pnpm@9

# Verify
pnpm --version
```

---

## Step 4 — Copy Project to VPS

If transferring via WinSCP / FileZilla / RDP copy-paste:
- Copy the entire project folder to `C:\Projects\KarAmoozYar` (or any path you prefer)

If using Git:
```powershell
cd C:\Projects
git clone <your-repo-url> KarAmoozYar
cd KarAmoozYar
```

> The env files (`.env`, `apps/api/.env`, `apps/web/.env.local`) are already filled in with production values in this repo. Do NOT overwrite them.

---

## Step 5 — Create Log Directories

```powershell
cd C:\Projects\KarAmoozYar
New-Item -ItemType Directory -Force -Path apps\api\logs
New-Item -ItemType Directory -Force -Path apps\web\logs
```

---

## Step 6 — Install pnpm Global Tools

```powershell
# Install PM2 globally (process manager)
npm install -g pm2

# Verify
pm2 --version
```

---

## Step 7 — Install Project Dependencies

```powershell
cd C:\Projects\KarAmoozYar
pnpm install
```

---

## Step 8 — Start Docker Containers (PostgreSQL, Redis, MinIO)

```powershell
cd C:\Projects\KarAmoozYar

# Start containers using the production compose file
# --env-file .env reads credentials from root .env
docker compose -f docker-compose.prod.yml --env-file .env up -d

# Check all containers are running
docker compose -f docker-compose.prod.yml ps
```

Expected output — all 4 containers should show `running`:
```
karamooziyar_postgres     running (healthy)
karamooziyar_redis        running (healthy)
karamooziyar_minio        running (healthy)
karamooziyar_minio_init   exited (0)      ← this is correct, it's a one-shot job
```

If a container shows `unhealthy`, check logs:
```powershell
docker logs karamooziyar_postgres
docker logs karamooziyar_redis
docker logs karamooziyar_minio
```

---

## Step 9 — Build Shared Package

```powershell
cd C:\Projects\KarAmoozYar
pnpm --filter @karamooziyar/shared build
```

---

## Step 10 — Run Prisma Generate

```powershell
cd C:\Projects\KarAmoozYar\apps\api
pnpm db:generate
```

---

## Step 11 — Run Prisma Migrate Deploy

```powershell
cd C:\Projects\KarAmoozYar\apps\api
pnpm db:migrate:prod
```

> `migrate:prod` runs `prisma migrate deploy` — applies existing migrations without resetting data. Never use `migrate dev` in production.

---

## Step 12 — Run Database Seed

```powershell
cd C:\Projects\KarAmoozYar\apps\api
pnpm db:seed
```

> Only run seed once on first deployment. Running it again may create duplicate data depending on your seed script.

---

## Step 13 — Build the Applications

```powershell
cd C:\Projects\KarAmoozYar

# Build shared + api + web
pnpm build
```

This runs `turbo run build` which builds in the correct dependency order.

---

## Step 14 — Start API and Web via PM2

```powershell
cd C:\Projects\KarAmoozYar

# Start both apps
pm2 start ecosystem.config.js

# Check status
pm2 status
```

Expected output:
```
┌─────────────────┬────┬─────────┬──────┬───────┐
│ name            │ id │ status  │ cpu  │ mem   │
├─────────────────┼────┼─────────┼──────┼───────┤
│ karamooz-api    │ 0  │ online  │ 0%   │ ...   │
│ karamooz-web    │ 1  │ online  │ 0%   │ ...   │
└─────────────────┴────┴─────────┴──────┴───────┘
```

---

## Step 15 — Configure PM2 Auto-Start on Reboot

```powershell
# Save current process list
pm2 save

# On Windows, PM2 startup works via a scheduled task
# Run this command and follow the output instructions:
pm2 startup
```

If `pm2 startup` doesn't work on Windows, use the alternative:
```powershell
# Install pm2-windows-startup
npm install -g pm2-windows-startup
pm2-startup install
pm2 save
```

Docker Desktop also needs to start on Windows boot:
- Open Docker Desktop → Settings → General → check "Start Docker Desktop when you log in"

---

## Step 16 — Open Windows Firewall Ports

Run PowerShell **as Administrator**:

```powershell
# Frontend
New-NetFirewallRule -DisplayName "KarAmooz Web 9100" -Direction Inbound -Protocol TCP -LocalPort 9100 -Action Allow

# Backend API
New-NetFirewallRule -DisplayName "KarAmooz API 9101" -Direction Inbound -Protocol TCP -LocalPort 9101 -Action Allow

# MinIO API (required for presigned URLs — browsers connect directly)
New-NetFirewallRule -DisplayName "KarAmooz MinIO 9000" -Direction Inbound -Protocol TCP -LocalPort 9000 -Action Allow

# MinIO Console (admin panel — restrict if not needed publicly)
New-NetFirewallRule -DisplayName "KarAmooz MinIO Console 9001" -Direction Inbound -Protocol TCP -LocalPort 9001 -Action Allow

# Confirm rules were created
Get-NetFirewallRule -DisplayName "KarAmooz*" | Format-Table DisplayName, Enabled, Direction, Action
```

---

## Step 17 — Test Health Endpoints

```powershell
# Test API health
Invoke-WebRequest -Uri "http://185.255.88.13:9101/api/v1/health" -UseBasicParsing

# Or with curl (if installed)
curl http://185.255.88.13:9101/api/v1/health

# Test frontend
Invoke-WebRequest -Uri "http://185.255.88.13:9100" -UseBasicParsing

# Test MinIO
Invoke-WebRequest -Uri "http://185.255.88.13:9000/minio/health/live" -UseBasicParsing
```

---

## Viewing Logs

```powershell
# All logs (tail)
pm2 logs

# API logs only
pm2 logs karamooz-api

# Web logs only
pm2 logs karamooz-web

# Last 200 lines of API errors
pm2 logs karamooz-api --lines 200 --err

# Docker container logs
docker logs karamooziyar_postgres --tail 50
docker logs karamooziyar_redis --tail 50
docker logs karamooziyar_minio --tail 50
```

---

## Restarting After VPS Reboot

Docker containers restart automatically (`restart: unless-stopped`).  
PM2 processes restart automatically if you ran `pm2 save` + `pm2 startup` / `pm2-windows-startup install`.

To manually restart everything:
```powershell
cd C:\Projects\KarAmoozYar

# Start Docker containers (if not auto-started)
docker compose -f docker-compose.prod.yml --env-file .env up -d

# Restart PM2 apps
pm2 restart all

# Check status
docker compose -f docker-compose.prod.yml ps
pm2 status
```

---

## Updating the Project (Without Deleting Database or Files)

```powershell
cd C:\Projects\KarAmoozYar

# 1. Pull latest code
git pull origin main

# 2. Install new dependencies (if any)
pnpm install

# 3. Rebuild shared package
pnpm --filter @karamooziyar/shared build

# 4. Apply new migrations (safe — never drops data)
cd apps\api
pnpm db:migrate:prod
cd ..\..

# 5. Rebuild apps
pnpm build

# 6. Restart apps (zero data loss — containers keep running)
pm2 restart karamooz-api
pm2 restart karamooz-web

# 7. Verify
pm2 status
```

> Docker containers (postgres, redis, minio) do NOT need to be restarted during an app update.  
> Data in Docker volumes (`postgres_data`, `redis_data`, `minio_data`) is persistent and survives restarts.

---

## Deleting and Recreating Containers (Nuclear Option — Data Lost)

Only do this if you need to reset everything from scratch:
```powershell
cd C:\Projects\KarAmoozYar
docker compose -f docker-compose.prod.yml down -v   # WARNING: -v deletes all data
docker compose -f docker-compose.prod.yml --env-file .env up -d
```

---

## FAQ

**Q: Do I need nginx or IIS?**  
No. Frontend runs on port 9100, API on 9101. Open those ports in the firewall and they are directly accessible. Add nginx only if you want HTTPS via Let's Encrypt later.

**Q: Why is MinIO port 9000 open to the internet?**  
Presigned URLs (for images, audio, video, files) embed `http://185.255.88.13:9000` in the URL. The browser fetches files directly from MinIO. If port 9000 is blocked, files will not load (401/timeout). This is by design.

**Q: Profile images return 401?**  
They should not — the `profiles/*` prefix has a public read bucket policy applied automatically on API startup. If they still 401, wait for the API to start fully and check API logs for `Public read policy applied`.

**Q: Socket.IO not connecting?**  
The frontend connects to `NEXT_PUBLIC_WS_URL=http://185.255.88.13:9101`. Make sure port 9101 is open in the firewall. Socket.IO uses the same port as the HTTP API.

**Q: How do I check which ports are in use on Windows?**  
```powershell
netstat -ano | findstr ":9100 :9101 :9000 :9001 :9432 :9379"
```

**Q: pnpm install fails with EACCES or permission errors?**  
Run PowerShell as Administrator.

**Q: Docker Desktop doesn't start on boot?**  
Open Docker Desktop → Settings → General → enable "Start Docker Desktop when you log in". Also ensure your Windows user account is set to auto-login or the startup task runs at login.
