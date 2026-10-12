const express = require('express');
const { authenticate } = require('../middleware/authMiddleware');
const { requireAdmin } = require('../middleware/roleMiddleware');
const { cctvVideoUpload } = require('../middleware/cctvUploadMiddleware');
const {
  cctvUploadLimiter,
  aiProcessingLimiter,
  evidenceExtractionLimiter
} = require('../middleware/rateLimiters');
const {
  createInvestigation,
  listInvestigations,
  getInvestigation,
  updateInvestigation,
  closeInvestigation,
  addCctvFootage,
  removeCctvFootage,
  getCctvFile
} = require('../controllers/investigationController');
const {
  startCctvAnalysis,
  retryCctvAnalysis,
  getCctvAnalysis,
  listCctvAnalyses
} = require('../controllers/cctvAnalysisController');
const {
  getInvestigationReview,
  extractEvidenceFrames,
  getEvidenceImage
} = require('../controllers/investigationReviewController');

const router = express.Router();

router.use(authenticate, requireAdmin);

router.get('/investigations', listInvestigations);
router.post('/investigations', createInvestigation);
router.get('/investigations/:id', getInvestigation);
router.patch('/investigations/:id', updateInvestigation);
router.post('/investigations/:id/close', closeInvestigation);
router.post('/investigations/:id/cctv', cctvUploadLimiter, cctvVideoUpload, addCctvFootage);
router.delete('/investigations/:id/cctv/:footageId', removeCctvFootage);
router.get('/investigations/:id/cctv/:footageId/file', getCctvFile);

// Module 5 — AI analysis of the CCTV file Module 4 already stored on disk.
router.get('/investigations/:id/analysis', listCctvAnalyses);
router.get('/investigations/:id/cctv/:footageId/analysis', getCctvAnalysis);
router.post('/investigations/:id/cctv/:footageId/analysis', aiProcessingLimiter, startCctvAnalysis);
router.post(
  '/investigations/:id/cctv/:footageId/analysis/retry',
  aiProcessingLimiter,
  retryCctvAnalysis
);

// Module 6 — investigation analysis, evidence frames, and review material built
// from the Module 5 results that are already stored.
router.get('/investigations/:id/review', getInvestigationReview);
router.post(
  '/investigations/:id/cctv/:footageId/evidence',
  evidenceExtractionLimiter,
  extractEvidenceFrames
);
router.get('/investigations/:id/evidence/:frameId/image', getEvidenceImage);

module.exports = router;
