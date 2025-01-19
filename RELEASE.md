# Release

1. Bump the version by running `npm run version [<newversion> | major | minor | patch | etc]`.
2. Merge all changes and let CI run on `main`. You'll have 3 builds, one for each of Windows, macOS and Linux. The Windows and macOS\* builds need to be signed.
3. Upload the unsigned Windows and macOS builds to R2. **Do _not_ overwrite the previous release's stable builds!**
4. On the private codesigning repo, kick off a codesign workflow for Windows and macOS. You'll need to provide the URL to the R2-hosted unsigned build for each platform.
5. Download the signed builds.
6. Test the signed builds locally. Make sure you install and launch Invoke.
7. Upload the signed builds to R2. **This time you _should_ overwrite the previous release's stable builds.**
8. Upload the builds to a new GH release. Follow the format from prior releases. Don't upload the unsigned builds.
9. Post on Discord in the `releases` channel, and link to that post in the `new-release-discussion` channel.

\*macOS signing is not possible until Apple finalizes our developer account. Skip signing macOS builds for now.

## Auto-Updating Launcher

Once we have macOS code signing set up, we can work on auto-updating for the launcher.

This will hopefully be simple. The electron community provides a free update service for OSS projects and it appears to be very easy to set up.
