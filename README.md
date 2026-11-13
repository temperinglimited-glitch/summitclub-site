# Guest registration thank-you update — 13 November 2026

After a successful save, the registration form is hidden and a clear “Thank you” message is shown. Guests return to index.html after five seconds. “Return home now” is also available. Validation or save failures keep the form open with its error message; no redirect is started.

This package changes only:
- public/guest-registration.html
- public/assets/registration.js

Upload
1. Unzip Summit_Club_Registration_Thank_You_Update.zip.
2. Open https://github.com/temperinglimited-glitch/summitclub-site on main.
3. At the repository root, choose Add file → Upload files.
4. Drag the extracted public folder into the upload area, preserving its paths.
5. Commit both files together and wait for the active Cloudflare test Worker build to succeed.
6. Open a private guest-registration link, save it successfully and confirm the thank-you message appears before returning to the home page.

The new registration.js asset URL has a fresh version so browsers request the updated script. No settings, secrets, database, payment code or booking terms are changed. There is no new deploy command.

Validation: both existing asset checks passed; Cloudflare asset build passed; local browser checks confirmed the success message, hidden form, automatic home-page return and failed-save recovery. Synthetic guest details only; no real emails or payments sent.

Source: the two original files matched GitHub main at commit e66f4d623f7a7084c29f5a3e6c59b9084bb381fc before editing. The update has been prepared locally and has not been uploaded or deployed.
