# Releasing Claus

Releases are built and signed by GitHub Actions, never on a developer's computer, and every release needs a manual approval.
This file is the part that cannot live in code: settings in GitHub and SignPath, and the steps of a release.

## One-time setup

### 1. Two-factor authentication (required for everyone on the team)

- GitHub: Settings > Password and authentication > Two-factor authentication, for every account in the code signing policy
  (if the repository moves to an organization: Organization > Settings > Authentication security > *Require two-factor authentication*).
- SignPath: every user of the SignPath organization turns on two-factor authentication in their SignPath profile.
- Prefer a passkey or an authenticator app over SMS.

### 2. GitHub repository

- Settings > Environments > **New environment** `release`:
  - *Required reviewers*: add the approvers (at least one person; ideally not the person who pushed the tag).
  - *Deployment branches and tags*: only tags matching `v*.*.*`.
  - Prevent self-review if there is more than one team member.
- Settings > Rules (or Branches): protect `main` (pull request and passing `CI` before merge) and protect the tag pattern `v*` so only
  maintainers can create release tags.
- Settings > Actions > General: *Workflow permissions* = read-only (the workflow asks for more where it needs it).

### 3. SignPath (free for open source: SignPath Foundation)

1. Apply at <https://signpath.org/>. The page <https://squizzoo.github.io/Claus/code-signing-policy.html> is the code signing policy they ask for.
2. In SignPath create a project `Claus`, add the artifact configuration from `.signpath/artifact-configuration.xml` (slug `initial`),
   and a signing policy `release-signing` with **manual approval** and *origin verification* for this GitHub repository (trusted build system).
3. Install the SignPath GitHub App / connector as SignPath describes, and create an API token for the CI user.
4. In GitHub > Settings > Secrets and variables > Actions:
   - Secret `SIGNPATH_API_TOKEN`
   - Variable `SIGNPATH_ORGANIZATION_ID`
   - Optional variables `SIGNPATH_PROJECT_SLUG` (default `Claus`), `SIGNPATH_SIGNING_POLICY_SLUG` (default `release-signing`),
     `SIGNPATH_ARTIFACT_CONFIGURATION_SLUG` (default `initial`)

Until `SIGNPATH_ORGANIZATION_ID` exists the signing job is skipped and the release job only runs from a manual start with
*allow_unsigned* ticked (the release is then labelled "NOT code signed").

## Making a release

1. Change `version` in `package.json` (and the changelog/README if needed), merge to `main` through a pull request.
2. Tag it: `git tag v0.3.0 && git push origin v0.3.0` (the tag must equal the version, the workflow checks).
3. The `Release` workflow builds, runs the tests and uploads the unsigned files, then sends them to SignPath.
4. Approve the signing request in SignPath.
5. Approve the `release` environment in GitHub (the job *Publish (needs approval)* waits for it).
6. The workflow rebuilds `latest.yml` from the signed installer (`scripts/release-yml.js`; signing changes the file, so the hash from the
   unsigned build would no longer match), attests the build provenance and creates the GitHub release with the installer, the portable exe,
   `latest.yml` and `SHA256SUMS.txt`.

Verify a download: `gh attestation verify Claus-Setup-0.3.0.exe --repo Squizzoo/Claus`.

## Notes

- The `.blockmap` file is not published (it belongs to the unsigned build). Without it updates are a full download, which is always correct.
- The installer is signed. The program inside it (`Claus.exe`) is not signed separately.
- Older releases made before this workflow existed keep working: *Settings > System > Updates > Choose a version* only needs a release with
  `latest.yml` and the `Claus-Setup-x.y.z.exe` file.
- The actions in the workflows are pinned to a major version; Dependabot proposes updates (`.github/dependabot.yml`). Pin them to a commit
  SHA if you want the strictest setup.
