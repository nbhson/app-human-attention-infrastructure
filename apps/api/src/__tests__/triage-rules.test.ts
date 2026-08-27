import { describe, expect, it } from 'vitest';

import { computeTriage, isMigrationPath, isSecurityPath } from '../triage-rules.js';

const ALL_ON = { securityBlock: true, performanceRegression: true, schemaIntegrity: true };
const ALL_OFF = { securityBlock: false, performanceRegression: false, schemaIntegrity: false };

describe('isSecurityPath', () => {
  it('flags auth/secrets/credential locations', () => {
    expect(isSecurityPath('src/auth/login.ts')).toBe(true);
    expect(isSecurityPath('app/session/token.ts')).toBe(true);
    expect(isSecurityPath('infra/secrets/prod.env')).toBe(true);
    expect(isSecurityPath('.env')).toBe(true);
    expect(isSecurityPath('config/id_rsa')).toBe(true);
    expect(isSecurityPath('certs/tls.crt')).toBe(true);
  });

  it('does not flag ordinary code', () => {
    expect(isSecurityPath('src/limit.ts')).toBe(false);
    expect(isSecurityPath('README.md')).toBe(false);
    expect(isSecurityPath('')).toBe(false);
  });
});

describe('isMigrationPath', () => {
  it('flags migrations, schema files, and SQL', () => {
    expect(isMigrationPath('prisma/migrations/0001_init/migration.sql')).toBe(true);
    expect(isMigrationPath('db/migrate/20260820_add_users.sql')).toBe(true);
    expect(isMigrationPath('prisma/schema.prisma')).toBe(true);
    expect(isMigrationPath('schema.rb')).toBe(true);
    expect(isMigrationPath('alembic/versions/x.py')).toBe(true);
    expect(isMigrationPath('data/seed.sql')).toBe(true);
  });

  it('does not flag ordinary code/config', () => {
    expect(isMigrationPath('src/app.ts')).toBe(false);
    expect(isMigrationPath('docker-compose.yml')).toBe(false);
    expect(isMigrationPath('')).toBe(false);
  });
});

describe('computeTriage', () => {
  it('downgrades the effective verdict on a CRITICAL security finding', () => {
    const result = computeTriage({
      rules: ALL_ON,
      findings: [{ severity: 'CRITICAL', file: 'src/auth/handler.ts' }],
    });
    expect(result.securityBlocked).toBe(true);
    expect(result.effectiveVerdict).toBe('REQUEST_CHANGES');
    expect(result.matchedRules).toContain('security-block');
  });

  it('does not fire security-block without a CRITICAL finding', () => {
    const result = computeTriage({
      rules: ALL_ON,
      findings: [{ severity: 'MAJOR', file: 'src/auth/handler.ts' }],
    });
    expect(result.securityBlocked).toBe(false);
    expect(result.effectiveVerdict).toBeNull();
  });

  it('gates schema on a touched migration path', () => {
    const result = computeTriage({
      rules: ALL_ON,
      findings: [],
      prFilePaths: ['prisma/schema.prisma', 'src/app.ts'],
    });
    expect(result.schemaGate).toBe(true);
    expect(result.matchedRules).toContain('schema-integrity');
  });

  it('derives regression risk only from a MAJOR+ source finding + a low judge run', () => {
    const result = computeTriage({
      rules: ALL_ON,
      findings: [{ severity: 'MAJOR', file: 'src/service/hot.ts' }],
      judgeRuns: [{ overall: 0.4 }],
    });
    expect(result.regressionRisk).toBe(true);
    expect(result.matchedRules).toContain('performance-regression');
  });

  it('does not claim regression without a judge run', () => {
    const result = computeTriage({
      rules: ALL_ON,
      findings: [{ severity: 'MAJOR', file: 'src/service/hot.ts' }],
    });
    expect(result.regressionRisk).toBe(false);
  });

  it('does not claim regression for test/style files or a healthy judge score', () => {
    const testFile = computeTriage({
      rules: ALL_ON,
      findings: [{ severity: 'MAJOR', file: 'src/service/hot.test.ts' }],
      judgeRuns: [{ overall: 0.2 }],
    });
    expect(testFile.regressionRisk).toBe(false);

    const healthyJudge = computeTriage({
      rules: ALL_ON,
      findings: [{ severity: 'MAJOR', file: 'src/service/hot.ts' }],
      judgeRuns: [{ overall: 0.9 }],
    });
    expect(healthyJudge.regressionRisk).toBe(false);
  });

  it('respects the OFF toggles', () => {
    const result = computeTriage({
      rules: ALL_OFF,
      findings: [{ severity: 'CRITICAL', file: 'src/auth/handler.ts' }],
      prFilePaths: ['prisma/schema.prisma'],
      judgeRuns: [{ overall: 0.1 }],
    });
    expect(result).toEqual({
      securityBlocked: false,
      regressionRisk: false,
      schemaGate: false,
      matchedRules: [],
      effectiveVerdict: null,
    });
  });

  it('is safe against empty/undefined inputs', () => {
    expect(computeTriage({ rules: ALL_ON })).toEqual({
      securityBlocked: false,
      regressionRisk: false,
      schemaGate: false,
      matchedRules: [],
      effectiveVerdict: null,
    });
  });
});
