import api from './api.js';

export function register(payload) {
  return api.post('/auth/register', payload);
}

export function login(payload) {
  return api.post('/auth/login', payload);
}

export function requestOtp(payload) {
  return api.post('/auth/request-otp', payload);
}

export function verifyOtp(payload) {
  return api.post('/auth/verify-otp', payload);
}

export function forgotPassword(payload) {
  return api.post('/auth/forgot-password', payload);
}

export function verifyResetOtp(payload) {
  return api.post('/auth/verify-reset-otp', payload);
}

export function resetPassword(payload) {
  return api.post('/auth/reset-password', payload);
}

export function logout() {
  return api.post('/auth/logout');
}

export function getCurrentUser() {
  return api.get('/auth/me');
}

export function requestVerificationOtp(payload) {
  return api.post('/auth/request-verification-otp', payload);
}

export function verifyEmail(payload) {
  return api.post('/auth/verify-email', payload);
}

export function changePassword(payload) {
  return api.post('/auth/change-password', payload);
}
