const { AppError } = require('../utils/AppError');
const { securityLog } = require('../utils/securityLog');

function authorizeRoles(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return next(new AppError('Please sign in to continue.', 401));
    }

    if (!roles.includes(req.user.role)) {
      securityLog('unauthorized_access', {
        userId: req.user._id,
        role: req.user.role,
        path: req.originalUrl,
        reason: 'role'
      });
      return next(new AppError('Access denied.', 403));
    }

    next();
  };
}

function requireAdmin(req, res, next) {
  if (!req.user) {
    return next(new AppError('Please sign in to continue.', 401));
  }

  if (req.user.role !== 'admin') {
    securityLog('unauthorized_access', {
      userId: req.user._id,
      role: req.user.role,
      path: req.originalUrl,
      reason: 'admin'
    });
    return next(new AppError('Access denied.', 403));
  }

  next();
}

module.exports = { authorizeRoles, requireAdmin };
