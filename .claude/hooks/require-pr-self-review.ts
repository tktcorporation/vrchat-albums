#!/usr/bin/env bun
import { readInput } from './hook-utils.ts';
import { convergenceDenyReason, denyJson } from './pr-review-gate.ts';
import { readRounds, reviewTargetSha } from './review-count.ts';
const input = await readInput();
const [rounds, currentSha] = await Promise.all([readRounds(input), reviewTargetSha(input)]);
const reason = convergenceDenyReason(rounds, currentSha, 'PR作成をブロックしました。');
if (reason) console.log(denyJson(reason));
