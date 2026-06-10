// PM2 process manager configuration
// Usage:
//   pm2 start ecosystem.config.js        — start both apps
//   pm2 restart all                       — restart both
//   pm2 stop all                          — stop both
//   pm2 logs                              — tail all logs
//   pm2 logs karamooz-api                 — tail API logs only
//   pm2 logs karamooz-web                 — tail Web logs only
//   pm2 save                              — persist process list (survives reboot)
//   pm2 startup                           — generate auto-start command

module.exports = {
  apps: [
    {
      name: 'karamooz-api',
      script: 'dist/main.js',
      cwd: './apps/api',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
      },
      // Restart on crash, not on memory limit in production
      watch: false,
      max_memory_restart: '512M',
      // Logging
      out_file: './logs/api-out.log',
      error_file: './logs/api-error.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      // Graceful restart
      kill_timeout: 5000,
      wait_ready: true,
      listen_timeout: 10000,
    },
    {
      name: 'karamooz-web',
      script: 'node_modules/.bin/next',
      args: 'start -p 9100',
      cwd: './apps/web',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: '9100',
      },
      watch: false,
      max_memory_restart: '512M',
      out_file: './logs/web-out.log',
      error_file: './logs/web-error.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      kill_timeout: 5000,
    },
  ],
};
