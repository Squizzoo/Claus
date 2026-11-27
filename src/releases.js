'use strict';
// The versions of Claus that can be installed, from the releases of the GitHub repository. Pure: JSON in, a list out.
// A version is installable when its release has the installer and latest.yml (the file electron-updater reads).
// Used by the "Choose a version" list in Settings > System, so a user can always go back to an older version.

const SEMVER = /^v?(\d{1,4})\.(\d{1,4})\.(\d{1,4})$/;
const SAFE_NAME = /^[A-Za-z0-9._-]{1,100}$/;
const MAX_LIST = 30;
const safeName = (name) => SAFE_NAME.test(String(name)) && !/^\.+$/.test(String(name)); // not '.' or '..'

/** '1.2.3' or 'v1.2.3' -> { major, minor, patch }, anything else (including pre-releases) -> null. */
function parseVersion(text) {
  const m = SEMVER.exec(String(text || '').trim());
  return m ? { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) } : null;
}

/** -1, 0 or 1; a version that does not parse sorts last. */
function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return x ? -1 : y ? 1 : 0;
  for (const k of ['major', 'minor', 'patch']) if (x[k] !== y[k]) return x[k] < y[k] ? -1 : 1;
  return 0;
}

/** The folder of one release on GitHub that holds its latest.yml and installer; null for an unsafe owner, repo or version. */
function feedUrl(owner, repo, version) {
  if (!safeName(owner) || !safeName(repo) || !parseVersion(version)) return null;
  const v = parseVersion(version);
  return `https://github.com/${owner}/${repo}/releases/download/v${v.major}.${v.minor}.${v.patch}`;
}

/**
 * The GitHub owner and repo the releases live in, from package.json: the build's publish settings in a source checkout, else `homepage`.
 * The installed app has no `build` section (electron-builder leaves it out of the packaged package.json), but it keeps `homepage`.
 */
function repoFromPackage(pkg) {
  const p = pkg && typeof pkg === 'object' ? pkg : {};
  const pub = p.build && Array.isArray(p.build.publish) ? p.build.publish[0] : null;
  if (pub && pub.provider === 'github' && safeName(pub.owner) && safeName(pub.repo)) return { owner: pub.owner, repo: pub.repo };
  const m = /^https:\/\/github\.com\/([A-Za-z0-9._-]{1,100})\/([A-Za-z0-9._-]{1,100})\/?$/.exec(String(p.homepage || ''));
  return m && safeName(m[1]) && safeName(m[2]) ? { owner: m[1], repo: m[2] } : null;
}

/**
 * The GitHub API's list of releases -> [{ version, date, relation }] newest first, `relation` being 'same', 'newer' or 'older'
 * than `current`. Drafts, pre-releases and releases without installer and latest.yml are left out.
 */
function parseReleases(json, current) {
  if (!Array.isArray(json)) return [];
  const out = [];
  for (const r of json) {
    if (!r || typeof r !== 'object' || r.draft || r.prerelease) continue;
    const v = parseVersion(r.tag_name);
    if (!v) continue;
    const version = `${v.major}.${v.minor}.${v.patch}`;
    const names = new Set((Array.isArray(r.assets) ? r.assets : []).map((a) => (a && typeof a.name === 'string' ? a.name : '')));
    if (!names.has('latest.yml') || !names.has(`Claus-Setup-${version}.exe`)) continue;
    if (out.some((o) => o.version === version)) continue;
    const date = typeof r.published_at === 'string' && /^\d{4}-\d{2}-\d{2}/.test(r.published_at) ? r.published_at.slice(0, 10) : '';
    const c = compareVersions(version, current);
    out.push({ version, date, relation: c === 0 ? 'same' : c > 0 ? 'newer' : 'older' });
  }
  out.sort((a, b) => compareVersions(b.version, a.version));
  return out.slice(0, MAX_LIST);
}

module.exports = { parseVersion, compareVersions, feedUrl, parseReleases, repoFromPackage, MAX_LIST };
