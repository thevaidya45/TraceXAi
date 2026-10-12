const express = require('express');
const { authenticate } = require('../middleware/authMiddleware');
const { authorizeRoles } = require('../middleware/roleMiddleware');
const { reportImageUpload } = require('../middleware/uploadMiddleware');
const { reportCreateLimiter } = require('../middleware/rateLimiters');
const {
  createReport,
  listMyReports,
  getMyReport,
  updateMyReport,
  updateMyReportStatus,
  getReportImage,
  deleteMyReport
} = require('../controllers/reportController');

const router = express.Router();

router.use(authenticate);

router.post(
  '/',
  authorizeRoles('student', 'employee'),
  reportCreateLimiter,
  reportImageUpload,
  createReport
);
router.get('/', authorizeRoles('student', 'employee'), listMyReports);
router.get('/:id/image', authorizeRoles('student', 'employee', 'admin'), getReportImage);
router.get('/:id', authorizeRoles('student', 'employee'), getMyReport);
router.patch(
  '/:id',
  authorizeRoles('student', 'employee'),
  reportImageUpload,
  updateMyReport
);
router.patch(
  '/:id/status',
  authorizeRoles('student', 'employee'),
  updateMyReportStatus
);
router.delete('/:id', authorizeRoles('student', 'employee'), deleteMyReport);

module.exports = router;
