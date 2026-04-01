module.exports = {
  apps: [{
    name: 'wan-manager',
    script: 'server/index.js',
    cwd: '/opt/wan-manager',
    watch: false,
    instances: 1,
    env: {
      PORT: 8080,
      HOST: '192.168.1.254',
      NODE_ENV: 'production',
    },
    error_file: '/var/log/wan-manager-error.log',
    out_file:   '/var/log/wan-manager-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    restart_delay: 3000,
    max_restarts: 10,
  }]
};
