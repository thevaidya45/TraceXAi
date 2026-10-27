process.env.JWT_SECRET = process.env.JWT_SECRET || 'module5-test-secret-value-32chars!!';
process.env.CLIENT_ORIGIN = 'http://localhost:5173';
process.env.NODE_ENV = 'test';
// Deterministic absence window for the disappearance assertions below.
process.env.AI_ITEM_ABSENCE_TOLERANCE_SECONDS = '10';

const fs = require('fs');
const os = require('os');
const path = require('path');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const { MongoMemoryServer } = require('mongodb-memory-server');

const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tracex-m5-uploads-'));
const cctvDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tracex-m5-cctv-'));
process.env.UPLOAD_DIR = uploadDir;
process.env.CCTV_UPLOAD_DIR = cctvDir;

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Worker payload shaped exactly like backend/ai/analyze_cctv.py output.
 * Only the worker is stubbed; every derivation, status, and storage rule below
 * is the real application code.
 */
function workerSuccess({ itemClass = null, itemLastSeen = null, durationSeconds = 120, fps = 10 } = {}) {
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
        bestConfidence: 0.81
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
    personTracks: [
      {
        kind: 'person',
        trackerId: 1,
        yoloClass: 'person',
        firstSeenSeconds: 0,
        lastSeenSeconds: 18.5,
        framesTracked: 30,
        bestConfidence: 0.88
      },
      {
        kind: 'person',
        trackerId: 2,
        yoloClass: 'person',
        firstSeenSeconds: 25,
        lastSeenSeconds: 61,
        framesTracked: 52,
        bestConfidence: 0.74
      }
    ],
    itemTracks,
    sampleTimestamps,
    detectionCounts: { personDetections: 82, itemDetections: itemTracks.length ? 40 : 0 }
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
  const analysisService = require('../services/cctvAnalysisService');
  const aiConfig = require('../config/aiConfig');

  const app = createApp();
  const request = supertest(app);

  const realRunWorker = analysisService.runWorker;
  let lastWorkerJob = null;

  function stubWorker(resultOrFn) {
    analysisService.runWorker = async (job) => {
      lastWorkerJob = job;
      return typeof resultOrFn === 'function' ? resultOrFn(job) : resultOrFn;
    };
  }

  function stubDeferredWorker() {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    analysisService.runWorker = async (job) => {
      lastWorkerJob = job;
      return gate;
    };
    return (value) => release(value);
  }

  async function waitForAnalysis(footageId, timeoutMs = 8000) {
    const job = analysisService.activeJob(footageId);
    if (job) {
      await job;
    }
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const row = await CctvAnalysis.findOne({ footageId });
      if (row && row.processingStatus !== 'PROCESSING') {
        return row;
      }
      if (Date.now() > deadline) {
        return row;
      }
      await sleep(25);
    }
  }

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

  async function createReport({ itemName, category, description, reportType = 'lost' }) {
    const res = await request
      .post('/api/reports')
      .set('Cookie', alpha)
      .field('reportType', reportType)
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
    const res = await request
      .post(`/api/admin/investigations/${caseId}/cctv`)
      .set('Cookie', admin)
      .field('cameraLocation', cameraLocation)
      .field('recordedDate', '2026-09-01')
      .field('recordingStartTime', startTime)
      .attach('video', fakeMp4(), { filename: 'clip.mp4', contentType: 'video/mp4' });
    assert(res.status === 201, `CCTV clip added (${res.status})`);
    const clips = res.body.investigation.cctv;
    return clips[clips.length - 1].id;
  }

  // ---------------------------------------------------------------- setup data
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
  const clipA1 = await addClip(caseA, 'Library Entrance', '10:00');
  const clipA2 = await addClip(caseA, 'Library Corridor', '10:00');
  const clipB1 = await addClip(caseB, 'Lecture Hall', '14:30');
  const clipC1 = await addClip(caseC, 'Admin Desk', '');

  // ------------------------------------------------------- item class mapping
  const laptopTarget = analysisService.itemTargetClasses({
    itemName: 'Campus Laptop',
    category: 'electronics',
    description: 'Grey laptop'
  });
  assert(
    laptopTarget.supported && laptopTarget.classes.includes('laptop'),
    'laptop report maps to the laptop detection class'
  );

  const umbrellaTarget = analysisService.itemTargetClasses({
    itemName: 'Blue Umbrella',
    category: 'other',
    description: 'Umbrella left at the desk'
  });
  assert(
    umbrellaTarget.supported && umbrellaTarget.classes.includes('umbrella'),
    'umbrella report maps to the umbrella detection class'
  );

  const bagTarget = analysisService.itemTargetClasses({
    itemName: 'bag',
    category: 'bags',
    description: 'black colour bag'
  });
  assert(
    bagTarget.supported
      && bagTarget.classes.includes('backpack')
      && bagTarget.classes.includes('handbag')
      && !bagTarget.classes.includes('suitcase'),
    'a plain bag does not include suitcase detections'
  );

  const cardTarget = analysisService.itemTargetClasses({
    itemName: 'ID Card',
    category: 'documents',
    description: 'College identity card'
  });
  assert(!cardTarget.supported, 'ID card is reported as unsupported instead of guessed');
  assert(
    cardTarget.classes.length === 0 && cardTarget.note === aiConfig.UNSUPPORTED_ITEM_NOTE,
    'unsupported item has no target classes and a clear note'
  );

  // --------------------------------------------------- timeline derivation
  const stillVisible = analysisService.deriveItemTimeline({
    itemTracks: [{ firstSeenSeconds: 2, lastSeenSeconds: 118 }],
    sampleTimestamps: [0, 30, 60, 90, 118, 119.5],
    durationSeconds: 120,
    toleranceSeconds: 10
  });
  assert(
    stillVisible.lastSeenSeconds === 118 && stillVisible.disappearanceSeconds === null,
    'item visible until the end has no disappearance time'
  );
  assert(
    stillVisible.missingDurationSeconds === null,
    'missing duration stays unset when disappearance is unknown'
  );

  const endedDuringAbsence = analysisService.deriveItemTimeline({
    itemTracks: [{ firstSeenSeconds: 24.94, lastSeenSeconds: 29.66 }],
    sampleTimestamps: [24.94, 29.66, 35, 39.7],
    durationSeconds: 39.775,
    toleranceSeconds: 20
  });
  assert(
    endedDuringAbsence.disappearanceSeconds === 39.78
      && endedDuringAbsence.missingDurationSeconds === 10.11
      && endedDuringAbsence.disappearanceCertainty === 'moderate',
    'a recording that ends during a real absence estimates disappearance at the end'
  );

  const disappeared = analysisService.deriveItemTimeline({
    itemTracks: [{ firstSeenSeconds: 2, lastSeenSeconds: 30 }],
    sampleTimestamps: [0, 10, 20, 30, 35, 40, 60, 90, 119.5],
    durationSeconds: 120,
    toleranceSeconds: 10
  });
  assert(disappeared.lastSeenSeconds === 30, 'last seen is the final real detection');
  assert(
    disappeared.disappearanceSeconds === 40,
    `disappearance is confirmed after the absence window (${disappeared.disappearanceSeconds})`
  );
  assert(disappeared.missingDurationSeconds === 10, 'missing duration is measured from last seen');
  assert(disappeared.disappearanceCertainty === 'high', 'long absence is high certainty');
  assert(disappeared.observedAbsenceSeconds === 90, 'observed absence covers the rest of the clip');

  const noDetections = analysisService.deriveItemTimeline({
    itemTracks: [],
    sampleTimestamps: [0, 10, 20],
    durationSeconds: 30,
    toleranceSeconds: 10
  });
  assert(
    noDetections.lastSeenSeconds === null && noDetections.disappearanceSeconds === null,
    'no detections produce no invented timestamps'
  );

  const overlayClock = analysisService.formatClock(
    { source: 'overlay', anchorVideoSeconds: 30, anchorClock: '14:30:30' },
    64
  );
  assert(overlayClock === '14:31:04', 'overlay clock follows the time printed on the video');
  assert(
    analysisService.formatClock('00:22', 64) === '00:23:04',
    'form start time stays the fallback when no clock is printed'
  );

  // ------------------------------------------------- secure file resolution
  assert(
    (await analysisService.resolveExistingCctvFile('../../../etc/passwd.mp4')) === null,
    'traversal file key is rejected'
  );
  assert(
    (await analysisService.resolveExistingCctvFile('/etc/passwd')) === null,
    'absolute path file key is rejected'
  );
  assert(
    (await analysisService.resolveExistingCctvFile('notes.txt')) === null,
    'non-video file key is rejected'
  );
  assert(
    (await analysisService.resolveExistingCctvFile('missing-file.mp4')) === null,
    'file key without a file on disk is rejected'
  );
  const storedKey = (await CctvFootage.findById(clipA1).select('+fileKey')).fileKey;
  const resolvedPath = await analysisService.resolveExistingCctvFile(storedKey);
  assert(
    resolvedPath === path.join(cctvDir, storedKey),
    'stored file key resolves inside the CCTV directory'
  );

  // ------------------------------------------------------------ authorization
  const studentStart = await request
    .post(`/api/admin/investigations/${caseA}/cctv/${clipA1}/analysis`)
    .set('Cookie', alpha);
  assert(studentStart.status === 403, 'student cannot start AI analysis');

  const employeeStart = await request
    .post(`/api/admin/investigations/${caseA}/cctv/${clipA1}/analysis`)
    .set('Cookie', employee);
  assert(employeeStart.status === 403, 'employee cannot start AI analysis');

  const studentRetry = await request
    .post(`/api/admin/investigations/${caseA}/cctv/${clipA1}/analysis/retry`)
    .set('Cookie', alpha);
  assert(studentRetry.status === 403, 'student cannot retry AI analysis');

  const studentResults = await request
    .get(`/api/admin/investigations/${caseA}/analysis`)
    .set('Cookie', alpha);
  assert(studentResults.status === 403, 'student cannot read AI analysis results');

  const employeeResults = await request
    .get(`/api/admin/investigations/${caseA}/cctv/${clipA1}/analysis`)
    .set('Cookie', employee);
  assert(employeeResults.status === 403, 'employee cannot read AI analysis results');

  const anonResults = await request.get(`/api/admin/investigations/${caseA}/analysis`);
  assert(anonResults.status === 401, `signed-out request is rejected (${anonResults.status})`);

  // -------------------------------------------------------- id validation
  const badFootage = await request
    .post(`/api/admin/investigations/${caseA}/cctv/not-an-id/analysis`)
    .set('Cookie', admin);
  assert(badFootage.status === 404, 'invalid footage id is 404');

  const crossCase = await request
    .post(`/api/admin/investigations/${caseA}/cctv/${clipB1}/analysis`)
    .set('Cookie', admin);
  assert(crossCase.status === 404, 'footage from another case cannot be analysed');

  const unknownCase = await request
    .post(`/api/admin/investigations/${new mongoose.Types.ObjectId().toString()}/cctv/${clipA1}/analysis`)
    .set('Cookie', admin);
  assert(unknownCase.status === 404, 'unknown investigation is 404');

  const beforeStart = await request
    .get(`/api/admin/investigations/${caseA}/analysis`)
    .set('Cookie', admin);
  assert(beforeStart.status === 200, 'admin can read analysis state before processing');
  assert(beforeStart.body.analyses.length === 2, 'every clip has an analysis entry');
  assert(
    beforeStart.body.analyses.every((row) => row.status === 'AVAILABLE' && row.canStart),
    'un-analysed clips report AVAILABLE'
  );
  assert(
    beforeStart.body.analyses.every(
      (row) => row.lastSeenLabel === 'Not determined' && row.disappearanceLabel === 'Not reliably determined'
    ),
    'un-analysed clips report undetermined values instead of numbers'
  );

  // ------------------------------------------------- processing lifecycle
  const release = stubDeferredWorker();
  const started = await request
    .post(`/api/admin/investigations/${caseA}/cctv/${clipA1}/analysis`)
    .set('Cookie', admin)
    .send({ videoPath: '/etc/passwd', fileKey: '../../etc/passwd.mp4', filePath: '/etc/shadow' });
  assert(started.status === 202, `analysis starts and returns immediately (${started.status})`);
  assert(started.body.analysis.status === 'PROCESSING', 'response reports PROCESSING');
  assert(
    lastWorkerJob && lastWorkerJob.videoPath === path.join(cctvDir, storedKey),
    'worker receives the server-resolved path, never a client value'
  );
  assert(
    lastWorkerJob && !JSON.stringify(lastWorkerJob).includes('passwd'),
    'client-supplied paths are ignored'
  );
  assert(
    lastWorkerJob && lastWorkerJob.itemClasses.includes('laptop'),
    'worker is told which item classes to look for'
  );

  const duringProcessing = await Investigation.findById(caseA);
  assert(duringProcessing.status === 'PROCESSING', 'case status moves to PROCESSING');

  const duplicate = await request
    .post(`/api/admin/investigations/${caseA}/cctv/${clipA1}/analysis`)
    .set('Cookie', admin);
  assert(duplicate.status === 409, 'the same recording cannot be analysed twice at once');

  const siblingClip = await request
    .post(`/api/admin/investigations/${caseA}/cctv/${clipA2}/analysis`)
    .set('Cookie', admin);
  assert(siblingClip.status === 409, 'only one recording per case is analysed at a time');

  const removeWhileBusy = await request
    .delete(`/api/admin/investigations/${caseA}/cctv/${clipA1}`)
    .set('Cookie', admin);
  assert(removeWhileBusy.status === 409, 'footage cannot be removed while it is being analysed');

  release(workerSuccess({ itemClass: 'laptop', itemLastSeen: 30, durationSeconds: 120 }));
  const completedA1 = await waitForAnalysis(clipA1);
  assert(completedA1 && completedA1.processingStatus === 'COMPLETED', 'analysis completes');

  const caseAfterA1 = await Investigation.findById(caseA);
  assert(caseAfterA1.status === 'COMPLETED', 'case status becomes COMPLETED after analysis');

  const resultsA = await request
    .get(`/api/admin/investigations/${caseA}/cctv/${clipA1}/analysis`)
    .set('Cookie', admin);
  assert(resultsA.status === 200, 'admin can read the finished analysis');
  const analysisA = resultsA.body.analysis;
  assert(analysisA.status === 'COMPLETED', 'result status is COMPLETED');
  assert(analysisA.item.detected === true, 'item detection is reported');
  assert(
    analysisA.lastSeenLabel.startsWith('10:00:30'),
    `last seen uses the recorded clock time (${analysisA.lastSeenLabel})`
  );
  assert(
    analysisA.disappearanceLabel.startsWith('10:00:40'),
    `disappearance uses the recorded clock time (${analysisA.disappearanceLabel})`
  );
  assert(analysisA.missingDurationLabel === '10 seconds', 'missing duration is reported in words');
  assert(analysisA.persons.uniqueCount === 2, 'unique anonymous tracks are counted');
  assert(
    analysisA.persons.tracks.every((row) => /^P-\d{3}$/.test(row.trackingId)),
    'people are labelled with anonymous tracking ids'
  );
  assert(
    analysisA.item.tracks.every((row) => /^I-\d{3}$/.test(row.trackingId)),
    'item appearances use anonymous tracking ids'
  );
  assert(
    analysisA.statistics.framesSampled === 240 && analysisA.video.frameCount === 1200,
    'real video metadata is stored'
  );
  assert(analysisA.video.durationLabel === '2 minutes', 'video duration is reported in words');
  assert(analysisA.canStart === false && analysisA.canRetry === false, 'completed analysis is final');

  const payloadText = JSON.stringify(resultsA.body);
  assert(!payloadText.includes(cctvDir), 'analysis response never exposes the storage path');
  assert(!payloadText.includes(storedKey), 'analysis response never exposes the stored file key');
  assert(
    !/face|suspect|identity|recognition/i.test(payloadText),
    'analysis response contains no identity or face data'
  );

  const rawDoc = await CctvAnalysis.collection.findOne({ footageId: new mongoose.Types.ObjectId(clipA1) });
  const rawText = JSON.stringify(rawDoc);
  assert(!rawText.includes(cctvDir) && !rawText.includes(storedKey), 'no file path or key is stored in MongoDB');
  assert(
    !Object.values(rawDoc).some((value) => Buffer.isBuffer(value) || (value && value._bsontype === 'Binary')),
    'no video or image bytes are stored in MongoDB'
  );

  const repeatStart = await request
    .post(`/api/admin/investigations/${caseA}/cctv/${clipA1}/analysis`)
    .set('Cookie', admin);
  assert(repeatStart.status === 409, 'a completed recording is not analysed again');

  const repeatRetry = await request
    .post(`/api/admin/investigations/${caseA}/cctv/${clipA1}/analysis/retry`)
    .set('Cookie', admin);
  assert(repeatRetry.status === 409, 'retry is rejected for a completed recording');

  // ------------------------------------------------------------ failure path
  stubWorker({ ok: false, errorCode: 'TRACKING_FAILED' });
  const failing = await request
    .post(`/api/admin/investigations/${caseA}/cctv/${clipA2}/analysis`)
    .set('Cookie', admin);
  assert(failing.status === 202, 'a second recording can be analysed after the first finished');
  const failedA2 = await waitForAnalysis(clipA2);
  assert(failedA2 && failedA2.processingStatus === 'FAILED', 'worker failure is recorded as FAILED');
  assert(
    failedA2.processingError === analysisService.FAILURE_MESSAGES.TRACKING_FAILED,
    'failure message is the safe admin-facing text'
  );
  assert(
    !/traceback|stack|mongo|jwt|\//i.test(failedA2.processingError),
    'failure message has no internal detail'
  );

  const caseAfterFailure = await Investigation.findById(caseA);
  assert(
    caseAfterFailure.status === 'COMPLETED',
    'case stays COMPLETED because another recording has results'
  );

  const failedView = await request
    .get(`/api/admin/investigations/${caseA}/cctv/${clipA2}/analysis`)
    .set('Cookie', admin);
  assert(
    failedView.body.analysis.canRetry === true && failedView.body.analysis.canStart === false,
    'a failed analysis offers retry only'
  );
  assert(failedView.body.analysis.attempts === 1, 'attempts are counted');

  stubWorker(workerSuccess({ itemClass: 'laptop', itemLastSeen: 55, durationSeconds: 120 }));
  const retried = await request
    .post(`/api/admin/investigations/${caseA}/cctv/${clipA2}/analysis/retry`)
    .set('Cookie', admin);
  assert(retried.status === 202, 'a failed analysis can be retried');
  const retriedA2 = await waitForAnalysis(clipA2);
  assert(retriedA2.processingStatus === 'COMPLETED', 'retry completes successfully');
  assert(retriedA2.attempts === 2, 'retry increments the attempt count');

  const removeAfter = await request
    .delete(`/api/admin/investigations/${caseA}/cctv/${clipA2}`)
    .set('Cookie', admin);
  assert(removeAfter.status === 200, 'footage can be removed when no analysis is running');
  assert(
    (await CctvAnalysis.countDocuments({ footageId: clipA2 })) === 0,
    'removing footage removes its analysis results'
  );

  const closeCase = await request.post(`/api/admin/investigations/${caseA}/close`).set('Cookie', admin);
  assert(closeCase.status === 200, 'case can be closed');
  const closedStart = await request
    .post(`/api/admin/investigations/${caseA}/cctv/${clipA1}/analysis`)
    .set('Cookie', admin);
  assert(closedStart.status === 409, 'a closed case cannot start AI analysis');
  const closedResults = await request
    .get(`/api/admin/investigations/${caseA}/cctv/${clipA1}/analysis`)
    .set('Cookie', admin);
  assert(
    closedResults.status === 200 && closedResults.body.analysis.status === 'COMPLETED',
    'existing results stay readable after the case is closed'
  );

  // --------------------------------- unsupported item and no item detections
  stubWorker(workerSuccess({ durationSeconds: 90 }));
  const unsupported = await request
    .post(`/api/admin/investigations/${caseB}/cctv/${clipB1}/analysis`)
    .set('Cookie', admin);
  assert(unsupported.status === 202, 'analysis runs for an item the model cannot detect');
  assert(
    lastWorkerJob.itemClasses.length === 0,
    'no item classes are sent when the item is unsupported'
  );
  const unsupportedDoc = await waitForAnalysis(clipB1);
  assert(unsupportedDoc.processingStatus === 'COMPLETED', 'unsupported item analysis still completes');

  const unsupportedView = await request
    .get(`/api/admin/investigations/${caseB}/cctv/${clipB1}/analysis`)
    .set('Cookie', admin);
  const analysisB = unsupportedView.body.analysis;
  assert(analysisB.item.detectionSupported === false, 'unsupported item detection is declared');
  assert(
    analysisB.item.note === aiConfig.UNSUPPORTED_ITEM_NOTE,
    'unsupported item shows the model limitation note'
  );
  assert(
    analysisB.lastSeenLabel === 'Not determined' &&
      analysisB.disappearanceLabel === 'Not reliably determined' &&
      analysisB.missingDurationLabel === 'Not determined',
    'unsupported item reports undetermined values, not guesses'
  );
  assert(analysisB.persons.uniqueCount === 2, 'anonymous people tracking still works');
  assert(
    analysisB.persons.tracks[0].firstSeen.clockTime === '14:30:00',
    'person timestamps use the recorded start time'
  );

  // ---------------------------------- missing file and status settle to READY
  const clipCKey = (await CctvFootage.findById(clipC1).select('+fileKey')).fileKey;
  await CctvFootage.updateOne({ _id: clipC1 }, { $set: { fileKey: '../../../etc/passwd.mp4' } });
  const traversal = await request
    .post(`/api/admin/investigations/${caseC}/cctv/${clipC1}/analysis`)
    .set('Cookie', admin);
  assert(traversal.status === 404, 'a tampered file key cannot start analysis');
  assert(
    traversal.body.message === 'CCTV footage is unavailable.',
    'missing footage returns a safe message'
  );
  const traversalDoc = await CctvAnalysis.findOne({ footageId: clipC1 });
  assert(
    traversalDoc && traversalDoc.processingStatus === 'FAILED',
    'the unavailable recording is recorded as FAILED'
  );
  const caseCAfterTraversal = await Investigation.findById(caseC);
  assert(
    caseCAfterTraversal.status === 'CCTV_SELECTED',
    'a failed start does not move the case into PROCESSING'
  );

  await CctvFootage.updateOne({ _id: clipC1 }, { $set: { fileKey: clipCKey } });
  stubWorker({ ok: false, errorCode: 'VIDEO_OPEN_FAILED' });
  const retryC = await request
    .post(`/api/admin/investigations/${caseC}/cctv/${clipC1}/analysis/retry`)
    .set('Cookie', admin);
  assert(retryC.status === 202, 'analysis can be retried once the file is available again');
  const failedC = await waitForAnalysis(clipC1);
  assert(
    failedC.processingError === analysisService.FAILURE_MESSAGES.VIDEO_OPEN_FAILED,
    'unreadable video reports a readable reason'
  );
  const caseCAfterFailure = await Investigation.findById(caseC);
  assert(
    caseCAfterFailure.status === 'READY',
    `case returns to READY when no analysis succeeded (${caseCAfterFailure.status})`
  );

  // The clip ends 5 seconds after the last sighting, inside the absence window.
  stubWorker(workerSuccess({ itemClass: 'umbrella', itemLastSeen: 100, durationSeconds: 105 }));
  const successC = await request
    .post(`/api/admin/investigations/${caseC}/cctv/${clipC1}/analysis/retry`)
    .set('Cookie', admin);
  assert(successC.status === 202, 'retry after a failure is allowed');
  const completedC = await waitForAnalysis(clipC1);
  assert(completedC.processingStatus === 'COMPLETED', 'retry succeeds');
  const resultsC = await request
    .get(`/api/admin/investigations/${caseC}/cctv/${clipC1}/analysis`)
    .set('Cookie', admin);
  assert(
    resultsC.body.analysis.lastSeenLabel === '00:01:40 into the recording',
    `without a recorded start time the offset is used (${resultsC.body.analysis.lastSeenLabel})`
  );
  assert(
    resultsC.body.analysis.disappearanceLabel === 'Not reliably determined',
    'no disappearance is claimed when the clip ends too soon after the last sighting'
  );

  // ----------------------------------------------- Module 4 behaviour intact
  const module4Status = await request
    .patch(`/api/admin/investigations/${caseC}`)
    .set('Cookie', admin)
    .send({ status: 'PROCESSING' });
  assert(module4Status.status === 400, 'PROCESSING still cannot be set by hand');

  const caseDetails = await request.get(`/api/admin/investigations/${caseC}`).set('Cookie', admin);
  assert(
    caseDetails.status === 200 && caseDetails.body.investigation.cctv.length === 1,
    'Module 4 case details still work'
  );
  assert(
    caseDetails.body.investigation.cctv[0].previewUrl.includes('/cctv/'),
    'CCTV preview link is unchanged'
  );

  const preview = await request
    .get(`/api/admin/investigations/${caseC}/cctv/${clipC1}/file`)
    .set('Cookie', admin);
  assert(preview.status === 200 || preview.status === 206, 'CCTV preview still streams for admins');

  // ------------------------------------------- failure message completeness
  const codes = Object.keys(analysisService.FAILURE_MESSAGES);
  assert(codes.length >= 12, 'every worker failure code has a message');
  assert(
    codes.every((code) => {
      const message = analysisService.FAILURE_MESSAGES[code];
      return typeof message === 'string' && message.length > 10 && !message.includes('/');
    }),
    'failure messages are user friendly and contain no paths'
  );

  analysisService.runWorker = realRunWorker;
  assert(typeof analysisService.runWorker === 'function', 'real worker runner is restored');

  console.log(`Module 5 tests: ${passed} passed, ${failed} failed`);
  await mongoose.disconnect();
  await mongod.stop();
  process.exit(failed ? 1 : 0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
