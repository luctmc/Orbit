#!/usr/bin/env node
// Read-only scan of the tracked working tree. Never prints matched values.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const files = execFileSync("git", ["ls-files", "-z"], { cwd: root, maxBuffer: 16 * 1024 * 1024 }).toString("utf8").split("\0").filter(Boolean);
const allowedDomains = new Set(["example.com", "example.org", "example.net", "example.invalid", "users.noreply.github.com"]);
const placeholder = /^(user|username|yourname|example|test|tester|demo|sample|name)$/i;
const hits = [], binary = [], oversized = [];
const rules = [
  ["email", /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi],
  ["mac-home", /\/Users\/[A-Za-z0-9._-]+/g],
  ["linux-home", /\/home\/[A-Za-z0-9._-]+/g],
  ["windows-home", /\b[A-Z]:\\Users\\[A-Za-z0-9._-]+/gi],
  ["github-token", /\b(?:ghp_|gho_|ghu_|ghs_|ghr_|github_pat_)[A-Za-z0-9_-]{18,}/g],
  ["anthropic-token", /\bsk-ant-[A-Za-z0-9_-]{16,}/g],
  ["openai-token", /\bsk-(?:proj-|live-)?[A-Za-z0-9_-]{28,}/g],
  ["aws-access-key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ["google-api-key", /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ["private-key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
];
for (const file of files) {
  if (file === "scripts/check-publication-safety.mjs") continue;
  if (/(^|\/)(\.env(?!\.example$)[^/]*|auth\.json|credentials\.json|id_rsa|id_ed25519|[^/]*\.pem|[^/]*\.p12|[^/]*\.p8|[^/]*\.mobileprovision)$/i.test(file)) hits.push({ file, type: "sensitive-filename", line: 0 });
  const buf = readFileSync(join(root, file));
  if (buf.includes(0) || /\.(?:png|jpe?g|webp|gif|ico|icns|gz|zip|pdf|woff2?)$/i.test(file)) {
    if (/^docs\/(?:analysis|plans)\//.test(file)) binary.push(file);
    continue;
  }
  if (buf.length > 2000000) { oversized.push(file); continue; }
  const content = buf.toString("utf8");
  for (const [type, re] of rules) {
    re.lastIndex = 0;
    for (const m of content.matchAll(re)) {
      if (type === "email") {
        const domain = m[0].split("@").at(-1).toLowerCase();
        if (allowedDomains.has(domain) || (domain === "github.com" && /noreply/i.test(m[0]))) continue;
      }
      if (type.endsWith("-home")) {
        const name = m[0].replaceAll("\\", "/").split("/").at(-1);
        if (placeholder.test(name)) continue;
      }
      hits.push({ file, type, line: content.slice(0, m.index).split("\n").length });
    }
  }
}
const unique = [...new Map(hits.map(x => [[x.file, x.type, x.line].join(":"), x])).values()];
console.log("Scanned tracked files: " + files.length);
console.log("Potential personal data / secrets: " + unique.length);
console.log("Binary evidence requiring manual review: " + binary.length);
console.log("Oversized files requiring manual review: " + oversized.length);
for (const item of unique.slice(0, 150)) console.log(item.type + ": " + item.file + (item.line ? ":" + item.line : ""));
if (unique.length > 150) console.log("Additional findings omitted: " + (unique.length - 150));
if (binary.length) console.log("Manual review of screenshots and archives is still required.");
if (oversized.length) console.log("Some oversized files were not scanned.");
if (unique.length || oversized.length) process.exitCode = 1;
