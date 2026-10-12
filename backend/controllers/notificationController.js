const Notification = require('../models/Notification');
const { AppError } = require('../utils/AppError');
const { isValidObjectId } = require('../utils/reportAccess');
const { securityLog } = require('../utils/securityLog');

function itemPathForUser(user, itemId) {
  if (user.role === 'employee') {
    return `/employee/reports/${itemId}`;
  }
  if (user.role === 'admin') {
    return `/admin/reports/${itemId}`;
  }
  return `/student/reports/${itemId}`;
}

function mapNotification(doc, user) {
  const itemId = doc.itemId && doc.itemId._id ? doc.itemId._id.toString() : String(doc.itemId);
  return {
    id: doc._id.toString(),
    type: doc.type,
    title: doc.title,
    message: doc.message,
    read: Boolean(doc.read),
    itemId,
    sightingId: doc.sightingId ? doc.sightingId.toString() : null,
    href: itemPathForUser(user, itemId),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt
  };
}

async function loadOwnNotification(req) {
  if (!isValidObjectId(req.params.id)) {
    throw new AppError('Notification not found.', 404);
  }
  const doc = await Notification.findById(req.params.id);
  if (!doc || doc.recipientId.toString() !== req.user._id.toString()) {
    securityLog('unauthorized_access', {
      userId: req.user._id,
      role: req.user.role,
      path: req.originalUrl,
      reason: 'notification_idor'
    });
    throw new AppError('Notification not found.', 404);
  }
  return doc;
}

async function listNotifications(req, res, next) {
  try {
    const filter = { recipientId: req.user._id };
    const read = String(req.query.read || '').trim().toLowerCase();
    if (read === 'true') filter.read = true;
    if (read === 'false') filter.read = false;

    const notifications = await Notification.find(filter).sort({ createdAt: -1 }).limit(100);
    const unreadCount = await Notification.countDocuments({ recipientId: req.user._id, read: false });
    res.json({
      unreadCount,
      notifications: notifications.map((item) => mapNotification(item, req.user))
    });
  } catch (err) {
    next(err);
  }
}

async function unreadCount(req, res, next) {
  try {
    const count = await Notification.countDocuments({ recipientId: req.user._id, read: false });
    res.json({ unreadCount: count });
  } catch (err) {
    next(err);
  }
}

async function getNotification(req, res, next) {
  try {
    const doc = await loadOwnNotification(req);
    res.json({ notification: mapNotification(doc, req.user) });
  } catch (err) {
    next(err);
  }
}

async function markRead(req, res, next) {
  try {
    const doc = await loadOwnNotification(req);
    doc.read = true;
    await doc.save();
    res.json({ notification: mapNotification(doc, req.user) });
  } catch (err) {
    next(err);
  }
}

async function markUnread(req, res, next) {
  try {
    const doc = await loadOwnNotification(req);
    doc.read = false;
    await doc.save();
    res.json({ notification: mapNotification(doc, req.user) });
  } catch (err) {
    next(err);
  }
}

async function markAllRead(req, res, next) {
  try {
    await Notification.updateMany({ recipientId: req.user._id, read: false }, { $set: { read: true } });
    const unread = await Notification.countDocuments({ recipientId: req.user._id, read: false });
    res.json({ message: 'All notifications marked as read.', unreadCount: unread });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listNotifications,
  unreadCount,
  getNotification,
  markRead,
  markUnread,
  markAllRead
};
