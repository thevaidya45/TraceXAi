const express = require('express');
const { authenticate } = require('../middleware/authMiddleware');
const { requireAdmin } = require('../middleware/roleMiddleware');
const {
  listAdminSightings,
  getSighting,
  updateAdminSightingStatus
} = require('../controllers/sightingController');

const router = express.Router();

router.use(authenticate, requireAdmin);

router.get('/sightings', listAdminSightings);
router.get('/sightings/:id', getSighting);
router.patch('/sightings/:id/status', updateAdminSightingStatus);

module.exports = router;
