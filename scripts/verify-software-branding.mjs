import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative } from "node:path";

const root = process.cwd();
const scanRoots = ["src", "scripts", "docs", "prisma"];
const standaloneFiles = ["README.md", "package.json"];
const searchableExtensions = new Set([".ts", ".tsx", ".js", ".mjs", ".json", ".md", ".txt"]);
const softwarePattern = new RegExp(`car(?:[\\s_-]*doc|doc)`, "i");
const filenamePattern = new RegExp(`car(?:[-_]?doc|doc)`, "i");
const allowedTenantData = new Map();

async function filesUnder(directory) {
  const entries = await readdir(join(root, directory), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (directory === "prisma" && entry.name === "migrations") continue;
      files.push(...await filesUnder(path));
    } else if (searchableExtensions.has(extname(entry.name))) {
      files.push(path);
    }
  }
  return files;
}

const files = [...standaloneFiles];
for (const directory of scanRoots) files.push(...await filesUnder(directory));

const violations = [];
let allowedExceptions = 0;
for (const path of files) {
  const normalizedPath = relative(root, join(root, path));
  if (filenamePattern.test(normalizedPath)) violations.push(`${normalizedPath}: branded filename`);
  const lines = (await readFile(join(root, path), "utf8")).split(/\r?\n/);
  lines.forEach((line, index) => {
    if (!softwarePattern.test(line)) return;
    const exception = allowedTenantData.get(normalizedPath);
    if (exception?.test(line)) {
      allowedExceptions += 1;
      return;
    }
    violations.push(`${normalizedPath}:${index + 1}`);
  });
}

console.log(`branding files scanned: ${files.length}`);
console.log(`allowed tenant-data exceptions: ${allowedExceptions}`);
console.log(`forbidden software-brand references: ${violations.length}`);
if (violations.length) {
  for (const violation of violations) console.log(`violation: ${violation}`);
  process.exitCode = 1;
}
