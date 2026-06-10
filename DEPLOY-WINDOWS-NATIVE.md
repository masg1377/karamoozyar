# KarAmoozYar — Windows Server 2022 Native Deployment
## (No Docker — PostgreSQL + Redis + MinIO run as Windows services)

**VPS:** `185.255.88.13` · Windows Server 2022 (Build 20348)

---

## Port Map

| Service        | Port | Bound To    |
|---------------|------|-------------|
| Frontend (Web) | 9100 | 0.0.0.0 (public) |
| Backend (API)  | 9101 | 0.0.0.0 (public) |
| MinIO API      | 9000 | 0.0.0.0 (public — required for presigned URLs) |
| MinIO Console  | 9001 | 0.0.0.0 (public) |
| PostgreSQL     | 9432 | 127.0.0.1 (localhost only) |
| Redis          | 9379 | 127.0.0.1 (localhost only) |

---

## Step 1 — Install Chocolatey (Package Manager)

Open PowerShell **as Administrator**:

```powershell
Set-ExecutionPolicy Bypass -Scope Process -Force
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))

# Close and reopen PowerShell as Admin, then verify:
choco --version
```

---

## Step 2 — Install Node.js 20

```powershell
choco install nodejs-lts -y
# Close and reopen PowerShell as Admin
node --version    # must be v20.x or higher
npm --version
```

---

## Step 3 — Install pnpm + PM2 + pm2-windows-startup

```powershell
npm install -g pnpm@9
npm install -g pm2
npm install -g pm2-windows-startup

pnpm --version    # must be 9.x
pm2 --version
```

---

## Step 4 — Install NSSM (Windows Service Manager)

NSSM is used to run MinIO as a Windows service.

```powershell
choco install nssm -y
```

---

## Step 5 — Install PostgreSQL 16

```powershell
choco install postgresql16 --params '/Password:PG_SUPER_2024!Admin /Port:9432 /ServiceName:postgresql-16' -y

# Close and reopen PowerShell as Admin
# Add psql to PATH for this session
$env:PATH += ";C:\Program Files\PostgreSQL\16\bin"
```

Verify PostgreSQL is running:
```powershell
Get-Service postgresql-16
# Status must be: Running
```

Create the app user and database:
```powershell
# Connect as postgres superuser (password is PG_SUPER_2024!Admin set above)
$env:PGPASSWORD = "PG_SUPER_2024!Admin"

psql -U postgres -p 9432 -c "CREATE USER karamooz_user WITH PASSWORD 'uj2rhvOjsiP9iU8pBO2dynOA';"
psql -U postgres -p 9432 -c "CREATE DATABASE karamooziyar OWNER karamooz_user;"
psql -U postgres -p 9432 -c "GRANT ALL PRIVILEGES ON DATABASE karamooziyar TO karamooz_user;"

# Verify
psql -U postgres -p 9432 -c "\l"
# You should see karamooziyar in the list
```

Make `psql` permanently available in PATH:
```powershell
[System.Environment]::SetEnvironmentVariable(
  "PATH",
  $env:PATH + ";C:\Program Files\PostgreSQL\16\bin",
  [System.EnvironmentVariableTarget]::Machine
)
```

---

## Step 6 — Install Memurai (Redis for Windows)

Memurai is a Redis 7-compatible server that runs natively on Windows.

```powershell
choco install memurai-developer -y
```

After install, configure port and password. Find the config file:
```powershell
# Default config location:
notepad "C:\Program Files\Memurai\memurai.conf"
```

Find and change these lines in `memurai.conf`:
```
# Change port from 6379 to 9379
port 9379

# Add password (add this line if it doesn't exist, or uncomment requirepass)
requirepass ttrzodtqSheUuNc5kAc0IuEA

# Bind to localhost only
bind 127.0.0.1
```

Restart Memurai service:
```powershell
Restart-Service Memurai

# Verify it's running and accepting connections
redis-cli -p 9379 -a ttrzodtqSheUuNc5kAc0IuEA ping
# Expected output: PONG
```

> If `redis-cli` is not found, it's included with Memurai at:
> `C:\Program Files\Memurai\redis-cli.exe`
> Run it with full path or add `C:\Program Files\Memurai` to PATH.

---

## Step 7 — Install and Configure MinIO

```powershell
# Create directories
New-Item -ItemType Directory -Force -Path C:\minio\bin
New-Item -ItemType Directory -Force -Path C:\minio\data

# Download MinIO binary
Invoke-WebRequest -Uri "https://dl.min.io/server/minio/release/windows-amd64/minio.exe" -OutFile "C:\minio\bin\minio.exe"

# Verify download
C:\minio\bin\minio.exe --version
```

Register MinIO as a Windows service using NSSM:
```powershell
nssm install KarAmoozMinIO "C:\minio\bin\minio.exe"
nssm set KarAmoozMinIO AppParameters "server C:\minio\data --address :9000 --console-address :9001"
nssm set KarAmoozMinIO AppEnvironmentExtra "MINIO_ROOT_USER=karamooz_minio" "MINIO_ROOT_PASSWORD=cEubvkQ6wr5t0bN8NyiJkc8F"
nssm set KarAmoozMinIO DisplayName "KarAmoozYar MinIO"
nssm set KarAmoozMinIO Description "MinIO Object Storage for KarAmoozYar"
nssm set KarAmoozMinIO Start SERVICE_AUTO_START
nssm set KarAmoozMinIO AppStdout "C:\minio\minio-out.log"
nssm set KarAmoozMinIO AppStderr "C:\minio\minio-error.log"

# Start the service
nssm start KarAmoozMinIO

# Verify
Get-Service KarAmoozMinIO
# Status must be: Running
```

Verify MinIO is accessible:
```powershell
Invoke-WebRequest -Uri "http://localhost:9000/minio/health/live" -UseBasicParsing
# StatusCode must be: 200
```

---

## Step 8 — Copy Project to VPS

Via RDP copy-paste or SCP/WinSCP, copy the project to:
```
C:\Projects\KarAmoozYar
```

Or via Git:
```powershell
# Install git if needed
choco install git -y
# Close and reopen PowerShell

cd C:\Projects
git clone <your-repo-url> KarAmoozYar
```

> The env files (`.env`, `apps/api/.env`, `apps/web/.env.local`) already contain production values — do NOT overwrite them.

---

## Step 9 — Create Log Directories

```powershell
cd C:\Projects\KarAmoozYar
New-Item -ItemType Directory -Force -Path apps\api\logs
New-Item -ItemType Directory -Force -Path apps\web\logs
```

---

## Step 10 — Install Project Dependencies

```powershell
cd C:\Projects\KarAmoozYar
pnpm install
```

---

## Step 11 — Build Shared Package

```powershell
cd C:\Projects\KarAmoozYar
pnpm --filter @karamooziyar/shared build
```

---

## Step 12 — Run Prisma Generate

```powershell
cd C:\Projects\KarAmoozYar\apps\api
pnpm db:generate
```

---

## Step 13 — Run Prisma Migrate Deploy

```powershell
cd C:\Projects\KarAmoozYar\apps\api
pnpm db:migrate:prod
```

If this fails with a connection error, verify PostgreSQL is reachable:
```powershell
$env:PGPASSWORD = "uj2rhvOjsiP9iU8pBO2dynOA"
psql -U karamooz_user -p 9432 -d karamooziyar -c "SELECT 1;"
# Expected: ?column? = 1
```

---

## Step 14 — Run Database Seed

```powershell
cd C:\Projects\KarAmoozYar\apps\api
pnpm db:seed
```

> Run once only on first deployment.

---

## Step 15 — Build All Applications

```powershell
cd C:\Projects\KarAmoozYar
pnpm build
```

This runs `turbo run build` — builds shared → api → web in correct order.

---

## Step 16 — Start API and Web via PM2

```powershell
cd C:\Projects\KarAmoozYar
pm2 start ecosystem.config.js

# Check status
pm2 status
```

Expected:
```
┌─────────────────┬────┬─────────┬──────┐
│ name            │ id │ status  │ cpu  │
├─────────────────┼────┼─────────┼──────┤
│ karamooz-api    │ 0  │ online  │ ...  │
│ karamooz-web    │ 1  │ online  │ ...  │
└─────────────────┴────┴─────────┴──────┘
```

If a process shows `errored`, check logs immediately:
```powershell
pm2 logs karamooz-api --lines 50
pm2 logs karamooz-web --lines 50
```

---

## Step 17 — Configure Auto-Start on Reboot

```powershell
# Save current PM2 process list
pm2 save

# Register PM2 to start automatically with Windows
pm2-startup install

# Verify all 3 services (PG, Memurai, MinIO) are set to auto-start
Get-Service postgresql-16, Memurai, KarAmoozMinIO | Select Name, StartType
# StartType for all must be: Automatic
```

---

## Step 18 — Open Windows Firewall Ports

Run PowerShell **as Administrator**:

```powershell
New-NetFirewallRule -DisplayName "KarAmooz Web 9100"          -Direction Inbound -Protocol TCP -LocalPort 9100 -Action Allow
New-NetFirewallRule -DisplayName "KarAmooz API 9101"          -Direction Inbound -Protocol TCP -LocalPort 9101 -Action Allow
New-NetFirewallRule -DisplayName "KarAmooz MinIO 9000"        -Direction Inbound -Protocol TCP -LocalPort 9000 -Action Allow
New-NetFirewallRule -DisplayName "KarAmooz MinIO Console 9001" -Direction Inbound -Protocol TCP -LocalPort 9001 -Action Allow

# Confirm
Get-NetFirewallRule -DisplayName "KarAmooz*" | Format-Table DisplayName, Enabled, Direction, Action
```

> PostgreSQL (9432) and Redis (9379) are NOT opened — they are localhost-only.

---

## Step 19 — Test Everything

```powershell
# API health
Invoke-WebRequest -Uri "http://185.255.88.13:9101/api/v1/health" -UseBasicParsing

# Frontend
Invoke-WebRequest -Uri "http://185.255.88.13:9100" -UseBasicParsing

# MinIO health
Invoke-WebRequest -Uri "http://185.255.88.13:9000/minio/health/live" -UseBasicParsing
```

Open in browser:
- Frontend: `http://185.255.88.13:9100`
- MinIO Console: `http://185.255.88.13:9001` (login: `karamooz_minio` / `cEubvkQ6wr5t0bN8NyiJkc8F`)

---

## Viewing Logs

```powershell
# PM2 app logs
pm2 logs                          # all
pm2 logs karamooz-api             # API only
pm2 logs karamooz-web             # Web only
pm2 logs karamooz-api --lines 200 --err   # last 200 error lines

# MinIO logs
Get-Content C:\minio\minio-error.log -Tail 50
Get-Content C:\minio\minio-out.log -Tail 50

# PostgreSQL logs
Get-Content "C:\Program Files\PostgreSQL\16\data\log\*.log" -Tail 50

# Windows service events
Get-EventLog -LogName Application -Source *Memurai* -Newest 20
Get-EventLog -LogName Application -Source *MinIO* -Newest 20
```

---

## Restarting After VPS Reboot

PostgreSQL, Memurai, and MinIO are Windows services with `Automatic` start — they restart automatically.  
PM2 restarts automatically via `pm2-windows-startup`.

To manually restart everything:
```powershell
# Services (should already be running after reboot)
Start-Service postgresql-16
Start-Service Memurai
Start-Service KarAmoozMinIO

# Apps
cd C:\Projects\KarAmoozYar
pm2 resurrect       # restores saved process list
# or
pm2 restart all

pm2 status
```

---

## Updating the Project (Without Data Loss)

```powershell
cd C:\Projects\KarAmoozYar

# 1. Pull latest code
git pull origin main

# 2. Install new dependencies
pnpm install

# 3. Rebuild shared
pnpm --filter @karamooziyar/shared build

# 4. Apply new migrations (safe — never drops data)
cd apps\api
pnpm db:migrate:prod
cd ..\..

# 5. Rebuild apps
pnpm build

# 6. Restart apps only (services keep running)
pm2 restart karamooz-api
pm2 restart karamooz-web

pm2 status
```

> PostgreSQL, Memurai (Redis), and MinIO do NOT need to be restarted during app updates.

---

## Credentials Summary

| Service    | Value |
|-----------|-------|
| Postgres superuser password | `PG_SUPER_2024!Admin` |
| Postgres app user | `karamooz_user` |
| Postgres app password | `uj2rhvOjsiP9iU8pBO2dynOA` |
| Postgres DB | `karamooziyar` |
| Postgres port | `9432` |
| Redis password | `ttrzodtqSheUuNc5kAc0IuEA` |
| Redis port | `9379` |
| MinIO user | `karamooz_minio` |
| MinIO password | `cEubvkQ6wr5t0bN8NyiJkc8F` |
| MinIO API port | `9000` |
| MinIO Console port | `9001` |

---

## FAQ

**Q: MinIO files (images/audio/video) not loading — 403 or connection refused?**  
Port 9000 must be open in the Windows Firewall (Step 18). The browser fetches files directly from MinIO via presigned URLs that embed `185.255.88.13:9000`.

**Q: Prisma migrate fails — "password authentication failed"?**  
Run `psql -U karamooz_user -p 9432 -d karamooziyar -c "SELECT 1;"` and check the error. Make sure `apps/api/.env` `DATABASE_URL` has the correct password.

**Q: PM2 processes restart loop (errored → online → errored)?**  
Run `pm2 logs karamooz-api --lines 100` immediately after start to see the crash reason.

**Q: Socket.IO not connecting?**  
Frontend connects to `NEXT_PUBLIC_WS_URL=http://185.255.88.13:9101`. Port 9101 must be open in Windows Firewall.

**Q: Port already in use?**  
```powershell
netstat -ano | findstr ":9100 :9101 :9000 :9001 :9432 :9379"
# Find the PID and kill it:
taskkill /PID <pid> /F
```

**Q: How to connect to PostgreSQL with a GUI (pgAdmin)?**  
```powershell
choco install pgadmin4 -y
```
Connect to: `localhost:9432`, user: `postgres`, password: `PG_SUPER_2024!Admin`
