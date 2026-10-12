/**
 * Modules 5 and 6 integration check against the REAL workers.
 *
 * Unlike `npm run test:module5` / `test:module6` (which stub the workers so
 * they can run anywhere), this script uploads a real video through the admin
 * API, runs OpenCV + YOLO + ByteTrack, then extracts the real evidence stills
 * and prints the Module 6 analysis. It needs backend/ai/.venv and the model
 * weights.
 *
 * Usage:
 *   node scripts/checkAiPipeline.js <path-to-video.mp4> [recordingStartTime]
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'ai-pipeline-check-secret-32chars!!';
process.env.CLIENT_ORIGIN = 'http://localhost:5173';
process.env.NODE_ENV = 'test';

const fs = require('fs');
const os = require('os');
const path = require('path');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const { MongoMemoryServer } = require('mongodb-memory-server');

process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tracex-check-uploads-'));
process.env.CCTV_UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tracex-check-cctv-'));
const evidenceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tracex-check-evidence-'));
process.env.EVIDENCE_UPLOAD_DIR = evidenceDir;

const videoPath = process.argv[2];
const recordingStartTime = process.argv[3] || '10:00';
const itemName = process.env.CHECK_ITEM_NAME || 'Necktie';
const itemCategory = process.env.CHECK_ITEM_CATEGORY || 'accessories';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run() {
  if (!videoPath || !fs.existsSync(videoPath)) {
    console.error('Provide a path to a recorded video file.');
    process.exit(1);
  }

  const aiConfig = require('../config/aiConfig');
  if (!fs.existsSync(aiConfig.PYTHON_BIN)) {
    console.error(`Python environment missing at ${aiConfig.PYTHON_BIN}. Run: npm run ai:setup`);
    process.exit(1);
  }
  if (!fs.existsSync(aiConfig.YOLO_MODEL_PATH)) {
    console.error(`Model weights missing at ${aiConfig.YOLO_MODEL_PATH}. See backend/ai/README.md`);
    process.exit(1);
  }

  const mongod = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongod.getUri();
  await mongoose.connect(process.env.MONGO_URI);
  mongoose.set('sanitizeFilter', true);

  const supertest = require('supertest');
  const { createApp } = require('../app');
  const User = require('../models/User');
  const Community = require('../models/Community');

  const request = supertest(createApp());
  const community = await Community.create({ name: 'Pipeline Check' });
  const passwordHash = await bcrypt.hash('Testpass1', 10);

  await User.create({
    name: 'Check Student',
    email: 'student@check.test',
    password: passwordHash,
    role: 'student',
    communityId: community._id,
    emailVerified: true,
    status: 'active'
  });
  await User.create({
    name: 'Check Admin',
    email: 'admin@check.test',
    password: passwordHash,
    role: 'admin',
    communityId: null,
    emailVerified: true,
    status: 'active'
  });

  const cookieOf = (res) =>
    (res.headers['set-cookie'] || []).map((row) => row.split(';')[0]).join('; ');

  const student = cookieOf(
    await request.post('/api/auth/login').send({ email: 'student@check.test', password: 'Testpass1' })
  );
  const admin = cookieOf(
    await request.post('/api/auth/login').send({ email: 'admin@check.test', password: 'Testpass1' })
  );

  const report = await request
    .post('/api/reports')
    .set('Cookie', student)
    .field('reportType', 'lost')
    .field('itemName', itemName)
    .field('category', itemCategory)
    .field('description', `${itemName} reported missing during the pipeline check.`)
    .field('location', 'Library')
    .field('approximateDate', '2026-09-01');
  if (report.status !== 201) {
    throw new Error(`report creation failed (${report.status})`);
  }

  const investigation = await request
    .post('/api/admin/investigations')
    .set('Cookie', admin)
    .send({ itemId: report.body.report.id });
  if (investigation.status !== 201) {
    throw new Error(`investigation creation failed (${investigation.status})`);
  }
  const caseId = investigation.body.investigation.id;

  const upload = await request
    .post(`/api/admin/investigations/${caseId}/cctv`)
    .set('Cookie', admin)
    .field('cameraLocation', 'Library Entrance')
    .field('recordedDate', '2026-09-01')
    .field('recordingStartTime', recordingStartTime)
    .attach('video', fs.readFileSync(videoPath), {
      filename: path.basename(videoPath),
      contentType: 'video/mp4'
    });
  if (upload.status !== 201) {
    throw new Error(`CCTV upload failed (${upload.status}): ${upload.body.message}`);
  }
  const footageId = upload.body.investigation.cctv[0].id;

  const started = await request
    .post(`/api/admin/investigations/${caseId}/cctv/${footageId}/analysis`)
    .set('Cookie', admin);
  console.log(`start: ${started.status} ${started.body.message || started.body.analysis?.status || ''}`);
  if (started.status !== 202) {
    throw new Error(`analysis did not start: ${JSON.stringify(started.body)}`);
  }

  const deadline = Date.now() + 15 * 60 * 1000;
  let analysis = null;
  for (;;) {
    const res = await request
      .get(`/api/admin/investigations/${caseId}/cctv/${footageId}/analysis`)
      .set('Cookie', admin);
    analysis = res.body.analysis;
    if (analysis.status !== 'PROCESSING') {
      console.log(`case status: ${res.body.investigationStatus}`);
      break;
    }
    if (Date.now() > deadline) {
      throw new Error('analysis did not finish in time');
    }
    await sleep(1000);
  }

  console.log(`analysis status: ${analysis.status}`);
  if (analysis.status !== 'COMPLETED') {
    console.error(`error reported to the admin: ${analysis.error}`);
    await mongoose.disconnect();
    await mongod.stop();
    process.exit(1);
  }

  console.log('video:', JSON.stringify(analysis.video));
  console.log('model:', JSON.stringify(analysis.model));
  console.log(`item (${itemName}) target classes:`, analysis.item.targetClasses.join(', ') || 'none');
  console.log('item detected:', analysis.item.detected, analysis.item.note || '');
  console.log('item first seen:', analysis.firstSeenLabel);
  console.log('item last seen:', analysis.lastSeenLabel);
  console.log('disappearance:', analysis.disappearanceLabel, analysis.disappearanceCertainty || '');
  console.log('missing duration:', analysis.missingDurationLabel);
  console.log('unique anonymous people tracks:', analysis.persons.uniqueCount);
  analysis.persons.tracks.slice(0, 5).forEach((track) => {
    console.log(
      `  ${track.trackingId}: ${track.firstSeen.offsetLabel} → ${track.lastSeen.offsetLabel} (${track.framesTracked} frames)`
    );
  });
  console.log('statistics:', JSON.stringify(analysis.statistics));

  // ------------------------------------------------------------- Module 6
  // Opening the review extracts the evidence stills from the same stored file.
  console.log('\n--- Module 6: investigation analysis ---');
  const EvidenceFrame = require('../models/EvidenceFrame');
  const evidenceDeadline = Date.now() + 5 * 60 * 1000;
  let recording = null;
  for (;;) {
    const res = await request
      .get(`/api/admin/investigations/${caseId}/review`)
      .set('Cookie', admin);
    if (res.status !== 200) {
      throw new Error(`review failed (${res.status}): ${JSON.stringify(res.body)}`);
    }
    recording = res.body.recordings[0];
    if (!recording.evidence || recording.evidence.status !== 'EXTRACTING') {
      break;
    }
    if (Date.now() > evidenceDeadline) {
      throw new Error('evidence extraction did not finish in time');
    }
    await sleep(1000);
  }

  console.log('evidence status:', recording.evidence.status, recording.evidence.message || '');
  if (recording.evidence.error) {
    console.error('evidence error:', recording.evidence.error);
  }
  recording.evidence.frames.forEach((frame) => {
    console.log(
      `  ${frame.evidenceType}: ${frame.timestamp.label} · frame ${frame.frameNumber} · ${frame.width}x${frame.height}${frame.trackingId ? ` · ${frame.trackingId}` : ''}`
    );
  });

  const storedFrames = await EvidenceFrame.find({}).select('+imageKey');
  const onDisk = storedFrames.filter((row) => fs.existsSync(path.join(evidenceDir, row.imageKey)));
  console.log(`evidence images on disk: ${onDisk.length} of ${storedFrames.length}`);
  onDisk.slice(0, 3).forEach((row) => {
    const bytes = fs.statSync(path.join(evidenceDir, row.imageKey)).size;
    console.log(`  ${row.evidenceType}: ${bytes} bytes`);
  });

  console.log(
    'before/after:',
    recording.beforeAfter
      ? `${recording.beforeAfter.beforeLabel} vs ${recording.beforeAfter.afterLabel}`
      : 'not available'
  );
  console.log('unique anonymous tracks:', recording.persons.uniqueCount,
    `(after disappearance: ${recording.persons.postDisappearanceCount})`);
  recording.persons.tracks.slice(0, 5).forEach((track) => {
    console.log(`  ${track.trackingId}: ${track.relationLabel || 'no disappearance reference'}`);
  });
  console.log('timeline events:', recording.timeline.events.length);
  recording.timeline.events.slice(0, 8).forEach((event) => {
    console.log(`  [${event.kind}] ${event.time ? event.time.offsetLabel : '—'} ${event.title}`);
  });
  console.log('review window:', recording.reviewWindow.available
    ? `${recording.reviewWindow.windowLabel} — ${recording.reviewWindow.reason}`
    : recording.reviewWindow.message);
  console.log('recommendation:', recording.recommendation.summary);

  const firstFrame = recording.evidence.frames[0];
  if (firstFrame) {
    const imageRes = await request.get(firstFrame.imageUrl).set('Cookie', admin);
    console.log(`evidence image route: ${imageRes.status} ${imageRes.headers['content-type']}`);
    const studentImage = await request.get(firstFrame.imageUrl).set('Cookie', student);
    console.log(`student evidence access: ${studentImage.status} (expected 403)`);
  }

  await mongoose.disconnect();
  await mongod.stop();
  process.exit(0);
}

run().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
