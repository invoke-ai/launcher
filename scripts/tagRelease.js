#!/usr/bin/env node
/* eslint-disable  @typescript-eslint/no-require-imports */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const colors = require('ansi-colors');

function doesTagExist(tag) {
  try {
    execSync(`git rev-parse --quiet --verify "refs/tags/${tag}"`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function gitShowRef(ref) {
  return execSync(`git show-ref --dereference ${ref} --abbrev 7`, { encoding: 'utf8' }).trim();
}

function gitShow(ref = 'HEAD') {
  return execSync(`git show -s --format='%h %s' ${ref}`, { encoding: 'utf8' }).trim();
}

function promptUser(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function main() {
  try {
    // Read version from package.json
    const packageJsonPath = path.join(__dirname, '..', 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const tag = `v${packageJson.version}`;

    // Check if tag already exists
    if (doesTagExist(tag)) {
      console.log(`${colors.cyan.bold(tag)} already exists:`);
      console.log(gitShowRef(`tags/${tag}`));
      console.log();
    }

    // Show current HEAD
    console.log(`${colors.green.bold('HEAD')}:`);
    console.log(gitShow());
    console.log();

    // Show git remotes
    console.log(`${colors.green.bold('git remote -v')}:`);
    console.log(execSync('git remote -v', { encoding: 'utf8' }));

    // Prompt for confirmation
    const prompt = `Create tags ${colors.cyan.bold(tag)} @ ${colors.green.bold('HEAD')}, ${colors.red(
      'deleting existing tags on origin remote'
    )}? y/n [n]: `;
    const response = await promptUser(prompt);

    if (response.toLowerCase() === 'y') {
      console.log();

      // Delete existing tag on remote
      console.log(`Deleting ${colors.cyan.bold(tag)} tag on origin remote...`);
      try {
        execSync(`git push origin :refs/tags/${tag}`, { stdio: 'inherit' });
      } catch (error) {
        // Tag might not exist on remote, which is fine
        if (!error.message.includes('remote ref does not exist')) {
          throw error;
        }
      }

      // Create tag locally
      console.log(`Tagging ${colors.green.bold('HEAD')} with ${colors.cyan.bold(tag)} locally...`);
      try {
        execSync(`git tag -fa ${tag}`, { stdio: 'inherit' });
      } catch (error) {
        console.error('Existing/invalid tag', error);
        process.exit(1);
      }

      // Push tags to remote
      console.log('Pushing updated tags to origin remote...');
      execSync(`git push origin tag ${tag}`, { stdio: 'inherit' });
    }

    process.exit(0);
  } catch (error) {
    console.error(`${colors.red.bold('Error:')}`, error.message);
    process.exit(1);
  }
}

main();
