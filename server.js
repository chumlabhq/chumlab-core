require('dotenv').config();

const app = require('./src/app');
const connectDB = require('./src/config/db');

const PORT = process.env.PORT || 5000;

(async () => {
  try {
    await connectDB();
    const server = app.listen(PORT, () => {
      console.log(`[chumlab-be] listening on http://localhost:${PORT}`);
    });

    const shutdown = (signal) => {
      console.log(`\n[chumlab-be] received ${signal}, shutting down`);
      server.close(() => process.exit(0));
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  } catch (err) {
    console.error('[chumlab-be] failed to start:', err);
    process.exit(1);
  }
})();
