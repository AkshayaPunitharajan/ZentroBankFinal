# Zentro Bank UI

Zentro Bank P658, IFSC AKSH0R4N8WX. The original SharedBank sign-in, balance, transfer and routing integration stays in place. The browser uses the existing Firebase project, `zentro-bank-dd41d`, for additional customer and admin features. No separate server is needed.

## Run on Windows

1. In VS Code, open the extracted `zentro-bank-main` folder.
2. Copy your working root `.env.local` from the previous Zentro folder. If you do not have it, copy `.env.example` to `.env.local` and set `VITE_ZENTRO_FIREBASE_WEB_API_KEY` to Zentro's `firebaseWebApiKey` from `x42-registration-P658.json`. Keep the project ID `zentro-bank-dd41d`.
3. Open Firestore for this project. If its rules are still the original deny-all rules, publish the included `firestore.rules`. If you have other custom rules, merge the Zentro matches and helper functions with them first. Keep `accounts`, `ledger_entries` and `transfer_limits` out of browser write permissions.
4. Optional admin setup in Firebase Console. Copy the existing admin user's full Authentication UID. In Firestore Data, create collection `zentroServices` and document `config` if missing. Under `config`, create subcollection `admins`, and create a document whose ID is exactly the admin UID. Add a string field such as `role` with value `admin`. The document's existence grants this role. The browser cannot create these documents.
5. In PowerShell, run:

```powershell
npm.cmd ci
npm.cmd run dev
```

Open the URL Vite prints.

## What you can do

- **Main sign-in** opens the existing SharedBank dashboard and transfers. Use the same credentials for Zentro's Firestore features in that session.
- **Register as a customer** collects name, phone, sample address, email, password, requested deposit and a fictional KYC reference such as `DEMO-ID-001`. It creates a Firebase login and submits a pending application. Returning applicants use **Application sign-in**. If login creation succeeds but the application save fails, the form opens with the application details for retry.
- **Customer** screens include KYC, account requests, profile, beneficiaries, existing-account portfolio labels, closure requests, loan applications and Zentro directory records. Customers only read their own records, except for the loan product catalog. Earlier loan records from the collection-only build are shown as history.
- **Admin portal** is on the same login page. Admins can filter and review KYC, account, closure and loan requests, read customer profiles, and manage loan products, Zentro directory entries and transfer-limit proposals.
- New workflow records are stored under `zentroServices/portal`, including the `closure`, `directoryNotes` and `limitNotes` subcollections. These collections appear when their first records are saved. Existing portfolio labels stay on the previous paths under `zentroServices`.

Approvals only change request status. The requested deposit is an application field only. X42 account provisioning and closure, shared directory routing, enforcing transfer limits and retrying transfers remain with SharedBank. Email delivery and loan payouts are outside this UI-only build. The loan payment estimate is illustrative. Do not upload real KYC documents.

The archive includes the existing GitHub Pages workflow. Nothing has been deployed. For a later published build, supply the Firebase web configuration as build-time environment variables if you want the extra screens on GitHub Pages.
