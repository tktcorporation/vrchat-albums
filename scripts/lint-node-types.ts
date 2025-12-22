#!/usr/bin/env node

import { createRequire } from 'node:module';
import consola from 'consola';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as {
  engines?: { node?: string };
  devDependencies?: Record<string, string>;
};

function extractMajorVersion(version: string): string | null {
  // Handle patterns like "20", "^20.0.0", "~20.17.2", ">=20", "20.x"
  const match = version.match(/(\d+)/);
  return match ? match[1] : null;
}

function main(): void {
  consola.start('Checking @types/node version matches engines.node...');

  const enginesNode = pkg.engines?.node;
  const typesNode = pkg.devDependencies?.['@types/node'];

  if (!enginesNode) {
    consola.error('engines.node is not defined in package.json');
    process.exit(1);
  }

  if (!typesNode) {
    consola.error('@types/node is not defined in devDependencies');
    process.exit(1);
  }

  const enginesMajor = extractMajorVersion(enginesNode);
  const typesMajor = extractMajorVersion(typesNode);

  if (!enginesMajor) {
    consola.error(`Cannot parse engines.node version: ${enginesNode}`);
    process.exit(1);
  }

  if (!typesMajor) {
    consola.error(`Cannot parse @types/node version: ${typesNode}`);
    process.exit(1);
  }

  if (enginesMajor !== typesMajor) {
    consola.error(
      `Version mismatch: @types/node@${typesNode} (major: ${typesMajor}) does not match engines.node: "${enginesNode}" (major: ${enginesMajor})`,
    );
    consola.info(`Fix: yarn add -D @types/node@~${enginesMajor}.0.0`);
    process.exit(1);
  }

  consola.success(
    `@types/node@${typesNode} matches engines.node: "${enginesNode}"`,
  );
}

main();
