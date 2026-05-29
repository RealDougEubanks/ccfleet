// PM2 config — kept for developers who prefer PM2 for local development.
// Production deployments should use launchd (macOS) or systemd (Linux) instead.
// See scripts/install-launchd.sh and scripts/install-systemd.sh.
module.exports = {
  apps: [
    {
      name: 'ccfleet',
      script: 'server.js',
      autorestart: true,
      max_memory_restart: '256M',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
