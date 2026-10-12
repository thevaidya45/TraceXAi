const express = require('express');
const { authenticate } = require('../middleware/authMiddleware');
const { requireAdmin } = require('../middleware/roleMiddleware');
const {
  listAdminReports,
  getAdminReport,
  updateAdminReportStatus,
  deleteAdminReport,
  sendCommunityEmail
} = require('../controllers/adminReportController');
const { emailAlertLimiter } = require('../middleware/rateLimiters');

const router = express.Router();

router.use(authenticate, requireAdmin);

router.get('/reports', listAdminReports);
router.get('/reports/:id', getAdminReport);
router.post('/reports/:id/email-alert', emailAlertLimiter, sendCommunityEmail);
router.patch('/reports/:id/status', updateAdminReportStatus);
router.delete('/reports/:id', deleteAdminReport);

module.exports = router;
