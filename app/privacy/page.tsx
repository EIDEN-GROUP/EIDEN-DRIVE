import type { Metadata } from "next";
import LegalShell from "@/components/site/LegalShell";

export const metadata: Metadata = {
  title: "Privacy Policy — EIDEN-DRIVE",
  description: "How EIDEN-DRIVE handles account data, files, Google Drive access, security, retention, and deletion requests.",
};

export default function PrivacyPage() {
  return (
    <LegalShell
      title="Privacy Policy"
      updated="October 2026"
      intro="EIDEN-DRIVE is a company file workspace built on Google Drive. This policy explains what data the service handles, why it needs Google Drive access, and how to ask questions or request deletion."
    >
      <h2>1. Who operates this service</h2>
      <p>EIDEN-DRIVE is operated by EIDEN GROUP (“we”, “us”). Contact: <a href="mailto:dev@eiden-group.com">dev@eiden-group.com</a>.</p>

      <h2>2. Data we handle</h2>
      <ul>
        <li><strong>Account data:</strong> name, work email, role, department, and sign-in records needed to run a company workspace.</li>
        <li><strong>Files and file metadata:</strong> names, folders, sizes, versions, tags, shares, and audit events for files your account is allowed to see.</li>
        <li><strong>Access requests:</strong> name, email, and message when you ask for an account, used only to review the request.</li>
        <li><strong>Operational logs:</strong> security and audit events such as sign-ins, uploads, shares, and administrative changes.</li>
      </ul>

      <h2>3. Google Drive access</h2>
      <p>When an administrator connects Google Drive, EIDEN-DRIVE uses Google OAuth to list, read, create, update, and organize files and folders in the connected drives, so the workspace can show, search, upload, move, share, sync, and back up company files.</p>
      <ul>
        <li>Access is limited to operating the workspace for your organization; connected accounts are chosen and scoped by your administrator.</li>
        <li>File contents are used to provide the requested file operations, previews where supported, search, and audit. They are not sold, not used for advertising, and not used to train general-purpose AI models.</li>
        <li>Authentication tokens are stored server-side and are never exposed in the browser interface.</li>
      </ul>

      <h2>4. How data is stored and protected</h2>
      <ul>
        <li>Application data is stored in our managed database and file storage; files themselves remain in the connected Google Drives unless your administrator configures additional managed storage or backups.</li>
        <li>Access is restricted by user accounts, roles, departments, and folder permissions. Administrative actions are logged.</li>
        <li>No system is perfectly secure. If you suspect unauthorized access, contact <a href="mailto:dev@eiden-group.com">dev@eiden-group.com</a> promptly.</li>
      </ul>

      <h2>5. Sharing</h2>
      <p>We do not sell personal data. Data is shared only as needed to operate the service: with Google to perform the Drive operations you request, with our infrastructure providers to host the service, and with your organization’s administrators to manage accounts and security. Public share links are created only when a user explicitly creates them.</p>

      <h2>6. Retention and deletion</h2>
      <p>Workspace data is retained while your organization uses the service and as required for audit, security, and legal obligations. Deleted files may remain in recovery or backup locations for a limited period. To request access, correction, or deletion of your personal data, email <a href="mailto:dev@eiden-group.com">dev@eiden-group.com</a>; account and organization-level requests may need to come through your administrator.</p>

      <h2>7. Changes to this policy</h2>
      <p>We will update this page when our practices change and revise the “Last updated” date. Material changes will be communicated through the service or by email where appropriate.</p>
    </LegalShell>
  );
}
