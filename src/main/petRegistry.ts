import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { constants, type Dirent } from 'node:fs';
import { access } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import JSZip from 'jszip';
import type { PetPackage, PetSource } from '../shared/types';

export type PetRegistryOptions = {
  codexPets: string;
  appPets: string;
  packageRoot: string;
};

type PetJson = {
  id?: string;
  displayName?: string;
  description?: string;
  spritesheetPath?: string;
  kind?: string;
};

type Candidate = {
  directory: string;
  source: PetSource;
};

export class PetRegistry {
  constructor(private readonly options: PetRegistryOptions) {}

  async list(): Promise<PetPackage[]> {
    const candidates = [
      ...(await scanPetRoot(this.options.appPets, 'app')),
      ...(await scanPetRoot(this.options.codexPets, 'codex')),
      ...(await scanNpmPets(this.options.packageRoot))
    ];
    const byId = new Map<string, PetPackage>();

    for (const candidate of candidates) {
      const pet = await this.readPet(candidate);
      if (pet && !byId.has(pet.id)) {
        byId.set(pet.id, pet);
      }
    }

    return Array.from(byId.values());
  }

  async importZip(zipPath: string): Promise<PetPackage> {
    const zip = await JSZip.loadAsync(await readFile(zipPath));
    const petEntry = findZipEntry(zip, 'pet.json');
    if (!petEntry) {
      throw new Error('Pet zip must include pet.json.');
    }

    const petJson = JSON.parse(await petEntry.async('string')) as PetJson;
    const id = normalizePetId(petJson.id);
    const spritePath = petJson.spritesheetPath ?? 'spritesheet.webp';
    const spriteEntry = zip.file(spritePath);
    if (!spriteEntry) {
      throw new Error(`Pet zip must include ${spritePath}.`);
    }

    const destination = resolve(this.options.appPets, id);
    const appPetsRoot = resolve(this.options.appPets);
    if (!isWithin(destination, appPetsRoot)) {
      throw new Error('Invalid pet destination.');
    }

    await rm(destination, { recursive: true, force: true });
    await mkdir(destination, { recursive: true });
    await writeFile(join(destination, 'pet.json'), JSON.stringify({ ...petJson, id }, null, 2), 'utf8');
    await writeFile(join(destination, spritePath), await spriteEntry.async('nodebuffer'));

    const pet = await this.readPet({ directory: destination, source: 'app' });
    if (!pet) {
      throw new Error('Imported pet is not a valid Codex pet package.');
    }
    return pet;
  }

  async findById(id: string): Promise<PetPackage | undefined> {
    return (await this.list()).find((pet) => pet.id === id);
  }

  private async readPet(candidate: Candidate): Promise<PetPackage | undefined> {
    try {
      const petJson = JSON.parse(await readFile(join(candidate.directory, 'pet.json'), 'utf8')) as PetJson;
      const id = normalizePetId(petJson.id);
      const spritesheetPath = resolve(candidate.directory, petJson.spritesheetPath ?? 'spritesheet.webp');
      const dimensions = readImageDimensions(await readFile(spritesheetPath));
      if (dimensions.width !== 1536 || dimensions.height !== 1872) {
        return undefined;
      }

      return {
        id,
        displayName: petJson.displayName?.trim() || id,
        description: petJson.description?.trim() || '',
        kind: petJson.kind,
        directory: candidate.directory,
        spritesheetPath,
        source: candidate.source
      };
    } catch {
      return undefined;
    }
  }
}

export function readImageDimensions(buffer: Buffer): { width: number; height: number } {
  if (isPng(buffer)) {
    return {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20)
    };
  }

  if (isWebp(buffer)) {
    return readWebpDimensions(buffer);
  }

  throw new Error('Unsupported image format.');
}

async function scanPetRoot(root: string, source: PetSource): Promise<Candidate[]> {
  const entries = await safeReaddir(root);
  const candidates: Candidate[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const directory = join(root, entry.name);
    if (await fileExists(join(directory, 'pet.json'))) {
      candidates.push({ directory, source });
    }
  }

  return candidates.sort((left, right) => left.directory.localeCompare(right.directory));
}

async function scanNpmPets(packageRoot: string): Promise<Candidate[]> {
  const candidates: Candidate[] = [];
  candidates.push(...(await scanPackageForPets(packageRoot)));
  const nodeModules = join(packageRoot, 'node_modules');
  const entries = (await safeReaddir(nodeModules)).filter((entry) => entry.isDirectory());
  const unscoped = entries.filter((entry) => !entry.name.startsWith('@')).sort((left, right) => left.name.localeCompare(right.name));
  const scoped = entries.filter((entry) => entry.name.startsWith('@')).sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of unscoped) {
    candidates.push(...(await scanPackageForPets(join(nodeModules, entry.name))));
  }

  for (const entry of scoped) {
    const scopedEntries = (await safeReaddir(join(nodeModules, entry.name)))
      .filter((scopedEntry) => scopedEntry.isDirectory())
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const scopedEntry of scopedEntries) {
      candidates.push(...(await scanPackageForPets(join(nodeModules, entry.name, scopedEntry.name))));
    }
  }

  return candidates;
}

async function scanPackageForPets(packageDir: string): Promise<Candidate[]> {
  const candidates: Candidate[] = [];
  if (await fileExists(join(packageDir, 'pet.json'))) {
    candidates.push({ directory: packageDir, source: 'npm' });
  }

  const petsDir = join(packageDir, 'pets');
  for (const entry of await safeReaddir(petsDir)) {
    if (entry.isDirectory() && (await fileExists(join(petsDir, entry.name, 'pet.json')))) {
      candidates.push({ directory: join(petsDir, entry.name), source: 'npm' });
    }
  }

  return candidates;
}

async function safeReaddir(path: string): Promise<Dirent[]> {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function normalizePetId(id: string | undefined): string {
  const normalized = id?.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!normalized) {
    throw new Error('Pet id is required.');
  }
  return normalized;
}

function findZipEntry(zip: JSZip, fileName: string): JSZip.JSZipObject | null {
  return zip.file(fileName) ?? zip.file(new RegExp(`(^|/)${escapeRegExp(fileName)}$`))[0] ?? null;
}

function isWithin(child: string, parent: string): boolean {
  const resolvedChild = resolve(child);
  const resolvedParent = resolve(parent);
  return resolvedChild === resolvedParent || resolvedChild.startsWith(`${resolvedParent}${sep}`);
}

function isPng(buffer: Buffer): boolean {
  return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
}

function isWebp(buffer: Buffer): boolean {
  return buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
}

function readWebpDimensions(buffer: Buffer): { width: number; height: number } {
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const chunk = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const data = offset + 8;

    if (chunk === 'VP8X' && data + 10 <= buffer.length) {
      return {
        width: readUInt24LE(buffer, data + 4) + 1,
        height: readUInt24LE(buffer, data + 7) + 1
      };
    }

    if (chunk === 'VP8L' && data + 5 <= buffer.length) {
      const bits = buffer.readUInt32LE(data + 1);
      return {
        width: (bits & 0x3fff) + 1,
        height: ((bits >> 14) & 0x3fff) + 1
      };
    }

    if (chunk === 'VP8 ' && data + 10 <= buffer.length) {
      return {
        width: buffer.readUInt16LE(data + 6) & 0x3fff,
        height: buffer.readUInt16LE(data + 8) & 0x3fff
      };
    }

    offset += 8 + size + (size % 2);
  }

  throw new Error('Could not read WebP dimensions.');
}

function readUInt24LE(buffer: Buffer, offset: number): number {
  return buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
