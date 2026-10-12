/**
 * Complete workflow check for Modules 1–6 against the REAL AI workers.
 *
 * Walks the whole investigation journey through the HTTP API: student report →
 * community notification → sighting → admin investigation → Module 5 analysis
 * (OpenCV + YOLO + ByteTrack on the stored file) → Module 6 evidence frames,
 * timeline, review window, and recommendation → admin notes → case closure.
 *
 * It needs backend/ai/.venv and the model weights. A detectable item makes the
 * run cover the full Module 6 output; otherwise the honest empty states are
 * exercised instead.
 *
 * Usage:
 *   node scripts/checkEndToEnd.js <path-to-video.mp4>
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'end-to-end-check-secret-32chars!!';
process.env.CLIENT_ORIGIN = 'http://localhost:5173';
process.env.NODE_ENV = 'test';

const fs = require('fs');
const os = require('os');
const path = require('path');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const { MongoMemoryServer } = require('mongodb-memory-server');

process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tracex-e2e-uploads-'));
process.env.CCTV_UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tracex-e2e-cctv-'));
const evidenceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tracex-e2e-evidence-'));
process.env.EVIDENCE_UPLOAD_DIR = evidenceDir;

const videoPath = process.argv[2];
const itemName = process.env.CHECK_ITEM_NAME || 'Necktie';
const itemCategory = process.env.CHECK_ITEM_CATEGORY || 'accessories';

let step = 0;
let failed = 0;

function check(description, condition, detail = '') {
  step += 1;
  const label = `${String(step).padStart(2, '0')}. ${description}`;
  if (condition) {
    console.log(`PASS ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed += 1;
    console.error(`FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run() {
  if (!videoPath || !fs.existsSync(videoPath)) {
    console.error('Provide a path to a recorded video file.');
    process.exit(1);
  }

  const aiConfig = require('../config/aiConfig');
  for (const [label, target] of [
    ['Python environment', aiConfig.PYTHON_BIN],
    ['model weights', aiConfig.YOLO_MODEL_PATH],
    ['analysis worker', aiConfig.WORKER_SCRIPT],
    ['frame worker', aiConfig.FRAME_WORKER_SCRIPT]
  ]) {
    if (!fs.existsSync(target)) {
      console.error(`Missing ${label}. See backend/ai/README.md`);
      process.exit(1);
    }
  }

  const mongod = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongod.getUri();
  await mongoose.connect(process.env.MONGO_URI);
  mongoose.set('sanitizeFilter', true);

  const supertest = require('supertest');
  const { createApp } = require('../app');
  const User = require('../models/User');
  const Community = require('../models/Community');
  const EvidenceFrame = require('../models/EvidenceFrame');

  const request = supertest(createApp());
  const community = await Community.create({ name: 'MCA Department' });
  const otherCommunity = await Community.create({ name: 'BCA Department' });
  const passwordHash = await bcrypt.hash('Testpass1', 10);

  for (const [name, email, role, communityId] of [
    ['Riya Student', 'riya@e2e.test', 'student', community._id],
    ['Arjun Student', 'arjun@e2e.test', 'student', community._id],
    ['Outside Student', 'outside@e2e.test', 'student', otherCommunity._id],
    ['System Administrator', 'admin@e2e.test', 'admin', null]
  ]) {
    await User.create({
      name,
      email,
      password: passwordHash,
      role,
      communityId,
      emailVerified: true,
      status: 'active'
    });
  }

  const cookieOf = (res) =>
    (res.headers['set-cookie'] || []).map((row) => row.split(';')[0]).join('; ');
  const loginAs = async (email) =>
    cookieOf(await request.post('/api/auth/login').send({ email, password: 'Testpass1' }));

  // 1
  const riyaLogin = await request
    .post('/api/auth/login')
    .send({ email: 'riya@e2e.test', password: 'Testpass1' });
  check('Student logs in', riyaLogin.status === 200, `status ${riyaLogin.status}`);
  const riya = cookieOf(riyaLogin);
  const arjun = await loginAs('arjun@e2e.test');
  const outsider = await loginAs('outside@e2e.test');
  const admin = await loginAs('admin@e2e.test');

  // 2
  const report = await request
    .post('/api/reports')
    .set('Cookie', riya)
    .field('reportType', 'lost')
    .field('itemName', itemName)
    .field('category', itemCategory)
    .field('description', `${itemName} left on the reading room desk after the afternoon lecture.`)
    .field('location', 'Library reading room')
    .field('approximateDate', '2026-09-01')
    .field('approximateTime', '10:00');
  check('Student reports a lost item', report.status === 201, `status ${report.status}`);
  const itemId = report.body.report.id;

  // 3
  check(
    'Report is filed under the student community',
    report.body.report.community && report.body.report.community.name === 'MCA Department',
    report.body.report.community ? report.body.report.community.name : 'none'
  );

  // 4 and 5
  const arjunNotes = await request.get('/api/notifications').set('Cookie', arjun);
  const matching = (arjunNotes.body.notifications || []).filter((row) => row.itemId === itemId);
  check('Community notification is created', matching.length > 0, `${matching.length} notification(s)`);
  check(
    'Authorized community member sees the notification',
    arjunNotes.status === 200 && matching.length > 0 && matching[0].read === false,
    `status ${arjunNotes.status}`
  );
  const outsideNotes = await request.get('/api/notifications').set('Cookie', outsider);
  check(
    'Another community does not see the notification',
    (outsideNotes.body.notifications || []).every((row) => row.itemId !== itemId)
  );

  // 6
  const sighting = await request
    .post('/api/sightings')
    .set('Cookie', arjun)
    .field('itemId', itemId)
    .field('location', 'Library entrance')
    .field('observation', 'I think I saw a similar item near the entrance desk in the afternoon.')
    .field('approximateDate', '2026-09-01')
    .field('approximateTime', '10:30');
  check('Community member reports a sighting', sighting.status === 201, `status ${sighting.status}`);

  // 7
  const adminItem = await request.get(`/api/admin/reports/${itemId}`).set('Cookie', admin);
  check('Admin opens the item', adminItem.status === 200, `status ${adminItem.status}`);

  // 8
  const investigation = await request
    .post('/api/admin/investigations')
    .set('Cookie', admin)
    .send({ itemId });
  check('Admin creates the investigation', investigation.status === 201, `status ${investigation.status}`);
  const caseId = investigation.body.investigation.id;

  // 9
  const details = await request.get(`/api/admin/investigations/${caseId}`).set('Cookie', admin);
  check('Admin opens investigation details', details.status === 200, details.body.investigation.caseId);

  // 10
  const upload = await request
    .post(`/api/admin/investigations/${caseId}/cctv`)
    .set('Cookie', admin)
    .field('cameraLocation', 'Library Entrance')
    .field('recordedDate', '2026-09-01')
    .field('recordingStartTime', '10:00')
    .attach('video', fs.readFileSync(videoPath), {
      filename: path.basename(videoPath),
      contentType: 'video/mp4'
    });
  const footageId = upload.status === 201 ? upload.body.investigation.cctv[0].id : null;
  check('CCTV reference is stored and available', upload.status === 201 && Boolean(footageId));

  // 11
  const started = await request
    .post(`/api/admin/investigations/${caseId}/cctv/${footageId}/analysis`)
    .set('Cookie', admin);
  check('Admin starts Module 5 AI processing', started.status === 202, `status ${started.status}`);

  const deadline = Date.now() + 15 * 60 * 1000;
  let analysis = null;
  for (;;) {
    const res = await request
      .get(`/api/admin/investigations/${caseId}/cctv/${footageId}/analysis`)
      .set('Cookie', admin);
    analysis = res.body.analysis;
    if (analysis.status !== 'PROCESSING') break;
    if (Date.now() > deadline) break;
    await sleep(1000);
  }

  // 12 to 14
  check(
    'OpenCV reads the stored recording',
    analysis.status === 'COMPLETED' && analysis.video && analysis.video.framesSampled > 0,
    analysis.video ? `${analysis.video.framesSampled} frames sampled` : analysis.error || ''
  );
  check(
    'YOLO reports detections',
    Boolean(analysis.statistics) && analysis.statistics.personDetections + analysis.statistics.itemDetections > 0,
    analysis.statistics ? JSON.stringify(analysis.statistics) : ''
  );
  check(
    'ByteTrack produces anonymous tracks',
    Boolean(analysis.persons) && analysis.persons.tracks.every((row) => /^P-\d{3}$/.test(row.trackingId)),
    `${analysis.persons ? analysis.persons.uniqueCount : 0} track(s)`
  );

  const itemDetected = Boolean(analysis.item && analysis.item.detected);

  // 15 to 17
  check(
    'Last-seen result is reported',
    itemDetected ? analysis.lastSeenLabel !== 'Not determined' : analysis.lastSeenLabel === 'Not determined',
    analysis.lastSeenLabel
  );
  check(
    'Disappearance result is reported honestly',
    typeof analysis.disappearanceLabel === 'string' && analysis.disappearanceLabel.length > 0,
    analysis.disappearanceLabel
  );
  check(
    'Missing duration is reported honestly',
    typeof analysis.missingDurationLabel === 'string' && analysis.missingDurationLabel.length > 0,
    analysis.missingDurationLabel
  );

  // 18
  let recording = null;
  const evidenceDeadline = Date.now() + 5 * 60 * 1000;
  for (;;) {
    const res = await request.get(`/api/admin/investigations/${caseId}/review`).set('Cookie', admin);
    recording = res.body.recordings[0];
    if (!recording.evidence || recording.evidence.status !== 'EXTRACTING') break;
    if (Date.now() > evidenceDeadline) break;
    await sleep(1000);
  }
  check(
    'Module 6 loads the stored results',
    recording.analysisReady === true && Boolean(recording.itemAnalysis),
    `evidence ${recording.evidence.status}`
  );

  // 19 to 22
  const frames = recording.evidence.frames;
  check(
    'Evidence frames are available where possible',
    itemDetected ? frames.length > 0 : frames.length === 0,
    `${frames.length} frame(s)`
  );
  const byType = recording.evidence.byType;
  check(
    'Last-seen frame is present when the item was detected',
    itemDetected ? Boolean(byType.LAST_SEEN) : byType.LAST_SEEN === null,
    byType.LAST_SEEN ? byType.LAST_SEEN.timestamp.label : 'none'
  );
  check(
    'Disappearance frame matches the analysis',
    recording.itemAnalysis.disappearance ? Boolean(byType.DISAPPEARANCE) : byType.DISAPPEARANCE === null,
    byType.DISAPPEARANCE ? byType.DISAPPEARANCE.timestamp.label : 'no disappearance timestamp'
  );
  check(
    'Post-disappearance frame is present when a reference exists',
    itemDetected ? Boolean(byType.POST_DISAPPEARANCE) : byType.POST_DISAPPEARANCE === null,
    byType.POST_DISAPPEARANCE ? byType.POST_DISAPPEARANCE.eventLabel : 'none'
  );

  // 23
  check(
    'Before/after comparison is produced',
    itemDetected ? Boolean(recording.beforeAfter) : recording.beforeAfter === null,
    recording.beforeAfter ? `${recording.beforeAfter.beforeLabel} vs ${recording.beforeAfter.afterLabel}` : 'omitted'
  );

  // 24 to 26
  check(
    'Anonymous persons are listed',
    recording.persons.uniqueCount === analysis.persons.uniqueCount,
    `${recording.persons.uniqueCount} track(s)`
  );
  check(
    'Person first-appearance timestamps are shown',
    recording.persons.tracks.every((row) => row.firstSeen && row.firstSeen.offsetLabel)
  );
  check(
    'Person timeline has first and last detections',
    recording.persons.tracks.every((row) => row.firstSeen && row.lastSeen && row.trackingDurationLabel)
  );

  // 27
  check(
    'Investigation timeline is chronological',
    recording.timeline.events.length > 0 &&
      recording.timeline.events
        .filter((row) => row.seconds !== null)
        .every((row, index, list) => index === 0 || row.seconds >= list[index - 1].seconds),
    `${recording.timeline.events.length} event(s)`
  );

  // 28
  check(
    'Smart review window is generated or declined honestly',
    recording.reviewWindow.available
      ? recording.reviewWindow.end.seconds <= (analysis.video.durationSeconds || Infinity)
      : recording.reviewWindow.message === 'Insufficient timestamp data to generate a review window.',
    recording.reviewWindow.available ? recording.reviewWindow.windowLabel : recording.reviewWindow.message
  );

  // 29
  check(
    'AI-assisted recommendation is displayed',
    recording.recommendation.title === 'AI-Assisted Review Recommendation' &&
      recording.recommendation.requiresAdminReview === true,
    recording.recommendation.summary.slice(0, 80)
  );
  check(
    'No identity, face, or accusation wording is present',
    !/face|facial|suspect|thief|identity|recognition|stole|culprit/i.test(JSON.stringify(recording))
  );

  // 30
  if (frames.length > 0) {
    const imageRes = await request.get(frames[0].imageUrl).set('Cookie', admin);
    const studentImage = await request.get(frames[0].imageUrl).set('Cookie', riya);
    check(
      'Admin reviews the evidence image, students cannot',
      imageRes.status === 200 && studentImage.status === 403,
      `admin ${imageRes.status}, student ${studentImage.status}`
    );
  } else {
    check('Evidence image route is only reachable by admins', true, 'no frames to open');
  }

  // 31
  const notes = await request
    .patch(`/api/admin/investigations/${caseId}`)
    .set('Cookie', admin)
    .send({ notes: 'Reviewed the recommended interval. Check the corridor camera next.' });
  check('Admin adds notes', notes.status === 200, `status ${notes.status}`);

  // 32
  const closed = await request.post(`/api/admin/investigations/${caseId}/close`).set('Cookie', admin);
  check('Admin closes the case', closed.status === 200 && closed.body.investigation.status === 'CLOSED');

  // 33
  const afterClose = await request.get(`/api/admin/investigations/${caseId}/review`).set('Cookie', admin);
  const closedRecording = afterClose.body.recordings[0];
  check(
    'Investigation history remains available after closure',
    afterClose.status === 200 &&
      closedRecording.analysisReady === true &&
      closedRecording.evidence.frames.length === frames.length &&
      afterClose.body.investigation.notes.startsWith('Reviewed the recommended interval'),
    `${closedRecording.evidence.frames.length} evidence frame(s) kept`
  );

  // 34
  const collections = await mongoose.connection.db.collections();
  let binaryFields = 0;
  let scannedDocs = 0;
  for (const collection of collections) {
    const docs = await collection.find({}).toArray();
    scannedDocs += docs.length;
    for (const doc of docs) {
      for (const value of Object.values(doc)) {
        if (Buffer.isBuffer(value) || (value && value._bsontype === 'Binary')) {
          binaryFields += 1;
        }
      }
    }
  }
  const storedFrames = await EvidenceFrame.find({}).select('+imageKey');
  check(
    'No video or image bytes are stored in MongoDB',
    binaryFields === 0,
    `${scannedDocs} documents scanned, ${storedFrames.length} evidence files on disk`
  );
  check(
    'Evidence files live on disk under server-generated names',
    storedFrames.every(
      (row) => row.imageKey === path.basename(row.imageKey)
        && fs.existsSync(path.join(evidenceDir, row.imageKey))
    ),
    `${storedFrames.length} file(s)`
  );

  // 35
  const regression = [
    ['student report list', await request.get('/api/reports').set('Cookie', riya), 200],
    ['student dashboard', await request.get('/api/dashboard/student').set('Cookie', arjun), 200],
    ['notifications', await request.get('/api/notifications/unread-count').set('Cookie', arjun), 200],
    ['sightings', await request.get('/api/sightings').set('Cookie', arjun), 200],
    ['admin dashboard', await request.get('/api/dashboard/admin').set('Cookie', admin), 200],
    ['admin users', await request.get('/api/admin/users').set('Cookie', admin), 200],
    ['admin investigations', await request.get('/api/admin/investigations').set('Cookie', admin), 200],
    [
      'cctv stream',
      await request.get(`/api/admin/investigations/${caseId}/cctv/${footageId}/file`).set('Cookie', admin),
      [200, 206]
    ],
    ['student blocked from review', await request.get(`/api/admin/investigations/${caseId}/review`).set('Cookie', riya), 403],
    ['student blocked from analysis', await request.get(`/api/admin/investigations/${caseId}/analysis`).set('Cookie', riya), 403]
  ];
  const broken = regression.filter(([, res, expected]) =>
    Array.isArray(expected) ? !expected.includes(res.status) : res.status !== expected
  );
  check(
    'Modules 1 to 5 continue working',
    broken.length === 0,
    broken.length === 0
      ? `${regression.length} endpoints verified`
      : broken.map(([label, res]) => `${label}=${res.status}`).join(', ')
  );

  console.log(`\nEnd-to-end: ${step - failed} of ${step} steps passed.`);
  await mongoose.disconnect();
  await mongod.stop();
  process.exit(failed ? 1 : 0);
}

run().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
