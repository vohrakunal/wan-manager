module.exports = {
  apps: [{
    name: 'nmt-panicle',
    script: 'index.js',
    cwd: '/home/devops/Dev/wan-manager/server',
    watch: false,
    instances: 1,
    exec_mode: 'fork',
    env: {
      PORT: 8080,
      HOST: '0.0.0.0',
      NODE_ENV: 'production',
    },
    time: true,
    restart_delay: 3000,
    max_restarts: 10,
  }]
};
