import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json'
  }
});

function isSafeMessage(message) {
  if (typeof message !== 'string') {
    return false;
  }
  const lowered = message.toLowerCase();
  const blocked = [
    'mongo',
    'e11000',
    'jwt_secret',
    'jwt secret',
    'smtp',
    'resend',
    'stack trace',
    'localhost',
    '127.0.0.1',
    'mongo_uri',
    'resend_api',
    'enode',
    'errno',
    '/users/',
    'exception'
  ];
  return !blocked.some((item) => lowered.includes(item));
}

export function isNotFoundError(error) {
  return Boolean(error && error.response && error.response.status === 404);
}

export function getErrorMessage(error, fallback) {
  const message = error && error.response && error.response.data && error.response.data.message;
  if (isSafeMessage(message)) {
    return message;
  }
  return fallback || 'Something went wrong. Please try again.';
}

export default api;
