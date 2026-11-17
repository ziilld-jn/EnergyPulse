EnergyPulse 2.0 - Admin Accounts Feature Patch (corrected)

INSTALL
1. Stop backend and frontend terminals with Ctrl+C.
2. Extract this ZIP into the EnergyPulse2.0-main project root. Allow overwrite for the included files.
3. Start backend from the backend folder: python -m uvicorn app.main:app --reload --port 8000
4. Start frontend from the frontend folder: npm run dev
5. Open http://127.0.0.1:8000/docs and confirm /api/auth/admin/users is listed.

ADMIN ACCESS
- On a brand-new install with no backend/data/users.json, the app creates admin / admin12345. Change it immediately.
- If users already exist, no default admin is added and no existing account is promoted. To make your own account admin, stop backend and edit backend/data/users.json: add "role": "admin" to only your user record. Other accounts should remain "role": "user". Save and restart backend, then sign out and sign in again.
- Older accounts without a role are treated as regular users. New registrations are always regular users.

FEATURES
- Admin-only sidebar link and dashboard.
- Server-side admin-only endpoint GET /api/auth/admin/users.
- Search by name, username, or role.
- Lists names, usernames, roles, and account creation dates.
- Never returns password hashes.
- Does not include account deletion or password editing.

SECURITY NOTE
This is suitable for local development/testing. Do not expose the development server publicly. Replace the starter admin password and configure a private ENERGYPULSE_SECRET before deployment.
