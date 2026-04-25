const mongoose = require('mongoose');

async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is not set');
  }

  mongoose.set('strictQuery', true);

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10000,
  });

  console.log(`[chumlab-be] mongo connected: ${mongoose.connection.host}/${mongoose.connection.name}`);

  mongoose.connection.on('error', (err) => {
    console.error('[chumlab-be] mongo error:', err.message);
  });

  mongoose.connection.on('disconnected', () => {
    console.warn('[chumlab-be] mongo disconnected');
  });
}

module.exports = connectDB;
