const express = require('express');
const {
  register,
  login,
  requestOtp,
  verifyOtp,
  logout,
  me,
  forgotPassword,
  verifyResetOtp,
  resetPassword,
  requestVerificationOtp,
  verifyEmail,
  changePassword
} = require('../controllers/authController');
const { authenticate } = require('../middleware/authMiddleware');
const {
  authLoginLimiter,
  authRegisterLimiter,
  otpRequestLimiter,
  otpVerifyLimiter,
  passwordResetLimiter
} = require('../middleware/rateLimiters');

const router = express.Router();

router.post('/register', authRegisterLimiter, register);
router.post('/login', authLoginLimiter, login);
router.post('/request-otp', otpRequestLimiter, requestOtp);
router.post('/verify-otp', otpVerifyLimiter, verifyOtp);
router.post('/forgot-password', passwordResetLimiter, forgotPassword);
router.post('/verify-reset-otp', otpVerifyLimiter, verifyResetOtp);
router.post('/reset-password', passwordResetLimiter, resetPassword);
router.post('/request-verification-otp', otpRequestLimiter, requestVerificationOtp);
router.post('/verify-email', otpVerifyLimiter, verifyEmail);
router.post('/change-password', authenticate, changePassword);
router.post('/logout', logout);
router.get('/me', authenticate, me);

module.exports = router;
