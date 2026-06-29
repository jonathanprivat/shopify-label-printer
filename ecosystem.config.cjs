// pm2 process config. Wraps the service in `caffeinate -i` so macOS idle-sleep
// never stalls printing, and keeps it alive on crash.
//   pm2 start ecosystem.config.cjs
//   pm2 save
//   pm2 startup launchd -u $USER --hp $HOME   (run the line it prints)
module.exports = {
  apps: [
    {
      name: 'label-printer',
      script: 'src/index.js',
      interpreter: 'caffeinate',
      interpreter_args: '-i node',
      autorestart: true,
      max_restarts: 20,
      restart_delay: 3000,
      time: true,
      env: { NODE_ENV: 'production' },
    },
  ],
};
