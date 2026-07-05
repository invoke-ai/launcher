# Release

1. Bump the version by running `npm run version [<newversion> | major | minor | patch | etc]`. PR & merge.
   - For a prerelease, either pass the version explicitly (e.g. `npm run version 1.8.2-rc.1`) or let npm compute it: `npm run version prepatch --preid rc` bumps 1.8.1 to `1.8.2-rc.0`, and each subsequent `npm run version prerelease` increments to `-rc.1`, `-rc.2`, etc.
   - To graduate a prerelease to the final release, use the increment level the prerelease was building toward: `npm run version patch` strips the suffix in place (`1.8.2-rc.1` → `1.8.2`). Likewise `minor` graduates `1.9.0-rc.1` → `1.9.0`. Careful with higher levels: `minor` from `1.8.2-rc.1` jumps to `1.9.0`, skipping `1.8.2` entirely.
   - Omit the `v` prefix; `package.json` stores the bare version and the git tag gets the `v` added automatically.
   - Note that pushing a prerelease tag triggers the signed-build workflow like any other `v*` tag.
2. Run `./scripts/tagRelease.js` to create and push a new tag. This will trigger the `Build Signed Artifacts and Publish` workflow on GitHub.
   - The workflow requires approval from a reviewer of the `code-signing` environment (currently @hipsterusername, @lstein, or @blessedcoolant) to run.
   - The workflow will create a draft release and upload signed artifacts to the draft. You do not need to upload anything else.
3. Flesh out the GH release, following the format from prior releases.
4. Post on Discord in the `releases` channel, and link to that post in the `new-release-discussion` channel.

## Auto-Updating Launcher

The Launcher will prompt the user to update when a new version is available. The user can choose to update now or later. If they choose to update now, the Launcher will download the new version and restart itself.
