const bcrypt = require('bcrypt');
const crypto = require('crypto');
const Otp = require('../models/Otp');
const PasswordReset = require('../models/PasswordReset');
const { AppError } = require('../utils/AppError');
const { sendOtpEmail } = require('./emailService');
const { isValidOtp, normalizeOtp } = require('../utils/validation');

const SALT_ROUNDS = 10;
const OTP_EXPIRY_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const OTP_MAX_SENDS_PER_HOUR = 8;
const HOUR_MS = 60 * 60 * 1000;
const RESET_TOKEN_EXPIRY_MS = 10 * 60 * 1000;

const PURPOSE_LOGIN = 'login';
const PURPOSE_RESET = 'reset';
const PURPOSE_VERIFY = 'verify';

function hashResetToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function saveOtpRecord(email, purpose, otpHash, now, sendCount, hourlyWindowStart) {
  const payload = {
    email,
    purpose,
    otpHash,
    expiresAt: new Date(now.getTime() + OTP_EXPIRY_MS),
    attempts: 0,
    lastSentAt: now,
    sendCount,
    hourlyWindowStart
  };

  try {
    const updated = await Otp.findOneAndUpdate(
      { email, purpose },
      { $set: payload },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    if (updated) {
      return updated;
    }
  } catch (err) {
    if (!err || err.code !== 11000) {
      throw err;
    }
  }

  const existing = await Otp.findOne({ email, purpose });
  if (existing) {
    existing.otpHash = otpHash;
    existing.expiresAt = payload.expiresAt;
    existing.attempts = 0;
    existing.lastSentAt = now;
    existing.sendCount = sendCount;
    existing.hourlyWindowStart = hourlyWindowStart;
    await existing.save();
    return existing;
  }

  return Otp.create(payload);
}

async function createAndSendOtp(email, purpose) {
  const existing = await Otp.findOne({ email, purpose });
  const now = new Date();

  if (existing && Date.now() - existing.lastSentAt.getTime() < OTP_RESEND_COOLDOWN_MS) {
    throw new AppError('Please wait before requesting another OTP.', 429);
  }

  let sendCount = 1;
  let hourlyWindowStart = now;
  if (existing && existing.hourlyWindowStart && Date.now() - existing.hourlyWindowStart.getTime() < HOUR_MS) {
    sendCount = (existing.sendCount || 0) + 1;
    hourlyWindowStart = existing.hourlyWindowStart;
    if (sendCount > OTP_MAX_SENDS_PER_HOUR) {
      throw new AppError('Too many attempts. Please try again later.', 429);
    }
  }

  const otp = String(crypto.randomInt(100000, 1000000));
  const otpHash = await bcrypt.hash(otp, SALT_ROUNDS);

  await saveOtpRecord(email, purpose, otpHash, now, sendCount, hourlyWindowStart);

  try {
    await sendOtpEmail(email, otp, purpose);
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }
    console.error('Unable to send OTP email.');
    throw new AppError('OTP could not be sent. Please try again.', 503);
  }
}

async function verifyOtpCode(email, otp, purpose) {
  const code = normalizeOtp(otp);
  if (!isValidOtp(code)) {
    throw new AppError('Invalid or expired OTP.', 400);
  }

  const record = await Otp.findOne({ email, purpose });
  if (!record) {
    throw new AppError('Invalid or expired OTP.', 400);
  }

  if (record.expiresAt.getTime() < Date.now()) {
    await Otp.deleteOne({ _id: record._id });
    throw new AppError('Invalid or expired OTP.', 400);
  }

  if (record.attempts >= OTP_MAX_ATTEMPTS) {
    await Otp.deleteOne({ _id: record._id });
    throw new AppError('Too many incorrect attempts. Please request a new OTP.', 429);
  }

  const matches = await bcrypt.compare(code, record.otpHash);
  if (!matches) {
    record.attempts += 1;
    await record.save();
    if (record.attempts >= OTP_MAX_ATTEMPTS) {
      await Otp.deleteOne({ _id: record._id });
      throw new AppError('Too many incorrect attempts. Please request a new OTP.', 429);
    }
    throw new AppError('Invalid or expired OTP.', 400);
  }

  return record;
}

async function consumeOtp(record) {
  if (record && record._id) {
    await Otp.deleteOne({ _id: record._id });
  }
}

async function invalidateOtps(email, purpose) {
  await Otp.deleteMany({ email, purpose });
}

async function createResetAuthorization(email) {
  await PasswordReset.deleteMany({ email, used: false });

  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashResetToken(token);
  const now = new Date();

  await PasswordReset.create({
    email,
    tokenHash,
    expiresAt: new Date(now.getTime() + RESET_TOKEN_EXPIRY_MS),
    used: false
  });

  return token;
}

async function consumeResetAuthorization(email, token) {
  if (!token || typeof token !== 'string') {
    throw new AppError('Unable to reset password. Please try again.', 400);
  }

  const tokenHash = hashResetToken(token);
  const record = await PasswordReset.findOne({ email, tokenHash, used: false });
  if (!record) {
    throw new AppError('Unable to reset password. Please try again.', 400);
  }

  if (record.expiresAt.getTime() < Date.now()) {
    await PasswordReset.deleteOne({ _id: record._id });
    throw new AppError('Unable to reset password. Please try again.', 400);
  }

  record.used = true;
  await record.save();
  await PasswordReset.deleteMany({ email, used: false });
  return record;
}

module.exports = {
  PURPOSE_LOGIN,
  PURPOSE_RESET,
  PURPOSE_VERIFY,
  SALT_ROUNDS,
  createAndSendOtp,
  verifyOtpCode,
  consumeOtp,
  invalidateOtps,
  createResetAuthorization,
  consumeResetAuthorization
};
