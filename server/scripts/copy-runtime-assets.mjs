import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(scriptDir, "..");

async function copyRuntimeDir(sourceRelative, destRelative) {
  const sourceDir = path.join(serverDir, sourceRelative);
  const destDir = path.join(serverDir, destRelative);
  await mkdir(destDir, { recursive: true });
  await cp(sourceDir, destDir, { recursive: true, force: true });
}

await copyRuntimeDir("src/onboarding-assets", "dist/onboarding-assets");
await copyRuntimeDir("src/built-ins", "dist/built-ins");
