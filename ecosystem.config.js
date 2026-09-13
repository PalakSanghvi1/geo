/**
 * pm2 process definitions.
 *
 * geo-web    — Next.js on :3100, proxied by nginx at http://<vps-ip>/GEO
 * geo-worker — cron schedules, the run_requests poller, and the Slack Socket Mode bot
 *
 * Both processes open the same SQLite file; WAL mode (src/lib/db.ts) makes that safe.
 */
module.exports = {
  apps: [
    {
      name: 'geo-web',
      script: 'npm',
      args: 'start',
      env: { NODE_ENV: 'production', PORT: '3100' },
      autorestart: true,
      max_restarts: 20,
      time: true,
    },
    {
      name: 'geo-worker',
      script: 'npm',
      args: 'run worker',
      env: { NODE_ENV: 'production' },
      autorestart: true,
      max_restarts: 20,
      time: true,
    },
  ],
};
