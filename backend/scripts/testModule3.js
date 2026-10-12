process.env.JWT_SECRET = process.env.JWT_SECRET || 'module3-test-secret-value-32chars!!';
process.env.CLIENT_ORIGIN = 'http://localhost:5173';
process.env.NODE_ENV = 'test';

const fs = require('fs');
const os = require('os');
const path = require('path');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const { MongoMemoryServer } = require('mongodb-memory-server');

const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tracex-uploads-'));
process.env.UPLOAD_DIR = uploadDir;

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

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

  const supertest = require('supertest');
  const { createApp } = require('../app');
  const emailService = require('../services/emailService');
  const { AppError } = require('../utils/AppError');
  const User = require('../models/User');
  const Community = require('../models/Community');
  const Item = require('../models/Item');
  const Notification = require('../models/Notification');

  const sentTo = [];
  let failEmail = false;
  emailService.sendCommunityItemAlert = async (to) => {
    if (failEmail) {
      throw new AppError('The community email could not be sent. Please try again.', 503);
    }
    sentTo.push(to);
  };

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
    name: 'Student Gamma',
    email: 'gamma@college.test',
    password: passwordHash,
    role: 'student',
    communityId: communityA._id,
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

  async function login(email) {
    const res = await request.post('/api/auth/login').send({ email, password: 'Testpass1' });
    assert(res.status === 200, `login ${email} should succeed (${res.status})`);
    return cookieFrom(res);
  }

  const alpha = await login('alpha@college.test');
  const beta = await login('beta@college.test');
  const gamma = await login('gamma@college.test');
  const employee = await login('employee@college.test');
  const admin = await login('admin@college.test');

  const created = await request
    .post('/api/reports')
    .set('Cookie', alpha)
    .field('reportType', 'lost')
    .field('itemName', 'Campus Laptop')
    .field('category', 'electronics')
    .field('description', 'Grey laptop reported near the library entrance.')
    .field('location', 'Library')
    .field('approximateDate', '2026-09-01');
  assert(created.status === 201, 'lost report created');
  const lostId = created.body.report.id;
  assert(sentTo.length === 0, 'creating a report does not send community email');

  const itemAfterCreate = await Item.findById(lostId);
  assert(itemAfterCreate.communityEmailNotification.sent === false, 'email status remains not sent after create');

  const alphaNotes = await request.get('/api/notifications').set('Cookie', alpha);
  assert(alphaNotes.status === 200, 'reporter can list notifications');
  assert(
    alphaNotes.body.notifications.every((item) => item.itemId !== lostId),
    'reporter does not receive an alert for their own report'
  );

  const gammaNotes = await request.get('/api/notifications').set('Cookie', gamma);
  assert(gammaNotes.status === 200 && gammaNotes.body.unreadCount >= 1, 'same-community member receives in-app alert');
  const lostAlert = gammaNotes.body.notifications.find((item) => item.itemId === lostId);
  assert(lostAlert && lostAlert.type === 'NEW_LOST_ITEM', 'alert type is NEW_LOST_ITEM');

  const employeeNotes = await request.get('/api/notifications').set('Cookie', employee);
  assert(employeeNotes.body.notifications.some((item) => item.itemId === lostId), 'employee in the community receives the alert');

  const betaNotes = await request.get('/api/notifications').set('Cookie', beta);
  assert(betaNotes.body.notifications.every((item) => item.itemId !== lostId), 'other community does not receive the alert');

  const inactiveCount = await Notification.countDocuments({
    recipientId: (await User.findOne({ email: 'inactive@college.test' }))._id
  });
  assert(inactiveCount === 0, 'inactive users do not receive new notifications');

  const communityView = await request.get(`/api/reports/${lostId}`).set('Cookie', gamma);
  assert(communityView.status === 200, 'community member can open the related report');
  assert(communityView.body.report.isOwner === false, 'community viewer is not treated as owner');

  const crossView = await request.get(`/api/reports/${lostId}`).set('Cookie', beta);
  assert(crossView.status === 404, 'other community cannot open the report');

  const gammaAlertId = lostAlert.id;
  const idorNote = await request.get(`/api/notifications/${gammaAlertId}`).set('Cookie', beta);
  assert(idorNote.status === 404, 'notification IDOR is 404');

  const markRead = await request.patch(`/api/notifications/${gammaAlertId}/read`).set('Cookie', gamma);
  assert(markRead.status === 200 && markRead.body.notification.read === true, 'owner can mark notification read');

  const markUnread = await request.patch(`/api/notifications/${gammaAlertId}/unread`).set('Cookie', gamma);
  assert(markUnread.status === 200 && markUnread.body.notification.read === false, 'owner can mark notification unread');

  const idorRead = await request.patch(`/api/notifications/${gammaAlertId}/read`).set('Cookie', beta);
  assert(idorRead.status === 404, 'cannot mark another user notification');

  const markAll = await request.patch('/api/notifications/read-all').set('Cookie', gamma);
  assert(markAll.status === 200 && markAll.body.unreadCount === 0, 'mark all read works');

  const studentEmail = await request.post(`/api/admin/reports/${lostId}/email-alert`).set('Cookie', alpha).send({
    emails: ['attacker@example.com']
  });
  assert(studentEmail.status === 403, 'student cannot send community email');

  failEmail = true;
  const failedSend = await request.post(`/api/admin/reports/${lostId}/email-alert`).set('Cookie', admin);
  assert(failedSend.status === 503, 'email failure returns a safe error');
  const stillUnsent = await Item.findById(lostId);
  assert(stillUnsent.communityEmailNotification.sent === false, 'failed send does not mark email as sent');
  assert(stillUnsent.itemName === 'Campus Laptop', 'report remains intact after email failure');
  failEmail = false;

  const adminSend = await request
    .post(`/api/admin/reports/${lostId}/email-alert`)
    .set('Cookie', admin)
    .send({ emails: ['attacker@example.com'], communityId: communityB._id.toString() });
  assert(adminSend.status === 200, 'admin can send community email');
  assert(adminSend.body.report.communityEmailNotification.sent === true, 'email status becomes sent');
  assert(adminSend.body.report.communityEmailNotification.recipientCount === 3, 'recipients are community members from the database');
  assert(adminSend.body.report.communityEmailNotification.sentBy === 'Admin User', 'sent by name is returned');
  assert(
    sentTo.sort().join(',') === 'alpha@college.test,employee@college.test,gamma@college.test',
    'emails go only to eligible community members'
  );
  assert(!sentTo.includes('attacker@example.com'), 'frontend recipient list is ignored');
  assert(!sentTo.includes('beta@college.test'), 'other community is not emailed by default');
  assert(!sentTo.includes('inactive@college.test'), 'inactive users are not emailed');
  assert(adminSend.body.report.communityEmailNotification.sendCount === 1, 'first send counts as attempt 1');
  assert(adminSend.body.report.communityEmailNotification.remainingAttempts === 1, 'one send attempt remains');
  assert(!JSON.stringify(adminSend.body).toLowerCase().includes('resend_api'), 'credentials are not exposed');

  const secondSend = await request
    .post(`/api/admin/reports/${lostId}/email-alert`)
    .set('Cookie', admin)
    .send({
      communityIds: [communityA._id.toString(), communityB._id.toString()],
      emails: ['attacker@example.com']
    });
  assert(secondSend.status === 200, 'admin can send community email a second time');
  assert(secondSend.body.report.communityEmailNotification.sendCount === 2, 'second send counts as attempt 2');
  assert(secondSend.body.report.communityEmailNotification.remainingAttempts === 0, 'no send attempts remain');
  assert(sentTo.includes('beta@college.test'), 'admin can include another community on a later send');
  assert(
    (secondSend.body.report.communityEmailNotification.sentCommunityNames || []).includes('BCA Test'),
    'emailed community names are recorded'
  );

  const duplicateSend = await request.post(`/api/admin/reports/${lostId}/email-alert`).set('Cookie', admin);
  assert(duplicateSend.status === 409, 'a third community email is blocked');

  const found = await request
    .post('/api/reports')
    .set('Cookie', employee)
    .field('reportType', 'found')
    .field('itemName', 'Black Wallet')
    .field('category', 'accessories')
    .field('description', 'Wallet found near Block A reception.')
    .field('location', 'Block A')
    .field('approximateDate', '2026-09-02');
  assert(found.status === 201, 'found report created');
  const foundId = found.body.report.id;
  const invalidCommunities = await request
    .post(`/api/admin/reports/${foundId}/email-alert`)
    .set('Cookie', admin)
    .send({ communityIds: ['aaaaaaaaaaaaaaaaaaaaaaaa'] });
  assert(invalidCommunities.status === 400, 'unknown community ids are rejected');
  const alphaFoundNotes = await request.get('/api/notifications').set('Cookie', alpha);
  assert(
    alphaFoundNotes.body.notifications.some((item) => item.itemId === foundId && item.type === 'NEW_FOUND_ITEM'),
    'community receives found-item alert'
  );

  const invalidSighting = await request
    .post('/api/sightings')
    .set('Cookie', gamma)
    .field('itemId', 'aaaaaaaaaaaaaaaaaaaaaaaa')
    .field('location', 'Cafeteria')
    .field('observation', 'Saw a similar laptop on a table.')
    .field('approximateDate', '2026-09-03');
  assert(invalidSighting.status === 404, 'sighting for missing item is 404');

  const crossSighting = await request
    .post('/api/sightings')
    .set('Cookie', beta)
    .field('itemId', lostId)
    .field('location', 'Cafeteria')
    .field('observation', 'Saw a similar laptop on a table.')
    .field('approximateDate', '2026-09-03')
    .field('communityId', communityA._id.toString());
  assert(crossSighting.status === 404, 'other community cannot attach a sighting');

  const badSighting = await request
    .post('/api/sightings')
    .set('Cookie', gamma)
    .field('itemId', lostId)
    .field('location', 'X')
    .field('observation', 'Too short')
    .field('approximateDate', '2026-09-03');
  assert(badSighting.status === 400, 'invalid sighting fields are 400');

  const huge = Buffer.alloc(2 * 1024 * 1024 + 50, 1);
  huge[0] = 0xff;
  huge[1] = 0xd8;
  huge[2] = 0xff;
  const oversizedSighting = await request
    .post('/api/sightings')
    .set('Cookie', gamma)
    .field('itemId', lostId)
    .field('location', 'Cafeteria')
    .field('observation', 'Saw a similar laptop on a table.')
    .field('approximateDate', '2026-09-03')
    .attach('image', huge, { filename: 'big.jpg', contentType: 'image/jpeg' });
  assert(oversizedSighting.status === 400, 'oversized sighting image is 400');

  const sighting = await request
    .post('/api/sightings')
    .set('Cookie', gamma)
    .field('itemId', lostId)
    .field('location', 'Cafeteria')
    .field('observation', 'Saw a similar laptop near the cafeteria.')
    .field('approximateDate', '2026-09-03')
    .field('approximateTime', '11:15')
    .field('communityId', communityB._id.toString())
    .attach('image', PNG, { filename: 'seen.png', contentType: 'image/png' });
  assert(sighting.status === 201, 'authorized user can create a sighting');
  assert(sighting.body.sighting.community.id === communityA._id.toString(), 'sighting community comes from the user');
  assert(!sighting.body.sighting.imageKey, 'sighting imageKey is not exposed');
  const sightingId = sighting.body.sighting.id;

  const alphaSightingNotes = await request.get('/api/notifications').set('Cookie', alpha);
  assert(
    alphaSightingNotes.body.notifications.some((item) => item.type === 'SIGHTING' && item.sightingId === sightingId),
    'community receives a sighting in-app alert'
  );
  const gammaOwnAlert = (await request.get('/api/notifications').set('Cookie', gamma)).body.notifications.some(
    (item) => item.sightingId === sightingId
  );
  assert(!gammaOwnAlert, 'sighting reporter does not get a duplicate sighting alert');

  const mine = await request.get('/api/sightings?mine=true').set('Cookie', gamma);
  assert(mine.status === 200 && mine.body.sightings.some((item) => item.id === sightingId), 'user can list own sightings');

  const communitySightings = await request.get('/api/sightings').set('Cookie', employee);
  assert(communitySightings.body.sightings.some((item) => item.id === sightingId), 'community member can list sightings');

  const betaList = await request.get('/api/sightings').set('Cookie', beta);
  assert(betaList.body.sightings.every((item) => item.id !== sightingId), 'other community cannot list the sighting');

  const betaGet = await request.get(`/api/sightings/${sightingId}`).set('Cookie', beta);
  assert(betaGet.status === 404, 'other community cannot view the sighting');

  const ownGet = await request.get(`/api/sightings/${sightingId}`).set('Cookie', gamma);
  assert(ownGet.status === 200, 'reporter can view own sighting');

  const otherUpdate = await request
    .patch(`/api/sightings/${sightingId}`)
    .set('Cookie', employee)
    .field('location', 'Hacked');
  assert(otherUpdate.status === 404, 'cannot update another user sighting');

  const ownUpdate = await request
    .patch(`/api/sightings/${sightingId}`)
    .set('Cookie', gamma)
    .field('location', 'Main cafeteria');
  assert(ownUpdate.status === 200 && ownUpdate.body.sighting.location === 'Main cafeteria', 'owner can update own sighting');

  const image = await request.get(`/api/sightings/${sightingId}/image`).set('Cookie', employee);
  assert(image.status === 200, 'authorized member can fetch sighting image');

  const betaImage = await request.get(`/api/sightings/${sightingId}/image`).set('Cookie', beta);
  assert(betaImage.status === 404, 'other community cannot fetch sighting image');

  const adminList = await request.get('/api/admin/sightings').set('Cookie', admin);
  assert(adminList.status === 200 && adminList.body.sightings.some((item) => item.id === sightingId), 'admin can list sightings');

  const adminInvalid = await request
    .patch(`/api/admin/sightings/${sightingId}/status`)
    .set('Cookie', admin)
    .send({ status: 'invalid' });
  assert(adminInvalid.status === 200 && adminInvalid.body.sighting.status === 'invalid', 'admin can mark a sighting invalid');

  const hidden = await request.get(`/api/sightings/${sightingId}`).set('Cookie', employee);
  assert(hidden.status === 404, 'invalid sighting is hidden from other members');

  const ownerStill = await request.get(`/api/sightings/${sightingId}`).set('Cookie', gamma);
  assert(ownerStill.status === 200, 'owner can still view own invalid sighting');

  const studentAdminSightings = await request.get('/api/admin/sightings').set('Cookie', gamma);
  assert(studentAdminSightings.status === 403, 'student cannot use admin sighting tools');

  console.log(`Module 3 tests: ${passed} passed, ${failed} failed`);
  await mongoose.disconnect();
  await mongod.stop();
  fs.rmSync(uploadDir, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
