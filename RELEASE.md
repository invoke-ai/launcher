# Release

1. Bump the version by running `npm run version [<newversion> | major | minor | patch | etc]`. Remember to push the tag. Merge changes.
2. Manually dispatch the `Build Signed Artifacts and Publish` workflow on GitHub, selecting the tag. This will create a draft release and upload signed artifacts to the draft. You do not need to upload anything else.
3. Flesh out the GH release, following the format from prior releases.
4. Post on Discord in the `releases` channel, and link to that post in the `new-release-discussion` channel.

## Auto-Updating Launcher

The Launcher will prompt the user to update when a new version is available. The user can choose to update now or later. If they choose to update now, the Launcher will download the new version and restart itself.
