import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { https } from 'follow-redirects';
import * as tar from 'tar';
import tmp from 'tmp';
import unzipper from 'unzipper';

import packageJson from './package.json';

const destBasePath = path.resolve(__dirname, 'assets/bin/');

type Platforms = 'linux' | 'win' | 'mac';

const validPlatforms: Platforms[] = ['linux', 'win', 'mac'];

function isPlatform(value?: string): value is Platforms {
  return validPlatforms.includes(value as Platforms);
}

function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const fileStream = fs.createWriteStream(dest);
    https
      .get(url, (response) => {
        if (response.statusCode !== 200) {
          return reject(new Error(`Failed to download file: ${response.statusMessage}`));
        }
        response.pipe(fileStream);
        fileStream.on('finish', resolve);
        fileStream.on('error', reject);
      })
      .on('error', reject);
  });
}

function verifyChecksum(filePath: string, expectedHash: string): Promise<boolean> {
  const hash = crypto.createHash('sha256');
  const fileStream = fs.createReadStream(filePath);

  return new Promise((resolve, reject) => {
    fileStream.on('data', (chunk) => {
      hash.update(chunk);
    });

    fileStream.on('end', () => {
      const computedHash = hash.digest('hex');
      console.debug(`Computed SHA-256: ${computedHash}`);
      resolve(computedHash === expectedHash);
    });

    fileStream.on('error', reject);
  });
}

async function extractTarGz(filePath: string, destPath: string): Promise<[string, string]> {
  await tar.extract({
    file: filePath,
    cwd: destPath,
    strip: 1,
  });
  const extractedFiles = fs.readdirSync(destPath);
  for (const file of extractedFiles) {
    if (file === 'uv' || file === 'uv.exe') {
      return [file, path.join(destPath, file)];
    }
  }

  throw new Error('Required file (uv or uv.exe) not found in the archive');
}

async function extractZip(filePath: string, destPath: string): Promise<[string, string]> {
  const extractedFilePath = await new Promise<[string, string]>((resolve, reject) => {
    fs.createReadStream(filePath)
      .pipe(unzipper.Extract({ path: destPath }))
      .on('close', () => {
        const extractedFiles = fs.readdirSync(destPath);
        for (const file of extractedFiles) {
          if (file === 'uv' || file === 'uv.exe') {
            resolve([file, path.join(destPath, file)]);
            return;
          }
        }
        reject(new Error('Required file (uv or uv.exe) not found in the zip archive'));
      })
      .on('error', reject);
  });
  return extractedFilePath;
}

async function download(platform: Platforms): Promise<void> {
  const config = packageJson.uv[platform];

  const destPath = path.join(destBasePath, platform);
  fs.mkdirSync(destPath);

  const tmpPath = tmp.dirSync({ unsafeCleanup: true });

  const fileName = path.basename(config.url);
  const downloadFilePath = path.join(tmpPath.name, fileName);

  console.log(`Downloading file: ${config.url}`);
  await downloadFile(config.url, downloadFilePath);

  console.log('Verifying checksum...');
  const isValid = await verifyChecksum(downloadFilePath, config.sha256);
  if (!isValid) {
    throw new Error('SHA256 checksum verification failed');
  }

  let extractedFileName: string;
  let extractedFilePath: string;
  if (fileName.endsWith('.tar.gz')) {
    console.log('Extracting .tar.gz archive...');
    [extractedFileName, extractedFilePath] = await extractTarGz(downloadFilePath, tmpPath.name);
  } else if (fileName.endsWith('.zip')) {
    console.log('Extracting .zip archive...');
    [extractedFileName, extractedFilePath] = await extractZip(downloadFilePath, tmpPath.name);
  } else {
    throw new Error('Unsupported archive file format');
  }

  const destFilePath = path.join(destPath, extractedFileName);
  console.log(`Copying extracted file to destination: ${destFilePath}`);
  fs.copyFileSync(extractedFilePath, destFilePath);
}

async function main(): Promise<void> {
  if (!fs.existsSync(destBasePath)) {
    fs.mkdirSync(destBasePath);
  }

  const platform = process.argv[2];
  if (!isPlatform(platform)) {
    throw Error('Invalid platform argument');
  }

  await download(platform);
}

main();
