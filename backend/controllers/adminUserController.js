const mongoose = require('mongoose');
const User = require('../models/User');
const Community = require('../models/Community');
const Otp = require('../models/Otp');
const PasswordReset = require('../models/PasswordReset');
const { AppError } = require('../utils/AppError');
const { securityLog } = require('../utils/securityLog');
const { notEqual } = require('../utils/trustedQuery');

const MANAGEABLE_ROLES = ['student', 'employee'];
const STATUSES = ['active', 'inactive'];

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function mapManagedUser(user) {
  const community = user.communityId && user.communityId.name
    ? { id: user.communityId._id.toString(), name: user.communityId.name }
    : user.communityId
      ? { id: user.communityId.toString(), name: null }
      : null;

  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    role: user.role,
    community,
    status: user.status === 'inactive' ? 'inactive' : 'active',
    emailVerified: Boolean(user.emailVerified),
    createdAt: user.createdAt || null
  };
}

async function listUsers(req, res, next) {
  try {
    const search = String(req.query.search || '').trim().slice(0, 80);
    const role = String(req.query.role || '').trim().toLowerCase();
    const status = String(req.query.status || '').trim().toLowerCase();
    const communityId = String(req.query.communityId || '').trim();

    const filter = {};

    if (search) {
      const pattern = new RegExp(escapeRegex(search), 'i');
      filter.$or = [{ name: pattern }, { email: pattern }];
    }

    if (role && role !== 'all') {
      if (!MANAGEABLE_ROLES.includes(role) && role !== 'admin') {
        throw new AppError('Please select a valid role filter.', 400);
      }
      filter.role = role;
    }

    if (status && status !== 'all') {
      if (!STATUSES.includes(status)) {
        throw new AppError('Please select a valid status filter.', 400);
      }
      if (status === 'active') {
        filter.status = notEqual('inactive');
      } else {
        filter.status = 'inactive';
      }
    }

    if (communityId) {
      if (!mongoose.Types.ObjectId.isValid(communityId)) {
        throw new AppError('Please select a valid community.', 400);
      }
      filter.communityId = new mongoose.Types.ObjectId(communityId);
    }

    const users = await User.find(filter)
      .select('name email role communityId status emailVerified createdAt')
      .populate('communityId', 'name')
      .sort({ createdAt: -1 })
      .limit(200);

    res.json({ users: users.map(mapManagedUser) });
  } catch (err) {
    next(err);
  }
}

async function getUser(req, res, next) {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id) || String(new mongoose.Types.ObjectId(id)) !== String(id)) {
      throw new AppError('User not found.', 404);
    }

    const user = await User.findById(id)
      .select('name email role communityId status emailVerified createdAt')
      .populate('communityId', 'name');
    if (!user) {
      throw new AppError('User not found.', 404);
    }

    res.json({ user: mapManagedUser(user) });
  } catch (err) {
    next(err);
  }
}

async function updateUser(req, res, next) {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError('User not found.', 404);
    }

    const target = await User.findById(id);
    if (!target) {
      throw new AppError('User not found.', 404);
    }

    if (target.role === 'admin') {
      throw new AppError('Admin accounts cannot be managed here.', 403);
    }

    if (target._id.toString() === req.user._id.toString()) {
      throw new AppError('You cannot change your own account from this page.', 403);
    }

    if (req.body.password || req.body.passwordHash || req.body.otp || req.body.resetToken) {
      throw new AppError('Unable to complete the request. Please try again.', 400);
    }

    const updates = {};
    if (Object.prototype.hasOwnProperty.call(req.body, 'role')) {
      const role = String(req.body.role || '').trim().toLowerCase();
      if (role === 'admin') {
        throw new AppError('Admin accounts cannot be created from user management.', 403);
      }
      if (!MANAGEABLE_ROLES.includes(role)) {
        throw new AppError('Please select a valid role.', 400);
      }
      updates.role = role;
    }

    if (Object.prototype.hasOwnProperty.call(req.body, 'status')) {
      const status = String(req.body.status || '').trim().toLowerCase();
      if (!STATUSES.includes(status)) {
        throw new AppError('Please select a valid account status.', 400);
      }
      updates.status = status;
    }

    if (Object.prototype.hasOwnProperty.call(req.body, 'communityId')) {
      const communityId = req.body.communityId;
      if (!communityId || !mongoose.Types.ObjectId.isValid(communityId)) {
        throw new AppError('Please select a valid community.', 400);
      }
      const community = await Community.findById(communityId);
      if (!community) {
        throw new AppError('Please select a valid community.', 400);
      }
      updates.communityId = community._id;
    }

    if (Object.keys(updates).length === 0) {
      throw new AppError('Please choose a change to save.', 400);
    }

    const nextRole = updates.role || target.role;
    const nextCommunity = Object.prototype.hasOwnProperty.call(updates, 'communityId')
      ? updates.communityId
      : target.communityId;

    if (MANAGEABLE_ROLES.includes(nextRole) && !nextCommunity) {
      throw new AppError('Please assign a community.', 400);
    }

    Object.assign(target, updates);
    await target.save();

    securityLog('admin_user_updated', {
      userId: req.user._id,
      targetUserId: target._id,
      reason: Object.keys(updates).join(',')
    });

    const populated = await User.findById(target._id)
      .select('name email role communityId status emailVerified createdAt')
      .populate('communityId', 'name');

    res.json({
      message: 'User updated successfully.',
      user: mapManagedUser(populated)
    });
  } catch (err) {
    next(err);
  }
}

async function deleteUser(req, res, next) {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError('User not found.', 404);
    }

    const target = await User.findById(id);
    if (!target) {
      throw new AppError('User not found.', 404);
    }

    if (target.role === 'admin') {
      throw new AppError('Admin accounts cannot be deleted here.', 403);
    }

    if (target._id.toString() === req.user._id.toString()) {
      throw new AppError('You cannot delete your own account.', 403);
    }

    const email = target.email;
    await User.deleteOne({ _id: target._id });
    await Otp.deleteMany({ email });
    await PasswordReset.deleteMany({ email });

    securityLog('admin_user_deleted', {
      userId: req.user._id,
      targetUserId: id
    });

    res.json({ message: 'User deleted successfully.' });
  } catch (err) {
    next(err);
  }
}

module.exports = { listUsers, getUser, updateUser, deleteUser };
