const EvidenceFrame = require('../models/EvidenceFrame');
const { deleteEvidenceImage } = require('./uploadService');

/**
 * Remove the stored stills and their metadata for one recording. Used when a
 * CCTV reference is deleted or when its analysis is re-run, so no orphaned
 * evidence image is ever left behind.
 *
 * This lives in its own small module so Module 5's analysis service can clean
 * up Module 6 evidence without depending on the Module 6 service.
 */
async function deleteEvidenceForFootage(footageId) {
  const frames = await EvidenceFrame.find({ footageId }).select('+imageKey');
  for (const frame of frames) {
    try {
      await deleteEvidenceImage(frame.imageKey);
    } catch (err) {
      console.error('Unable to remove an evidence frame file:', (err && err.name) || 'Error');
    }
  }
  await EvidenceFrame.deleteMany({ footageId });
}

module.exports = {
  deleteEvidenceForFootage
};
