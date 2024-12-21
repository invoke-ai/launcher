import { useStore } from '@nanostores/react';
import { compare } from '@renovatebot/pep440';
import { atom } from 'nanostores';
import { useMemo } from 'react';

import { withResult, withResultAsync } from '@/lib/result';
import type { AsyncRequest } from '@/shared/types';

type LatestGHReleases = { stable: string; pre?: string };

export const $latestGHReleases = atom<AsyncRequest<LatestGHReleases, string>>({
  isUninitialized: true,
  isError: false,
  isLoading: false,
  isSuccess: false,
});

// GH rate-limits requests to 60 per hour, but 304s do not count towards the limit - use conditional requests with ETag
// to avoid rate-limiting
let previousETag: string | null = null;

let lastCheck: number | null = null;

/**
 * Update the $latestGHReleases store with the latest stable and pre-release versions from the GitHub API.
 */
export const syncGHReleases = async () => {
  // We may re-use the cached data if we get a 304
  const cached = $latestGHReleases.get();

  // Set the loading state
  $latestGHReleases.set({
    isLoading: true,
    isError: false,
    isSuccess: false,
    isUninitialized: false,
  });

  const request = await withResultAsync(async () => {
    const url = 'https://api.github.com/repos/invoke-ai/invokeai/releases';

    // Only pass the ETag if we have one, else this is the first request
    const headers: HeadersInit = previousETag ? { 'If-None-Match': previousETag } : {};

    if (previousETag) {
      console.log('Using cached ETag:', previousETag);
    }

    console.log('Checking for new releases...');

    lastCheck = Date.now();

    const response = await fetch(url, { headers });

    if (response.status === 200) {
      // TODO(psyche): use zod?
      const data = (await response.json()) as Array<{ tag_name: string; prerelease: boolean; draft: boolean }>;

      // Update the ETag for future requests
      const newETag = response.headers.get('ETag');
      console.log('Updating ETag:', newETag);
      previousETag = newETag;

      // Get the latest stable and pre-release versions - we assume tag_name is a valid PEP 440 version
      const releases = {
        stable: data.find((release) => !release.prerelease && !release.draft)?.tag_name as string | undefined,
        pre: data.find((release) => release.prerelease && !release.draft)?.tag_name as string | undefined,
      };

      console.log('Latest releases:', releases);

      return releases;
    } else if (response.status === 304) {
      // If we get a 304, we can use the cached data
      if (cached.isSuccess) {
        console.log('Data not modified. Using cached data.');
        return cached.data;
      } else {
        // If we get a 304 but we don't have cached data, something is wrong, reset the ETag so the next request is fresh
        previousETag = null;
        throw new Error('Data not modified but no cached data available');
      }
    } else {
      throw new Error(`Unexpected status code: ${response.status}`);
    }
  });

  if (request.isErr()) {
    console.error('Failed to fetch latest GH releases:', request.error);
    $latestGHReleases.set({
      isLoading: false,
      isError: true,
      isSuccess: false,
      isUninitialized: false,
      error: request.error.message,
    });
    return;
  }

  const { stable, pre } = request.value;

  // We must have a stable release
  if (!stable) {
    $latestGHReleases.set({
      isLoading: false,
      isError: true,
      isSuccess: false,
      isUninitialized: false,
      error: 'No stable release found',
    });
    return;
  }

  const data: LatestGHReleases = { stable };

  // Only list pre-releases if they are newer than the stable release
  if (pre && compare(pre, stable) > 0) {
    data.pre = pre;
  }

  $latestGHReleases.set({
    isLoading: false,
    isError: false,
    isSuccess: true,
    isUninitialized: false,
    data,
  });
};

// Initial fetch
syncGHReleases();

const STALE_THRESHOLD = 1000 * 60 * 60; // 1 hour

// Periodically check for new releases when the app is in the foreground
window.setInterval(() => {
  if (window.document.visibilityState !== 'visible') {
    return;
  }
  syncGHReleases();
}, STALE_THRESHOLD);

// Check for updates on focus (if we haven't checked recently)
window.addEventListener('focus', () => {
  if (window.document.visibilityState !== 'visible') {
    return;
  }
  if (!lastCheck || Date.now() - lastCheck > STALE_THRESHOLD) {
    syncGHReleases();
  }
});

type UseAvailableUpdatesReturn = {
  stable: string | null;
  pre: string | null;
};

export const useAvailableUpdates = (currentVersion: string): UseAvailableUpdatesReturn => {
  const latestGHReleases = useStore($latestGHReleases);

  const updates = useMemo<UseAvailableUpdatesReturn>(() => {
    if (!latestGHReleases.isSuccess) {
      return { stable: null, pre: null };
    }
    const { stable, pre } = latestGHReleases.data;

    const stableCompareResult = withResult(() => compare(stable, currentVersion) > 0);
    const isStableUpdateAvailable = stableCompareResult.isOk() ? stableCompareResult.value : false;

    if (!pre) {
      return { stable: isStableUpdateAvailable ? stable : null, pre: null };
    }

    const prereleaseCompareResult = withResult(() => compare(pre, currentVersion) > 0);
    const isPrereleaseUpdateAvailable = prereleaseCompareResult.isOk() ? prereleaseCompareResult.value : false;

    return { stable: isStableUpdateAvailable ? stable : null, pre: isPrereleaseUpdateAvailable ? pre : null };
  }, [currentVersion, latestGHReleases]);

  return updates;
};
