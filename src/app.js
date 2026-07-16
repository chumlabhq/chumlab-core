const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const passport = require('passport');

const errorHandler = require('./middleware/errorHandler');
const initPassport = require('./config/passport');

const authRoutes = require('./routes/auth.routes');
const paymentRoutes = require('./routes/payment.routes');
const feedbackRoutes = require('./routes/feedback.routes');
const playgroundRoutes = require('./routes/playground.routes');
const generationRoutes = require('./routes/generation.routes');
const chatRoutes = require('./routes/chat.routes');
const adminRoutes = require('./routes/admin.routes');

initPassport();

const app = express();

app.set('trust proxy', 1);

app.use(
  helmet({
    contentSecurityPolicy: false,
  })
);
app.use(
  cors({
    origin: process.env.CORS_ORIGIN === '*' ? true : (process.env.CORS_ORIGIN || '*').split(','),
    credentials: true,
  })
);
// Generation accepts larger payloads (Phase 8 adds image blocks); the global
// parser skips bodies this route-scoped one already handled.
app.use('/api/playground/generate', express.json({ limit: '10mb' }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(passport.initialize());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', apiLimiter);

app.use('/public', express.static(path.join(__dirname, '..', 'public')));

app.get('/', (_req, res) => {
  res.json({ name: 'chumlab-be', status: 'ok', time: new Date().toISOString() });
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.use('/api/auth', authRoutes);
app.use('/api', paymentRoutes);
app.use('/api/feedback', feedbackRoutes);
app.use('/api/playground', playgroundRoutes);
app.use('/api/generation', generationRoutes);
app.use('/api/chats', chatRoutes);
app.use('/api/admin', adminRoutes);

app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.originalUrl} not found` });
});

app.use(errorHandler);

module.exports = app;
