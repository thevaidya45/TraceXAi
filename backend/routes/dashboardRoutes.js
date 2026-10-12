const express = require('express');
const { authenticate } = require('../middleware/authMiddleware');
const { authorizeRoles } = require('../middleware/roleMiddleware');
const {
  studentDashboard,
  employeeDashboard,
  adminDashboard
} = require('../controllers/dashboardController');

const router = express.Router();

router.get('/student', authenticate, authorizeRoles('student'), studentDashboard);
router.get('/employee', authenticate, authorizeRoles('employee'), employeeDashboard);
router.get('/admin', authenticate, authorizeRoles('admin'), adminDashboard);

module.exports = router;
