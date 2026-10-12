import api from './api.js';

export function getNotifications(params) {
  return api.get('/notifications', { params });
}

export function getUnreadCount() {
  return api.get('/notifications/unread-count');
}

export function getNotification(id) {
  return api.get(`/notifications/${id}`);
}

export function markNotificationRead(id) {
  return api.patch(`/notifications/${id}/read`);
}

export function markNotificationUnread(id) {
  return api.patch(`/notifications/${id}/unread`);
}

export function markAllNotificationsRead() {
  return api.patch('/notifications/read-all');
}

export function formatRelativeTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
