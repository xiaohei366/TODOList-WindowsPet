import { execSync } from 'node:child_process';

const NAMES = ['TOList Desktop Pet.exe', 'TOList-Desktop-Pet-0.2.2.exe'];

for (const name of NAMES) {
  try {
    execSync(`taskkill /F /IM "${name}"`, { stdio: 'pipe' });
  } catch {
    // process not running, ignore
  }
}
