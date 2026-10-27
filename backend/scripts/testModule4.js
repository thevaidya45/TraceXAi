process.env.JWT_SECRET = process.env.JWT_SECRET || 'module4-test-secret-value-32chars!!';
process.env.CLIENT_ORIGIN = 'http://localhost:5173';
process.env.NODE_ENV = 'test';

const fs = require('fs');
const os = require('os');
const path = require('path');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const { MongoMemoryServer } = require('mongodb-memory-server');

const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tracex-uploads-'));
const cctvDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tracex-cctv-'));
process.env.UPLOAD_DIR = uploadDir;
process.env.CCTV_UPLOAD_DIR = cctvDir;

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

function fakeMp4() {
  const buf = Buffer.alloc(64);
  buf.writeUInt32BE(24, 0);
  buf.write('ftyp', 4);
  buf.write('isom', 8);
  return buf;
}

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
  const Investigation = require('../models/Investigation');
  const CctvFootage = require('../models/CctvFootage');

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
  const employee = await login('employee@college.test');
  const admin = await login('admin@college.test');

  const lost = await request
    .post('/api/reports')
    .set('Cookie', alpha)
    .field('reportType', 'lost')
    .field('itemName', 'Campus Laptop')
    .field('category', 'electronics')
    .field('description', 'Grey laptop reported near the library entrance.')
    .field('location', 'Library')
    .field('approximateDate', '2026-09-01');
  assert(lost.status === 201, 'lost report created');
  const lostId = lost.body.report.id;

  const found = await request
    .post('/api/reports')
    .set('Cookie', alpha)
    .field('reportType', 'found')
    .field('itemName', 'Blue Umbrella')
    .field('category', 'other')
    .field('description', 'Umbrella left at the administration desk after rain.')
    .field('location', 'Admin desk')
    .field('approximateDate', '2026-09-01');
  assert(found.status === 201, 'found report created');
  const foundId = found.body.report.id;

  const otherLost = await request
    .post('/api/reports')
    .set('Cookie', beta)
    .field('reportType', 'lost')
    .field('itemName', 'ID Card')
    .field('category', 'documents')
    .field('description', 'College ID card missing from the BCA classroom.')
    .field('location', 'BCA block')
    .field('approximateDate', '2026-09-02');
  assert(otherLost.status === 201, 'second community lost report created');
  const otherLostId = otherLost.body.report.id;

  await Investigation.collection.insertOne({
    status: 'no_match',
    createdAt: new Date(),
    updatedAt: new Date()
  });

  const studentCreate = await request.post('/api/admin/investigations').set('Cookie', alpha).send({ itemId: lostId });
  assert(studentCreate.status === 403, 'student cannot create investigation');

  const employeeCreate = await request.post('/api/admin/investigations').set('Cookie', employee).send({ itemId: lostId });
  assert(employeeCreate.status === 403, 'employee cannot create investigation');

  const studentList = await request.get('/api/admin/investigations').set('Cookie', alpha);
  assert(studentList.status === 403, 'student cannot list investigations');

  const created = await request
    .post('/api/admin/investigations')
    .set('Cookie', admin)
    .send({ itemId: lostId, notes: 'Reported missing between 11:00 and 11:30.', communityId: String(communityB._id) });
  assert(created.status === 201, `admin can create investigation (${created.status})`);
  const caseId = created.body.investigation && created.body.investigation.id;
  assert(created.body.investigation.caseId === 'INV-0001', 'first case id is INV-0001');
  assert(created.body.investigation.status === 'CREATED', 'new case starts CREATED');
  assert(created.body.investigation.community && created.body.investigation.community.name === 'MCA Test', 'community comes from the item');
  assert(created.body.investigation.item && created.body.investigation.item.id === lostId, 'investigation references the item');
  assert(!JSON.stringify(created.body).includes(cctvDir), 'response does not expose CCTV storage path');

  const duplicate = await request.post('/api/admin/investigations').set('Cookie', admin).send({ itemId: lostId });
  assert(duplicate.status === 409, 'duplicate open investigation is rejected');
  assert(duplicate.body.investigation && duplicate.body.investigation.id === caseId, 'duplicate response includes existing case');

  const missingItem = await request.post('/api/admin/investigations').set('Cookie', admin).send({ itemId: new mongoose.Types.ObjectId().toString() });
  assert(missingItem.status === 404, 'unknown item cannot be investigated');

  await request.patch(`/api/admin/reports/${foundId}/status`).set('Cookie', admin).send({ status: 'claimed' });
  const claimedCreate = await request.post('/api/admin/investigations').set('Cookie', admin).send({ itemId: foundId });
  assert(claimedCreate.status === 400, 'claimed found report is not eligible');
  await request.patch(`/api/admin/reports/${foundId}/status`).set('Cookie', admin).send({ status: 'active' });

  const foundCase = await request.post('/api/admin/investigations').set('Cookie', admin).send({ itemId: foundId });
  assert(foundCase.status === 201, 'active found report can be investigated');

  const otherCase = await request.post('/api/admin/investigations').set('Cookie', admin).send({ itemId: otherLostId });
  assert(otherCase.status === 201, 'admin can investigate another community item');
  const otherCaseId = otherCase.body.investigation.id;

  const list = await request.get('/api/admin/investigations').set('Cookie', admin);
  assert(list.status === 200, 'admin can list investigations');
  assert(Array.isArray(list.body.investigations) && list.body.investigations.length >= 3, 'list includes created cases');

  const search = await request.get('/api/admin/investigations').set('Cookie', admin).query({ search: 'INV-0001' });
  assert(search.status === 200 && search.body.investigations.length === 1, 'search by case id works');

  const statusFilter = await request.get('/api/admin/investigations').set('Cookie', admin).query({ status: 'CREATED' });
  assert(statusFilter.status === 200 && statusFilter.body.investigations.length >= 1, 'status filter works');

  const communityFilter = await request.get('/api/admin/investigations').set('Cookie', admin).query({ communityId: String(communityB._id) });
  assert(communityFilter.status === 200 && communityFilter.body.investigations.some((row) => row.id === otherCaseId), 'community filter works');

  const details = await request.get(`/api/admin/investigations/${caseId}`).set('Cookie', admin);
  assert(details.status === 200, 'admin can open investigation details');
  assert(details.body.investigation.notes.includes('11:00'), 'notes are stored');

  const studentDetails = await request.get(`/api/admin/investigations/${caseId}`).set('Cookie', alpha);
  assert(studentDetails.status === 403, 'student cannot open investigation details');

  const bogusId = await request.get(`/api/admin/investigations/${new mongoose.Types.ObjectId().toString()}`).set('Cookie', admin);
  assert(bogusId.status === 404, 'unknown investigation is 404');

  const badId = await request.get('/api/admin/investigations/not-an-id').set('Cookie', admin);
  assert(badId.status === 404, 'invalid investigation id is 404');

  const readyTooSoon = await request.patch(`/api/admin/investigations/${caseId}`).set('Cookie', admin).send({ status: 'READY' });
  assert(readyTooSoon.status === 400, 'READY requires CCTV');

  const futureStatus = await request.patch(`/api/admin/investigations/${caseId}`).set('Cookie', admin).send({ status: 'PROCESSING' });
  assert(futureStatus.status === 400, 'PROCESSING is reserved');

  const pngUpload = await request
    .post(`/api/admin/investigations/${caseId}/cctv`)
    .set('Cookie', admin)
    .field('cameraLocation', 'Library Entrance')
    .field('recordedDate', '2026-09-01')
    .attach('video', PNG, { filename: 'photo.png', contentType: 'image/png' });
  assert(pngUpload.status === 400, 'image file is rejected as CCTV');

  const traversalName = await request
    .post(`/api/admin/investigations/${caseId}/cctv`)
    .set('Cookie', admin)
    .field('cameraLocation', 'Library Entrance')
    .field('recordedDate', '2026-09-01')
    .field('recordingStartTime', '10:00')
    .field('recordingEndTime', '12:00')
    .attach('video', fakeMp4(), { filename: '../../etc/passwd.mp4', contentType: 'video/mp4' });
  assert(traversalName.status === 201, 'malicious filename is accepted after sanitizing');
  const firstClip = traversalName.body.investigation.cctv[0];
  assert(firstClip && !String(firstClip.filename).includes('..'), 'stored filename has no path traversal');
  assert(!JSON.stringify(traversalName.body).includes(cctvDir), 'CCTV metadata has no filesystem path');
  assert(traversalName.body.investigation.status === 'CCTV_SELECTED', 'status moves to CCTV_SELECTED');

  const filesAfterUpload = fs.readdirSync(cctvDir);
  assert(filesAfterUpload.length === 1, 'one CCTV file stored on disk');
  assert(filesAfterUpload[0].endsWith('.mp4'), 'stored file uses generated key');
  assert(!filesAfterUpload[0].includes('passwd'), 'original name is not used as disk key');

  const secondClip = await request
    .post(`/api/admin/investigations/${caseId}/cctv`)
    .set('Cookie', admin)
    .field('cameraLocation', 'Library Corridor')
    .field('recordedDate', '2026-09-01')
    .attach('video', fakeMp4(), { filename: 'corridor.mp4', contentType: 'video/mp4' });
  assert(secondClip.status === 201, 'multiple CCTV files allowed');
  assert(secondClip.body.investigation.cctv.length === 2, 'two CCTV references on the case');

  const fileRes = await request
    .get(`/api/admin/investigations/${caseId}/cctv/${firstClip.id}/file`)
    .set('Cookie', admin);
  assert(fileRes.status === 200 || fileRes.status === 206, `admin can preview CCTV (${fileRes.status})`);
  assert(String(fileRes.headers['content-type']).includes('video/mp4'), 'preview is video/mp4');

  const studentFile = await request
    .get(`/api/admin/investigations/${caseId}/cctv/${firstClip.id}/file`)
    .set('Cookie', alpha);
  assert(studentFile.status === 403, 'student cannot access CCTV file');

  const employeeFile = await request
    .get(`/api/admin/investigations/${caseId}/cctv/${firstClip.id}/file`)
    .set('Cookie', employee);
  assert(employeeFile.status === 403, 'employee cannot access CCTV file');

  const crossFile = await request
    .get(`/api/admin/investigations/${otherCaseId}/cctv/${firstClip.id}/file`)
    .set('Cookie', admin);
  assert(crossFile.status === 404, 'CCTV from another case is not found');

  const notesUpdate = await request
    .patch(`/api/admin/investigations/${caseId}`)
    .set('Cookie', admin)
    .send({ notes: 'Relevant CCTV footage selected for review.' });
  assert(notesUpdate.status === 200, 'admin can update notes');
  assert(notesUpdate.body.investigation.notes.includes('CCTV footage selected'), 'updated notes persist');

  const ready = await request
    .patch(`/api/admin/investigations/${caseId}`)
    .set('Cookie', admin)
    .send({ status: 'READY' });
  assert(ready.status === 200, 'admin can set READY after CCTV');
  assert(ready.body.investigation.status === 'READY', 'status is READY');

  const studentPatch = await request
    .patch(`/api/admin/investigations/${caseId}`)
    .set('Cookie', alpha)
    .send({ notes: 'tamper' });
  assert(studentPatch.status === 403, 'student cannot update investigation');

  const deleteBlocked = await request.delete(`/api/admin/reports/${lostId}`).set('Cookie', admin);
  assert(deleteBlocked.status === 409, 'report with investigation cannot be deleted');

  const ownerDelete = await request.delete(`/api/reports/${lostId}`).set('Cookie', alpha);
  assert(ownerDelete.status === 409, 'owner cannot delete a report under investigation');

  const closeStudent = await request.post(`/api/admin/investigations/${caseId}/close`).set('Cookie', alpha);
  assert(closeStudent.status === 403, 'student cannot close investigation');

  const closed = await request.post(`/api/admin/investigations/${caseId}/close`).set('Cookie', admin);
  assert(closed.status === 200, 'admin can close investigation');
  assert(closed.body.investigation.status === 'CLOSED', 'closed status stored');
  assert(Boolean(closed.body.investigation.completedAt), 'completedAt set on close');

  const stillThere = await request.get(`/api/admin/investigations/${caseId}`).set('Cookie', admin);
  assert(stillThere.status === 200 && stillThere.body.investigation.status === 'CLOSED', 'closed case remains stored');
  assert((stillThere.body.investigation.cctv || []).length === 2, 'CCTV references remain after close');

  const closedUpdate = await request.patch(`/api/admin/investigations/${caseId}`).set('Cookie', admin).send({ notes: 'after close' });
  assert(closedUpdate.status === 409, 'closed case cannot be updated');

  const closedCctv = await request
    .post(`/api/admin/investigations/${caseId}/cctv`)
    .set('Cookie', admin)
    .field('cameraLocation', 'Main Gate')
    .field('recordedDate', '2026-09-01')
    .attach('video', fakeMp4(), { filename: 'gate.mp4', contentType: 'video/mp4' });
  assert(closedCctv.status === 409, 'cannot add CCTV to a closed case');

  const recreate = await request.post('/api/admin/investigations').set('Cookie', admin).send({ itemId: lostId });
  assert(recreate.status === 201, 'a new investigation can be created after the previous one is closed');

  const stored = await Investigation.findById(caseId);
  const clips = await CctvFootage.find({ investigationId: caseId }).select('+fileKey');
  assert(Boolean(stored), 'closed investigation document remains');
  assert(clips.length === 2, 'CCTV documents remain');
  assert(clips.every((clip) => Boolean(clip.fileKey) && !clip.fileKey.includes('..')), 'file keys are generated names');

  const reportView = await request.get(`/api/admin/reports/${lostId}`).set('Cookie', admin);
  assert(reportView.status === 200, 'admin report still loads');
  assert(reportView.body.investigation && reportView.body.investigation.id === recreate.body.investigation.id, 'open investigation is returned with the report');

  console.log(`Module 4 tests: ${passed} passed, ${failed} failed`);
  await mongoose.disconnect();
  await mongod.stop();
  process.exit(failed ? 1 : 0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
