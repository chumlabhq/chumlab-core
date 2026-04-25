/* PM2 process manifest. Used by:
 *   - the one-time setup-server.sh bootstrap, and
 *   - .github/workflows/deploy.yml on every push to main.
 *
 * Bump `instances` to "max" to use all CPU cores once the workload justifies
 * cluster mode. Note: at that point switch express-rate-limit to a shared
 * store (Redis) since each worker keeps its own counter in fork/cluster mode.
 */
module.exports = {
  apps: [
    {
      name: "chumlab-be",
      cwd: "/var/www/chumlab-be",
      script: "./server.js",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 10,
      max_memory_restart: "500M",
      env: {
        NODE_ENV: "production",
      },
      error_file: "./logs/err.log",
      out_file: "./logs/out.log",
      merge_logs: true,
      time: true,
    },
  ],
};
