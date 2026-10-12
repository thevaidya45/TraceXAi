const express = require('express');
const { authenticate } = require('../middleware/authMiddleware');
const { authorizeRoles } = require('../middleware/roleMiddleware');
const { reportImageUpload } = require('../middleware/uploadMiddleware');
const { reportCreateLimiter } = require('../middleware/rateLimiters');
const {
  createSighting,
  listSightings,
  getSighting,
  updateSighting,
  getSightingImage
} = require('../controllers/sightingController');

const router = express.Router();

router.use(authenticate);

router.post(
  '/',
  authorizeRoles('student', 'employee'),
  reportCreateLimiter,
  reportImageUpload,
  createSighting
);
router.get('/', authorizeRoles('student', 'employee', 'admin'), listSightings);
router.get('/:id/image', authorizeRoles('student', 'employee', 'admin'), getSightingImage);
router.get('/:id', authorizeRoles('student', 'employee', 'admin'), getSighting);
router.patch(
  '/:id',
  authorizeRoles('student', 'employee'),
  reportImageUpload,
  updateSighting
);

module.exports = router;
