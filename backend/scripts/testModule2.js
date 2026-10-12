process.env.JWT_SECRET = process.env.JWT_SECRET || 'module2-test-secret-value-32chars!!';
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
    status: 'active'
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
  const inactiveCookie = await login('inactive@college.test');
  await User.updateOne({ email: 'inactive@college.test' }, { status: 'inactive' });

  const unauthorized = await request.post('/api/reports').field('itemName', 'Wallet');
  assert(unauthorized.status === 401, 'unauthenticated create is 401');

  const unauthList = await request.get('/api/reports');
  assert(unauthList.status === 401, 'unauthenticated list is 401');

  const badLogin = await request.post('/api/auth/login').send({
    email: 'alpha@college.test',
    password: 'wrong-password'
  });
  assert(badLogin.status === 401, 'wrong password is 401');

  const adminCreate = await request
    .post('/api/reports')
    .set('Cookie', admin)
    .field('reportType', 'lost')
    .field('itemName', 'Admin Item')
    .field('category', 'other')
    .field('description', 'Admins should not create reports on this route.')
    .field('location', 'Office')
    .field('approximateDate', '2026-09-01');
  assert(adminCreate.status === 403, 'admin cannot create via student report API');

  const studentUsers = await request.get('/api/admin/users').set('Cookie', alpha);
  assert(studentUsers.status === 403, 'student cannot list admin users');

  const missing = await request
    .post('/api/reports')
    .set('Cookie', alpha)
    .field('reportType', 'lost')
    .field('itemName', 'W');
  assert(missing.status === 400, 'invalid/missing fields are 400');

  const badImage = await request
    .post('/api/reports')
    .set('Cookie', alpha)
    .field('reportType', 'lost')
    .field('itemName', 'Blue Wallet')
    .field('category', 'accessories')
    .field('description', 'Leather wallet with ID cards inside.')
    .field('location', 'Library entrance')
    .field('approximateDate', '2026-09-01')
    .attach('image', Buffer.from('not-an-image'), { filename: 'note.txt', contentType: 'text/plain' });
  assert(badImage.status === 400, 'invalid image is 400');

  const huge = Buffer.alloc(2 * 1024 * 1024 + 50, 1);
  huge[0] = 0xff;
  huge[1] = 0xd8;
  huge[2] = 0xff;
  const oversized = await request
    .post('/api/reports')
    .set('Cookie', alpha)
    .field('reportType', 'lost')
    .field('itemName', 'Oversized Photo Item')
    .field('category', 'other')
    .field('description', 'This upload is intentionally too large for validation.')
    .field('location', 'Canteen')
    .field('approximateDate', '2026-09-01')
    .attach('image', huge, { filename: 'big.jpg', contentType: 'image/jpeg' });
  assert(oversized.status === 400, 'oversized image is 400');

  const spoof = await request
    .post('/api/reports')
    .set('Cookie', alpha)
    .field('reportType', 'lost')
    .field('itemName', 'Black Umbrella')
    .field('category', 'accessories')
    .field('description', 'Umbrella left near the lecture hall stairs.')
    .field('location', 'Block A lobby')
    .field('approximateDate', '2026-09-01')
    .field('approximateTime', '14:30')
    .field('communityId', communityB._id.toString())
    .attach('image', PNG, { filename: 'item.png', contentType: 'image/png' });
  assert(spoof.status === 201, 'alpha lost report created');
  assert(spoof.body.report.community.id === communityA._id.toString(), 'community comes from the user, not the body');
  assert(!spoof.body.report.imageKey, 'imageKey is not exposed');
  assert(!JSON.stringify(spoof.body).includes(uploadDir), 'filesystem path is not exposed');
  assert(spoof.body.report.hasImage === true, 'hasImage is true when a photo is stored');
  const lostId = spoof.body.report.id;

  const found = await request
    .post('/api/reports')
    .set('Cookie', alpha)
    .field('reportType', 'found')
    .field('itemName', 'USB Drive')
    .field('category', 'electronics')
    .field('description', 'Silver USB drive found on a classroom desk.')
    .field('location', 'Lab 2')
    .field('approximateDate', '2026-09-02');
  assert(found.status === 201, 'alpha found report created');
  const foundId = found.body.report.id;

  const employeeReport = await request
    .post('/api/reports')
    .set('Cookie', employee)
    .field('reportType', 'lost')
    .field('itemName', 'ID Card')
    .field('category', 'documents')
    .field('description', 'College identity card with a lanyard attached.')
    .field('location', 'Parking')
    .field('approximateDate', '2026-09-03');
  assert(employeeReport.status === 201, 'employee can create a report');

  const employeeMine = await request.get('/api/reports').set('Cookie', employee);
  assert(employeeMine.status === 200 && employeeMine.body.reports.length === 1, 'employee sees only own reports');

  const adminOwnList = await request.get('/api/reports').set('Cookie', admin);
  assert(adminOwnList.status === 403, 'admin cannot use the student my-reports list');

  const mine = await request.get('/api/reports').set('Cookie', alpha);
  assert(mine.status === 200, 'alpha can list own reports');
  assert(mine.body.reports.length === 2, 'alpha sees only two own reports');

  const own = await request.get(`/api/reports/${lostId}`).set('Cookie', alpha);
  assert(own.status === 200, 'alpha can view own report');

  const crossCommunity = await request.get(`/api/reports/${lostId}`).set('Cookie', beta);
  assert(crossCommunity.status === 404, 'other community user cannot read the report');

  const sameCommunity = await request.get(`/api/reports/${lostId}`).set('Cookie', gamma);
  assert(sameCommunity.status === 200, 'same community member can view the report');
  assert(sameCommunity.body.report.isOwner === false, 'community viewer is not the owner');

  const badId = await request.get('/api/reports/not-a-valid-id').set('Cookie', alpha);
  assert(badId.status === 404, 'invalid item id is 404');

  const missingId = await request.get('/api/reports/aaaaaaaaaaaaaaaaaaaaaaaa').set('Cookie', alpha);
  assert(missingId.status === 404, 'unknown item id is 404');

  const update = await request
    .patch(`/api/reports/${lostId}`)
    .set('Cookie', alpha)
    .field('location', 'Block A auditorium');
  assert(update.status === 200, 'owner can update an active report');
  assert(update.body.report.location === 'Block A auditorium', 'location updated');

  const otherUpdate = await request
    .patch(`/api/reports/${lostId}`)
    .set('Cookie', gamma)
    .field('location', 'Hacked');
  assert(otherUpdate.status === 404, 'non-owner cannot update');

  const invalidOwnerStatus = await request
    .patch(`/api/reports/${lostId}/status`)
    .set('Cookie', alpha)
    .send({ status: 'invalid' });
  assert(invalidOwnerStatus.status === 400, 'owner cannot mark invalid');

  const mineLost = await request.get('/api/reports').query({ type: 'lost' }).set('Cookie', alpha);
  assert(mineLost.status === 200 && mineLost.body.reports.length === 1, 'owner can filter own reports by type');

  const badClaim = await request
    .patch(`/api/reports/${lostId}/status`)
    .set('Cookie', alpha)
    .send({ status: 'claimed' });
  assert(badClaim.status === 400, 'lost report cannot be marked claimed');

  const recovered = await request
    .patch(`/api/reports/${lostId}/status`)
    .set('Cookie', alpha)
    .send({ status: 'recovered' });
  assert(recovered.status === 200, 'owner can mark lost item recovered');

  const lateUpdate = await request
    .patch(`/api/reports/${lostId}`)
    .set('Cookie', alpha)
    .field('location', 'Too late');
  assert(lateUpdate.status === 400, 'non-active report cannot be edited');

  const claimed = await request
    .patch(`/api/reports/${foundId}/status`)
    .set('Cookie', alpha)
    .send({ status: 'claimed' });
  assert(claimed.status === 200, 'owner can mark found item claimed');

  const badRecoverFound = await request
    .post('/api/reports')
    .set('Cookie', gamma)
    .field('reportType', 'found')
    .field('itemName', 'Water Bottle')
    .field('category', 'other')
    .field('description', 'Steel bottle left on a bench near the canteen.')
    .field('location', 'Canteen bench')
    .field('approximateDate', '2026-09-04');
  assert(badRecoverFound.status === 201, 'found report created for invalid status check');
  const bottleId = badRecoverFound.body.report.id;
  const recoveredFound = await request
    .patch(`/api/reports/${bottleId}/status`)
    .set('Cookie', gamma)
    .send({ status: 'recovered' });
  assert(recoveredFound.status === 400, 'found report cannot be marked recovered');
  const closedFound = await request
    .patch(`/api/reports/${bottleId}/status`)
    .set('Cookie', gamma)
    .send({ status: 'closed' });
  assert(closedFound.status === 200, 'owner can close a found report');

  const adminForbidden = await request.get('/api/admin/reports').set('Cookie', alpha);
  assert(adminForbidden.status === 403, 'student cannot use admin report APIs');

  const adminAll = await request.get('/api/admin/reports').set('Cookie', admin);
  assert(adminAll.status === 200, 'admin can list all reports');
  assert(adminAll.body.reports.length >= 3, 'admin sees reports from every community');

  const adminSearch = await request.get('/api/admin/reports').query({ search: 'Umbrella' }).set('Cookie', admin);
  assert(adminSearch.status === 200 && adminSearch.body.reports.length === 1, 'admin search works');

  const adminFilter = await request.get('/api/admin/reports').query({ type: 'lost', communityId: communityA._id.toString() }).set('Cookie', admin);
  assert(adminFilter.status === 200 && adminFilter.body.reports.length >= 1, 'admin filter works');

  const adminDetail = await request.get(`/api/admin/reports/${employeeReport.body.report.id}`).set('Cookie', admin);
  assert(adminDetail.status === 200, 'admin can view any report');

  const adminStatus = await request
    .patch(`/api/admin/reports/${employeeReport.body.report.id}/status`)
    .set('Cookie', admin)
    .send({ status: 'invalid' });
  assert(adminStatus.status === 200 && adminStatus.body.report.status === 'invalid', 'admin can mark a report invalid');

  const imageOk = await request.get(`/api/reports/${lostId}/image`).set('Cookie', alpha);
  assert(imageOk.status === 200, 'owner can fetch the image');
  assert(String(imageOk.headers['content-type']).includes('image/png'), 'image content type is png');

  const imageDenied = await request.get(`/api/reports/${lostId}/image`).set('Cookie', beta);
  assert(imageDenied.status === 404, 'non-owner cannot fetch the image');

  const adminImage = await request.get(`/api/reports/${lostId}/image`).set('Cookie', admin);
  assert(adminImage.status === 200, 'admin can fetch the image');

  const inactiveList = await request.get('/api/reports').set('Cookie', inactiveCookie);
  assert(inactiveList.status === 403, 'inactive account cannot use reports');

  const futureDate = await request
    .post('/api/reports')
    .set('Cookie', gamma)
    .field('reportType', 'lost')
    .field('itemName', 'Future Bag')
    .field('category', 'bags')
    .field('description', 'This date should be rejected by validation.')
    .field('location', 'Gate 2')
    .field('approximateDate', '2099-01-01');
  assert(futureDate.status === 400, 'future dates are rejected');

  const toDelete = await request
    .post('/api/reports')
    .set('Cookie', gamma)
    .field('reportType', 'found')
    .field('itemName', 'Notebook')
    .field('category', 'books')
    .field('description', 'Spiral notebook found in the classroom.')
    .field('location', 'Room 12')
    .field('approximateDate', '2026-09-04');
  assert(toDelete.status === 201, 'report created for delete tests');
  const deleteId = toDelete.body.report.id;

  const otherDelete = await request.delete(`/api/reports/${deleteId}`).set('Cookie', alpha);
  assert(otherDelete.status === 404, 'non-owner cannot delete');

  const ownerDelete = await request.delete(`/api/reports/${deleteId}`).set('Cookie', gamma);
  assert(ownerDelete.status === 200, 'owner can delete own report');
  const gone = await request.get(`/api/reports/${deleteId}`).set('Cookie', gamma);
  assert(gone.status === 404, 'deleted report is gone');

  const adminTarget = employeeReport.body.report.id;
  const studentAdminDelete = await request.delete(`/api/admin/reports/${adminTarget}`).set('Cookie', alpha);
  assert(studentAdminDelete.status === 403, 'student cannot use admin delete');

  const adminDelete = await request.delete(`/api/admin/reports/${adminTarget}`).set('Cookie', admin);
  assert(adminDelete.status === 200, 'admin can delete any report');

  const blockedCommunity = await request.delete(`/api/admin/communities/${communityA._id}`).set('Cookie', admin);
  assert(blockedCommunity.status === 409, 'community with members cannot be deleted');

  const studentCommunityDelete = await request.delete(`/api/admin/communities/${communityA._id}`).set('Cookie', alpha);
  assert(studentCommunityDelete.status === 403, 'student cannot delete communities');

  const emptyCommunity = await request.post('/api/admin/communities').set('Cookie', admin).send({ name: 'Temp Empty Group' });
  assert(emptyCommunity.status === 201, 'empty community created for delete');
  const emptyId = emptyCommunity.body.community.id;
  const emptyDelete = await request.delete(`/api/admin/communities/${emptyId}`).set('Cookie', admin);
  assert(emptyDelete.status === 200, 'admin can delete an empty community');
  const emptyGone = await request.get('/api/admin/communities').set('Cookie', admin);
  assert(
    emptyGone.status === 200 && !(emptyGone.body.communities || []).some((item) => item.id === emptyId),
    'deleted community is gone from the list'
  );

  await mongoose.disconnect();
  await mongod.stop();
  fs.rmSync(uploadDir, { recursive: true, force: true });

  console.log(`Module 2 tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
