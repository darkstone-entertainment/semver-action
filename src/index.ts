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
  const m = tag.trim().match(SEMVER_RE);
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3] };
}

async function tagExists(tag: string): Promise<boolean> {
  let exitCode = 0;
  try {
    exitCode = await exec("git", ["rev-parse", `refs/tags/${tag}`], {
      silent: true,
    });
  } catch {
    return false;
  }
  return exitCode === 0;
}

function normalizeUpgradeType(x: string | undefined): "MAJOR" | "MINOR" | "PATCH" {
  const up = (x || "PATCH").trim().toUpperCase();
  return (up === "MAJOR" || up === "MINOR") ? up : "PATCH";
}

function formatSemver(s: Semver): string {
  return `${s.major}.${s.minor}.${s.patch}`;
}

async function bumpForUniqueness(version: string, bumpPatch: (v: string) => string): Promise<string> {
  let v = version;
  while (await tagExists(v)) {
    v = bumpPatch(v);
  }
  return v;
}

async function run(): Promise<void> {
  try {
    const baseBranch = core.getInput("baseBranch", { required: true }).trim();
    const upgradeType = normalizeUpgradeType(core.getInput("upgradeType"));

    const lastTag = core.getInput("lastTag"); // for main
    const lastMainTag = core.getInput("lastMainTag"); // for branch base
    const lastDevelopTag = core.getInput("lastDevelopTag"); // last tag on current branch

    core.info(`Using baseBranch='${baseBranch}'`);
    core.info(`Using upgradeType='${upgradeType}'`);

    if (baseBranch === "main") {
      core.info(`Using lastTag='${lastTag}'`);
      const parsed = parseSemver(lastTag) ?? { major: 0, minor: 1, patch: 0 };
      if (!parseSemver(lastTag)) {
        core.info("No existing main tag found, starting with 0.1.0");
      } else {
        core.info(`Parsed existing main tag: ${formatSemver(parsed)}`);
      }

      let next: Semver = { ...parsed };
      switch (upgradeType) {
        case "MAJOR":
          next.major += 1; next.minor = 0; next.patch = 0; break;
        case "MINOR":
          next.minor += 1; next.patch = 0; break;
        default:
          next.patch += 1; break;
      }
      let newVersion = formatSemver(next);

      newVersion = await bumpForUniqueness(newVersion, (v) => {
        const m = v.match(SEMVER_RE)!;
        const p = +m[3] + 1;
        return `${m[1]}.${m[2]}.${p}`;
      });

      core.setOutput("version", newVersion);
      core.exportVariable("NEW_VERSION", newVersion);
      core.info(`NEW_VERSION=${newVersion}`);
      return;
    }

    // --- Dynamic Branch Logic ---
    core.info(`Using lastMainTag='${lastMainTag}'`);
    core.info(`Using lastBranchTag='${lastDevelopTag}'`);

    const mainBase = parseSemver(lastMainTag) ?? { major: 0, minor: 1, patch: 0 };
    const baseVersion = formatSemver(mainBase);

    // Regex-safe branch name escaping
    const escapedBranch = baseBranch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    let build = 0;
    const branchPattern = new RegExp(`^${mainBase.major}\\.${mainBase.minor}\\.${mainBase.patch}-${escapedBranch}\\.(\\d+)$`);
    
    const m = (lastDevelopTag || "").trim().match(branchPattern);
    if (m) {
      build = +m[1];
      core.info(`Found existing build number for ${baseBranch}: ${build}`);
    } else {
      core.info(`No matching tag for branch ${baseBranch} found, starting build at 0`);
    }
    build += 1;

    const mk = (b: number) => `${baseVersion}-${baseBranch}.${b}`;
    let newVersion = mk(build);

    // Ensure uniqueness by increasing build until tag is free
    newVersion = await bumpForUniqueness(newVersion, (v) => {
      const regex = new RegExp(`^(.+?-` + escapedBranch + `\\.)(\\d+)$`);
      const x = v.match(regex)!;
      return `${x[1]}${+x[2] + 1}`;
    });

    core.setOutput("version", newVersion);
    core.exportVariable("NEW_VERSION", newVersion);
    core.info(`NEW_VERSION=${newVersion}`);
  } catch (err: any) {
    core.setFailed(err?.message ?? String(err));
  }
}

run();
