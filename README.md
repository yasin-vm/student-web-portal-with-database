# student-web-portal-with-database
ys

## Production operations

- The application exposes `GET /healthz` for Render health checks. It returns HTTP 200 only when MongoDB is connected and otherwise returns HTTP 503 without exposing connection details. Set the Render Web Service health check path to `/healthz`.
- Configure and periodically verify MongoDB Atlas backups for the production cluster. Restore backups only into a deliberate target database and verify the collections afterward.
- Do not commit `.env` files or share Render/Atlas credentials. Rotate credentials that may have been exposed.
- Students who forget their password must contact the portal administrator; an administrator can set a new password from Student Management. Automated email recovery is not configured.

## Upload and account guidance

- Project uploads are limited to 10 files, with a maximum of 10 MB per file.
- Student password changes require the current password and a new password of at least 10 characters.
- Student showcase cards show project information, not private account contact details.
