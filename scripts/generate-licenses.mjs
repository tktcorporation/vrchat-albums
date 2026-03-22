#!/usr/bin/env node

/**
 * # ライセンス情報生成スクリプト
 *
 * `license-checker` の結果から環境依存のパスを除外し、
 * `src/assets/licenses.json` を生成する。
 */

import fs from 'node:fs';
import path from 'node:path';

import licenseChecker from 'license-checker';

const rootDir = process.cwd();

licenseChecker.init(
  {
    start: rootDir,
    production: true,
    json: true,
    relativeLicensePath: true,
  },
  (err, packages) => {
    if (err) {
      console.error(err);
      process.exit(1);
    }

    for (const pkg of Object.values(packages)) {
      if (pkg.path) pkg.path = path.relative(rootDir, pkg.path);
      if (pkg.licenseFile) {
        pkg.licenseFile = path.relative(rootDir, pkg.licenseFile);
      }
    }

    const outputPath = path.resolve('src/assets/licenses.json');
    fs.writeFileSync(outputPath, `${JSON.stringify(packages, null, 2)}\n`);
  },
);
