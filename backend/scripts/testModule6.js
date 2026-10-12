process.env.JWT_SECRET = process.env.JWT_SECRET || 'module6-test-secret-value-32chars!!';
process.env.CLIENT_ORIGIN = 'http://localhost:5173';
process.env.NODE_ENV = 'test';
// Deterministic absence window for the disappearance assertions below.
process.env.AI_ITEM_ABSENCE_TOLERANCE_SECONDS = '10';
process.env.REVIEW_WINDOW_LEAD_SECONDS = '180';
process.env.REVIEW_WINDOW_TRAIL_SECONDS = '300';
process.env.EVIDENCE_POST_OFFSET_SECONDS = '10';

const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const { MongoMemoryServer } = require('mongodb-memory-server');

const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tracex-m6-uploads-'));
const cctvDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tracex-m6-cctv-'));
const evidenceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tracex-m6-evidence-'));
process.env.UPLOAD_DIR = uploadDir;
process.env.CCTV_UPLOAD_DIR = cctvDir;
process.env.EVIDENCE_UPLOAD_DIR = evidenceDir;

function fakeMp4() {
  const buf = Buffer.alloc(64);
  buf.writeUInt32BE(24, 0);
  buf.write('ftyp', 4);
  buf.write('isom', 8);
  return buf;
}

// Smallest payload that passes the JPEG magic-byte check in uploadService.
function fakeJpeg() {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    Buffer.alloc(32, 0x20),
    Buffer.from([0xff, 0xd9])
  ]);
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Module 5 worker payload, shaped exactly like backend/ai/analyze_cctv.py.
 * Only the worker is stubbed; every Module 6 derivation below runs the real
 * application code against these real-looking results.
 */
function workerSuccess({
  itemClass = null,
  itemLastSeen = null,
  durationSeconds = 120,
  fps = 10,
  personTracks = [
    { firstSeenSeconds: 5, lastSeenSeconds: 20, framesTracked: 30, bestConfidence: 0.88 },
    { firstSeenSeconds: 45, lastSeenSeconds: 60, framesTracked: 28, bestConfidence: 0.81 },
    { firstSeenSeconds: 70, lastSeenSeconds: 90, framesTracked: 40, bestConfidence: 0.76 }
  ]
} = {}) {
  const sampleTimestamps = [];
  for (let seconds = 0; seconds < durationSeconds; seconds += 0.5) {
    sampleTimestamps.push(Math.round(seconds * 10) / 10);
  }
  const itemTracks = itemClass && itemLastSeen !== null
    ? [
      {
        kind: 'item',
        trackerId: 7,
        yoloClass: itemClass,
        firstSeenSeconds: 2,
        lastSeenSeconds: itemLastSeen,
        framesTracked: 40,
        bestConfidence: 0.83
      }
    ]
    : [];

  return {
    ok: true,
    video: {
      fps,
      frameCount: durationSeconds * fps,
      durationSeconds,
      framesSampled: sampleTimestamps.length,
      frameInterval: 5,
      truncated: false
    },
    model: {
      name: 'yolov8n.pt',
      confidence: 0.35,
      tracker: 'bytetrack.yaml',
      missingClasses: [],
      itemClassesUsed: itemClass ? [itemClass] : []
    },
    personTracks: personTracks.map((row, index) => ({
      kind: 'person',
      trackerId: index + 1,
      yoloClass: 'person',
      ...row
    })),
    itemTracks,
    sampleTimestamps,
    detectionCounts: {
      personDetections: 90,
      itemDetections: itemTracks.length ? 40 : 0
    }
  };
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
  const CctvAnalysis = require('../models/CctvAnalysis');
  const EvidenceFrame = require('../models/EvidenceFrame');
  const analysisService = require('../services/cctvAnalysisService');
  const evidenceService = require('../services/evidenceFrameService');
  const aiConfig = require('../config/aiConfig');

  const app = createApp();
  const request = supertest(app);

  const realRunWorker = analysisService.runWorker;
  const realRunFrameWorker = evidenceService.runFrameWorker;
  let frameWorkerCalls = 0;
  let lastFrameJob = null;

  function stubWorker(resultOrFn) {
    analysisService.runWorker = async (job) =>
      (typeof resultOrFn === 'function' ? resultOrFn(job) : resultOrFn);
  }

  /**
   * Stands in for backend/ai/extract_frames.py: writes one still per requested
   * timestamp into a temporary directory and reports the frame metadata.
   */
  function stubFrameWorker({ unavailableKeys = [], fail = null } = {}) {
    evidenceService.runFrameWorker = async (job) => {
      frameWorkerCalls += 1;
      lastFrameJob = job;
      const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'tracex-m6-worker-'));
      if (fail) {
        return { ok: false, errorCode: fail, tempDir };
      }
      const frames = [];
      for (const target of job.targets) {
        if (unavailableKeys.includes(target.key)) {
          frames.push({ key: target.key, available: false });
          continue;
        }
        const file = path.join(tempDir, `${target.key}.jpg`);
        await fsp.writeFile(file, fakeJpeg());
        frames.push({
          key: target.key,
          available: true,
          file,
          frameNumber: Math.round(target.timestampSeconds * 10),
          width: 1280,
          height: 720
        });
      }
      return {
        ok: true,
        video: { fps: 10, frameCount: 1200, durationSeconds: 120 },
        frames,
        tempDir
      };
    };
  }

  async function waitForAnalysis(footageId, timeoutMs = 8000) {
    const job = analysisService.activeJob(footageId);
    if (job) await job;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const row = await CctvAnalysis.findOne({ footageId });
      if (row && row.processingStatus !== 'PROCESSING') return row;
      if (Date.now() > deadline) return row;
      await sleep(25);
    }
  }

  async function waitForEvidence(footageId, timeoutMs = 8000) {
    const job = evidenceService.activeExtraction(footageId);
    if (job) await job;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const row = await CctvAnalysis.findOne({ footageId });
      if (row && row.evidenceStatus !== 'EXTRACTING') return row;
      if (Date.now() > deadline) return row;
      await sleep(25);
    }
  }

  const communityA = await Community.create({ name: 'MCA Test' });
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
  const employee = await login('employee@college.test');
  const admin = await login('admin@college.test');

  async function createReport({ itemName, category, description }) {
    const res = await request
      .post('/api/reports')
      .set('Cookie', alpha)
      .field('reportType', 'lost')
      .field('itemName', itemName)
      .field('category', category)
      .field('description', description)
      .field('location', 'Library')
      .field('approximateDate', '2026-09-01');
    assert(res.status === 201, `report ${itemName} created (${res.status})`);
    return res.body.report.id;
  }

  async function createCase(itemId) {
    const res = await request.post('/api/admin/investigations').set('Cookie', admin).send({ itemId });
    assert(res.status === 201, `investigation created (${res.status})`);
    return res.body.investigation.id;
  }

  async function addClip(caseId, cameraLocation, startTime) {
    const req = request
      .post(`/api/admin/investigations/${caseId}/cctv`)
      .set('Cookie', admin)
      .field('cameraLocation', cameraLocation)
      .field('recordedDate', '2026-09-01');
    if (startTime) req.field('recordingStartTime', startTime);
    const res = await req.attach('video', fakeMp4(), {
      filename: 'clip.mp4',
      contentType: 'video/mp4'
    });
    assert(res.status === 201, `CCTV clip added (${res.status})`);
    const clips = res.body.investigation.cctv;
    return clips[clips.length - 1].id;
  }

  async function review(caseId, cookie = admin) {
    return request.get(`/api/admin/investigations/${caseId}/review`).set('Cookie', cookie);
  }

  // ---------------------------------------------------------------- test data
  const laptopId = await createReport({
    itemName: 'Campus Laptop',
    category: 'electronics',
    description: 'Grey laptop reported missing near the library entrance.'
  });
  const cardId = await createReport({
    itemName: 'ID Card',
    category: 'documents',
    description: 'College identity card missing after the afternoon lecture.'
  });
  const umbrellaId = await createReport({
    itemName: 'Blue Umbrella',
    category: 'other',
    description: 'Umbrella left near the administration desk after the rain.'
  });

  const caseA = await createCase(laptopId);
  const caseB = await createCase(cardId);
  const caseC = await createCase(umbrellaId);
  const clipA = await addClip(caseA, 'Library Entrance', '10:00');
  const clipB = await addClip(caseB, 'Lecture Hall', '14:30');
  const clipC = await addClip(caseC, 'Admin Desk', '');

  // ------------------------------------------------------------ authorization
  const studentReview = await review(caseA, alpha);
  assert(studentReview.status === 403, 'student cannot read investigation results');
  const employeeReview = await review(caseA, employee);
  assert(employeeReview.status === 403, 'employee cannot read investigation results');
  const anonReview = await request.get(`/api/admin/investigations/${caseA}/review`);
  assert(anonReview.status === 401, `signed-out request is rejected (${anonReview.status})`);

  const studentExtract = await request
    .post(`/api/admin/investigations/${caseA}/cctv/${clipA}/evidence`)
    .set('Cookie', alpha);
  assert(studentExtract.status === 403, 'student cannot extract evidence frames');
  const employeeExtract = await request
    .post(`/api/admin/investigations/${caseA}/cctv/${clipA}/evidence`)
    .set('Cookie', employee);
  assert(employeeExtract.status === 403, 'employee cannot extract evidence frames');

  const studentImage = await request
    .get(`/api/admin/investigations/${caseA}/evidence/${new mongoose.Types.ObjectId()}/image`)
    .set('Cookie', alpha);
  assert(studentImage.status === 403, 'student cannot read evidence images');

  // ---------------------------------------------------------- id validation
  const badCase = await request.get('/api/admin/investigations/not-an-id/review').set('Cookie', admin);
  assert(badCase.status === 404, 'invalid investigation id is 404');
  const unknownCase = await request
    .get(`/api/admin/investigations/${new mongoose.Types.ObjectId()}/review`)
    .set('Cookie', admin);
  assert(unknownCase.status === 404, 'unknown investigation is 404');
  const crossFootage = await request
    .post(`/api/admin/investigations/${caseA}/cctv/${clipB}/evidence`)
    .set('Cookie', admin);
  assert(crossFootage.status === 404, 'footage from another case cannot be used');
  const badFootage = await request
    .post(`/api/admin/investigations/${caseA}/cctv/not-an-id/evidence`)
    .set('Cookie', admin);
  assert(badFootage.status === 404, 'invalid footage id is 404');
  const badFrame = await request
    .get(`/api/admin/investigations/${caseA}/evidence/not-an-id/image`)
    .set('Cookie', admin);
  assert(badFrame.status === 404, 'invalid evidence frame id is 404');

  // ------------------------------------------------- state before processing
  const beforeAnalysis = await review(caseA);
  assert(beforeAnalysis.status === 200, 'admin can open the investigation analysis');
  assert(
    beforeAnalysis.body.item && beforeAnalysis.body.item.itemName === 'Campus Laptop',
    'the reported item is included in the results overview'
  );
  assert(
    beforeAnalysis.body.item.imageUrl === null && beforeAnalysis.body.item.hasImage === false,
    'an item with no photo reports no image instead of a broken link'
  );
  assert(beforeAnalysis.body.recordings.length === 1, 'the stored CCTV reference is listed');
  const recordingBefore = beforeAnalysis.body.recordings[0];
  assert(
    recordingBefore.processingStatus === 'AVAILABLE' && recordingBefore.analysisReady === false,
    'an un-analysed recording reports AVAILABLE'
  );
  assert(
    recordingBefore.statusMessage === 'AI analysis has not been started for this recording.',
    `un-analysed recording explains itself (${recordingBefore.statusMessage})`
  );
  assert(
    recordingBefore.itemAnalysis === null && recordingBefore.evidence === null,
    'no analysis sections are produced before the analysis runs'
  );
  assert(
    beforeAnalysis.body.summary.analysedCount === 0 &&
      beforeAnalysis.body.summary.evidenceFrameCount === 0,
    'the summary counts nothing before analysis'
  );

  const earlyExtract = await request
    .post(`/api/admin/investigations/${caseA}/cctv/${clipA}/evidence`)
    .set('Cookie', admin);
  assert(earlyExtract.status === 409, 'evidence cannot be extracted before analysis completes');
  assert(
    earlyExtract.body.message === 'AI analysis has not completed for this recording.',
    `the reason is stated plainly (${earlyExtract.body.message})`
  );

  // --------------------------------------------------------- processing state
  let release;
  analysisService.runWorker = async () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const startA = await request
    .post(`/api/admin/investigations/${caseA}/cctv/${clipA}/analysis`)
    .set('Cookie', admin);
  assert(startA.status === 202, `analysis starts (${startA.status})`);
  const duringProcessing = await review(caseA);
  assert(
    duringProcessing.body.recordings[0].processingStatus === 'PROCESSING' &&
      duringProcessing.body.recordings[0].analysisReady === false,
    'a running analysis is reported as PROCESSING'
  );
  assert(
    duringProcessing.body.recordings[0].statusMessage === 'AI analysis is still processing.',
    'processing state shows the required message'
  );
  assert(
    duringProcessing.body.recordings[0].itemAnalysis === null,
    'incomplete results are never shown as final'
  );

  stubFrameWorker();
  release(workerSuccess({ itemClass: 'laptop', itemLastSeen: 30, durationSeconds: 120 }));
  const completedA = await waitForAnalysis(clipA);
  assert(completedA.processingStatus === 'COMPLETED', 'analysis completes');
  assert(
    completedA.evidenceStatus === 'AVAILABLE',
    'Module 5 does not extract evidence frames by itself'
  );

  // ------------------------------------------------- results and extraction
  const firstOpen = await review(caseA);
  assert(
    firstOpen.body.recordings[0].evidence.status === 'EXTRACTING',
    `opening the analysis starts a one-time extraction (${firstOpen.body.recordings[0].evidence.status})`
  );
  assert(
    firstOpen.body.recordings[0].evidence.message === 'Evidence frames are being extracted.',
    'the extracting state is explained'
  );
  await waitForEvidence(clipA);
  assert(frameWorkerCalls === 1, 'the frame worker ran once');
  assert(
    lastFrameJob.videoPath === path.join(cctvDir, (await CctvFootage.findById(clipA).select('+fileKey')).fileKey),
    'the worker receives the server-resolved CCTV path'
  );

  const results = await review(caseA);
  const recording = results.body.recordings[0];
  assert(recording.analysisReady === true, 'completed analysis produces the Module 6 sections');
  assert(frameWorkerCalls === 1, 're-opening the analysis does not extract frames again');

  // ------------------------------------------------------------ item analysis
  const itemAnalysis = recording.itemAnalysis;
  assert(itemAnalysis.detected === true, 'item detection from Module 5 is reported');
  assert(
    itemAnalysis.lastSeenLabel.startsWith('10:00:30'),
    `last seen uses the recorded clock time (${itemAnalysis.lastSeenLabel})`
  );
  assert(
    itemAnalysis.disappearanceLabel.startsWith('10:00:40'),
    `estimated disappearance uses the recorded clock time (${itemAnalysis.disappearanceLabel})`
  );
  assert(
    itemAnalysis.disappearanceRange &&
      itemAnalysis.disappearanceRange.label === '10:00:30 – 10:00:40',
    `an estimate is shown as a range (${itemAnalysis.disappearanceRange && itemAnalysis.disappearanceRange.label})`
  );
  assert(
    itemAnalysis.missingDurationLabel === '10 seconds',
    `missing duration comes from the stored result (${itemAnalysis.missingDurationLabel})`
  );
  assert(
    itemAnalysis.disappearanceCertainty === 'high' && Boolean(itemAnalysis.certaintyLabel),
    'the certainty of the estimate is stated'
  );
  assert(itemAnalysis.messages.length === 0, 'no empty-state messages when the data exists');

  // ---------------------------------------------------------- evidence frames
  const evidence = recording.evidence;
  assert(evidence.status === 'COMPLETED', `evidence extraction completed (${evidence.status})`);
  assert(evidence.frames.length === 5, `five evidence frames were extracted (${evidence.frames.length})`);
  assert(evidence.message === null && evidence.error === null, 'no failure message on success');

  const lastSeenFrame = evidence.byType.LAST_SEEN;
  const disappearanceFrame = evidence.byType.DISAPPEARANCE;
  const postFrame = evidence.byType.POST_DISAPPEARANCE;
  const personFrames = evidence.byType.PERSON_FIRST_APPEARANCE;

  assert(
    lastSeenFrame && lastSeenFrame.timestamp.seconds === 30 && lastSeenFrame.eventLabel === 'Item Last Seen',
    'the last-seen frame is taken at the real last-seen time'
  );
  assert(
    disappearanceFrame &&
      disappearanceFrame.timestamp.seconds === 40 &&
      disappearanceFrame.eventLabel === 'Estimated Item Disappearance',
    'the disappearance frame is taken at the estimated disappearance time'
  );
  assert(
    postFrame && postFrame.timestamp.seconds === 45 && postFrame.trackingId === 'P-002',
    'the post-disappearance frame uses the first track detected afterwards'
  );
  assert(
    personFrames.length === 2 &&
      personFrames.map((row) => row.trackingId).join(',') === 'P-002,P-003',
    'each post-disappearance track has a first-appearance frame'
  );
  assert(
    evidence.frames.every((row) => row.frameNumber !== null && row.imageUrl.includes('/evidence/')),
    'every frame records a frame number and an authenticated image link'
  );
  assert(
    lastSeenFrame.timestamp.clockTime === '10:00:30' &&
      lastSeenFrame.timestamp.offsetLabel === '00:00:30',
    'frame metadata includes both clock time and offset'
  );
  assert(
    evidence.frames.every((row) => typeof row.description === 'string' && row.description.length > 10),
    'every frame explains what it is'
  );

  // ------------------------------------------------------- before / after
  assert(
    recording.beforeAfter &&
      recording.beforeAfter.before.id === lastSeenFrame.id &&
      recording.beforeAfter.after.id === postFrame.id,
    'before/after pairs the last-seen and post-disappearance frames'
  );
  assert(
    recording.beforeAfter.beforeLabel === 'Last seen' &&
      recording.beforeAfter.afterLabel === 'After estimated disappearance',
    'before/after uses neutral labels'
  );

  // ------------------------------------------------- anonymous person analysis
  const persons = recording.persons;
  assert(persons.uniqueCount === 3, `unique anonymous tracks are counted (${persons.uniqueCount})`);
  assert(persons.postDisappearanceCount === 2, 'post-disappearance tracks are counted');
  assert(
    persons.tracks.map((row) => row.trackingId).join(',') === 'P-001,P-002,P-003',
    'tracks keep the anonymous Module 5 labels'
  );
  const trackTwo = persons.tracks[1];
  assert(
    trackTwo.firstSeen.clockTime === '10:00:45' && trackTwo.lastSeen.clockTime === '10:01:00',
    'first and last detection times come from the stored tracking result'
  );
  assert(
    trackTwo.trackingDurationLabel === '15 seconds',
    `tracking duration is derived from real timestamps (${trackTwo.trackingDurationLabel})`
  );
  assert(
    trackTwo.relationLabel === 'First detected 5 seconds after the estimated disappearance',
    `the person-disappearance relationship is temporal only (${trackTwo.relationLabel})`
  );
  assert(
    persons.tracks[0].relationLabel === 'First detected 35 seconds before the estimated disappearance',
    'tracks seen before the disappearance are labelled as such'
  );

  // ---------------------------------------------------- investigation timeline
  const timeline = recording.timeline;
  const kinds = timeline.events.map((row) => row.kind);
  assert(kinds.includes('ITEM') && kinds.includes('PERSON') && kinds.includes('ANALYSIS'),
    'the timeline covers item, person, and analysis events');
  const itemEvents = timeline.events.filter((row) => row.kind === 'ITEM');
  assert(
    itemEvents.map((row) => row.title).join('|') ===
      'Item first detected|Item last seen|Estimated disappearance',
    `item events are in order (${itemEvents.map((row) => row.title).join('|')})`
  );
  const timedEvents = timeline.events.filter((row) => row.seconds !== null);
  assert(
    timedEvents.every((row, index) => index === 0 || row.seconds >= timedEvents[index - 1].seconds),
    'timeline events are chronological'
  );
  assert(
    timeline.events.some((row) => row.id === 'analysis-recommendation'
      && row.detail === 'Admin review recommended for the relevant interval.'),
    'the timeline ends with the review recommendation'
  );
  assert(
    timeline.events.filter((row) => row.kind === 'PERSON').length === 3,
    'every tracked person appears once in the timeline'
  );
  assert(timeline.truncated === false, 'nothing is hidden for a short recording');

  // -------------------------------------------------------- smart review window
  const window = recording.reviewWindow;
  assert(window.available === true, 'a review window is produced from real timestamps');
  assert(
    window.start.seconds === 0 && window.end.seconds === 120,
    `the window stays inside the recording (${window.start.seconds}-${window.end.seconds})`
  );
  assert(
    window.windowLabel === '10:00:00 – 10:02:00',
    `the window is shown in recorded clock time (${window.windowLabel})`
  );
  assert(
    window.reason.includes('10:00:30') && window.reason.includes('10:00:40') && window.reason.includes('P-002'),
    'the window explains itself with the real events'
  );
  assert(window.requiresAdminReview === true, 'the window requires admin review');
  assert(
    !/suspect|responsible|thief|guilty/i.test(`${window.reason} ${window.note}`),
    'the window makes no claim about who is responsible'
  );

  // ------------------------------------------------- AI-assisted recommendation
  const recommendation = recording.recommendation;
  assert(
    recommendation.title === 'AI-Assisted Review Recommendation',
    'the recommendation uses the required title'
  );
  assert(
    recommendation.summary.includes('10:00:30') &&
      recommendation.summary.includes('2 anonymous tracks were first detected'),
    `the recommendation summarises the real findings (${recommendation.summary})`
  );
  assert(
    recommendation.requiresAdminReview === true && recommendation.disclaimer.includes('not a conclusion'),
    'the recommendation is an observation that needs admin review'
  );

  // ------------------------------------------------------------ evidence image
  const imageRes = await request
    .get(`/api/admin/investigations/${caseA}/evidence/${lastSeenFrame.id}/image`)
    .set('Cookie', admin);
  assert(imageRes.status === 200, `admin can open an evidence image (${imageRes.status})`);
  assert(imageRes.headers['content-type'] === 'image/jpeg', 'evidence images are served as JPEG');
  assert(
    imageRes.headers['x-content-type-options'] === 'nosniff'
      && String(imageRes.headers['cache-control']).includes('private'),
    'evidence images are served with safe headers'
  );
  const imageAnon = await request.get(
    `/api/admin/investigations/${caseA}/evidence/${lastSeenFrame.id}/image`
  );
  assert(imageAnon.status === 401, 'evidence images are not public');
  const imageStudent = await request
    .get(`/api/admin/investigations/${caseA}/evidence/${lastSeenFrame.id}/image`)
    .set('Cookie', alpha);
  assert(imageStudent.status === 403, 'students cannot open evidence images');
  const imageWrongCase = await request
    .get(`/api/admin/investigations/${caseB}/evidence/${lastSeenFrame.id}/image`)
    .set('Cookie', admin);
  assert(imageWrongCase.status === 404, 'an evidence frame cannot be read through another case');

  // --------------------------------------------------------- path protection
  const storedFrame = await EvidenceFrame.findById(lastSeenFrame.id).select('+imageKey');
  assert(
    path.basename(storedFrame.imageKey) === storedFrame.imageKey && storedFrame.imageKey.endsWith('.jpg'),
    'evidence keys are plain server-generated file names'
  );
  assert(
    fs.existsSync(path.join(evidenceDir, storedFrame.imageKey)),
    'the extracted still is stored on disk, not in MongoDB'
  );
  await EvidenceFrame.updateOne(
    { _id: lastSeenFrame.id },
    { $set: { imageKey: '../../../etc/passwd' } }
  );
  const traversal = await request
    .get(`/api/admin/investigations/${caseA}/evidence/${lastSeenFrame.id}/image`)
    .set('Cookie', admin);
  assert(traversal.status === 404, 'a tampered evidence key cannot read another file');
  await EvidenceFrame.updateOne(
    { _id: lastSeenFrame.id },
    { $set: { imageKey: storedFrame.imageKey } }
  );

  const payloadText = JSON.stringify(results.body);
  assert(!payloadText.includes(evidenceDir), 'the response never exposes the evidence directory');
  assert(!payloadText.includes(cctvDir), 'the response never exposes the CCTV directory');
  assert(!payloadText.includes(storedFrame.imageKey), 'the response never exposes a stored file key');
  assert(
    !payloadText.includes(process.env.JWT_SECRET) && !payloadText.includes(process.env.MONGO_URI),
    'the response never exposes secrets'
  );
  assert(
    !/face|facial|suspect|thief|identity|recognition|stole/i.test(payloadText),
    'the response contains no identity, face, or accusation wording'
  );

  const rawFrame = await EvidenceFrame.collection.findOne({
    _id: new mongoose.Types.ObjectId(lastSeenFrame.id)
  });
  assert(
    !Object.values(rawFrame).some(
      (value) => Buffer.isBuffer(value) || (value && value._bsontype === 'Binary')
    ),
    'no image bytes are stored in MongoDB'
  );

  // --------------------------------------- unsupported item: honest empty state
  stubWorker(workerSuccess({ durationSeconds: 90 }));
  const startB = await request
    .post(`/api/admin/investigations/${caseB}/cctv/${clipB}/analysis`)
    .set('Cookie', admin);
  assert(startB.status === 202, 'analysis runs for an item the model cannot detect');
  await waitForAnalysis(clipB);
  const callsBeforeB = frameWorkerCalls;
  const reviewB = await review(caseB);
  const recordingB = reviewB.body.recordings[0];
  assert(
    recordingB.itemAnalysis.detected === false &&
      recordingB.itemAnalysis.messages.includes(aiConfig.UNSUPPORTED_ITEM_NOTE),
    'an undetectable item is reported as such'
  );
  assert(
    recordingB.itemAnalysis.lastSeenLabel === 'Not determined' &&
      recordingB.itemAnalysis.disappearanceLabel === 'Not reliably determined' &&
      recordingB.itemAnalysis.missingDurationLabel === 'Not determined',
    'missing values are reported, never guessed'
  );
  assert(
    recordingB.reviewWindow.available === false &&
      recordingB.reviewWindow.message === 'Insufficient timestamp data to generate a review window.',
    'no review window is invented without timestamps'
  );
  assert(
    recordingB.persons.messages.includes(
      'No disappearance timestamp available, so person detections cannot be placed before or after it.'
    ),
    'person timings are not related to a disappearance that was never determined'
  );
  assert(
    recordingB.evidence.frames.length === 0 &&
      recordingB.evidence.message === 'No evidence frame could be derived from this analysis.',
    'no evidence frame is faked when no event timestamp exists'
  );
  assert(frameWorkerCalls === callsBeforeB, 'no extraction is attempted without any target frame');
  assert(
    recordingB.evidence.canExtract === false,
    'the extract button is not offered when no frame can be derived'
  );
  const extractB = await request
    .post(`/api/admin/investigations/${caseB}/cctv/${clipB}/evidence`)
    .set('Cookie', admin);
  assert(
    extractB.status === 409 &&
      extractB.body.message === 'No evidence frame can be derived from this analysis.',
    'the extraction request explains why it cannot run'
  );
  assert(
    recordingB.persons.tracks.every((row) => row.relationLabel === null),
    'no before/after relationship is claimed without a disappearance time'
  );
  assert(recordingB.beforeAfter === null, 'the before/after section is omitted when it has no frames');

  // ------------------------- no post-disappearance detections, offset fallback
  stubWorker(
    workerSuccess({
      itemClass: 'umbrella',
      itemLastSeen: 30,
      durationSeconds: 120,
      personTracks: [{ firstSeenSeconds: 2, lastSeenSeconds: 20, framesTracked: 18, bestConfidence: 0.7 }]
    })
  );
  const startC = await request
    .post(`/api/admin/investigations/${caseC}/cctv/${clipC}/analysis`)
    .set('Cookie', admin);
  assert(startC.status === 202, 'a third case can be analysed');
  await waitForAnalysis(clipC);
  await review(caseC);
  await waitForEvidence(clipC);
  const reviewC = await review(caseC);
  const recordingC = reviewC.body.recordings[0];
  assert(
    recordingC.persons.messages.includes('No post-disappearance person detections were found.'),
    'the absence of later detections is stated plainly'
  );
  assert(
    recordingC.evidence.byType.PERSON_FIRST_APPEARANCE.length === 0,
    'no person frames are produced when no track follows the disappearance'
  );
  assert(
    recordingC.evidence.byType.POST_DISAPPEARANCE &&
      recordingC.evidence.byType.POST_DISAPPEARANCE.timestamp.seconds === 50 &&
      recordingC.evidence.byType.POST_DISAPPEARANCE.trackingId === null,
    'the post-disappearance frame falls back to a real frame shortly afterwards'
  );
  assert(
    recordingC.evidence.byType.POST_DISAPPEARANCE.description.includes('No anonymous track was detected'),
    'the fallback frame says no person was detected'
  );
  assert(
    recordingC.itemAnalysis.lastSeen.clockTime === null &&
      recordingC.itemAnalysis.lastSeenLabel === '00:00:30 into the recording',
    'without a recorded start time the offset is used'
  );

  // ------------------------- item still visible near the end of the recording
  const bagId = await createReport({
    itemName: 'Black Backpack',
    category: 'bags',
    description: 'Backpack left beside the reading room desk after class.'
  });
  const caseD = await createCase(bagId);
  const clipD = await addClip(caseD, 'Reading Room', '09:00');
  // The clip ends inside the absence window, so no disappearance is confirmed.
  stubWorker(workerSuccess({ itemClass: 'backpack', itemLastSeen: 100, durationSeconds: 105 }));
  const startD = await request
    .post(`/api/admin/investigations/${caseD}/cctv/${clipD}/analysis`)
    .set('Cookie', admin);
  assert(startD.status === 202, 'a fourth case can be analysed');
  await waitForAnalysis(clipD);
  await review(caseD);
  await waitForEvidence(clipD);
  const recordingD = (await review(caseD)).body.recordings[0];
  assert(
    recordingD.itemAnalysis.detected === true &&
      recordingD.itemAnalysis.disappearanceLabel === 'Not reliably determined' &&
      recordingD.itemAnalysis.disappearanceRange === null &&
      recordingD.itemAnalysis.missingDurationLabel === 'Not determined',
    'no disappearance is claimed when the recording ends too soon after the last detection'
  );
  assert(
    recordingD.itemAnalysis.messages.includes('No disappearance timestamp available.'),
    'the missing disappearance timestamp is stated plainly'
  );
  const afterLastSeen = recordingD.evidence.byType.POST_DISAPPEARANCE;
  assert(
    afterLastSeen &&
      afterLastSeen.basis === 'AFTER_LAST_SEEN_OFFSET' &&
      afterLastSeen.eventLabel === 'Frame After Item Last Seen',
    'the later frame is named after the last detection, not a disappearance'
  );
  assert(
    afterLastSeen.timestamp.seconds === 104.5 &&
      afterLastSeen.description.includes('did not confirm a disappearance point'),
    `the later frame stays inside the recording and explains itself (${afterLastSeen.timestamp.seconds})`
  );
  assert(
    recordingD.beforeAfter.afterLabel === 'After last detection',
    'before/after is labelled without implying a disappearance'
  );
  assert(
    recordingD.persons.messages.includes(
      'No person detections were found after the item was last detected.'
    ),
    'person detections are related to the last detection when no disappearance exists'
  );
  assert(
    recordingD.persons.tracks[0].relationLabel ===
      'First detected 1 minute 35 seconds before the item was last detected',
    `the relationship names the real reference event (${recordingD.persons.tracks[0].relationLabel})`
  );
  assert(
    recordingD.recommendation.summary.includes(
      'A disappearance point could not be reliably determined from this recording.'
    ),
    'the recommendation does not invent a disappearance'
  );
  assert(
    recordingD.reviewWindow.available === true &&
      recordingD.reviewWindow.end.seconds === 105 &&
      !recordingD.reviewWindow.reason.includes('disappearance was estimated'),
    'the review window is built from the last detection and clamped to the recording'
  );

  // --------------------------------------------------- extraction failure path
  const frameA = await EvidenceFrame.findOne({ footageId: clipA });
  const callsBeforeFailedView = frameWorkerCalls;
  await CctvAnalysis.updateOne(
    { footageId: clipA },
    { $set: { evidenceStatus: 'FAILED', evidenceError: 'Evidence frame unavailable.' } }
  );
  const failedView = await review(caseA);
  assert(
    failedView.body.recordings[0].evidence.status === 'FAILED' &&
      failedView.body.recordings[0].evidence.canExtract === true,
    'a failed extraction offers a retry'
  );
  assert(
    failedView.body.recordings[0].evidence.error === 'Evidence frame unavailable.',
    'the failure message is the safe admin-facing text'
  );
  assert(
    frameWorkerCalls === callsBeforeFailedView,
    `a failed extraction is not retried automatically (${frameWorkerCalls})`
  );

  stubFrameWorker({ fail: 'VIDEO_OPEN_FAILED' });
  const retryFail = await request
    .post(`/api/admin/investigations/${caseA}/cctv/${clipA}/evidence`)
    .set('Cookie', admin);
  assert(retryFail.status === 202, 'the admin can retry extraction');
  const afterFail = await waitForEvidence(clipA);
  assert(
    afterFail.evidenceStatus === 'FAILED' &&
      afterFail.evidenceError === evidenceService.FAILURE_MESSAGES.VIDEO_OPEN_FAILED,
    'a worker failure is recorded with a readable reason'
  );
  assert(
    !/traceback|stack|mongo|jwt|\//i.test(afterFail.evidenceError),
    'the failure message exposes no internal detail'
  );
  assert(
    (await EvidenceFrame.countDocuments({ footageId: clipA })) > 0,
    'a failed retry keeps the frames that were already extracted'
  );

  stubFrameWorker({ unavailableKeys: ['f1'] });
  const retryPartial = await request
    .post(`/api/admin/investigations/${caseA}/cctv/${clipA}/evidence`)
    .set('Cookie', admin);
  assert(retryPartial.status === 202, 'extraction can be retried again');
  await waitForEvidence(clipA);
  const partialReview = await review(caseA);
  const partialEvidence = partialReview.body.recordings[0].evidence;
  assert(
    partialEvidence.status === 'COMPLETED' && partialEvidence.frames.length === 4,
    `an unreadable frame is skipped instead of faked (${partialEvidence.frames.length})`
  );
  assert(
    partialEvidence.byType.DISAPPEARANCE === null,
    'the unavailable frame is simply absent'
  );
  assert(
    (await EvidenceFrame.countDocuments({ _id: frameA._id })) === 0,
    're-extraction replaces the previous frames'
  );
  assert(
    !fs.existsSync(path.join(evidenceDir, storedFrame.imageKey)),
    'replaced evidence images are deleted from disk'
  );

  const duplicateExtract = await request
    .post(`/api/admin/investigations/${caseA}/cctv/${clipA}/evidence`)
    .set('Cookie', admin);
  assert(
    duplicateExtract.status === 409 &&
      duplicateExtract.body.message === 'Evidence frames have already been extracted for this recording.',
    'frames are not extracted twice'
  );

  // ----------------------------------------------- notes, closure, and history
  const notesRes = await request
    .patch(`/api/admin/investigations/${caseA}`)
    .set('Cookie', admin)
    .send({ notes: 'Review north corridor entrance around 10:00:30.' });
  assert(notesRes.status === 200, 'admin notes can be saved');
  const withNotes = await review(caseA);
  assert(
    withNotes.body.investigation.notes === 'Review north corridor entrance around 10:00:30.',
    'admin notes are returned with the analysis, separate from the AI result'
  );

  const framesBeforeClose = await EvidenceFrame.countDocuments({ footageId: clipA });
  const closeRes = await request.post(`/api/admin/investigations/${caseA}/close`).set('Cookie', admin);
  assert(closeRes.status === 200, 'the admin can close the case');
  const afterClose = await review(caseA);
  assert(afterClose.status === 200, 'a closed case still opens');
  assert(
    afterClose.body.investigation.closed === true && afterClose.body.investigation.completedAt,
    'closure is recorded'
  );
  const closedRecording = afterClose.body.recordings[0];
  assert(
    closedRecording.processingStatus === 'COMPLETED' && closedRecording.analysisReady === true,
    'closing the case keeps the AI results'
  );
  assert(
    closedRecording.evidence.frames.length === framesBeforeClose && framesBeforeClose > 0,
    'closing the case keeps the evidence frames'
  );
  assert(
    closedRecording.timeline.events.length > 0 && closedRecording.persons.uniqueCount === 3,
    'closing the case keeps the timeline and tracking results'
  );
  assert(
    afterClose.body.investigation.notes === 'Review north corridor entrance around 10:00:30.',
    'closing the case keeps the admin notes'
  );
  assert(
    (await CctvFootage.countDocuments({ _id: clipA })) === 1,
    'closing the case keeps the CCTV reference'
  );
  const closedImage = await request
    .get(`/api/admin/investigations/${caseA}/evidence/${closedRecording.evidence.frames[0].id}/image`)
    .set('Cookie', admin);
  assert(closedImage.status === 200, 'evidence images stay readable after closure');

  // --------------------------------------- removing footage removes evidence
  const framesC = await EvidenceFrame.find({ footageId: clipC }).select('+imageKey');
  assert(framesC.length > 0, 'the third case has evidence frames to remove');
  const removedKeys = framesC.map((row) => row.imageKey);
  const removeRes = await request
    .delete(`/api/admin/investigations/${caseC}/cctv/${clipC}`)
    .set('Cookie', admin);
  assert(removeRes.status === 200, 'footage can be removed');
  assert(
    (await EvidenceFrame.countDocuments({ footageId: clipC })) === 0,
    'removing a CCTV reference removes its evidence metadata'
  );
  assert(
    removedKeys.every((key) => !fs.existsSync(path.join(evidenceDir, key))),
    'removing a CCTV reference removes its evidence images'
  );
  const emptyReview = await review(caseC);
  assert(
    emptyReview.body.recordings.length === 0 && emptyReview.body.summary.recordingCount === 0,
    'a case with no recording reports nothing to analyse'
  );

  analysisService.runWorker = realRunWorker;
  evidenceService.runFrameWorker = realRunFrameWorker;
  assert(
    typeof analysisService.runWorker === 'function' &&
      typeof evidenceService.runFrameWorker === 'function',
    'the real workers are restored'
  );

  console.log(`Module 6 tests: ${passed} passed, ${failed} failed`);
  await mongoose.disconnect();
  await mongod.stop();
  process.exit(failed ? 1 : 0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
