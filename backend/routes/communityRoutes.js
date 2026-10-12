const express = require('express');
const { listCommunities, getCommunity } = require('../controllers/communityController');
const { authenticate } = require('../middleware/authMiddleware');
const { authorizeCommunity } = require('../middleware/communityMiddleware');

const router = express.Router();

router.get('/', listCommunities);
router.get('/:id', authenticate, authorizeCommunity, getCommunity);

module.exports = router;
