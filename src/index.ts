/*
 * MIT License
 *
 * Copyright (c) 2025 Interguess.com
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the 'Software'), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import * as core from "@actions/core";
import { exec } from "@actions/exec";

type Semver = { major: number; minor: number; patch: number };

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;

function parseSemver(tag: string | undefined | null): Semver | null {
  if (!tag) return null;
  const cleanTag = tag.trim().split('-')[0];
  const m = cleanTag.match(SEMVER_RE);
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3] };
}

async function tagExists(tag: string): Promise<boolean> {
  try {
    const exitCode = await exec("git", ["rev-parse", `refs/tags/${tag}`], {
      silent: true,
      ignoreReturnCode: true,
    });
    return exitCode === 0;
  } catch {
    return false;
  }
}

function normalizeUpgradeType(x: string | undefined): "MAJOR" | "MINOR" | "PATCH" {
  const up = (x || "PATCH").trim().toUpperCase();
  return (up === "MAJOR" || up === "MINOR") ? up : "PATCH";
}

function formatSemver(s: Semver): string {
  return `${s.major}.${s.minor}.${s.patch}`;
}

async function bumpForUniqueness(version: string, isMain: boolean): Promise<string> {
  let v = version;
  while (await tagExists(v)) {
    if (isMain) {
      const parts = v.split('.');
      parts[2] = String(+parts[2] + 1);
      v = parts.join('.');
    } else {
      const parts = v.split('.');
      const last = parts.pop()!;
      if (!isNaN(Number(last))) {
        v = [...parts, String(+last + 1)].join('.');
      } else {
        v = `${v}.1`;
      }
    }
  }
  return v;
}

async function run(): Promise<void> {
  try {
    const baseBranch = core.getInput("baseBranch", { required: true }).trim();
    const upgradeType = normalizeUpgradeType(core.getInput("upgradeType"));

    const lastTag = core.getInput("lastTag");
    const lastMainTag = core.getInput("lastMainTag");
    const lastDevelopTag = core.getInput("lastDevelopTag");

    core.info(`Using baseBranch='${baseBranch}'`);
    core.info(`Using upgradeType='${upgradeType}'`);

    if (baseBranch === "main") {
      core.info(`Processing main branch release. lastTag='${lastTag}'`);
      const parsed = parseSemver(lastTag) ?? { major: 0, minor: 1, patch: 0 };
      
      let next: Semver = { ...parsed };
      switch (upgradeType) {
        case "MAJOR": next.major += 1; next.minor = 0; next.patch = 0; break;
        case "MINOR": next.minor += 1; next.patch = 0; break;
        default:      next.patch += 1; break;
      }
      
      const newVersion = await bumpForUniqueness(formatSemver(next), true);
      core.setOutput("version", newVersion);
      core.exportVariable("NEW_VERSION", newVersion);
      core.info(`Resulting NEW_VERSION=${newVersion}`);
      return;
    }

    core.info(`Processing branch release. lastMainTag='${lastMainTag}', lastBranchTag='${lastDevelopTag}'`);

    const mainBase = parseSemver(lastMainTag) ?? { major: 0, minor: 1, patch: 0 };
    const baseVersion = formatSemver(mainBase);
    const escapedBranch = baseBranch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    let build = 0;
    const branchPattern = new RegExp(`-${escapedBranch}\\.(\\d+)$`);
    
    const m = (lastDevelopTag || "").trim().match(branchPattern);
    if (m) {
      build = +m[1];
      core.info(`Found existing build number for ${baseBranch}: ${build}`);
    } else {
      core.info(`No matching tag for branch ${baseBranch} found. Starting at build 0`);
    }

    const candidate = `${baseVersion}-${baseBranch}.${build + 1}`;
    const newVersion = await bumpForUniqueness(candidate, false);

    core.setOutput("version", newVersion);
    core.exportVariable("NEW_VERSION", newVersion);
    core.info(`Resulting NEW_VERSION=${newVersion}`);

  } catch (err: any) {
    core.setFailed(err?.message ?? String(err));
  }
}

run();
