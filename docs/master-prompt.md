# Master prompt — source of truth

> Verbatim copy of the original implementation brief (2026-10-15). Do not edit; track progress in `IMPLEMENTATION_PROGRESS.md`.

You are a senior multidisciplinary engineering team working directly inside this repository: Staff NestJS/TypeScript backend engineer, Next.js/React frontend engineer, application security engineer, PostgreSQL data architect, UX/UI designer, DevOps engineer and QA automation lead.
Implement a complete, production-oriented User Identity, Authentication, Authorization, Profile, Sessions, MFA, Security and Administration system for our Market Trading Room Simulator (Simulateur de Salle de Marché).
The application is English-first. All user-visible text, navigation, form labels, validation feedback, email templates, API messages, errors, comments, documentation, demo seeds and tests MUST be in polished, consistent English. Use clear financial/market-simulation terminology.
Reuse proven patterns and conventions from our previous TaxGain AI project, but DO NOT assume this repository is TaxGain AI, DO NOT retain TaxGain naming, cookie names, logos, fiscal-import behavior or unrelated business models. We want the same engineering language and architectural family: TypeScript, NestJS server, Next.js/React frontend, PostgreSQL, Argon2id, JWT short-lived access credentials, rotating opaque refresh credentials and secure HTTP APIs. Preserve existing compatible libraries, monorepo layout, ORM, DTO conventions, styling system and test tools after inspecting the repository. Redis and Docker are optional existing infrastructure to reuse where appropriate, not excuses for architectural bloat.
Non-negotiable execution behavior
1. Inspect the actual repository first: files, apps, package.json, existing modules, DB schema, migrations, API prefix, frontend router, email transport, env validation, tests, Docker and design system. Never claim an implementation exists without checking the source.
2. Create a concise implementation plan and a requirements-to-code checklist, then perform the implementation in coherent, verifiable slices. Do not stop after the plan.
3. Reuse or extend existing code safely. Do not introduce a second authentication system, redundant User model, unnecessary microservices or an incompatible second ORM.
4. If the repository has no appropriate identity structure, build an idiomatic NestJS AuthModule, UsersModule for account management if that improves separation, AdminUsersModule and shared security services. If the repository already uses AuthService for both identity and profile, refactor only when justified and without breaking external contracts.
5. Prefer explicit security guarantees, testable services, atomic database operations, modular NestJS providers, strict TypeScript and accessible frontend code.
6. Build both backend and actual frontend; do not leave /login or any auth page a placeholder. Wire forms to real endpoints, cookies, navigation and error states.
7. Run available code generation, lint, formatting, types, migrations, unit, integration and E2E tests. Fix failures created by your changes. Do not falsify test results.
8. Do not fabricate business requirements. Label anything not explicitly demanded by the supplied specification as DESIGN DECISION or RECOMMENDED EXTENSION.
9. Never bypass authorization for the sake of a demo. No hardcoded credentials, weak JWT secrets, production debug token disclosures, fake successful emails or localStorage refresh tokens.
10. Work autonomously through coding and testing. Ask for help only if a truly blocking external secret/service, irreconcilable schema conflict or destructive production migration requires user intervention. Otherwise choose a safe documented default.
11. Do not read secret values into documentation or output. Add names to .env.example, never real values.
12. At completion give a precise report of files changed, DB migrations, API endpoints, implemented screens, executed tests, limitations and manual configuration steps.
1. BUSINESS CONTEXT AND TRACEABILITY
The academic/client specification describes a Market Trading Room Simulator for client personnel and customers, serving beginner and professional traders. Features across the full system include personal dashboards, virtual portfolios, trading orders, transaction histories, risk evaluation, historical/backtesting strategies, interactive learning, competitions, AI analysis and trading agents, bank stress testing, XAI, actuarial tools and system administration.
This implementation focuses on the cross-cutting user and identity domain underpinning those modules; it MUST NOT attempt to implement the complete financial engines under the guise of implementing authentication.
Direct specification references
- §1–2, pp.1: users include novices and professionals; private virtual portfolios and AI features are central.
- §3.1, pp.1–2: user-friendly interface, individual personalized dashboard, user-specific portfolios, positions, performance, indicators and simulation/AI outputs.
- §3.2, p.2: portfolios, orders, transactions and histories are logically owned and secured per user.
- §3.3, p.2: learning, competitions, quizzes and progress require an identifiable learner and ownership boundaries.
- §3.4–3.7, pp.3–5: AI, banking stress testing, XAI and actuarial functionality need controlled access and auditable provenance, but the specification does not define separate user roles for them.
- §4, p.5: secure authentication, roles and authorizations, encryption of sensitive data, protected user/financial data, access restrictions and traceability of important actions.
- §5, pp.5–6: administrators manage user accounts/permissions and platform entities and inspect aggregate statistics and system functioning.
Crucial interpretation: the client specification DOES NOT prescribe an exact role enum, MFA product, cookie architecture, identity provider, approval hierarchy or exact registration fields. Those are engineering design decisions, justified below. Skill level (BEGINNER, INTERMEDIATE, ADVANCED or PROFESSIONAL) is NOT the same as an authorization role.
Create docs/identity-requirements-matrix.md with a row for each relevant specification requirement: source section/page, requirement, classification (EXPLICIT / NECESSARY INFERENCE / PROPOSAL / NEEDS CLARIFICATION), implementation files, backend endpoint, frontend screen and acceptance test. If a feature depends on a not-yet-implemented business module, build an authorization-ready interface or integration example rather than a fake financial engine.
2. TARGET ARCHITECTURE AND CODE QUALITY
- Backend: idiomatic NestJS on Node.js with TypeScript strict mode, REST controllers, services, injectable repositories/ORM and centralized configuration.
- Frontend: Next.js + React + TypeScript using the repository's current router (App Router if already present), existing UI components, state and CSS conventions. Prefer minimal dependencies. Do not rewrite the app theme.
- Database: PostgreSQL, using repository's existing ORM/migration tool (Prisma if it is already used; otherwise preserve the installed solution).
- Security: Argon2id, secure random opaque tokens, server-side token hashing with keyed HMAC-SHA-256 where useful, JWT access tokens, HttpOnly refresh cookie, server-side session records, role/policy guards.
- Email: reuse installed SMTP/provider adapter; support safe local development transport and production delivery.
- Background processing: only introduce an existing queue for mails/cleanup if already supported. DB transactions must never depend on external mail success.
- Audit: server-side append-only security event metadata with appropriately restricted access.
- Integration: public auth routes and protected account/admin routes under existing API prefix; document exact effective paths.
Use DTOs with validated input, typed output, stable machine-readable errorCode, OpenAPI annotations if Swagger is installed, consistent status codes and safe serialized responses. Use a single public user serializer; never pass ORM User entities directly through responses.
3. DATA MODEL — SAFE, EXTENSIBLE AND TIED TO THE MARKET DOMAIN
Inspect existing DB entities and evolve them with non-destructive migrations. Desired concepts (name them according to current conventions):
3.1 User
- id: UUID PK.
- email: normalized case-insensitive unique email; enforce uniqueness in the DB and handle races, including concurrent registrations or email changes.
- firstName, lastName: 1–80 characters after trimming; reject empty content.
- passwordHash: Argon2id; NEVER exposed.
- role: default INVESTOR (recommended because users maintain simulated investment portfolios); ADMIN elevated by secure seed/admin operation; add ADVISOR only if an advisory business workflow is really implemented. Do not grant advisory cross-user access simply because a role exists. If the current repo already uses a different role enum, preserve and map it carefully.
- experienceLevel: BEGINNER | INTERMEDIATE | ADVANCED, user-configurable; this personalizes education, NOT permissions. Only implement an additional PROFESSIONAL label if the UX/content actually distinguishes it.
- emailVerified, emailVerifiedAt, passwordChangedAt.
- status: PENDING_VERIFICATION | ACTIVE | SUSPENDED | DEACTIVATED or a similarly clear enum; nullable deletedAt for soft deletion if chosen.
- failedLoginCount, lockedUntil or equivalent persistent throttling metadata.
- mfaEnabled, mfaVerifiedAt and references to encrypted MFA secrets if MFA is present.
- createdAt, updatedAt, lastLoginAt, and possibly lastActiveAt with clearly defined update frequency.
- Optional preferences separately: preferred currency, timezone, market/chart preferences, notification opt-ins, training difficulty and accessibility; English is default UI language. Validate each field. No arbitrary JSON blob with no validation.
Do NOT collect actual brokerage credentials, bank accounts, national IDs or unnecessary sensitive personal data for a virtual trading simulator.
3.2 AuthSession (stable session)
Create a stable AuthSession entity/table or equivalent independent of rotating refresh-token rows:
- id UUID PK; userId FK.
- createdAt, lastSeenAt, expiresAt, revokedAt, optional revokedReason.
- User-agent metadata (bounded, sanitized), a privacy-preserving keyed digest of IP for anomaly monitoring if justified, and optional device label.
- Unique/session indices; query and cap active sessions.
A user may have multiple simultaneous sessions. A stable session ID MUST remain constant during refresh rotation. Access-token validation checks this stable session is still active. Do not set a JWT sid to the database row of a rotating refresh token, because revoking that row on refresh would invalidate access tokens belonging to the same ongoing session.
3.3 AuthToken
- id, userId, optional sessionId, type enum (EMAIL_VERIFICATION, PASSWORD_RESET, EMAIL_CHANGE, REFRESH_TOKEN, MFA_LOGIN_CHALLENGE), tokenHash unique, expiresAt, usedAt, revokedAt, createdAt.
- For refresh tokens: sessionId, replacedById, optionally family/rotation counter. Do not need both familyId and sessionId if the stable session already represents the family unambiguously.
- For email change: structured, validated pending-email metadata (never place credentials in generic meta).
- Optional lastUsedAt and client metadata only if needed.
- Token values are 32 cryptographically random bytes encoded as 64 hex characters or an equivalent safe format; store HMAC-SHA-256(AUTH_TOKEN_PEPPER, token) with a separate secret, NOT raw tokens. If migrating an existing SHA-256 store, plan a safe rollout so pre-existing tokens do not silently break without an explicit strategy.
- Token valid iff hash/type match, unused, unrevoked, unexpired and associated identity/session is in the expected state.
3.4 MFA and audit
- Store TOTP secrets with authenticated encryption (AES-256-GCM or vetted crypto helper), separately encrypted at rest using a dedicated MFA_ENCRYPTION_KEY that is never committed. Securely handle IV/nonce/auth tag and key versioning as needed.
- Recovery codes are individually generated, displayed once, Argon2id hashed, individually consumable with concurrency safety. Track remaining count without returning hashes.
- An AuditEvent records actor identity if known, affected account/resource, event type, timestamp, outcome, request correlation ID and limited context. Never record passwords, JWTs, raw reset/refresh/MFA tokens, cookie headers, OTPs, full financial records, email-link URLs or secret material.
- Relationships with future portfolio/order/import/learning/stress-test artifacts MUST maintain user ownership. Do not cascade-delete historical financial/simulation records without an explicit data retention decision.
Create indexes and integrity constraints. Show precisely which database changes are required and document rollback/migration precautions.
4. PASSWORD, TOKEN AND AUTHENTICATION SECURITY RULES
Implement and test these invariants:
1. Normalize emails with trim + lowercasing consistently in every account flow. Reconcile DB uniqueness semantics safely.
2. Hash passwords using Argon2id, benchmark appropriately; security reference baseline: memory 19 MiB, 2 passes, parallelism 1. Verify using parameters encoded in the hash.
3. For a NEW password-only system, prefer a modern policy of 15–128 characters, allow Unicode and spaces, reject a curated compromised/common password list, avoid arbitrary forced combinations of letters/numbers/symbols. If migrating an existing TaxGain-compatible policy (8–128 with letter+digit), preserve login for existing hashes, document the change and update all DTOs/frontend consistently. Do not silently downgrade security.
4. Provide hashPassword, verifyPassword, generateOpaqueToken, hashOpaqueToken, token-expiry, cookie, JWT and session abstractions with focused tests.
5. Never store tokens in plaintext; never expose them in API responses, URLs rendered in server logs, analytics, exception traces or production developer tools. Development email previews may carry verification URLs only in locally restricted development delivery tooling; no token in JSON even in development.
6. Do not use JWT_REFRESH_SECRET to sign refresh tokens; refresh credentials are opaque. Remove stale misleading env variables only after checking actual references.
7. Access JWTs short lived (e.g., 15 min), signed with sufficiently strong JWT_ACCESS_SECRET; include sub, stable sid, issuance/expiration and an appropriate session/credential version or timestamp. Do not authorize against a stale role claim.
8. On EACH sensitive/protected request, validate signature, issuer/audience if configured, expiration, user state, verified email, current role from DB, active stable session and any password/security-version invalidation policy. Use bounded caching only if immediate invalidation remains correct.
9. Tokens for email verification, reset and MFA challenges are single-use atomically, including concurrent attempts; use conditional DB updates inside a transaction and check affected-row count.
10. Refresh rotation uses an atomic transaction: claim existing active refresh token once, create replacement for the SAME stable session, mark prior refresh as rotated/revoked and return a new cookie. If replacement creation fails, roll back and do not lose the session.
11. On confirmed reuse of an already-rotated refresh token, treat it as potential theft; revoke the associated session family and record REFRESH_REUSE_DETECTED. Correctly handle documented benign duplicate retries/concurrent browser tabs and do not leak a new token to a request presenting an invalid old token. Implement a single-flight refresh on the frontend; consider cross-tab coordination and server concurrency tests.
12. Logout revokes the corresponding stable session immediately; previously issued access JWTs tied to it fail at next protected request. Logout-all and password reset revoke all relevant sessions as specified.
13. Generic account-discovery-sensitive endpoints give the same public response to existing, absent, pending, blocked or cooled-down accounts wherever appropriate. Use reasonable equivalent processing timing, not claims of mathematically constant wall time.
14. Use layered protection against brute force and email flooding: rate limits by IP and normalized account identifier, persistent failed-attempt tracking, token-email cooldown (default 60 sec), optional progressive delays and temporary lockouts without easily weaponized permanent denial of service. Benchmark/adjust limits; never claim example thresholds are contractual requirements.
15. No leaking whether a user-owned UUID exists in another account: by default return a consistent 404 for missing OR inaccessible private resources. Administrative APIs may use role-appropriate explicit errors.
16. Production startup MUST validate required secrets and reject unsafe defaults/weak values, dangerous dev flags, incorrect HTTPS/cookie/CORS settings and unknown auth token TTL formats.
5. COMPLETE PUBLIC AND AUTHENTICATED API
Use the existing API prefix. The paths below assume /api and may be adapted consistently if the codebase uses /api/v1. Implement DTOs, service logic, database transaction safety, auditable events, Swagger contracts and tests.
5.1 Registration — POST /api/auth/register
Input: first name, last name, normalized email, password + confirmation if UI chooses to send it (service must validate independently). Public registration always assigns default INVESTOR and an initial non-elevated state. Never accept role, status, emailVerified, virtualBalance or administrative attributes from clients. Create account, generate email-verification token (60 min configurable), send verification email, and return a generic check-email response to limit enumeration. If email already exists, avoid creating duplicates; verified accounts may receive a carefully rate-limited account-exists notification, and pending accounts may receive a new verification link outside cooldown. DB unique-constraint races must be handled safely. The registration HTTP response never includes a JWT or raw verification token. If sending mail fails, preserve the consistent external response but expose appropriate internal delivery observability and a safe resend flow.
5.2 Email verification — POST /api/auth/verify-email
Consume exactly one valid verification token via conditional update/transaction. Set verified fields and activate account if otherwise eligible. Revoke other outstanding verification tokens. Reject expired/used/revoked/incorrect tokens with safe messages. Never automatically log the user in merely because the link was opened. A verification GET page must never auto-consume its token.
5.3 Resend verification — POST /api/auth/resend-verification
Identical public response whether user exists, is already verified or is cooling down; only send when appropriate. Enforce cooldown, rate limiting and audit without exposing account existence.
5.4 Login — POST /api/auth/login
Normalize email; compare using Argon2. For an absent account use a precomputed dummy Argon2id hash with comparable work before generic 401 INVALID_CREDENTIALS. Wrong password gets the same outward error. Include safe persistent failure/lockout controls, generic feedback and alerting. If credentials are correct but email not verified, return a controlled 403 EMAIL_NOT_VERIFIED (no session). If suspended/deactivated, deny the session with a safe account-state response after credential verification. If MFA is enabled, issue only a short-lived login challenge, with no authenticated session or refresh cookie. Otherwise create a stable session, a hashed rotating refresh token, sign access JWT and return public user profile + access JWT. Refresh token is set exclusively in an HttpOnly cookie for browser clients. Allow multiple devices subject to documented session limits.
5.5 MFA completion — POST /api/auth/mfa/verify-login
Validate and atomically consume a 5-min login challenge; accept valid TOTP or single-use recovery code; throttle/restrict repeated attempts (e.g., 5). Only after successful MFA issue the actual session/access/refresh. Never let an MFA pending challenge reach protected APIs.
5.6 Refresh — POST /api/auth/refresh
Browser reads refresh ONLY from its cookie. Perform atomic rotation in a stable session and return a new access JWT + sanitized user with new HttpOnly cookie. Missing/expired/revoked/reused tokens fail appropriately, clear invalid cookies and audit potential theft. Keep any non-browser refreshToken JSON input compatibility ONLY IF existing clients actually require it; if so, document and secure that explicit separate transport. Browser JSON never contains refresh secrets.
5.7 Logout — POST /api/auth/logout
Revoke current stable session on server, including active refresh tokens; clear cookie using matching Path/SameSite/Secure settings. Return idempotent success for already logged-out browsers without exposing token state. Access JWTs for the revoked session fail immediately on next protected request.
5.8 Forgot and reset password
- POST /api/auth/forgot-password: generic response; rate-limited; generate 30-min password reset token if account qualifies; revoke older tokens; send safe link; errors must not reveal existence.
- POST /api/auth/reset-password: validate token atomically; validate new password + confirmation, update Argon2id hash and passwordChangedAt/securityVersion, revoke ALL sessions and competing reset tokens in transaction, send password-changed notice. Already issued access tokens must be denied next request.
- POST /api/auth/change-password: protected; require current password, validate new password differs, consider step-up MFA for high-risk accounts, atomic password change + session revocation, notification email and predictable reauthentication behavior. If retaining current session, replace it with a NEW stable authenticated session, don't merely un-revoke a revoked session.
5.9 Current profile and edits
- GET /api/auth/me: protected, return explicitly serialized public fields only: id, email, firstName, lastName, role, experienceLevel, emailVerified, status, safe preferences, timestamps if necessary. No secret material and no other users' private data.
- PATCH /api/auth/me: current user only; only safe editable names and allowed non-security profile fields. Reject overposting; no direct email, role, verification or status mutation.
- GET /api/users/me/preferences and PATCH /api/users/me/preferences if profile preferences merit separate endpoints; otherwise a well-defined /api/auth/me/preferences endpoint is fine. Persist and validate English-first UX preferences, local timezone, currency display and educational experience level.
- GET /api/users/me/dashboard-context (or a service provider): return role, experience, allowed feature capabilities and lightweight initial UI context without inventing live portfolio/performance numbers. Existing trading/learning modules should supply their own real data.
5.10 Change email
- POST /api/auth/change-email/request: require fresh reauthentication (password, and MFA when enabled), normalize target, issue single-use EMAIL_CHANGE token sent to new address. Notify old address of initiation. Keep current verified address active until confirmation. Avoid revealing whether target email belongs to another user to an untrusted caller; validate uniqueness at final commit.
- POST /api/auth/change-email/confirm: atomically claim token, verify unclaimed new email within transaction, update email and verification state, invalidate all sessions, revoke competing tokens and notify old/new addresses. If uniqueness race occurs, return a safe outcome without changing ownership incorrectly.
5.11 Session management
- GET /api/auth/sessions: list only the requesting user's active device sessions with stable ID, created/last-used, bounded device info and current-session marker. Never return tokens or full raw IP.
- DELETE /api/auth/sessions/:id: revoke only an owned session; use 404 for missing/unowned IDs. Revocation invalidates associated access at next request.
- DELETE /api/auth/sessions: revoke all other sessions after password (and MFA if enabled) step-up, while documenting whether the current session is retained. Provide a separate fully-log-out-all mechanism if useful.
- A maximum session count (e.g., 8) should be configurable. Revocation of the oldest must be deterministic and auditable.
5.12 MFA lifecycle (TOTP)
- POST /api/auth/mfa/setup: authenticated recent reauth; create encrypted pending TOTP secret, return setup secret/otpauth URI once only over HTTPS, never audit or persist plaintext.
- POST /api/auth/mfa/enable: verify OTP with a vetted TOTP library (30-sec step, narrowly justified allowed clock drift), then mark enabled and generate/display recovery codes only once; hash individually; expire pending setups.
- POST /api/auth/mfa/disable: require password plus current valid MFA or a suitably protected recovery flow; revoke current session(s) as appropriate and notify user.
- POST /api/auth/mfa/recovery-codes/regenerate: require step-up, invalidate old codes and issue new ones displayed once.
- GET /api/auth/mfa/status: only status, remaining recovery code count and last enabled date, NO secrets.
- Implement replay prevention for TOTP where practical, using last accepted time-step state and atomic update; throttle requests.
- Admin MFA should be mandatory in production as a recommended security policy, with a safe first-admin enrollment mechanism; document it as a design decision, not a requirement stated by the client.
5.13 Deactivate and delete account
- POST /api/auth/me/deactivate: step-up; invalidate all sessions; make sign-in impossible until authorized reactivation; preserve explicitly necessary audit records.
- DELETE /api/auth/me: step-up and clear confirmation; define a documented delete/anonymize/retention workflow. If there is no approved retention schedule for simulated trading records, implement an explicit safe pending-deletion/anonymization state and flag the final retention rule for product approval. Do not claim GDPR/legal compliance or silently destroy all transaction/history records by cascade. A revoked/deleted identity must not be usable for sign-in or token issuance.
5.14 Optional account-help
Clear account recovery errors; contact-support placeholder must be a genuine configured support route or a plainly labeled unavailable feature. Do not invent working support channels.
6. AUTHORIZATION, OWNERSHIP AND ACCESS POLICIES
The authentication layer proves who the caller is; authorization determines exactly which operations/resources the caller may access. Implement BOTH.
Roles
- INVESTOR: self-service virtual trading, own portfolio/orders/transactions, own learning progress, own AI experiments and simulations where permitted; NO admin actions.
- ADMIN: platform-level management of users, access, account status, financial data sources, training content, AI model metadata, stress-scenario definitions and platform metrics ONLY when corresponding business services exist. An ADMIN does NOT automatically acquire permission to inspect or modify another person's private portfolio.
- ADVISOR: enable only if explicitly included by existing product models. If included, access to a user's data requires a consented active advisor-client relationship and specific scoped permissions; never merely role === 'ADVISOR'.
- A separate INSTRUCTOR role for training/quiz authoring is OPTIONAL and should not be invented as mandatory. If implemented, document permissions and make default registration INVESTOR.
Use guards plus resource-level policies. @Roles() / RolesGuard may protect coarse administrative entry, but EVERY sensitive service method also checks ownership, status, relationship permissions and allowed action.
Ownership integration contract
Any private resource with owner ID (portfolio, open/closed position, order, trade, import if present, watchlist, saved strategy, backtest, AI prediction job, AI trading-agent run, learning progress, quiz attempt, competition submission, actuarial simulation or bank stress-test run) needs policies such as:
- canReadOwnResource(user, resource)
- canModifyOwnResource(user, resource)
- canExecuteSimulation(user, limits, resource)
- canManageUsers(user)
- canManageLearningContent(user)
- canManageStressScenarios(user)
Return the same 404 RESOURCE_NOT_FOUND for absent and cross-account private IDs to avoid ownership discovery. Validate ownership inside query and service layer, not only via frontend hiding or route-level guards. Never accept userId from a browser as proof of ownership. All calculations/AI jobs must carry an authenticated subject ID and enforce consistent output visibility; a predictable async job ID must not leak results.
Visitor/guest: the specification describes customers/collaborators and novice/pro users; it does not require a visitor role. Public landing page, public explanatory content and auth forms may be browsed without an account. Private dashboard, trading, portfolios, AI, learning-progress and account pages must authenticate. If public educational previews are desirable, label as a proposal and implement with explicitly public data only.
Example permissions matrix to realize and test
Capability	Guest	Investor	Admin
See marketing/landing	Yes	Yes	Yes
Register and verify email	Yes	Yes when relevant	Yes when relevant
View own dashboard and portfolio	No	Yes	Yes, own only
Trade using own virtual portfolio	No	Yes	Yes, own only, unless product policy says otherwise
View another investor's portfolio	No	No	No by default
View own learning progress	No	Yes	Yes, own only
Manage accounts and account roles	No	No	Yes, scoped and audited
Suspend/reactivate users	No	No	Yes, with rules
Manage platform settings	No	No	Yes, when module implemented
View aggregate analytics	No	No	Yes; avoid unnecessary personal-data disclosure

7. ADMINISTRATOR USER MANAGEMENT
Implement the administrator backend and real frontend, independent of unfinished market engines:
- GET /api/admin/users: authenticated admin-only, paginated, searchable and filterable by status/role/verification. Restrict fields to necessary public/admin-safe metadata; bounded page size and stable sort.
- GET /api/admin/users/:id: limited account information plus allowed status/audit summary; never passwords/MFA secrets/tokens; no portfolio intrusion.
- PATCH /api/admin/users/:id/status: suspend/reactivate account, record reason and audit; suspended accounts cannot issue refresh or access protected services; revoke sessions upon suspension.
- PATCH /api/admin/users/:id/role: strictly controlled elevation/demotion; reauth/step-up MFA for sensitive actions; protect against escalation by lower roles, self-escalation, inappropriate admin demotion and removal of last active admin.
- GET /api/admin/audit-events: properly paginated/filtered, admin-only security logs, with PII minimization.
- GET /api/admin/overview: real counts for total/active/pending/suspended users, verified accounts, recent safe aggregate events. Never fabricate data from unrelated finance modules.
- Optional explicit admin-created invitation flow ONLY if supported by current repo/business requirement; public registration must never accept role assignment.
Seed initial admin using a documented secure, opt-in CLI/env bootstrap with hashed password, no committed credential, no public admin signup endpoint, and no insecure default password. Production MFA setup should be possible for this account.
8. COOKIE, CORS, CSRF AND CLIENT AUTHENTICATION
Design a coherent production deployment topology. Prefer same-site first-party deployment where feasible. Do not assume that SameSite=Lax works on an arbitrary frontend domain unrelated to the API domain.
- Browser access token: in memory only (React context/store). Do not use localStorage/sessionStorage for tokens. Prefer a BFF/fully HttpOnly session if the existing project already securely uses it, but do not gratuitously rebuild architecture; document selection.
- Refresh: HttpOnly, Secure in production, SameSite=Lax or Strict when deployment topology permits, scoped Path (e.g. /api/auth), no Domain unless required. Choose cookie names appropriate to Market Trading Room Simulator, not tg_refresh.
- If cross-site deployment is unavoidable: explicitly plan SameSite=None; Secure plus robust CSRF protections and narrowly allowed credentialed CORS; no wildcard origin. Validate browser behavior in the actual intended deployment.
- CORS: strict allowlist from CORS_ORIGINS, credentials: true only for trusted origins. Validate real production origin, account for proxies, trusted headers and HTTPS.
- CSRF: protect cookie-authenticated state-changing endpoints including refresh/logout; use explicit Origin/Referer and Fetch Metadata verification with safe fallbacks and/or vetted anti-CSRF token pattern; do not rely on a custom header or SameSite alone. Prevent login CSRF where relevant. Set secure headers with Helmet or current equivalent, content security policy compatible with Next.js, Cache-Control: no-store on auth responses and Referrer-Policy: no-referrer on email-token pages.
- Never consume one-time emailed credentials during GET/page render, bot prefetch or link preview. Show a confirmation button; remove link token from URL via history.replaceState after client extraction. Sanitize tokens from analytics and error reporting.
- Frontend auth client: typed API wrapper with credentials: 'include' for auth endpoints, Bearer access JWT for private API, centralized 401 handling, one in-flight refresh promise, retry original request once, return to login after failure. Consider safe BroadcastChannel cross-tab sign-out/refresh coordination; do not accidentally retain access state after logout, password reset or suspension.
- Explicitly handle development localhost HTTP cookies, secure production HTTPS and actual Next.js deployment. No silent insecure production fallback.
- Add careful rendering for backend-triggered invalidation: stale protected pages must clear user state on auth failure.
9. FRONTEND — COMPLETE PREMIUM ENGLISH FINTECH EXPERIENCE
Build a beautiful, coherent, production-quality identity area matching existing Market Trading Room Simulator brand/design tokens. Style: sophisticated trading workstation, restrained finance aesthetic, accessible light/dark compatibility if app supports themes, crisp typography, polished spacing, strong visual hierarchy, purposeful micro-interactions, subtle charts/patterns ONLY if existing design permits, and absolutely NO ornamental fake portfolio returns, prices or profit claims.
Design for desktop and mobile; support keyboard navigation, screen readers, form labels, focus states, reduced motion, visible errors, responsive layouts, skeletons, loading, success and empty states. Avoid excessively distracting neon/glass effects.
Implement these fully working routes or idiomatic equivalents respecting the repo router:
1. / public landing/authenticated redirect strategy; relevant and branded entry points.
2. /register registration (first/last/email/password/confirm, secure visible password rules, submission state, server validation).
3. /login replace placeholder with real sign-in, remember device/session semantics if implemented, forgot-password path, email-unverified state, MFA-challenge transition, show/hide password, accessible messages.
4. /verify-email safe token confirmation, success/expired/used states and resend path.
5. /resend-verification or integrated resend flow with generic messaging and cooldown UX.
6. /forgot-password non-enumerating request UI.
7. /reset-password token handoff, validation, confirmation, success and expired states.
8. /dashboard protected identity-aware dashboard shell/real existing widgets; show personal greeting, quick navigation to portfolio, trading, risk, learning, AI, stress testing, actuarial features IF those modules/screens exist. Not implemented modules should be honestly labeled unavailable/coming later, never fabricated.
9. /settings/profile name, verified email, experience level, permitted preferences, account activity.
10. /settings/security change password/email, session overview, MFA enrollment, backup codes, deactivate/delete.
11. /settings/sessions all active sessions with current device, revoke device, sign out elsewhere with confirmation.
12. /admin protected overview with real aggregate account data.
13. /admin/users user list with search/filter/pagination, details and safe management actions.
14. /admin/users/[id] if suitable; status/role forms with confirmations and audited descriptions.
15. /unauthorized, sensible error/not-found states; do not leak private info.
Reusable components: AuthLayout, AuthFormField, PasswordStrengthHint, FormError, SessionCard, MfaEnrollment, ProtectedRoute/guard wrapper, PermissionGate, ProfileDropdown, AccountStatusBadge, ConfirmDialog, AdminUserTable as warranted. Use an existing form library (React Hook Form/Zod, etc.) only if already installed or clearly worth adding; keep client and server validation aligned and avoid overengineering.
The navbar must respond to login/logout and role changes. On refresh/reload, restore auth by calling the secure refresh/session mechanism without flicker or auth loops. Redirect unauthenticated visitors to /login with a validated same-origin returnTo path (prevent open redirects). Admin routes must enforce access at the server/API regardless of frontend route guards. If using access-token-in-memory client-rendered protected pages, clearly design a safe loading/auth boundary and avoid assuming server SSR has the token.
Emails must also be premium English: branded, responsive transactional templates for verification, reset, password changed, new email request/confirmation, suspicious sign-in/lockout (where implemented), sessions revoked and account deactivation. Each should state expiry if relevant, include a safe canonical link, plain-text version, support text that does not invent support contact details, and avoid logging links. Configure sender identity only through environment variables.
10. DOMAIN READINESS — USER MANAGEMENT IN A MARKET SIMULATOR
Do NOT stop at generic SaaS auth. Make identity actually useful for our financial simulator while respecting unimplemented modules:
- Registered trader is associated with own dashboard personalization, display preferences and experience level.
- Identity and ownership integrate with virtual portfolios, holdings, orders, trades and risk indicators if present. If those modules are not built yet, define reusable guarded service/policy contracts and tests with controlled fixtures; do not invent financial data or functions.
- User/learner progress belongs to specific user; courses, quiz attempts, challenges and contest participation should not be readable cross-user.
- AI forecasts, bot decisions, sentiment analysis, backtests, banking stress tests, XAI explanations and actuarial jobs must carry owner IDs or explicit share policies. Different roles should not automatically see private experiment outputs.
- For expensive market-data queries/AI/simulation actions, prepare pluggable per-user quota/resource guards, but do not falsely create billing/subscription requirements.
- Authentication and role management are not financial suitability assessments: a beginner setting is a learning preference, not an investment eligibility authorization or professional-trader certification.
- Integrate no real brokerage accounts or real-money trading merely because TaxGain AI once handled brokers or financial uploads. Everything is virtual unless a different approved module requires otherwise.
- Admin aggregate metrics should be privacy-conscious; provide a simple account metric contract for future analytics but never fake trade/market results.
11. OPERATIONAL SECURITY AND CONFIGURATION
Provide complete .env.example entries for at least:
DATABASE_URL, NODE_ENV, APP_FRONTEND_URL, CORS_ORIGINS, JWT_ACCESS_SECRET, optional JWT_ACCESS_SECRET_PREVIOUS, JWT_ACCESS_EXPIRES_IN, JWT_REFRESH_EXPIRES_IN, AUTH_TOKEN_PEPPER, AUTH_EMAIL_COOLDOWN_SECONDS, EMAIL_VERIFICATION_TOKEN_EXPIRES_IN_MINUTES, PASSWORD_RESET_TOKEN_EXPIRES_IN_MINUTES, MFA_ENCRYPTION_KEY, SMTP/provider variables, AUTH_MAX_SESSIONS, AUTH_RATE_LIMIT_*, secure cookie settings appropriate to environment and retention-policy variables when supported.
Do not add unused variables without explaining them. Validate durations and misconfigurations at startup. Store production secrets outside git. Allow current config provider to handle overrides. Respect any existing Docker Compose environment.
Implement safe HTTP headers, structured logs, minimal redacted error output, password/token secrecy, request IDs and safe audit. Rate-limit public auth and login-challenge endpoints. Sensitive responses must not be cached. Consider background deletion of expired auth tokens and idle sessions with a documented maintenance job. Ensure maintenance does not delete tokens needed for short-term refresh-reuse forensic detection before a documented retention window.
Admin and security system must never leak data in Sentry/telemetry, unguarded Swagger paths, console output or HTML hydration payloads. Distinguish secure authentication from legal compliance claims; if retention requirements are not available, record NEEDS LEGAL/CLIENT APPROVAL.
12. IMPLEMENTATION ORDER — EXECUTE, NOT JUST DESCRIBE
Work through the following slices without stopping after the first:
Slice A — Repository audit and contracts
- Inspect current code and write docs/identity-implementation-plan.md with exact discovered paths, dependencies and compatibility risks.
- Construct the source-traceability matrix and route/policy matrix.
- Establish current tests and known baseline failures.
Slice B — DB and reusable primitives
- Add safe migrations and indices for User, stable AuthSession, AuthToken, MFA, preferences and audit.
- Add password/token/session/security helpers and configuration validation.
- Verify migrations against local dev/test DB; guard destructive operations.
Slice C — Core auth server
- Implement registration, verification, resend, login, refresh, logout, forgot/reset, /me, guards/strategies, cookie/CORS/CSRF, email adapter.
- Cover common errors, concurrent single-use tokens and cross-user access.
Slice D — Security hardening and lifecycle
- Implement account locks/rate limiting, session rotation/reuse detection, password/email change, session listing/revocation, status changes, MFA lifecycle and deletion/deactivation handling.
Slice E — RBAC, admin and ownership
- Implement role guard, service policies, self-only data access, admin APIs and audit reporting; seed initial admin securely.
Slice F — Frontend integration
- Build polished auth pages; auth state management; form validation; real email verification/reset handling; profile/security/sessions screens; working admin area and dashboard shell; responsive accessibility.
Slice G — End-to-end integration and verification
- Validate all migrations, CORS/cookies, local emails, user flows, protected routes and security scenarios; update docs and examples.
Complete each slice's tests and report blockers, then continue to the next. Avoid accumulating unchecked TypeScript errors.
13. REQUIRED TEST MATRIX (DO NOT SKIP)
Build automated unit, integration and E2E tests using installed tooling (Jest/Vitest, Supertest, Playwright/Cypress if present; add minimal new tooling if genuinely necessary). Include an isolated test DB, fixed clocks/mock transports where needed and cleanup between tests.
Registration / verification
- Valid register, email normalized, default INVESTOR, no privileged fields accepted, no JWT, no secret response.
- Duplicate email race, case variants, previously verified/pending accounts and generic responses.
- Email send failure with recoverable resend, 60s cooldown, invalid/expired/replayed verification, concurrent duplicate confirmation.
Login / auth
- Wrong email and wrong password same public error, dummy hashing path, password hashing consistency.
- Locked, suspended, deactivated, unverified account denied, proper audit and session behavior.
- Successful login -> session -> cookie -> Bearer -> /me; profile serialization excludes ALL secrets.
- Expired/malformed/forged access JWT, invalid issuer/audience where applicable, deleted account and stale role.
Refresh / sessions
- Legitimate rotation, replaced token fails, replay revokes associated stable session, no session lost on transaction failure.
- Parallel refresh requests: exactly one authoritative outcome; no two live descendants; correct theft/duplicate policy.
- Multiple logins/devices, maximum count, logout one versus all, revoke another device; access from revoked stable session rejected immediately.
- Concurrent browser tabs and single-flight behavior where testable.
Password / email / MFA
- Generic forgot response; expired/reset token replay, concurrency, password policy, password-changed session invalidation.
- Change password requires old password, reject same password, notify user and prevent stale access.
- Email change requires step-up, uniqueness race, pending email, one-time confirmation and old/new notification.
- MFA setup cannot become active without verified TOTP; challenge before session; invalid/expired/replayed MFA; brute-force challenge limits.
- TOTP replay where implemented; one-time recovery-code consumption under concurrency; disable/regenerate requires step-up; no secrets exposed.
Authorization / privacy
- Guest cannot access private route, investor cannot access admin, admin cannot access another investor's private resource by default.
- Cross-user portfolio/order/learning/job IDs yield indistinguishable 404 where privacy requires.
- Overposting/role escalation blocked, forged userId ignored, admin status/role updates audited.
- Last admin protection and privileged operation step-up.
- CORS restricted; cookie attributes correct per environment; CSRF blocked; open redirects blocked; email token GET does not consume.
- Audit/logging excludes passwords and all raw token types.
Frontend
- Register -> verify -> login -> private dashboard -> profile -> logout.
- Forgot -> reset -> old credentials invalid -> login again.
- MFA enrollment -> MFA-required login -> sessions management.
- Non-admin /admin blocked both UI and API.
- Mobile and desktop forms: visible errors, keyboard/focus, accessible field labels, pending states.
- Reload keeps valid session via refresh; logout and revoked session clear UI state.
- Production build succeeds with no placeholder login or fake credentials.
Tests must assert behavior, not implementation-specific internal names. Report skipped tests and why; do not label unexecuted coverage as complete.
14. EXAMPLE AUTHORIZATION DECISIONS TO DOCUMENT
Write docs/identity-security-decisions.md with at least:
- Why stable session IDs rather than JWT sid pointing to rotating refresh-row IDs.
- Why and when old refresh replay revokes a session; concurrency edge cases.
- Why the current role is reloaded from DB and how administrator actions invalidate access.
- Why users cannot self-assign ADMIN; ownership is not the same as RBAC.
- Why guest access is limited to truly public routes.
- Why we do not copy TaxGain tax-import or broker-specific entities.
- Why password policy differs from a legacy 8-char rule if modernized.
- Why browser tokens are not stored in localStorage; chosen cookie/SameSite/CSRF scheme.
- How admin bootstrap is secured, and how MFA is enforced for privileged roles if selected.
- Which identity assumptions remain client decisions (exact business roles, retention, account deletion and advisor sharing).
15. FINISHED DELIVERABLES AND DEFINITION OF DONE
Deliver actual working, integrated code and these artifacts:
1. Database schema, checked migration and safe seed/bootstrap instructions.
2. Complete NestJS modules, services, controllers, DTOs, guards/decorators, serializers, policies, cookies, email and MFA flows.
3. Complete Next.js auth/session/profile/security/admin interface integrated with the backend.
4. API contract documentation with sample request/response without real secrets.
5. .env.example, setup instructions and local SMTP test guidance.
6. Requirements mapping, access/policy matrix, security decisions and remaining clarification register.
7. Tests for auth, concurrency, security, ownership, administration and browser flows.
8. A final honest status table: requirement / backend / frontend / test / complete-or-blocked.
9. Exact commands you ran and their actual outcomes; fixed issues and remaining risks.
Definition of done: from a fresh development setup, a visitor can register, receive a verification link via a real configured mail/dev-preview transport, verify, log in, complete MFA if configured, enter a personal English dashboard, edit profile/preferences, rotate session, manage devices, change password/email, log out; an administrator can securely view and manage accounts, while a regular investor cannot cross user/data boundaries. The implementation must remain production-safe with real auth/security controls and be ready to protect future trading, portfolio, risk, educational, AI, bank stress-testing and actuarial modules without pretending those engines are already implemented.
Do not stop at scaffolding. Begin by inspecting this repository, then execute every slice you can complete. At the end distinguish actual completions from blocked or proposed features.
16. PRIMARY SECURITY AND FRAMEWORK REFERENCE LINKS
Use these as engineering references, not as substitutes for reading our repository or as claims of certification:
- OWASP Authentication Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html
- OWASP Session Management Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
- OWASP Password Storage Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- OWASP Forgot Password Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html
- OWASP CSRF Prevention Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html
- NIST SP 800-63B-4 Digital Identity Guidelines: https://pages.nist.gov/800-63-4/sp800-63b.html
- NestJS authentication: https://docs.nestjs.com/security/authentication
- NestJS authorization: https://docs.nestjs.com/security/authorization
- NestJS rate limiting: https://docs.nestjs.com/security/rate-limiting