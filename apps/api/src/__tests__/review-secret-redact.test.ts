import { describe, expect, it } from 'vitest';

import { isSensitiveFile, redactSensitivePatch } from '../review-secret-redact.js';

describe('isSensitiveFile', () => {
  it('flags env and Compose files', () => {
    expect(isSensitiveFile('.env')).toBe(true);
    expect(isSensitiveFile('.env.production')).toBe(true);
    expect(isSensitiveFile('apps/api/.env.local')).toBe(true);
    expect(isSensitiveFile('docker-compose.yml')).toBe(true);
    expect(isSensitiveFile('compose.yaml')).toBe(true);
    expect(isSensitiveFile('src/docker-compose.override.yml')).toBe(true);
  });

  it('leaves ordinary source and config alone', () => {
    expect(isSensitiveFile('src/app.ts')).toBe(false);
    expect(isSensitiveFile('README.md')).toBe(false);
    expect(isSensitiveFile('package.json')).toBe(false);
    expect(isSensitiveFile('Dockerfile')).toBe(false);
    expect(isSensitiveFile('nginx.conf')).toBe(false);
  });
});

describe('redactSensitivePatch', () => {
  it('masks secret values on added env lines, keeping the key name', () => {
    const patch = [
      '@@ -0,0 +1,4 @@',
      '+API_KEY=sk-live-abc123',
      '+DATABASE_URL=postgres://u:p@localhost/db',
      '+PORT=3000',
    ].join('\n');

    expect(redactSensitivePatch('.env', patch)).toBe(
      [
        '@@ -0,0 +1,4 @@',
        '+API_KEY=<redacted>',
        '+DATABASE_URL=postgres://u:<redacted>@localhost/db',
        '+PORT=3000',
      ].join('\n'),
    );
  });

  it('masks YAML map and list secret values in a Compose file', () => {
    const patch = [
      '@@ environment @@',
      '+      POSTGRES_PASSWORD: hunter2',
      '+      - JWT_SECRET=topsecret',
      '+      - APP_PORT=8080',
    ].join('\n');

    expect(redactSensitivePatch('docker-compose.yml', patch)).toBe(
      [
        '@@ environment @@',
        '+      POSTGRES_PASSWORD: <redacted>',
        '+      - JWT_SECRET=<redacted>',
        '+      - APP_PORT=8080',
      ].join('\n'),
    );
  });

  it('masks secrets on removal and context lines, and leaves non-sensitive files alone', () => {
    const patch = [
      '+++ b/.env',
      '-API_KEY=old-secret', // removed secret is still a live credential → masked
      ' APP_MODE=prod', // context, not secret → untouched
      ' OLD_TOKEN=still-live', // context secret → masked
    ].join('\n');

    expect(redactSensitivePatch('.env', patch)).toBe(
      ['+++ b/.env', '-API_KEY=<redacted>', ' APP_MODE=prod', ' OLD_TOKEN=<redacted>'].join('\n'),
    );

    expect(redactSensitivePatch('src/app.ts', '+const apiKey = "live";\n')).toBe(
      '+const apiKey = "live";\n',
    );
  });
});
