const { AppError } = require('../utils/AppError');

function studentDashboard(req, res, next) {
  try {
    if (!req.user.communityId) {
      throw new AppError('Community information is unavailable.', 400);
    }
    res.json({
      message: 'Welcome to the student dashboard.',
      name: req.user.name,
      community: req.user.communityId.name || null
    });
  } catch (err) {
    next(err);
  }
}

function employeeDashboard(req, res, next) {
  try {
    res.json({
      message: 'Welcome to the employee dashboard.',
      name: req.user.name,
      community: req.user.communityId ? req.user.communityId.name : null
    });
  } catch (err) {
    next(err);
  }
}

function adminDashboard(req, res, next) {
  try {
    res.json({
      message: 'Welcome to the admin dashboard.',
      name: req.user.name
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  studentDashboard,
  employeeDashboard,
  adminDashboard
};
