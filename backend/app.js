const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const authRoutes = require('./routes/authRoutes');
const communityRoutes = require('./routes/communityRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const adminUserRoutes = require('./routes/adminUserRoutes');
const adminReportRoutes = require('./routes/adminReportRoutes');
const reportRoutes = require('./routes/reportRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const sightingRoutes = require('./routes/sightingRoutes');
const adminSightingRoutes = require('./routes/adminSightingRoutes');
const adminInvestigationRoutes = require('./routes/adminInvestigationRoutes');
const { errorHandler } = require('./middleware/errorHandler');
const { AppError } = require('./utils/AppError');
const {
  apiLimiter,
  adminLimiter
} = require('./middleware/rateLimiters');

function createApp() {
  const app = express();
  const isProduction = process.env.NODE_ENV === 'production';
  const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

  if (isProduction) {
    app.set('trust proxy', 1);
  }

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' }
    })
  );
  app.use(
    cors({
      origin: clientOrigin,
      credentials: true
    })
  );
  app.use(express.json({ limit: '16kb' }));
  app.use(express.urlencoded({ extended: false, limit: '16kb' }));
  app.use(cookieParser());
  app.use('/api', apiLimiter);

  app.use('/api/auth', authRoutes);
  app.use('/api/communities', communityRoutes);
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/reports', reportRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/sightings', sightingRoutes);
  app.use('/api/admin', adminLimiter);
  app.use('/api/admin', adminUserRoutes);
  app.use('/api/admin', adminReportRoutes);
  app.use('/api/admin', adminSightingRoutes);
  app.use('/api/admin', adminInvestigationRoutes);

  app.use((req, res, next) => {
    next(new AppError('The requested resource was not found.', 404));
  });

  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
