const express = require('express');
const { authenticate } = require('../middleware/authMiddleware');
const { requireAdmin } = require('../middleware/roleMiddleware');
const { listUsers, getUser, updateUser, deleteUser } = require('../controllers/adminUserController');
const {
  listAdminCommunities,
  createCommunity,
  updateCommunity,
  deleteCommunity
} = require('../controllers/adminCommunityController');

const router = express.Router();

router.use(authenticate, requireAdmin);

router.get('/users', listUsers);
router.get('/users/:id', getUser);
router.patch('/users/:id', updateUser);
router.delete('/users/:id', deleteUser);
router.get('/communities', listAdminCommunities);
router.post('/communities', createCommunity);
router.patch('/communities/:id', updateCommunity);
router.delete('/communities/:id', deleteCommunity);

module.exports = router;
