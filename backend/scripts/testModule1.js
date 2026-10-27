process.env.JWT_SECRET = process.env.JWT_SECRET || 'module1-test-secret-value-32chars!!';
process.env.CLIENT_ORIGIN = 'http://localhost:5173';
process.env.NODE_ENV = 'test';

const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const { MongoMemoryServer } = require('mongodb-memory-server');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed += 1;
    return;
  }
  failed += 1;
  console.error(`FAIL: ${message}`);
}

async function run() {
  const mongod = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongod.getUri();
  await mongoose.connect(process.env.MONGO_URI);
  mongoose.set('sanitizeFilter', true);

  const emailService = require('../services/emailService');
  let lastOtp = null;
  emailService.sendOtpEmail = async (to, otp) => {
    lastOtp = String(otp);
  };

  const supertest = require('supertest');
  const { createApp } = require('../app');
  const User = require('../models/User');
  const Community = require('../models/Community');

  const app = createApp();
  const request = supertest(app);

  const communityA = await Community.create({ name: 'MCA Test' });
  const communityB = await Community.create({ name: 'BCA Test' });
  const passwordHash = await bcrypt.hash('Testpass1', 10);

  await User.create({
    name: 'Student Alpha',
    email: 'alpha@college.test',
    password: passwordHash,
    role: 'student',
    communityId: communityA._id,
    emailVerified: true,
    status: 'active'
  });
  await User.create({
    name: 'Student Beta',
    email: 'beta@college.test',
    password: passwordHash,
    role: 'student',
    communityId: communityB._id,
    emailVerified: true,
    status: 'active'
  });
  await User.create({
    name: 'Employee One',
    email: 'employee@college.test',
    password: passwordHash,
    role: 'employee',
    communityId: communityA._id,
    emailVerified: true,
    status: 'active'
  });
  await User.create({
    name: 'Admin User',
    email: 'admin@college.test',
    password: passwordHash,
    role: 'admin',
    communityId: null,
    emailVerified: true,
    status: 'active'
  });
  await User.create({
    name: 'Inactive Student',
    email: 'inactive@college.test',
    password: passwordHash,
    role: 'student',
    communityId: communityA._id,
    emailVerified: true,
    status: 'inactive'
  });

  function cookieFrom(res) {
    const raw = res.headers['set-cookie'];
    if (!raw) return '';
    return raw.map((item) => item.split(';')[0]).join('; ');
  }

  async function login(email, password = 'Testpass1') {
    const res = await request.post('/api/auth/login').send({ email, password });
    return res;
  }

  const communities = await request.get('/api/communities');
  assert(communities.status === 200, 'public community list is 200');
  assert(communities.body.communities.length >= 2, 'community list includes seeded groups');

  const adminRegister = await request.post('/api/auth/register').send({
    name: 'New Admin',
    email: 'newadmin@college.test',
    password: 'Testpass1',
    role: 'admin',
    communityId: communityA._id.toString()
  });
  assert(adminRegister.status === 400, 'admin cannot self-register');

  lastOtp = null;
  const register = await request.post('/api/auth/register').send({
    name: 'New Student',
    email: 'newbie@college.test',
    password: 'Testpass1',
    role: 'student',
    communityId: communityA._id.toString()
  });
  assert(register.status === 201, 'student can register');
  assert(!cookieFrom(register), 'register does not issue a session cookie');
  assert(Boolean(lastOtp) && lastOtp.length === 6, 'verification OTP is sent');

  const unverifiedLogin = await login('newbie@college.test');
  assert(unverifiedLogin.status === 403, 'unverified user cannot login');

  const continueOtp = await request.post('/api/auth/request-otp').send({ email: 'newbie@college.test' });
  assert(continueOtp.status === 200, 'unverified account can continue with email OTP');
  assert(continueOtp.body.verificationRequired === true, 'new account OTP continues into email verification');

  const verify = await request.post('/api/auth/verify-email').send({
    email: 'newbie@college.test',
    otp: lastOtp
  });
  assert(verify.status === 200, 'email verification succeeds');
  assert(Boolean(cookieFrom(verify)), 'verify email issues a session');

  const badLogin = await login('alpha@college.test', 'wrong-password');
  assert(badLogin.status === 401, 'wrong password is 401');

  const inactiveLogin = await login('inactive@college.test');
  assert(inactiveLogin.status === 403, 'inactive user cannot login');

  const alphaLogin = await login('alpha@college.test');
  assert(alphaLogin.status === 200, 'verified student can login');
  const alpha = cookieFrom(alphaLogin);
  assert(alphaLogin.body.user.role === 'student', 'login returns student role');

  const me = await request.get('/api/auth/me').set('Cookie', alpha);
  assert(me.status === 200, 'authenticated me succeeds');
  assert(me.body.user.email === 'alpha@college.test', 'me returns the signed-in user');

  const unauthMe = await request.get('/api/auth/me');
  assert(unauthMe.status === 401, 'signed-out me is 401');

  const ownCommunity = await request.get(`/api/communities/${communityA._id}`).set('Cookie', alpha);
  assert(ownCommunity.status === 200, 'student can view assigned community');

  const otherCommunity = await request.get(`/api/communities/${communityB._id}`).set('Cookie', alpha);
  assert(otherCommunity.status === 403, 'student cannot view another community');

  const studentDash = await request.get('/api/dashboard/student').set('Cookie', alpha);
  assert(studentDash.status === 200, 'student dashboard is allowed');
  const employeeDash = await request.get('/api/dashboard/employee').set('Cookie', alpha);
  assert(employeeDash.status === 403, 'student cannot open employee dashboard');
  const adminDashDenied = await request.get('/api/dashboard/admin').set('Cookie', alpha);
  assert(adminDashDenied.status === 403, 'student cannot open admin dashboard');

  const employeeLogin = await login('employee@college.test');
  assert(employeeLogin.status === 200, 'employee can login');
  const employee = cookieFrom(employeeLogin);
  const employeeDashOk = await request.get('/api/dashboard/employee').set('Cookie', employee);
  assert(employeeDashOk.status === 200, 'employee dashboard is allowed');

  const adminLogin = await login('admin@college.test');
  assert(adminLogin.status === 200, 'admin can login');
  const admin = cookieFrom(adminLogin);
  const adminDash = await request.get('/api/dashboard/admin').set('Cookie', admin);
  assert(adminDash.status === 200, 'admin dashboard is allowed');

  const studentAdminUsers = await request.get('/api/admin/users').set('Cookie', alpha);
  assert(studentAdminUsers.status === 403, 'student cannot list users');

  const adminUsers = await request.get('/api/admin/users').set('Cookie', admin);
  assert(adminUsers.status === 200, 'admin can list users');

  const alphaId = alphaLogin.body.user.id;
  const studentGetUser = await request.get(`/api/admin/users/${alphaId}`).set('Cookie', alpha);
  assert(studentGetUser.status === 403, 'student cannot open user details');
  const adminGetUser = await request.get(`/api/admin/users/${alphaId}`).set('Cookie', admin);
  assert(adminGetUser.status === 200, 'admin can open user details');
  assert(adminGetUser.body.user && adminGetUser.body.user.email === 'alpha@college.test', 'user details include email');
  assert(!Object.prototype.hasOwnProperty.call(adminGetUser.body.user, 'password'), 'user details omit password');
  const missingUser = await request.get('/api/admin/users/000000000000000000000000').set('Cookie', admin);
  assert(missingUser.status === 404, 'unknown user details are 404');

  const promote = await request.patch(`/api/admin/users/${alphaId}`).set('Cookie', admin).send({ role: 'admin' });
  assert(promote.status === 403, 'admin cannot promote a user to admin');

  const createdCommunity = await request.post('/api/admin/communities').set('Cookie', admin).send({ name: 'Temp Empty Group' });
  assert(createdCommunity.status === 201, 'admin can create a community');
  const tempId = createdCommunity.body.community.id;
  const deletedCommunity = await request.delete(`/api/admin/communities/${tempId}`).set('Cookie', admin);
  assert(deletedCommunity.status === 200, 'admin can delete an empty community');

  const blockedDelete = await request.delete(`/api/admin/communities/${communityA._id}`).set('Cookie', admin);
  assert(blockedDelete.status === 409, 'community with members cannot be deleted');

  lastOtp = null;
  const otpRequest = await request.post('/api/auth/request-otp').send({ email: 'alpha@college.test' });
  assert(otpRequest.status === 200, 'login OTP can be requested');
  const otpLogin = await request.post('/api/auth/verify-otp').send({
    email: 'alpha@college.test',
    otp: lastOtp
  });
  assert(otpLogin.status === 200, 'login OTP verification succeeds');

  const changePassword = await request.post('/api/auth/change-password').set('Cookie', alpha).send({
    currentPassword: 'Testpass1',
    newPassword: 'Testpass2'
  });
  assert(changePassword.status === 200, 'authenticated user can change password');
  const oldPassword = await login('alpha@college.test', 'Testpass1');
  assert(oldPassword.status === 401, 'old password no longer works');
  const newPassword = await login('alpha@college.test', 'Testpass2');
  assert(newPassword.status === 200, 'new password works');

  const logout = await request.post('/api/auth/logout').set('Cookie', cookieFrom(newPassword));
  assert(logout.status === 200, 'logout succeeds');

  console.log(`Module 1 tests: ${passed} passed, ${failed} failed`);
  await mongoose.disconnect();
  await mongod.stop();
  process.exit(failed ? 1 : 0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
