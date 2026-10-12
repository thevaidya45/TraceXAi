const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OTP_REGEX = /^\d{6}$/;
const ALLOWED_REGISTER_ROLES = ['student', 'employee'];

function isValidEmail(email) {
  return typeof email === 'string' && EMAIL_REGEX.test(email.trim().toLowerCase());
}

function isValidPassword(password) {
  return typeof password === 'string' && password.length >= 8 && password.length <= 128;
}

function isValidName(name) {
  return typeof name === 'string' && name.trim().length >= 2 && name.trim().length <= 80;
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function normalizeOtp(otp) {
  return String(otp || '').replace(/\D/g, '');
}

function isValidOtp(otp) {
  return /^\d{6}$/.test(normalizeOtp(otp));
}

module.exports = {
  EMAIL_REGEX,
  OTP_REGEX,
  ALLOWED_REGISTER_ROLES,
  isValidEmail,
  isValidPassword,
  isValidName,
  isValidOtp,
  normalizeEmail,
  normalizeOtp
};
