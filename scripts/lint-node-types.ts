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
  consola.start('Checking Node.js version consistency...');

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
  const runningMajor = extractMajorVersion(process.versions.node);

  if (!enginesMajor) {
    consola.error(`Cannot parse engines.node version: ${enginesNode}`);
    process.exit(1);
  }

  if (!typesMajor) {
    consola.error(`Cannot parse @types/node version: ${typesNode}`);
    process.exit(1);
  }

  if (!runningMajor) {
    consola.error(
      `Cannot parse running Node.js version: ${process.versions.node}`,
    );
    process.exit(1);
  }

  // Check 1: Running Node.js version matches engines.node
  if (runningMajor !== enginesMajor) {
    consola.error(
      `Running Node.js v${process.versions.node} (major: ${runningMajor}) does not match engines.node: "${enginesNode}" (major: ${enginesMajor})`,
    );
    consola.info(
      `Fix: Use Node.js ${enginesMajor}.x (e.g., mise use node@${enginesMajor})`,
    );
    process.exit(1);
  }
  consola.success(
    `Running Node.js v${process.versions.node} matches engines.node: "${enginesNode}"`,
  );

  // Check 2: @types/node matches engines.node
  if (enginesMajor !== typesMajor) {
    consola.error(
      `@types/node@${typesNode} (major: ${typesMajor}) does not match engines.node: "${enginesNode}" (major: ${enginesMajor})`,
    );
    consola.info(`Fix: yarn add -D @types/node@~${enginesMajor}.0.0`);
    process.exit(1);
  }
  consola.success(
    `@types/node@${typesNode} matches engines.node: "${enginesNode}"`,
  );
}

main();
