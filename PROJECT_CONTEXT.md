# TraceX AI — project context

College MCA project: campus lost-and-found with role-based access. Modules 1–6 are complete and must not be rebuilt: Module 1 (auth, communities, dashboards), Module 2 (lost/found reports), Module 3 (community alerts and sightings), Module 4 (admin investigation cases and recorded CCTV), Module 5 (AI analysis of recorded CCTV), Module 6 (investigation analysis and results).

## Stack

- Frontend: React 18, Vite 5, React Router 6, Axios, Satoshi (Fontshare). Cookie session (`withCredentials`). No Bootstrap. No Google auth. Sticky top navigation (role-based). Public landing at `/` for guests.
- Backend: Express, Mongoose, MongoDB Atlas, JWT httpOnly cookie `token`, bcrypt, Resend, Helmet, express-rate-limit, multer (memory → disk for report/sighting photos and recorded CCTV).
- Ports: frontend 5173, backend 5050. Vite proxies `/api` to 5050.

## Roles

- `student` / `employee`: assigned `communityId`; create and manage **own** reports; may **view** other reports and sightings in their community; community on a report/sighting is taken from the user, never from the client. No investigation or CCTV access.
- `admin`: created via `create-admin` script; all communities; cannot self-register; only role that can send community email alerts, create investigations, and access CCTV files.

## Module 2 reports

- Collection: `Item` (`items`). Types `lost` | `found`. Status: lost `active → recovered|closed|invalid`; found `active → claimed|closed|invalid`.
- Photos stored under `backend/uploads/items` as random keys; MongoDB stores `imageKey` only (not returned to clients). Images served at `GET /api/reports/:id/image` after the same ACL as the report. Deleting a report also deletes its photo file.
- Owners may `DELETE /api/reports/:id`; admins may `DELETE /api/admin/reports/:id`. Delete is blocked (409) if an investigation exists for that item.
- Admin may `DELETE /api/admin/communities/:id` only if the community has **no members, no reports, and no investigations**.
- Delete UI: confirm (“Would you like to delete…?”) then success (“Successfully deleted”).

## Module 3 alerts and sightings

- In-app `Notification` records for active student/employee members of the item’s community, excluding the reporter. Types: `NEW_LOST_ITEM`, `NEW_FOUND_ITEM`, `SIGHTING`. No automatic email on create or sighting.
- Admin sends community email from report details (`POST /api/admin/reports/:id/email-alert`). Admin may choose one or more existing communities; recipients are active student/employee emails from those communities (deduplicated, never entered by hand). Each report may be sent twice. Email failure does not delete or alter the report, and does not mark sent.
- `Sighting` references `itemId`, `reporterId`, and `communityId`. Optional image uses the same upload validation as reports.

## Module 4 investigations

- `Investigation` references `itemId` (does not copy item fields). `communityId` is taken from the Item.
- Eligible reports: `status === active` and type lost or found. One open case per item; 409 returns the existing case.
- Status: CREATED → CCTV_SELECTED (first clip) → READY (admin). PROCESSING and COMPLETED cannot be set by hand; only Module 5 analysis moves a case into them. CLOSED keeps the document and CCTV files.
- `CctvFootage` metadata in MongoDB; video files under `backend/uploads/cctv` (MP4/WebM, default max 500 MB, streamed to disk). Admin preview: `GET /api/admin/investigations/:id/cctv/:footageId/file`. No live cameras.

## Module 5 AI analysis of recorded CCTV

- Analyses the file Module 4 already stored. Nothing is re-uploaded, no video or frame is stored in MongoDB, and the file is resolved only from the stored `fileKey` — never from a request body.
- Python worker `backend/ai/analyze_cctv.py` (venv `backend/ai/.venv`, weights `backend/ai/models/yolov8n.pt`): OpenCV frame sampling, YOLOv8 detection, ByteTrack anonymous IDs. Tuning in `backend/config/aiConfig.js`.
- `CctvAnalysis` (one per footage) stores video metadata, item tracks, anonymous person tracks, detection statistics, item last seen, disappearance, missing duration, and safe failure text. Unavailable values stay unset and the API returns "Not determined" / "Not reliably determined".
- Admin-only: `POST /api/admin/investigations/:id/cctv/:footageId/analysis` (202, runs in the background), `.../analysis/retry` (failed or abandoned runs only), `GET .../cctv/:footageId/analysis`, `GET /api/admin/investigations/:id/analysis`.
- One analysis per investigation at a time. Case status moves to PROCESSING, then COMPLETED, or back to READY if nothing succeeded.
- Not included: facial recognition, identity or suspect matching, live cameras, cross-camera correlation.

## Module 6 investigation analysis and results

- Admin-only review layer over the Module 5 results, on the existing Investigation Details page. Three routes behind the same `authenticate` + `requireAdmin` used by Module 4: `GET /api/admin/investigations/:id/review`, `POST /api/admin/investigations/:id/cctv/:footageId/evidence`, `GET /api/admin/investigations/:id/evidence/:frameId/image`.
- Evidence frames are extracted once from the already-stored recording by `backend/ai/extract_frames.py`, a cv2-only worker that does no detection, no tracking, and no face processing. Extraction starts lazily from the review endpoint when the analysis is COMPLETED and no frames exist; opening a case never re-runs YOLO or ByteTrack.
- `EvidenceFrame` holds metadata only (type, `basis`, timestamp, real frame number, size, optional anonymous track id). JPEGs live under `backend/uploads/evidence` with random keys and are served by frame id after checking the frame belongs to that investigation. No filesystem path is returned to the frontend.
- The timeline, smart review window, and AI-assisted recommendation are derived from the stored analysis on each request, never persisted. Wording follows the data: with no estimated disappearance the page refers to the item's last detection instead.
- Admin notes and case closure reuse Module 4. Closing a case keeps the analysis, evidence metadata and files, timelines, notes, and the CCTV reference.
- Not included: facial recognition, identity inference, suspect or thief identification, accusation, guilt prediction, automatic closure by the AI, report generation, police reporting.

## Navigation

- `BackLink` and the browser Back button are the primary ways back. `SwipeBackNavigation` (mounted once in `main.jsx`) adds a two-finger swipe right on touch devices as an extra shortcut for the same `navigate(-1)`.
- The gesture needs two fingers, at least 80 px to the right, mostly horizontal movement, and no pinch. It is ignored on form controls, buttons, links, images, dialogs, the top navigation, horizontally scrollable containers, and while text is selected, and it does nothing when there is no in-app history entry. It is not registered on non-touch devices, so trackpad and browser back navigation are untouched.

## Run

- `npm run dev` in `backend` and `frontend`.
- `npm run test:module1` … `test:module6` in `backend` (in-memory MongoDB; the Module 5 and 6 suites stub the Python workers).
- AI environment: `npm run ai:setup` in `backend`, model weights per `backend/ai/README.md`, real pipeline check with `npm run ai:check -- <clip.mp4>`, full workflow check with `npm run check:e2e -- <clip.mp4>`.
