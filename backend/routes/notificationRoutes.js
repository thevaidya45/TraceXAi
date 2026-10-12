const express = require('express');
const { authenticate } = require('../middleware/authMiddleware');
const { authorizeRoles } = require('../middleware/roleMiddleware');
const {
  listNotifications,
  unreadCount,
  getNotification,
  markRead,
  markUnread,
  markAllRead
} = require('../controllers/notificationController');

const router = express.Router();

router.use(authenticate, authorizeRoles('student', 'employee', 'admin'));

router.get('/', listNotifications);
router.get('/unread-count', unreadCount);
router.patch('/read-all', markAllRead);
router.get('/:id', getNotification);
router.patch('/:id/read', markRead);
router.patch('/:id/unread', markUnread);

module.exports = router;
