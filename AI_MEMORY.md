# TraceX AI — AI permanent memory

This file is the project’s development memory. Read it fully before any work. If this file and the code disagree, the **code is the source of truth**; then correct this file.

Do not store passwords, API keys, JWT secrets, OTPs, Mongo connection strings, or other credentials here.

---

## 1. PROJECT STATE

**Product:** TraceX AI — AI-Based Missing Item Detection System (college MCA project).

**Workspace:** `/Users/thevaidya45/TraceX AI`  
**Git:** Historically this workspace has **not** been a git repo (no `.git`). Do not assume remotes or commit history.

**Stack (current):**
- Frontend: React 18 + Vite 5, React Router 6, Axios, Satoshi. No Bootstrap. No Google auth.
- Backend: Express, Mongoose, MongoDB Atlas, JWT in **httpOnly** cookie `token`, bcrypt, Resend, Helmet, express-rate-limit.
- Ports: frontend **5173**, backend **5050** (macOS AirPlay often occupies 5000). Vite proxies `/api` → `http://localhost:5050`.

**Current module:** Module 6 complete (investigation analysis and results). Modules 1–5 remain complete. Do not rebuild any of them.

**Current feature:** Admin investigation analysis — evidence frames, timelines, review window, and AI-assisted review recommendation built on top of the Module 5 results.

**Overall completion:**
- Module 1 backend + frontend: **complete**.
- Module 2 (lost/found reports, images, owner/admin delete): **complete and API-tested (67 passed)**.
- Module 3 (community alerts, admin email, sightings): **complete and API-tested (`npm run test:module3`, 70 passed)**.
- Module 4 (investigations + recorded CCTV): **complete and API-tested (`npm run test:module4`, 70 passed)**.
- Module 5 (OpenCV + YOLOv8 + ByteTrack on stored CCTV): **complete and API-tested (`npm run test:module5`, 117 passed)**.
- Module 6 (investigation analysis, evidence frames, review): **complete and API-tested (`npm run test:module6`, 161 passed)**, plus a 38-step workflow check with the real workers (`npm run check:e2e -- <clip.mp4>`, 38/38).

**What is working (code-backed):**
- Student/employee register (admin cannot self-register).
- Email verification OTP after register; JWT issued only after verify.
- Email/password login; email OTP login; forgot/reset password; change password (authenticated).
- Logout; `GET /api/auth/me`.
- Role dashboards (student / employee / admin) with community ACL.
- Admin user list/update/delete (cannot promote to admin, cannot set password, cannot manage other admins or self).
- Admin community list/create/update/**delete** (blocked if members, reports, or investigations remain).
- Student/employee community page for **assigned** community only.
- Account/profile page.
- Seed communities: MCA, BCA, BBA, Faculty, Administration (`backend/scripts/seed.js`).
- Admin creation script: `backend/scripts/createAdmin.js`.
- Lost and found reports (create, list own, view own, update own while active, owner status recovered/claimed/closed, **delete own**).
- Admin lost/found list, search, filter, details, status including `invalid`, **delete any report** unless an investigation exists (409).
- Optional report photo (JPEG/PNG/WebP, max 2 MB) stored on disk; served via authenticated image route.
- In-app delete UX: `ConfirmDialog` (“Would you like to delete…?”) then `SuccessDialog` (“Successfully deleted”) for **reports** and **admin communities**.
- Header notification bell with unread count; students/employees see community in-app alerts for new lost/found reports and sightings (reporter excluded; inactive users excluded).
- Admin community email alert from report details (confirm dialog; not sent automatically on create). Each report may be sent **twice**; a third send is blocked (409). Admin may select **one or more existing communities**; recipients are still loaded from the database (no arbitrary emails).
- Sightings linked to an Item; optional photo via the same upload pipeline; student/employee own update; admin status `active|invalid`.
- Admin investigation cases (`INV-0001`…): create from an **active** lost/found report; one **open** case per item; notes; status CREATED → CCTV_SELECTED → READY; PROCESSING/COMPLETED set by Module 5 analysis, not by hand; close preserves history.
- Recorded CCTV (MP4/WebM, max 500 MB, streamed to disk) stored under `uploads/cctv` as random keys; MongoDB stores metadata only; preview via authenticated admin file route. Students/employees have no investigation nav or APIs.
- Module 5 AI analysis of a stored recording: item last-seen / disappearance / missing duration, anonymous people tracking. No video in MongoDB. No facial recognition.
- Module 6 investigation analysis on the existing Investigation Details page: evidence frames extracted from the stored recording, before/after comparison, anonymous person analysis and timeline, investigation timeline, smart review window, AI-assisted review recommendation, Admin notes and case closure (reusing Module 4). Admin only, enforced on the backend.

**What is incomplete / pending:**
- `node --watch` on the backend has hit **EADDRINUSE** on 5050 when the previous process did not release the port. `server.js` now handles listen errors and SIGTERM/SIGINT close.
- Production hardening: HTTPS, Atlas IP allowlist, secret rotation if the machine was untrusted.
- Campus-wide mail to arbitrary student addresses still needs a **verified Resend domain** if the current test sender is not enough for every inbox. User confirmed the OTP flow they care about is **done**.
- API tests: Module 1 **44**, Module 2 **67**, Module 3 **70**, Module 4 **70**, Module 5 **117**, Module 6 **161**. Frontend Vite build succeeds. The Module 6 admin screens were walked through in a browser against a seeded in-memory backend; the student and employee screens were verified through the API suites, not clicked through in that session.
- Two legacy `Investigation` documents in the dev Atlas database have no `caseId` and use the old lowercase statuses (`no_match`, `completed`). The APIs tolerate them; they predate Module 4's current schema.

---

## 2. FEATURES IMPLEMENTED

### Auth — register, login, logout, session
- **When:** Module 1 initial build (conversation history, 2026-09).
- **Frontend:** `AuthContext.jsx`, `authService.js`, `api.js`, `LoginForm.jsx`, `RegisterForm.jsx`, `ProtectedRoute.jsx`, `RoleProtectedRoute.jsx`.
- **Backend:** `authController.js`, `authRoutes.js`, `authMiddleware.js`, `token.js`, `User.js`.
- **APIs:** `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`.
- **Status:** Working. Register does **not** issue JWT; user must verify email.

### Email OTP login
- **When:** Module 1.
- **Frontend:** `LoginForm.jsx` (Continue with Email OTP), `VerifyOtp.jsx`, `OtpForm.jsx`.
- **Backend:** `otpService.js`, `emailService.js`, `Otp.js`.
- **APIs:** `POST /api/auth/request-otp`, `POST /api/auth/verify-otp`.
- **Status:** Done (user confirmed 2026-09-08). Code path: OTP hashed, 10 min, 5 attempts, 60s resend, max 8/hour. OTP is never returned in API responses.

### Forgot / reset password
- **When:** Module 1.
- **Frontend:** `ForgotPassword.jsx`, `ResetPassword.jsx`.
- **Backend:** `PasswordReset.js`, OTP purpose `reset`.
- **APIs:** `POST /api/auth/forgot-password`, `POST /api/auth/verify-reset-otp`, `POST /api/auth/reset-password`.
- **Status:** Implemented. Same OTP/email path as login; user confirmed OTP is done.

### Email verification
- **When:** Module 1 completion pass.
- **Frontend:** `VerifyEmail.jsx`; register navigates here.
- **Backend:** `User.emailVerified` (schema default **true** so existing users still log in; **new** register sets `false`).
- **APIs:** `POST /api/auth/request-verification-otp`, `POST /api/auth/verify-email`.
- **Status:** Implemented. Login and login-OTP blocked if `emailVerified === false`. Inactive users cannot login/OTP.

### Change password / account
- **When:** Module 1 completion pass.
- **Frontend:** `Account.jsx`, route `/account`.
- **Backend:** `POST /api/auth/change-password` (authenticated; current + new).
- **Status:** Implemented.

### Communities
- **When:** Module 1; admin CRUD added in completion pass.
- **Frontend:** `CommunitySelector.jsx`, `CommunityPage.jsx` (`/student/community`, `/employee/community`), `CommunityManagement.jsx` (`/admin/communities`).
- **Backend:** `Community.js`, `communityController.js`, `adminCommunityController.js`, `communityMiddleware.js`.
- **APIs:** `GET /api/communities` (public list for register), `GET /api/communities/:id` (auth + community ACL), admin `GET/POST/PATCH/DELETE /api/admin/communities`.
- **Status:** Implemented. Admin delete uses confirm + success popups. Delete is blocked (409) if the community still has members or reports.

### Role dashboards
- **When:** Module 1.
- **Frontend:** `StudentDashboard.jsx`, `EmployeeDashboard.jsx`, `AdminDashboard.jsx`, `DashboardHome.jsx`, `AppShell.jsx`, `Navbar.jsx`, `nav.js`.
- **Backend:** `dashboardController.js`, `GET /api/dashboard/student|employee|admin`.
- **Status:** Implemented as Module 1 shells; dashboards now also show **real** report counts from Module 2 APIs (no fake rows).

### Admin user management
- **When:** Module 1.
- **Frontend:** `UserManagement.jsx`, `ManageUserModal.jsx`.
- **Backend:** `adminUserController.js`.
- **APIs:** `GET/PATCH/DELETE /api/admin/users`.
- **Status:** Implemented with restrictions: cannot promote to admin, cannot set password via this API, cannot manage other admins or self.

### Lost & Found reports (Module 2)
- **When:** 2026-09-08.
- **Backend:** `Item.js`, `reportController.js`, `adminReportController.js`, `uploadService.js`, `uploadMiddleware.js`, `reportRoutes.js`, `adminReportRoutes.js`, `reportAccess.js`. Express app extracted to `app.js` for tests.
- **Frontend:** Lost & Found hub, report forms, My Reports, report details, admin reports list/details; `reportService.js`; `ConfirmDialog.jsx`, `SuccessDialog.jsx`.
- **APIs:** `POST/GET /api/reports`, `GET/PATCH/DELETE /api/reports/:id`, `PATCH /api/reports/:id/status`, `GET /api/reports/:id/image`, admin `GET /api/admin/reports`, `GET /api/admin/reports/:id`, `PATCH /api/admin/reports/:id/status`, `DELETE /api/admin/reports/:id`.
- **Status:** Implemented. `npm run test:module2` last run **67 passed, 0 failed** (2026-09-10), including same-community **view** of another member’s report (edit/delete still owner-only). Delete UI: confirm popup then success popup.

### Community alerts, admin email, sightings (Module 3)
- **When:** 2026-09-10.
- **Backend:** `Notification.js`, `Sighting.js`, `notificationService.js`, `notificationController.js`, `sightingController.js`, Item `communityEmailNotification`, `sendCommunityItemAlert` in `emailService.js`, routes mounted in `app.js`.
- **Frontend:** `NotificationBell.jsx`, sighting pages, admin email section on report details, admin sightings pages.
- **APIs:** `GET/PATCH /api/notifications` (own records only), `POST /api/admin/reports/:id/email-alert` (admin), `POST/GET/PATCH /api/sightings`, `GET /api/sightings/:id/image`, admin `GET/PATCH /api/admin/sightings`.
- **Status:** Implemented. `npm run test:module3` **70 passed, 0 failed**. Creating a report does **not** send email. In-app alerts are automatic for active student/employee members of the item’s community except the reporter.

### Investigation cases and recorded CCTV (Module 4)
- **When:** 2026-09-10.
- **Backend:** `Investigation.js`, `CctvFootage.js`, `investigationController.js`, `adminInvestigationRoutes.js`, CCTV helpers in `uploadService.js`, `cctvUploadMiddleware.js`.
- **Frontend:** Investigations nav, list/create/details pages, Create Investigation from admin report details, dashboard counts from live APIs.
- **APIs:** admin-only `POST/GET /api/admin/investigations`, `GET/PATCH /api/admin/investigations/:id`, `POST .../close`, `POST .../cctv`, `DELETE .../cctv/:footageId`, `GET .../cctv/:footageId/file`.
- **Status:** Implemented. `npm run test:module4` **70 passed**. No YOLO/OpenCV/ByteTrack. Community on a case is copied from the Item, never from the client.

### Investigation analysis and results (Module 6)
- **When:** 2026-10-04.
- **Backend:** `EvidenceFrame.js`, `evidenceFrameService.js`, `evidenceStorageService.js`, `investigationReviewService.js`, `investigationReviewController.js`, `ai/extract_frames.py`, evidence helpers in `uploadService.js`, evidence state fields on `CctvAnalysis`, `scripts/testModule6.js`, `scripts/checkEndToEnd.js`.
- **Frontend:** `components/investigation/` (`InvestigationAnalysis`, `RecordingAnalysis`, `EvidenceFrameCard`, `EvidenceViewer`, `BeforeAfterCompare`, `PersonAnalysis`, `PersonTimeline`, `InvestigationTimeline`), restructured `AdminInvestigationDetailsPage.jsx`, Module 6 calls in `investigationService.js`, Module 6 styles in `index.css`.
- **APIs:** admin-only `GET /api/admin/investigations/:id/review`, `POST /api/admin/investigations/:id/cctv/:footageId/evidence`, `GET /api/admin/investigations/:id/evidence/:frameId/image`.
- **Status:** Implemented. `npm run test:module6` **161 passed**. Evidence frames are extracted once, lazily, from the recording Module 5 already analysed; YOLO/ByteTrack never re-run when the Admin opens a case.

### Two-finger swipe-back gesture (navigation enhancement)
- **When:** 2026-10-04.
- **Frontend:** `components/SwipeBackNavigation.jsx`, mounted once in `main.jsx` inside `BrowserRouter`.
- **Status:** Implemented. Touch devices only (`navigator.maxTouchPoints > 1`), four passive listeners on `window`, `navigate(-1)` guarded by the same `location.key !== 'default'` check `BackLink` uses. No new dependency, no backend change.

### Security hardening
- **When:** After Module 1, before UI redesigns.
- **Files:** `helmet` in `server.js`, CORS `CLIENT_ORIGIN`, JSON 16kb, `rateLimiters.js`, `securityLog.js`, mongoose `sanitizeFilter`, password length 8–128, OTP purpose isolation.
- **Status:** In place. Generic user-facing errors; no passwords/OTP/keys in logs.

### Auth UI — current login
- **When:** 2026-09-07 (latest).
- **Frontend:** `AuthSplit.jsx` (name leftover; layout is **centered**, not split), `Login.jsx`, `LoginForm.jsx`, `styles/index.css`.
- **Status:** Split-screen, dark left panel, campus illustration, and marketing copy **removed**. Single light page, branding above a ~440px white card.

---

## 3. CODE CHANGES (important)

### Created (Module 1)
- Backend: Express app, models (`User`, `Community`, `Otp`, `PasswordReset`), auth/community/dashboard/admin controllers and routes, middleware, `emailService` (Resend), `otpService`, seed + createAdmin scripts.
- Frontend: Vite React app, auth pages, dashboards, admin pages, services, `AuthContext`.

### Modified — email / OTP (2026-09-07)
- `backend/services/emailService.js`: log Resend accept id and error status/message (not OTP/keys); map unverified-domain / test-sender errors to a user-facing 503; send `to` as array.
- `backend/services/otpService.js`: rethrow `AppError` from send instead of always replacing with a generic 503.
- `backend/controllers/authController.js`: register no longer returns 201 if verification email failed (send errors surface).
- `frontend/src/components/OtpForm.jsx`: hint to check Spam/Promotions.

### Modified — server watch crash
- `backend/server.js`: listen `EADDRINUSE` handling; SIGTERM/SIGINT close so `--watch` restarts more cleanly.

### Modified — login redesign (2026-09-07)
- Replaced 50/50 navy + campus split with centered card.
- `AuthSplit.jsx` still used by login, register, verify, forgot/reset, access-denied so **all auth pages** share the centered shell (split removed completely).
- Login copy: “Welcome back” / “Sign in to your account.” No marketing lead.

### Created (Module 2)
- Backend: Item model, report/admin report controllers and routes, multer memory upload + disk store, image ACL route, `app.js`, `scripts/testModule2.js`.
- Frontend: report pages/forms, admin report pages, `reportService.js`.
- `PROJECT_CONTEXT.md`.

### Modified — Module 2 integration (2026-09-08)
- `server.js` now loads `createApp()` from `app.js` and mounts `/api/reports` plus `/api/admin` report routes.
- Rate limiter `reportCreateLimiter`; errorHandler multer size errors.
- Nav, App routes, dashboards, CSS for forms/details.
- `backend/package.json`: multer, supertest, `test:module2`.

### Modified — deletes and dialogs (2026-09-08, later same day)
- Report delete APIs + UI (list and details) for owner and admin; photo file removed with the report.
- Confirm then success popups (`ConfirmDialog.jsx`, `SuccessDialog.jsx`) for report delete.
- Admin community `DELETE /api/admin/communities/:id` + same popups on `/admin/communities`.
- Duplicate `SuccessDialog` import in `AdminReportsPage.jsx` caused a Vite compile error; duplicate line removed.

### Deleted / not present
- No Google OAuth.
- No Bootstrap.
- No YOLO/ByteTrack/OpenCV processing.

### Created (Module 3)
- Backend: `Notification.js`, `Sighting.js`, `notificationService.js`, `notificationController.js`, `notificationRoutes.js`, `sightingController.js`, `sightingRoutes.js`, `adminSightingRoutes.js`, `scripts/testModule3.js`.
- Frontend: `NotificationBell.jsx`, `notificationService.js`, `sightingService.js`, student/employee sighting pages, admin sighting pages.

### Modified — Module 3 (2026-09-10)
- `Item.js`: `communityEmailNotification` `{ sent, sentAt, sentBy, sentByName, recipientCount }`.
- `reportAccess.js`: community members can **view** reports; owners still required to mutate/delete.
- `reportController.js`: after create, `createCommunityAlerts` (failure does not block 201).
- `adminReportController.js`: `POST` send community email.
- `emailService.js`: `sendCommunityItemAlert`; alert errors do not say “OTP”.
- `app.js`, `rateLimiters.js`, `nav.js`, `App.jsx`, `AppShell.jsx`, report details pages, `reportService.js`, `index.css`, `ConfirmDialog.jsx` (primary confirm for email).
- `testModule2.js`: same-community GET is 200.
- `package.json` (root + backend): `test:module3`.

### Created (Module 4)
- Backend: `Investigation.js`, `CctvFootage.js`, `investigationController.js`, `investigationAccess.js`, `adminInvestigationRoutes.js`, `cctvUploadMiddleware.js`, `scripts/testModule4.js`.
- Frontend: `investigationService.js`, `AdminInvestigationsPage.jsx`, `AdminInvestigationCreatePage.jsx`, `AdminInvestigationDetailsPage.jsx`.

### Modified — Module 4 (2026-09-10)
- `uploadService.js`: CCTV save/delete/stream with path-safe keys.
- `app.js`, `rateLimiters.js`, `errorHandler.js`.
- Report/community delete blocked if an investigation exists.
- Admin report GET includes open `investigation` summary.
- `nav.js`, `App.jsx`, `AdminDashboard.jsx`, `DashboardHome.jsx`, `AdminReportDetailsPage.jsx`, `index.css`.
- `package.json` (root + backend): `test:module4`.

### Created (Module 6)
- Backend: `models/EvidenceFrame.js`, `services/evidenceFrameService.js`, `services/evidenceStorageService.js`, `services/investigationReviewService.js`, `controllers/investigationReviewController.js`, `ai/extract_frames.py`, `scripts/testModule6.js`, `scripts/checkEndToEnd.js`.
- Frontend: `components/investigation/*` (8 components).

### Modified — Module 6 (2026-10-04)
- `CctvAnalysis.js`: `evidenceStatus` AVAILABLE | EXTRACTING | COMPLETED | FAILED plus `evidenceStartedAt`, `evidenceExtractedAt`, `evidenceError`, `evidenceAttempts`. No other Module 5 field changed.
- `uploadService.js`: `safeEvidencePath`, `storeEvidenceImage` (JPEG magic-byte check, random key), `deleteEvidenceImage`, exported `readFileHeader`.
- `cctvAnalysisService.js`: resetting or deleting an analysis also clears Module 6 evidence; exports `timePoint`, `NOT_DETERMINED`, `NOT_RELIABLE`.
- `aiConfig.js`: frame-worker path and the `EVIDENCE_*` / `REVIEW_WINDOW_*` settings.
- `adminInvestigationRoutes.js`: three admin-only Module 6 routes behind the existing `authenticate` + `requireAdmin`.
- `rateLimiters.js`: `evidenceExtractionLimiter`.
- `AdminInvestigationDetailsPage.jsx`: overview + CCTV, then the analysis sections, then a case-review panel holding the Module 4 notes and closure controls.
- `index.css`: Module 6 styles using the existing tokens only.
- `backend/.env.example`, `backend/package.json` (`test:module6`, `check:e2e`).

---

## 4. ARCHITECTURE

### Frontend
- Entry: `frontend/src/main.jsx` → `App.jsx`.
- Auth state: `AuthContext.jsx` (cookie session via Axios `withCredentials`).
- API client: `frontend/src/services/api.js` (base `/api`).
- Auth layout component: `AuthSplit.jsx` (centered; filename historical).
- App chrome: `AppShell.jsx` + `Navbar.jsx` + `nav.js`.
- Shared dialogs: `ConfirmDialog.jsx`, `SuccessDialog.jsx` (report delete and admin community delete).
- Styles: single file `frontend/src/styles/index.css` (CSS variables: navy `#0B1220`, accent `#2563EB`, page bg `#F5F7FA`).

### Backend
- Entry: `backend/server.js`.
- DB: `backend/config/db.js` (`dns.setServers(['8.8.8.8','1.1.1.1'])` for Atlas SRV).
- Env (names only, in `backend/.env`, gitignored): `PORT`, `MONGO_URI`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `CLIENT_ORIGIN`, `GMAIL_USER`, `GMAIL_APP_PASSWORD`.
- Typical local: `PORT=5050`, `CLIENT_ORIGIN=http://localhost:5173`. Mail is Gmail SMTP through Nodemailer. The app password is a Google app password, not the account password.

### API map
- `/api/auth/*` — auth (see section 6).
- `/api/communities`, `/api/communities/:id`.
- `/api/dashboard/student|employee|admin`.
- `/api/reports`, `/api/reports/:id`, `/api/reports/:id/status`, `/api/reports/:id/image`.
- `/api/admin/users`, `/api/admin/communities`, `/api/admin/reports`, `/api/admin/sightings`, `/api/admin/investigations`.

### Auth flow
1. Register → user created unverified → verify OTP email → `verify-email` → JWT cookie → dashboard.
2. Existing verified user: password login **or** login OTP → JWT cookie.
3. JWT payload: `userId`, `role`, `communityId` (from ObjectId). Cookie: httpOnly, sameSite lax, secure only in production.
4. `authenticate` loads user from DB; inactive → 403.

### Authorization
- Roles: `student` | `employee` | `admin`.
- `authorizeRoles` / `requireAdmin`.
- `authorizeCommunity`: non-admin may only access their `communityId`; admin bypasses.

---

## 5. DATABASE

**Database name (Atlas):** `tracex_ai` (from app config; do not paste URI).

### Community
- `name` unique, 2–80 chars, `createdAt`.

### User
- `name`, `email` unique lowercase, `password` (select:false, nullable), `role`, `communityId` (required unless admin), `authProvider` `local`|`otp`, `status` `active`|`inactive`, `emailVerified` (default true in schema; new register false), `createdAt`.
- Indexes: role, status, name.

### Otp
- Unique `{ email, purpose }` where purpose is `login` | `reset` | `verify`.
- `otpHash` (bcrypt), `expiresAt` (TTL index), `attempts`, `lastSentAt`, `sendCount`, `hourlyWindowStart`.

### PasswordReset
- `email`, `tokenHash` (sha256 of one-time token), `expiresAt` (TTL), `used`.

**No collections yet** for cameras as live devices, YOLO tracks, or investigation result timelines.

### Investigation
- `caseId` (`INV-0001`), `caseSeq`, `itemId`, `communityId` (from the Item), `createdBy`, `status` CREATED | CCTV_SELECTED | READY | PROCESSING | COMPLETED | CLOSED, `notes`, `startedAt`, `completedAt`, timestamps.
- At most one **open** investigation per item (application check). Closed cases are kept. A new case may be created after close if the report is still active.

### CctvFootage
- `investigationId`, `fileKey` (select:false), `displayName`, `cameraLocation`, `recordedDate`, optional `recordingStartTime`/`recordingEndTime`, timestamps.
- Files on disk under `uploads/cctv`; max 10 clips per case; MP4/WebM up to 500 MB (streamed to disk, `CCTV_MAX_MB`).

### CctvAnalysis (Module 5, with Module 6 evidence state)
- Module 5: video metadata, item tracks, anonymous person tracks, detection statistics, `itemFirstSeenSeconds` / `itemLastSeenSeconds` / `disappearanceSeconds` / `missingDurationSeconds`, `processingStatus`, safe failure text.
- Module 6: `evidenceStatus`, `evidenceStartedAt`, `evidenceExtractedAt`, `evidenceError`, `evidenceAttempts`.

### EvidenceFrame (Module 6)
- `investigationId`, `footageId`, `itemId`, `evidenceType` LAST_SEEN | DISAPPEARANCE | POST_DISAPPEARANCE | PERSON_FIRST_APPEARANCE, `basis` ITEM_DETECTION | DISAPPEARANCE_ESTIMATE | PERSON_DETECTION | AFTER_DISAPPEARANCE_OFFSET | AFTER_LAST_SEEN_OFFSET, `trackingId`, `timestampSeconds`, `frameNumber`, `imageKey` (select:false), `width`, `height`, `sortOrder`, `extractedBy`.
- JPEG files live on disk under `uploads/evidence` with random keys; MongoDB holds metadata only. `basis` is what makes the displayed wording provably accurate — a frame taken relative to the last detection is never described as being after a disappearance.

### Item (reports)
- `reportType` `lost`|`found`, `itemName`, `category`, `description`, `imageKey` (select:false), `location`, `approximateDate`, `approximateTime` (HH:MM or null), `communityId`, `reporterId`, `status` `active`|`recovered`|`claimed`|`closed`|`invalid`, timestamps.
- Community always from reporter’s assigned community (non-admin).
- Indexes: reporterId+createdAt, communityId+createdAt, status+reportType, itemName.

---

## 6. AUTHENTICATION & SECURITY

- **Registration:** student/employee + community; bcrypt 10 rounds; no JWT until email verified.
- **Login:** email+password; blocked if inactive or unverified.
- **OTP:** 6 digits `crypto.randomInt`; hashed before save; saved **before** send; 10 min; 5 verify attempts; 60s cooldown; 8 sends/hour per email+purpose.
- **Forgot password:** OTP purpose `reset` then hashed reset token (10 min).
- **Email:** Nodemailer over Gmail SMTP (`smtp.gmail.com:587`) in `backend/utils/sendEmail.js`. From address is `TraceX AI <GMAIL_USER>`. OTP, verification, password-reset, and community alerts all use that sender. Community item alerts inline/attach the report photo when one exists (CID `item-photo`; file read via `readReportImage`, no filesystem paths in the API or email metadata). A failed send does not mark the community alert as sent unless at least one recipient was accepted. In-app alerts are separate and are not rolled back when mail fails.
- **JWT:** cookie `token`; 7d default.
- **Roles:** admin only via `create-admin` (or existing DB admin); register dropdown excludes admin.
- Rate limits: login 20/15m, register 10/h, OTP request 8/15m, OTP verify 15/15m, password reset 8/15m, global API 400/15m, admin 120/15m, report create 20/15m, community email send 5/15m, CCTV upload 20/15m. Limiters are skipped when `NODE_ENV=test`.
- **Security log:** `securityLog` events (login_failed, otp_requested, etc.) without secrets.
- **Do not** log OTP codes, return OTP in JSON, or commit `.env`.

---

## 7. BUGS AND FIXES

### OTP emails not arriving
- **Problem:** User does not receive OTP in Gmail.
- **Causes (verified):** (1) Earlier `from` used an unverified domain (`example.com`) → Resend 403 “domain is not verified”. Fixed by using Resend test sender `onboarding@resend.dev`. (2) Register used to return 201 even when send failed (swallowed). Fixed: send errors propagate. (3) Resend test sender only delivers to the Resend account email. (4) Gmail Spam/Promotions. (5) Live probe: Resend `last_event: sent` for a delivery-check email; API is not silently failing now.
- **Files:** `emailService.js`, `otpService.js`, `authController.js`, `OtpForm.jsx`.
- **Status:** **Closed by user (2026-09-08)** — OTP part is done. Historical notes kept; do not reopen unless the user reports mail failing again.

### Backend EADDRINUSE :5050
- **Cause:** `node --watch` restart while old process still listening.
- **Fix:** Kill stale listeners; `server.js` listen error + graceful shutdown.
- **Status:** Recurs if multiple `npm run dev` copies are started. Prefer a single backend on 5050.

### Duplicate SuccessDialog import
- **Problem:** Vite overlay `Identifier 'SuccessDialog' has already been declared` on `/admin/reports`.
- **Cause:** Duplicate import in `AdminReportsPage.jsx` after wiring confirm/success dialogs.
- **Fix:** Keep a single import.
- **Status:** Fixed 2026-09-08.

### Admin community email CastError
- **Problem:** Admin Send Email Alert failed; in-app community alerts also failed to insert (`Unable to create community alerts. CastError`).
- **Cause:** Global `sanitizeFilter` wrapped server `$in` / `$ne` in `$eq`, so `User.find({ role: { $in: ['student', 'employee'] } })` threw CastError. Tests did not turn sanitizeFilter on, so they missed it.
- **Fix:** `backend/utils/trustedQuery.js` with `mongoose.trusted` for those operators. Module 2/3 tests now set `sanitizeFilter: true`.
- **Status:** Fixed 2026-09-10.

---

## 8. DESIGN DECISIONS

| Decision | Why |
| --- | --- |
| No Bootstrap | Keep custom campus/admin UI. |
| No Google auth | College email/password + OTP only. |
| JWT in httpOnly cookie, not localStorage | Reduce XSS token theft. |
| Admin not in register dropdown | Admins created separately. |
| `emailVerified` schema default true | Existing users keep access; new users must verify. |
| OTP never in API/logs | Security requirement for the project. |
| Backend 5050 | Avoid macOS AirPlay on 5000. |
| Resend over MailDev for “real” mail | Later MailDev was started in a terminal but production-like path is Resend. |
| **UI v1:** college campus / split navy login | User requested visual redesigns. |
| **UI v2:** Minimalist monochrome | User requested. |
| **UI v3:** Full navy campus split login (50/50 + illustration) | User requested a reference split login. |
| **UI v4 (current auth):** Remove split completely; centered card on `#F5F7FA`; small navy search mark; no marketing, no fake locations/stats | User said split looked like a generic AI template; wants “clean university software”. |
| Blue (`#2563EB`) only for links/focus, not logo fill | Latest login spec. |
| Do **not** add lost-item fake data or CCTV claims | Module 2 uses live API data only; CCTV still later. |
| Report community from authenticated user | Students/employees cannot pick or spoof community. |
| Photos on disk, `imageKey` hidden | No binaries in MongoDB; no filesystem paths in JSON. |
| IDOR → 404 | Unauthorized report access does not confirm the report exists. |
| Express app in `app.js` | Needed for in-memory Module 2 tests without listening on 5050. |
| Community delete blocked if members or reports exist | Avoid orphaned users/items. Admin sees 409 and an error, not success. |
| In-app confirm then success (not only `window.confirm`) | User asked for “would you like to delete” then “successfully deleted”. |

| Community members may view reports | Needed so a notification can open the related item; mutate/delete remain owner-only. |
| Email only after Admin confirm | Spec: in-app automatic; email is not sent on report create. |
| Recipients from DB | Never trust client emails or communityId for alerts/sightings. |
| Investigation community from Item | Admin cannot attach an unrelated community to a case. |
| CCTV on disk, `fileKey` hidden | Same pattern as report photos; no video blobs in MongoDB. |
| PROCESSING/COMPLETED not settable by hand | Only Module 5 analysis moves a case through those statuses. |
| Module 5 AI in a Python subprocess | OpenCV/YOLO/ByteTrack need Python; Node stays the API layer. Worker gets a minimal env (no DB/JWT/mail secrets). |
| Analysis is per CCTV recording | One `CctvAnalysis` per footage id; one running job per investigation. |
| Worker resolves files only from the stored `fileKey` | Request bodies can never point the AI at a path. |
| Unavailable results stay `null` | API returns "Not determined" / "Not reliably determined" instead of invented numbers. |
| Item matched to YOLO classes by keyword/category | If the model cannot represent the item, the UI says so rather than guessing. |
| Evidence extraction is lazy and runs once | Opening a case must not re-run YOLO/ByteTrack. The review endpoint starts a one-time frame extraction only when the analysis is COMPLETED and no frames exist, guarded by status plus an in-memory lock. |
| A second, cv2-only Python worker for frames | `extract_frames.py` imports no ultralytics or torch, so seeking a few stills is fast and cannot run detection. |
| Evidence stills are stored unmodified | Module 5 does not persist bounding boxes, so nothing is drawn on the frames; every label lives in the UI. Inventing boxes would be fake evidence. |
| Every evidence frame records its `basis` | Lets the UI say "after the item was last detected" when no disappearance was estimated, instead of implying one. |
| Review window and recommendation are derived, never stored | They are deterministic functions of the stored analysis, so they cannot drift from it. |
| Module 6 reuses Module 4 notes and closure | The spec asks for one admin-notes field and one closure flow, not a second one. Closing keeps the analysis, evidence, timeline, notes, and CCTV reference. |
| Evidence images served through an admin route by frame id | The frontend never sees a filesystem path, and the frame must belong to the investigation in the URL. |
| Swipe-back listens to touch events only, never wheel or pointer | Trackpad two-finger swipes are wheel events, so native browser back navigation on macOS and Windows is left completely alone. |
| Swipe-back mounted once at the router root | One global listener instead of a handler per page, and location changes re-render only that null-rendering component. |

**Must NOT add without a new request:** landing-page marketing copy, 50/50 login, large campus backgrounds, Google login, Bootstrap, exposing OTP in responses, live CCTV streaming, facial recognition, face matching, identity inference, suspect or thief identification, automatic accusation, guilt prediction, automatic case closure by the AI, police reporting, report generation, fake statistics.

---

## 9. CURRENT TODO

### Completed
- Module 1 models, APIs, JWT, roles, communities.
- OTP + Resend wiring.
- Email verification, change password, admin communities, assigned community page.
- Security headers, rate limits, filter sanitization.
- Centered login / auth shell (2026-09-07).
- `AI_MEMORY.md` created (this file).
- OTP (login, verify email, forgot password) — user confirmed done 2026-09-08.
- Module 2 lost/found reports, images, admin management (2026-09-08).
- Report delete (owner + admin) with confirm/success popups.
- Admin community delete with the same popups; blocked if members/reports remain.
- Duplicate SuccessDialog import fix on admin reports page.
- Module 3 community alerts, admin-controlled email, sightings (2026-09-10).
- Module 4 investigation cases and recorded CCTV references (2026-09-10).
- Frontend corporate redesign (2026-09-10) and admin rate-limit fix (2026-09-14).
- Module 5 AI analysis of recorded CCTV (2026-09-14): OpenCV + YOLOv8 + ByteTrack worker, item last-seen / disappearance / missing duration, anonymous people tracking.
- Module 6 investigation analysis and results (2026-10-04): evidence frames, before/after, person analysis and timeline, investigation timeline, smart review window, AI-assisted recommendation, admin review and closure.

### In Progress
- None at code level.

### Next
- Nothing is queued. Ask the user before starting new feature work.
- Optional later: verified Resend domain if mail must go to every campus address, not only the tested inbox.

### Future
- Production HTTPS, secret rotation, Atlas IP allowlist.
- Optional: queue/worker service if several cases must be analysed at the same time (today one job per investigation runs in-process).

### Rejected / Do Not Implement (unless user reverses)
- Google OAuth.
- Bootstrap.
- Split-screen / editorial login.
- Marketing slogans, fake stats, fake campus locations on login.
- Returning OTP codes from the API.
- Admin self-registration.

---

## 10. AI DEVELOPMENT HISTORY

### Step 1
Built Module 1: MongoDB Atlas + Mongoose, User/Community, Express auth APIs, React dashboards, JWT cookie session.

### Step 2
Added Resend email service and hashed OTP (login + password reset).

### Step 3
Hardened security (Helmet, CORS origin, rate limits, OTP purpose isolation, security logs).

### Step 4
Admin user management and community ACL on dashboards.

### Step 5
Module 1 gap fill: email verification, change password, admin community CRUD, user community page, account page.

### Step 6
Diagnosed OTP non-delivery: unverified from-domain 403, Resend test-sender limits, Gmail spam; improved error surfacing; restarted backend on 5050.

### Step 7
Removed split-screen auth UI; centered professional login card; shared auth shell used by other auth routes.

### Step 8
Created `AI_MEMORY.md` and a Cursor always-apply rule to load it before future work.

### Step 9
User confirmed OTP is done (2026-09-08). Memory updated: OTP inbox issue closed; Module 1 auth/email considered complete.

### Step 10
Implemented Module 2 lost & found: Item model, disk image uploads, student/employee own reports, admin search/filter/status (including invalid), frontend pages, `PROJECT_CONTEXT.md`, `app.js`, `npm run test:module2`.

### Step 11
Report delete: owner `DELETE /api/reports/:id`, admin `DELETE /api/admin/reports/:id`, UI on list and details, image file removed.

### Step 12
Delete UX: confirm popup then “Successfully deleted” for reports.

### Step 13
Admin community delete with the same confirm/success popups. `DELETE /api/admin/communities/:id` returns 409 if members or reports remain. Duplicate SuccessDialog import on admin reports page fixed.

### Step 14
Module 3: Notification and Sighting models; in-app alerts on report/sighting create; admin `POST /api/admin/reports/:id/email-alert` via existing Resend; sighting CRUD/image; header bell; tests `test:module3` 70 passed; Module 2 suite 67 passed after community view ACL.

### Step 15
Module 4: Investigation and CctvFootage models; admin-only case APIs; recorded CCTV upload/preview; admin UI list/create/details; duplicate open-case protection; close preserves history; `npm run test:module4` 70 passed. Modules 1–3 re-run and passed.

### Step 16
Frontend redesign (2026-09-10): corporate professional campus UI. Design tokens (primary `#2563EB`, slate, Satoshi via Fontshare). Sidebar replaced with sticky 64px top nav (role-based links; profile + bell + logout on the right). Public landing at `/` for guests (Get Started / Sign In). Dashboards use real API counts/lists. Click-to-details, APIs, and Modules 1–4 behavior unchanged. No Module 5/6 UI.

### Step 17
Module 5 — AI-based CCTV investigation (2026-09-14). Analyses the recording Module 4 already stored; nothing is re-uploaded and no video is stored in MongoDB.

- Python worker `backend/ai/analyze_cctv.py` (own venv at `backend/ai/.venv`, weights at `backend/ai/models/yolov8n.pt`): OpenCV frame sampling, YOLOv8 detection, ByteTrack IDs. Results written to a temp JSON file, then deleted. Spawned with a minimal env, a timeout, and stdout unused for data.
- `backend/config/aiConfig.js` centralizes model path, confidence, frame interval, frame cap, absence tolerance, timeout, stale window, and the item keyword/category → YOLO class map.
- `CctvAnalysis` model stores video metadata, item tracks, anonymous person tracks, detection statistics, timeline values, and safe failure text. No file key, no path, no frames.
- `cctvAnalysisService` resolves the file only through `safeCctvPath(fileKey)` + `fs.stat`, derives last seen / disappearance / missing duration, labels tracks `P-00n` / `I-00n`, and settles case status (PROCESSING → COMPLETED, or back to READY when nothing succeeded).
- Admin-only endpoints on the existing router: `POST .../cctv/:footageId/analysis`, `POST .../analysis/retry`, `GET .../cctv/:footageId/analysis`, `GET .../analysis`. Start returns 202 and processing continues in the background; `aiProcessingLimiter` is 12/15min.
- Duplicate runs blocked per recording and per investigation; abandoned PROCESSING rows become retryable after `AI_STALE_PROCESSING_MS`; footage cannot be removed mid-run and removing it deletes its analysis.
- Frontend `CctvAnalysisPanel` inside each clip card on the investigation details page: status badge, Start/Retry, real results, 5s polling while processing.
- Fixed a real bug found by the new tests: `$ne` in a service query needs `mongoose.trusted` (`notEqual`) because `sanitizeFilter` is on, otherwise the query 400s as a CastError.
- Tests: `npm run test:module5` → 114 passed (worker stubbed so it runs anywhere). Modules 1–4 re-run: 42 / 67 / 70 / 70 passed. `npm run ai:check -- <clip.mp4>` runs the real pipeline through the admin API.

### Step 18
Removed the investigation details module-note. Case header goes straight to item, community, status, and notes.

### Step 19
Raised CCTV upload from 80 MB to 500 MB (`CCTV_MAX_MB`). Files stream to disk. Analysis timeout 60 minutes, sample cap 7,200 frames.

### Step 20
Fixed the signed-in UI going blank until a manual refresh. Node `--watch` was watching the whole backend folder, so CCTV uploads and other file writes restarted the API; `/api/auth/me` then failed and the app treated the user as logged out. Dev watch is now limited to source folders. Auth retries network failures. Page content stays visible if the fade-in animation is interrupted.

### Step 21
Landing page: removed Platform / Lost & Found / Community / Sign In from the public header and footer, removed the placeholder platform preview, and removed the feature cards and footer. Hero Get Started / Sign In remain.

### Step 22
Module 6 — investigation analysis and results (2026-10-04). Built entirely on top of Modules 1–5; nothing was re-uploaded, re-processed, or replaced.

- `ai/extract_frames.py`: a second Python worker that imports only cv2. It seeks requested timestamps in the recording Module 4 already stored, writes JPEGs to a backend-chosen temp directory, and reports the real frame numbers. It performs no detection, no tracking, and no face processing, and draws nothing on the frames.
- `evidenceFrameService.js`: decides which frames are worth extracting (item last seen, estimated disappearance, first frame after the reference point, and the first appearance of each person track that starts at or after it), runs the worker once, stores each image through `storeEvidenceImage`, and records metadata in `EvidenceFrame`. Extraction is triggered lazily by the review endpoint when the analysis is COMPLETED and no frames exist yet, and is guarded by `evidenceStatus` plus an in-memory lock so a reload cannot start a second run.
- `investigationReviewService.js`: derives the item analysis, before/after pair, anonymous person analysis, person and investigation timelines, smart review window, and the AI-assisted review recommendation from the stored results. Nothing here is persisted, so the page can never disagree with the analysis.
- `investigationReviewController.js` and three admin-only routes: `GET .../review`, `POST .../cctv/:footageId/evidence`, `GET .../evidence/:frameId/image`. The image route checks that the frame belongs to the investigation in the URL and resolves the file through `safeEvidencePath`; no filesystem path is ever returned to the frontend.
- Frontend: eight components under `components/investigation/` and a restructured Investigation Details page. Sections appear in the required order and are hidden when the data does not exist. The evidence viewer supports keyboard navigation and zoom. The timeline has All / Item / Person / Analysis filters.
- Wording is tied to the data: when no disappearance was estimated, the page says the frame is after the item was last detected, and the person table and review window change their reference accordingly. Unavailable values stay `null` and are rendered as explicit sentences such as "No disappearance timestamp available."
- Tests: `npm run test:module6` → 161 passed. Modules 1–5 re-run: 42 / 67 / 70 / 70 / 114 passed. `npm run check:e2e -- <clip.mp4>` walks the full student → admin → AI → evidence → closure workflow with the real workers: 38 of 38 steps passed, including no binary data in MongoDB and students blocked from every Module 6 route.
- Honesty bug caught by the real run, not by the stubs: person labels said "estimated disappearance" even when the reference had fallen back to the last detection. Fixed by recording a `basis` on every evidence frame and deriving all wording from it.

### Step 23
Global two-finger swipe-back gesture (2026-10-04). A single `SwipeBackNavigation` component mounted in `main.jsx` inside `BrowserRouter`; it renders nothing and adds four passive `window` touch listeners.

- Fires only for a two-finger swipe to the right of at least 80 px, with vertical drift under 60 px, horizontal movement at least twice the vertical, no pinch (finger spread change under 40 px), and completed within one second.
- Ignored when the touch starts on an input, textarea, select, button, link, label, image, video, canvas, contenteditable, any `role` of button/dialog/alertdialog/menu/listbox, the top navigation, an open `.modal-backdrop`, anything marked `data-swipe-back="ignore"`, or inside any element that can be panned sideways (detected from `overflow-x` plus `scrollWidth`, so wide tables keep their own gesture).
- Also ignored while text is selected, for one finger or three, for leftward or short swipes, and for 700 ms after a successful navigation so it cannot loop.
- `navigate(-1)` runs only when `location.key !== 'default'`, the same history check `BackLink` already uses, so a directly opened URL never navigates out of the application.
- Listeners are registered only when `navigator.maxTouchPoints > 1`. Trackpad gestures produce wheel events, which the component never listens to, so native browser back navigation is untouched.
- No new dependency, no visual overlay, and no backend, auth, or module change.
- Verified in Chrome with touch emulation: list → details → swipe right returns to the list with the query string intact; 13 negative cases navigated nowhere; browser Back, Forward, back links, and click-to-details still work; exactly one listener of each type after ~20 navigations; no console output; and on a non-touch desktop no touch listeners are registered at all.

### Step 24
Admin Communities list: Open / Rename / Delete sit on the far right. The name column now takes leftover width via `data-table-split`. Rename still fills the form without leaving the list; Open still goes to community details.

### Step 25
Investigation create failed with "Please check the information you entered." Two legacy investigation documents have no `caseSeq`. The next-number lookup sorted those first, so `undefined + 1` became `NaN` and Mongoose rejected the new case. `nextCaseIdentity` now uses `$max` on `caseSeq`, which ignores missing numbers. Module 4 still passes (70) with a legacy document present; the first real case is still `INV-0001`.

Chrome / device fit (2026-10-04). The signed-in chrome no longer overflows the browser window. `html`/`body` clip horizontal overflow, grids use `minmax(min(100%, …))`, the admin nav collapses to Menu below 1100px, and tables scroll inside `.table-wrap`. A follow-up removed the 72rem page cap so the dashboard fills the Chrome window, and the account name is no longer truncated on large screens. Verified at 1512px: full name, Logout, five metric cards, and the Date column all stay on screen with no page overflow.

### Step 26
CCTV analysis times and lost-item timestamps (2026-10-27). On INV-0001 the office recording shows a clock around 14:30 on 2026-10-27, while the form start time was 00:22. The reported item is a black bag. YOLOv8 was treating cardboard boxes as suitcases and backpacks people were wearing as the lost bag, then adding the 20-second absence window as a second “disappearance” time.

- A plain “bag” now maps to backpack and handbag only. Suitcase is used only when the report says suitcase, luggage, or trolley bag.
- An item detection that overlaps a person is not the lost item. It does not get a last-seen time or a disappearance time. A track also needs at least three separate sampled frames.
- When the clock printed on the video can be read at two points and it moves with the file, every analysis time uses that clock. The page says so, including the date read from the picture. If the clock cannot be read, times stay based on the start time entered for the file, and the page says that too.
- The reader is `backend/ai/read_video_text.swift`, compiled to `backend/ai/bin/read_video_text` (`swiftc -O -o backend/ai/bin/read_video_text backend/ai/read_video_text.swift`). It is macOS-only. Analysis still completes without it.
- INV-0001 was re-analysed. The bag is not reported as found. Last seen is “Not determined”, disappearance is “Not reliably determined”, and the page states that times follow the clock printed on the video (2026-10-27). People in the clip are still listed, with times from that same clock.
- `npm run test:module5` → 117 passed.

### Step 27
Start AI analysis was missing on a clip that had just been uploaded (2026-10-27). The footage card only rendered that control after a separate analyses fetch, and a successful upload did not run that fetch, so the new file had a player and no analysis option until a full reload. Each attached clip now gets the control immediately, and the upload handler refreshes the analysis list. A future recorded date is reported as “cannot be in the future” instead of a generic invalid-date message.

### Step 28
INV-0002 phone (`Missing Object Detection.mp4`) was reported as not detected even though a white phone sits on the desk. YOLOv8n scored that phone around 0.19–0.30, under the 0.35 cutoff, and ByteTrack did not keep an id on it. `cell phone` is now accepted from 0.18. People and larger objects stay at 0.35. Unattended item sightings of the same class within 3 seconds are grouped, so a phone counts after 3 sampled frames even without a tracker id. Re-ran this recording: the phone is seen from 30.00s to 34.72s and again from 74.83s to 75.51s.

### Step 29
Item disappearance was still labeled from the start time typed on the form (12:22). This file is a screen recording, so that clock does not move in step with the file. `read_event_clocks.py` reads the camera clock on the frame at each item timestamp (a time on the same line as a date; if that frame has none, the nearest frame within 8 seconds). INV-0002 disappearance is 16:53:21 on 2015-03-30, the clock printed on that frame, shown as `16:53:21 (00:01:35 into the recording)`.

### Step 30
New registrations were stuck at sign-in (2026-10-27). The account is saved with `emailVerified: false`. Password sign-in and Email OTP both stopped with “Please verify your email before signing in,” and registering the same address again only said it already exists. Continue with Email OTP, and registering an address that is already saved but not verified, now send the verification code and open the code screen. A code that was just sent still opens that screen during the 60-second resend wait. `npm run test:module1` → 44 passed.

The mail account still uses Resend’s test sender (`onboarding@resend.dev`). That sender refuses every address except the inbox on the Resend account, so a new campus or Gmail address is saved and then cannot receive the code. A verified sending domain is required before those addresses can complete OTP.

### Step 31
The Resend key in `backend/.env` was replaced with a send-only key supplied for this project (2026-10-27). The key is not recorded in this file. A delivery check to an address other than the previous Resend inbox was accepted. `RESEND_FROM_EMAIL` is still `onboarding@resend.dev`. The API process was restarted so it loads the new key. A later send showed this key only delivers to thevaidya45@gmail.com. thevaidya45@gmail.com completed verification. vaidyaayush45@gmail.com and every other address are refused by Resend while the sender stays onboarding@resend.dev. The sign-in error now names that allowed inbox.

### Step 32
Resend was removed (2026-10-27). Mail now goes through Nodemailer and Gmail SMTP. Credentials are only `GMAIL_USER` and `GMAIL_APP_PASSWORD` in `backend/.env`. OTP login, email verification, password-reset codes, and admin community alerts use the same sender. `npm run test:module1` → 44 passed. `npm run test:module3` → 70 passed. A live SMTP check accepted mail to two different Gmail addresses, and a community-alert template was accepted. No Resend package or import remains.

### Step 33
INV-0002 estimated disappearance and missing duration were blank (2026-10-27). The phone is last seen at 29.66s (clock 16:53:19) and the file ends at 39.78s, so the usual 20-second absence check cannot finish. When the item stays absent for more than half of that window and the recording ends, disappearance is now the clock on the final frame and the missing duration is the time from the last sighting to that end. INV-0002 shows 16:53:19 – 16:53:28 (00:00:39 into the recording) and a missing duration of 10 seconds. A gap of only a few seconds at the end of a longer clip is still left unconfirmed. `npm run test:module5` → 118 passed. `npm run test:module6` → 161 passed.

---

## 11. CURRENT STATE SNAPSHOT

**Current module:** Module 6 complete in code and API-tested. Modules 1–5 still pass.  
**Current feature:** Investigation analysis and results on the existing admin Investigation Details page.  
**Last completed task:** Estimated disappearance and missing duration use the end of the recording when the item is gone and the file ends before the usual 20-second check.  
**Last files changed:** `backend/services/cctvAnalysisService.js`, `frontend/src/components/CctvAnalysisPanel.jsx`, `backend/scripts/testModule5.js`.  
**Current problems:** AI analysis and frame extraction need the local Python venv and model weights (`npm run ai:setup`, weights per `backend/ai/README.md`); without them the admin sees a clear failure message. The on-video clock reader is a macOS helper (`backend/ai/bin/read_video_text`, built from `read_video_text.swift`). If that helper is missing, times fall back to the start time entered on the CCTV form and the page says so. Detection quality still depends on YOLOv8n and the default 0.35 confidence. Analysis still runs in the API process, so a long video keeps one CPU busy. Gmail’s personal sending limit is about 500 messages a day. The app password must stay in `backend/.env` only.  
**Next recommended task:** None queued. Ask the user before starting new feature work.

**How to run (local):**
- Backend: `npm run dev` in `backend` (port 5050).
- Frontend: `npm run dev` in `frontend` (5173).
- Seed: `npm run seed` from repo root or backend.
- Admin: `npm run create-admin` in backend (script prompts/args; never paste the password here).
- Module 1 API tests: `npm run test:module1` in backend.
- Module 2 API tests: `npm run test:module2` in backend.
- Module 3 API tests: `npm run test:module3` in backend.
- Module 4 API tests: `npm run test:module4` in backend.
- Module 5 API tests: `npm run test:module5` in backend (worker stubbed; no Python needed).
- Module 6 API tests: `npm run test:module6` in backend (both workers stubbed; no Python needed).
- Module 5 AI environment: `npm run ai:setup` in backend, then the model weights from `backend/ai/README.md`.
- Module 5 + 6 real pipeline check: `npm run ai:check -- <path-to-clip.mp4> [HH:MM]` in backend.
- Full workflow check with the real workers: `npm run check:e2e -- <path-to-clip.mp4>` in backend.
