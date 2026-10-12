const rateLimit = require('express-rate-limit');

function tooMany() {
  return {
    message: 'Too many attempts. Please try again later.'
  };
}

function makeLimiter({ windowMs, limit }) {
  if (process.env.NODE_ENV === 'test') {
    return (req, res, next) => next();
  }
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    message: tooMany()
  });
}

const authLoginLimiter = makeLimiter({ windowMs: 15 * 60 * 1000, limit: 20 });
const authRegisterLimiter = makeLimiter({ windowMs: 60 * 60 * 1000, limit: 10 });
const otpRequestLimiter = makeLimiter({ windowMs: 15 * 60 * 1000, limit: 8 });
const otpVerifyLimiter = makeLimiter({ windowMs: 15 * 60 * 1000, limit: 15 });
const passwordResetLimiter = makeLimiter({ windowMs: 15 * 60 * 1000, limit: 8 });
const apiLimiter = makeLimiter({ windowMs: 15 * 60 * 1000, limit: 400 });
const adminLimiter = makeLimiter({ windowMs: 15 * 60 * 1000, limit: 400 });
const reportCreateLimiter = makeLimiter({ windowMs: 15 * 60 * 1000, limit: 20 });
const emailAlertLimiter = makeLimiter({ windowMs: 15 * 60 * 1000, limit: 5 });
const cctvUploadLimiter = makeLimiter({ windowMs: 15 * 60 * 1000, limit: 20 });
const aiProcessingLimiter = makeLimiter({ windowMs: 15 * 60 * 1000, limit: 12 });
const evidenceExtractionLimiter = makeLimiter({ windowMs: 15 * 60 * 1000, limit: 30 });

module.exports = {
  authLoginLimiter,
  authRegisterLimiter,
  otpRequestLimiter,
  otpVerifyLimiter,
  passwordResetLimiter,
  apiLimiter,
  adminLimiter,
  reportCreateLimiter,
  emailAlertLimiter,
  cctvUploadLimiter,
  aiProcessingLimiter,
  evidenceExtractionLimiter
};
