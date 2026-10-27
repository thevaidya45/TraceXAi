const bcrypt = require('bcrypt');
const mongoose = require('mongoose');
const User = require('../models/User');
const Community = require('../models/Community');
const { AppError } = require('../utils/AppError');
const { signAuthToken, setAuthCookie, clearAuthCookie } = require('../utils/token');
const otpService = require('../services/otpService');
const { securityLog } = require('../utils/securityLog');
const {
  ALLOWED_REGISTER_ROLES,
  isValidEmail,
  isValidPassword,
  isValidName,
  isValidOtp,
  normalizeEmail
} = require('../utils/validation');

const SALT_ROUNDS = otpService.SALT_ROUNDS;

function publicUser(user) {
  const community = user.communityId && user.communityId.name
    ? { id: user.communityId._id.toString(), name: user.communityId.name }
    : user.communityId
      ? { id: user.communityId.toString(), name: null }
      : null;

  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    role: user.role,
    community,
    authProvider: user.authProvider,
    status: user.status === 'inactive' ? 'inactive' : 'active',
    emailVerified: user.emailVerified !== false
  };
}

function issueSession(res, user) {
  const token = signAuthToken(user);
  setAuthCookie(res, token);
}

async function register(req, res, next) {
  try {
    const name = req.body.name;
    const email = normalizeEmail(req.body.email);
    const password = req.body.password;
    const role = String(req.body.role || '').trim().toLowerCase();
    const communityId = req.body.communityId;

    if (!isValidName(name)) {
      throw new AppError('Please enter a valid full name.', 400);
    }
    if (!isValidEmail(email)) {
      throw new AppError('Please enter a valid email address.', 400);
    }
    if (!isValidPassword(password)) {
      throw new AppError('Password must be at least 8 characters.', 400);
    }
    if (!ALLOWED_REGISTER_ROLES.includes(role)) {
      throw new AppError('Please select a valid role.', 400);
    }
    if (!communityId || !mongoose.Types.ObjectId.isValid(communityId)) {
      throw new AppError('Please select a valid community.', 400);
    }

    const community = await Community.findById(communityId);
    if (!community) {
      throw new AppError('Please select a valid community.', 400);
    }

    const existing = await User.findOne({ email });
    if (existing) {
      if (existing.emailVerified === false && existing.status !== 'inactive') {
        const message = await sendAccountOtp(email, otpService.PURPOSE_VERIFY);
        securityLog('otp_requested', { email, reason: 'verify' });
        res.status(200).json({
          message,
          email,
          verificationRequired: true
        });
        return;
      }
      if (existing.status === 'inactive') {
        throw new AppError('Your account is currently inactive. Please contact the administrator.', 403);
      }
      throw new AppError('An account with this email already exists.', 409);
    }

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
    const user = await User.create({
      name: name.trim(),
      email,
      password: hashedPassword,
      role,
      communityId: community._id,
      authProvider: 'local',
      status: 'active',
      emailVerified: false
    });

    await otpService.createAndSendOtp(email, otpService.PURPOSE_VERIFY);
    securityLog('register_success', { email, role, userId: user._id });

    res.status(201).json({
      message: 'Registration successful. Please verify your email.',
      email
    });
  } catch (err) {
    if (err && err.code === 11000) {
      return next(new AppError('An account with this email already exists.', 409));
    }
    next(err);
  }
}

async function login(req, res, next) {
  try {
    const email = normalizeEmail(req.body.email);
    const password = req.body.password;

    if (!isValidEmail(email) || !password) {
      throw new AppError('Invalid email or password.', 401);
    }

    const user = await User.findOne({ email }).select('+password').populate('communityId', 'name');
    if (!user || !user.password) {
      securityLog('login_failed', { email, reason: 'invalid_credentials' });
      throw new AppError('Invalid email or password.', 401);
    }

    const matches = await bcrypt.compare(password, user.password);
    if (!matches) {
      securityLog('login_failed', { email, reason: 'invalid_credentials' });
      throw new AppError('Invalid email or password.', 401);
    }

    if (user.status === 'inactive') {
      securityLog('login_failed', { email, reason: 'inactive' });
      throw new AppError('Your account is currently inactive. Please contact the administrator.', 403);
    }

    if (user.emailVerified === false) {
      securityLog('login_failed', { email, reason: 'unverified' });
      throw new AppError('Please verify your email before signing in.', 403);
    }

    issueSession(res, user);
    securityLog('login_success', { email, userId: user._id, role: user.role });
    res.json({
      message: 'Signed in successfully.',
      user: publicUser(user)
    });
  } catch (err) {
    next(err);
  }
}

function isOtpCooldown(err) {
  return Boolean(err && err.statusCode === 429 && /wait before requesting another OTP/i.test(String(err.message || '')));
}

async function sendAccountOtp(email, purpose) {
  try {
    await otpService.createAndSendOtp(email, purpose);
    return purpose === otpService.PURPOSE_VERIFY
      ? 'A verification code has been sent to your email.'
      : 'OTP sent successfully.';
  } catch (err) {
    if (purpose === otpService.PURPOSE_VERIFY && isOtpCooldown(err)) {
      return 'Enter the verification code already sent to your email.';
    }
    throw err;
  }
}

async function requestOtp(req, res, next) {
  try {
    const email = normalizeEmail(req.body.email);
    if (!isValidEmail(email)) {
      throw new AppError('Please enter a valid email address.', 400);
    }

    const user = await User.findOne({ email });
    if (!user) {
      throw new AppError('No account found with this email.', 404);
    }

    if (user.status === 'inactive') {
      throw new AppError('Your account is currently inactive. Please contact the administrator.', 403);
    }

    if (user.emailVerified === false) {
      const message = await sendAccountOtp(email, otpService.PURPOSE_VERIFY);
      securityLog('otp_requested', { email, reason: 'verify' });
      res.json({ message, verificationRequired: true });
      return;
    }

    const message = await sendAccountOtp(email, otpService.PURPOSE_LOGIN);
    securityLog('otp_requested', { email, reason: 'login' });

    res.json({ message });
  } catch (err) {
    next(err);
  }
}

async function verifyOtp(req, res, next) {
  try {
    const email = normalizeEmail(req.body.email);
    const otp = String(req.body.otp || '').trim();

    if (!isValidEmail(email)) {
      throw new AppError('Please enter a valid email address.', 400);
    }
    if (!isValidOtp(otp)) {
      throw new AppError('Invalid or expired OTP.', 400);
    }

    const record = await otpService.verifyOtpCode(email, otp, otpService.PURPOSE_LOGIN);

    const user = await User.findOne({ email }).select('-password').populate('communityId', 'name');
    if (!user) {
      await otpService.consumeOtp(record);
      throw new AppError('No account found with this email.', 404);
    }

    if (user.status === 'inactive') {
      throw new AppError('Your account is currently inactive. Please contact the administrator.', 403);
    }

    if (user.emailVerified === false) {
      throw new AppError('Please verify your email before signing in.', 403);
    }

    await otpService.consumeOtp(record);
    user.authProvider = 'otp';
    await user.save();

    issueSession(res, user);
    securityLog('login_success', { email, userId: user._id, role: user.role, reason: 'otp' });
    res.json({
      message: 'Signed in successfully.',
      user: publicUser(user)
    });
  } catch (err) {
    if (err && err.statusCode === 400) {
      securityLog('otp_verify_failed', { email: normalizeEmail(req.body && req.body.email) });
    }
    next(err);
  }
}

function logout(req, res) {
  clearAuthCookie(res);
  res.json({ message: 'Signed out successfully.' });
}

async function me(req, res, next) {
  try {
    res.json({ user: publicUser(req.user) });
  } catch (err) {
    next(err);
  }
}

async function forgotPassword(req, res, next) {
  try {
    const email = normalizeEmail(req.body.email);
    if (!isValidEmail(email)) {
      throw new AppError('Please enter a valid email address.', 400);
    }

    const user = await User.findOne({ email });
    if (user) {
      await otpService.createAndSendOtp(email, otpService.PURPOSE_RESET);
    }
    securityLog('password_reset_requested', { email });

    res.json({ message: 'OTP sent successfully.' });
  } catch (err) {
    next(err);
  }
}

async function verifyResetOtp(req, res, next) {
  try {
    const email = normalizeEmail(req.body.email);
    const otp = String(req.body.otp || '').trim();

    if (!isValidEmail(email)) {
      throw new AppError('Please enter a valid email address.', 400);
    }
    if (!isValidOtp(otp)) {
      throw new AppError('Invalid or expired OTP.', 400);
    }

    const user = await User.findOne({ email });
    if (!user) {
      throw new AppError('Invalid or expired OTP.', 400);
    }

    const record = await otpService.verifyOtpCode(email, otp, otpService.PURPOSE_RESET);
    await otpService.consumeOtp(record);

    const resetToken = await otpService.createResetAuthorization(email);

    res.json({
      message: 'OTP verified successfully.',
      resetToken
    });
  } catch (err) {
    next(err);
  }
}

async function resetPassword(req, res, next) {
  try {
    const email = normalizeEmail(req.body.email);
    const resetToken = req.body.resetToken;
    const newPassword = req.body.newPassword;

    if (!isValidEmail(email)) {
      throw new AppError('Please enter a valid email address.', 400);
    }
    if (!isValidPassword(newPassword)) {
      throw new AppError('Password does not meet the required requirements.', 400);
    }

    const user = await User.findOne({ email }).select('+password');
    if (!user) {
      throw new AppError('Unable to reset password. Please try again.', 400);
    }

    await otpService.consumeResetAuthorization(email, resetToken);
    await otpService.invalidateOtps(email, otpService.PURPOSE_RESET);

    user.password = await bcrypt.hash(newPassword, SALT_ROUNDS);
    user.authProvider = 'local';
    await user.save();

    securityLog('password_reset_success', { email, userId: user._id });

    res.json({ message: 'Password reset successfully. Please log in.' });
  } catch (err) {
    next(err);
  }
}

async function requestVerificationOtp(req, res, next) {
  try {
    const email = normalizeEmail(req.body.email);
    if (!isValidEmail(email)) {
      throw new AppError('Please enter a valid email address.', 400);
    }

    const user = await User.findOne({ email });
    if (!user || user.emailVerified !== false) {
      res.json({ message: 'If this email can be verified, an OTP has been sent.' });
      return;
    }

    if (user.status === 'inactive') {
      throw new AppError('Your account is currently inactive. Please contact the administrator.', 403);
    }

    await otpService.createAndSendOtp(email, otpService.PURPOSE_VERIFY);
    securityLog('otp_requested', { email, reason: 'verify' });
    res.json({ message: 'OTP sent successfully.' });
  } catch (err) {
    next(err);
  }
}

async function verifyEmail(req, res, next) {
  try {
    const email = normalizeEmail(req.body.email);
    const otp = String(req.body.otp || '').trim();

    if (!isValidEmail(email)) {
      throw new AppError('Please enter a valid email address.', 400);
    }
    if (!isValidOtp(otp)) {
      throw new AppError('Invalid or expired OTP.', 400);
    }

    const user = await User.findOne({ email }).populate('communityId', 'name');
    if (!user) {
      throw new AppError('Invalid or expired OTP.', 400);
    }

    const record = await otpService.verifyOtpCode(email, otp, otpService.PURPOSE_VERIFY);
    await otpService.consumeOtp(record);

    user.emailVerified = true;
    await user.save();

    issueSession(res, user);
    securityLog('email_verified', { email, userId: user._id });

    res.json({
      message: 'Email verified successfully.',
      user: publicUser(user)
    });
  } catch (err) {
    if (err && err.statusCode === 400) {
      securityLog('otp_verify_failed', { email: normalizeEmail(req.body && req.body.email), reason: 'verify' });
    }
    next(err);
  }
}

async function changePassword(req, res, next) {
  try {
    const currentPassword = req.body.currentPassword;
    const newPassword = req.body.newPassword;

    if (!currentPassword || !isValidPassword(newPassword)) {
      throw new AppError('Password does not meet the required requirements.', 400);
    }

    const user = await User.findById(req.user._id).select('+password');
    if (!user || !user.password) {
      throw new AppError('Unable to complete the request. Please try again.', 400);
    }

    const matches = await bcrypt.compare(currentPassword, user.password);
    if (!matches) {
      throw new AppError('Current password is incorrect.', 400);
    }

    user.password = await bcrypt.hash(newPassword, SALT_ROUNDS);
    user.authProvider = 'local';
    await user.save();

    securityLog('password_changed', { userId: user._id, email: user.email });
    res.json({ message: 'Password updated successfully.' });
  } catch (err) {
    next(err);
  }
}

module.exports = {
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
};
