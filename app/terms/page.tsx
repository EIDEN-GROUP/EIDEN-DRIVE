import type { Metadata } from "next";
import LegalShell from "@/components/site/LegalShell";

export const metadata: Metadata = {
  title: "Terms of Service — EIDEN-DRIVE",
  description: "The terms for using EIDEN-DRIVE: accounts, acceptable use, storage, availability, and liability.",
};

export default function TermsPage() {
  return (
    <LegalShell
      title="Terms of Service"
      updated="October 2026"
      intro="These terms cover use of EIDEN-DRIVE, the company file workspace operated by EIDEN GROUP. By using the service through your organization, you agree to these terms."
    >
      <h2>1. The service</h2>
      <p>EIDEN-DRIVE provides a shared workspace over connected Google Drives, with department-scoped access, audit logging, sharing controls, and optional features such as vault storage, backups, and team integrations. Features may change as the service improves.</p>

      <h2>2. Accounts and access</h2>
      <ul>
        <li>Accounts are provisioned by your organization’s administrators. You must use your own account and keep sign-in details confidential.</li>
        <li>Administrators may grant, limit, suspend, or remove access to files, folders, and features at any time.</li>
        <li>You may only access files and workspaces your account is authorized to see. Attempting to bypass permissions is prohibited.</li>
      </ul>

      <h2>3. Acceptable use</h2>
      <ul>
        <li>Use the service for lawful company work and content you have the right to store and share.</li>
        <li>Do not upload malware, attempt to disrupt the service, probe other tenants’ data, or misuse sharing, automation, or integrations.</li>
        <li>You are responsible for the files you upload and share, including having the necessary rights and consents.</li>
      </ul>

      <h2>4. Storage, quotas, and availability</h2>
      <p>Uploads are subject to drive capacity, configured quotas, and file-size limits. The service targets reliable day-to-day operation but does not guarantee uninterrupted availability; maintenance, upstream Google Drive issues, or connectivity problems can cause temporary disruption.</p>

      <h2>5. Backups and recovery</h2>
      <p>Where configured, the service supports backups and recovery workflows. Unless your organization has agreed otherwise in writing, backups are provided on a best-effort basis alongside Google Drive’s own retention and recovery behavior. Keep independent copies of business-critical data where required by your policies.</p>

      <h2>6. Termination</h2>
      <p>Your organization may terminate or suspend accounts according to its own policies. We may suspend accounts that threaten security, violate these terms, or breach applicable law. On termination, access ends; residual copies may persist in recovery or backup locations for a limited period as described in the Privacy Policy.</p>

      <h2>7. Liability</h2>
      <p>To the maximum extent permitted by law, the service is provided “as is”, and EIDEN GROUP is not liable for indirect or consequential losses, including loss of data or business interruption. Our total liability for paid services, if any, is limited to the amounts paid for the service in the twelve months before the claim. Nothing in these terms limits liability that cannot be limited by law.</p>

      <h2>8. Changes</h2>
      <p>We may update these terms and will revise the “Last updated” date. Continued use after changes take effect constitutes acceptance. Contact: <a href="mailto:dev@eiden-group.com">dev@eiden-group.com</a>.</p>
    </LegalShell>
  );
}
