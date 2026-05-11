import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { PetRegistry, readImageDimensions } from '../src/main/petRegistry';

const transparentPng1536x1872 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAABgAAAAdQAQAAAACrIDJkAAAAAnRSTlMAAHaTzTgAAABJSURBVHja7cEBAQAAAIIg/69uSEABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADgbwEM0AABc+UyAAAAAABJRU5ErkJggg==',
  'base64'
);

const transparentPng1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAghgXxwAAAABJRU5ErkJggg==',
  'base64'
);

describe('PetRegistry', () => {
  let dir: string;
  let codexPets: string;
  let appPets: string;
  let packageRoot: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'tolist-pets-'));
    codexPets = join(dir, 'codex-pets');
    appPets = join(dir, 'app-pets');
    packageRoot = join(dir, 'pet-packages');
    await mkdir(codexPets, { recursive: true });
    await mkdir(appPets, { recursive: true });
    await mkdir(packageRoot, { recursive: true });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writePet(root: string, id: string, image = transparentPng1536x1872): Promise<void> {
    const petDir = join(root, id);
    await mkdir(petDir, { recursive: true });
    await writeFile(
      join(petDir, 'pet.json'),
      JSON.stringify({
        id,
        displayName: id,
        description: `${id} pet`,
        spritesheetPath: 'spritesheet.webp',
        kind: 'test'
      }),
      'utf8'
    );
    await writeFile(join(petDir, 'spritesheet.webp'), image);
  }

  test('reads PNG dimensions used for spritesheet validation', () => {
    expect(readImageDimensions(transparentPng1536x1872)).toEqual({ width: 1536, height: 1872 });
  });

  test('loads valid pets from Codex and app directories', async () => {
    await writePet(codexPets, 'codex-one');
    await writePet(appPets, 'app-one');
    const registry = new PetRegistry({ codexPets, appPets, packageRoot });

    const pets = await registry.list();

    expect(pets.map((pet) => pet.id)).toEqual(['app-one', 'codex-one']);
    expect(pets[0]).toMatchObject({ displayName: 'app-one', source: 'app' });
  });

  test('rejects pets with invalid atlas dimensions', async () => {
    await writePet(appPets, 'bad-size', transparentPng1x1);
    const registry = new PetRegistry({ codexPets, appPets, packageRoot });

    await expect(registry.list()).resolves.toEqual([]);
  });

  test('loads npm-installed packages from node_modules root or pets folder', async () => {
    const directPackage = join(packageRoot, 'node_modules', 'direct-pet');
    await writePet(join(directPackage, '..'), 'direct-pet');
    const nestedPackagePet = join(packageRoot, 'node_modules', '@scope', 'bundle', 'pets');
    await writePet(nestedPackagePet, 'nested-pet');
    const registry = new PetRegistry({ codexPets, appPets, packageRoot });

    const pets = await registry.list();

    expect(pets.map((pet) => pet.id)).toEqual(['direct-pet', 'nested-pet']);
    expect(pets.every((pet) => pet.source === 'npm')).toBe(true);
  });

  test('imports a local zip pet into the app pets directory', async () => {
    const zip = new JSZip();
    zip.file(
      'pet.json',
      JSON.stringify({
        id: 'zip-pet',
        displayName: 'Zip Pet',
        description: 'Imported pet',
        spritesheetPath: 'spritesheet.webp',
        kind: 'zip'
      })
    );
    zip.file('spritesheet.webp', transparentPng1536x1872);
    const zipPath = join(dir, 'zip-pet.zip');
    await writeFile(zipPath, await zip.generateAsync({ type: 'nodebuffer' }));
    const registry = new PetRegistry({ codexPets, appPets, packageRoot });

    const pet = await registry.importZip(zipPath);

    expect(pet).toMatchObject({ id: 'zip-pet', displayName: 'Zip Pet', source: 'app' });
    await expect(registry.list()).resolves.toHaveLength(1);
  });
});
