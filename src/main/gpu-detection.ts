import type { ChildProcess } from 'node:child_process';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { GpuConfidence, GpuDetectionResult } from '@/shared/types';

/**
 * Best-effort hardware probe for the compute backend (CUDA / ROCm / Metal / CPU). This is advisory only: the install
 * flow presents the result to the user for confirmation and always allows a manual override, so a wrong guess is never
 * fatal. Ported from a standalone prototype; every probe is async and deadline-bounded so we neither block the main
 * process event loop nor leave the caller waiting on a wedged driver.
 */

/** Per-probe budget. Each probe is independent and they all run concurrently, so this is not additive. */
const PROBE_TIMEOUT_MS = 3000;
/**
 * Overall budget for the whole detection. `execFile`'s own timeout only *signals* the child - the callback still waits
 * for it to exit, and a process stuck in an uninterruptible driver ioctl (a wedged `nvidia-smi` under Xid 79, or
 * `powershell` against a corrupt WMI repository) never does. Without a hard deadline the IPC reply never arrives, the
 * Configure step spins forever and its Next button can never enable.
 */
const DETECTION_TIMEOUT_MS = 10000;

type ProbeResult = {
  ok: boolean;
  command: string;
  stdout: string;
  stderr: string;
  reason: string;
};

type BackendProbe = {
  detected: boolean;
  confidence: GpuConfidence;
  reason: string;
};

const CPU_FALLBACK: GpuDetectionResult = {
  backend: 'cpu',
  vendor: 'cpu',
  // "No evidence found" is the opposite of high confidence - nothing was detected.
  confidence: 'none',
  decision: 'No supported GPU backend detected',
};

function runProbe(command: string, args: string[] = []): Promise<ProbeResult> {
  const commandLine = [command, ...args].join(' ');

  return new Promise<ProbeResult>((resolve) => {
    let settled = false;
    let deadline: NodeJS.Timeout | undefined;
    let child: ChildProcess | undefined;

    const finish = (result: ProbeResult) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(deadline);
      resolve(result);
    };

    child = execFile(
      command,
      args,
      {
        encoding: 'utf8',
        timeout: PROBE_TIMEOUT_MS,
        killSignal: 'SIGKILL',
        // A packaged Electron app is a GUI-subsystem process with no console of its own, so without this every probe
        // that shells out (`powershell` on every Windows machine, `nvidia-smi` on every NVIDIA one) flashes a console
        // window in the user's face.
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          const err = error as { message?: string };
          finish({
            ok: false,
            command: commandLine,
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            reason: err.message ?? 'command failed',
          });
          return;
        }
        finish({ ok: true, command: commandLine, stdout: stdout.trim(), stderr: '', reason: 'command succeeded' });
      }
    );

    // Belt and braces against a child that will not die: settle regardless of whether the callback ever fires.
    deadline = setTimeout(() => {
      child?.kill('SIGKILL');
      finish({ ok: false, command: commandLine, stdout: '', stderr: '', reason: 'command timed out' });
    }, PROBE_TIMEOUT_MS + 500);
  });
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readFile(filePath: string): Promise<string> {
  try {
    return (await fs.readFile(filePath, 'utf8')).trim();
  } catch {
    return '';
  }
}

async function listDir(dirPath: string): Promise<string[]> {
  try {
    return await fs.readdir(dirPath);
  } catch {
    return [];
  }
}

function parseKfdProperties(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.trim().match(/^([a-zA-Z0-9_]+)\s+(.+)$/);
    if (match && match[1]) {
      result[match[1]] = match[2] ?? '';
    }
  }
  return result;
}

function numberValue(value: string | undefined): number {
  if (value === undefined || value === '') {
    return 0;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * gfx targets that ROCm's PyTorch wheels are actually built for.
 *
 * Without this check, every AMD APU on Linux (a 5700G, a 7840U, any Ryzen laptop with stock `amdgpu`) is a positive
 * ROCm detection: its KFD topology node reports a gfx name, non-zero compute units and a valid device id, exactly like
 * a discrete card. The user is then asked to confirm "we detected an AMD GPU (ROCm)" - which is *true* - and ends up
 * with a multi-GB ROCm torch that dies with `hipErrorNoBinaryForGpu` at first generation. The confirmation prompt
 * cannot save them, because there is nothing wrong with the statement they agreed to.
 *
 * Erring towards a short list is the safe direction: an unlisted target falls through to the CPU backend, which the
 * user can still override by hand from the manual picker.
 */
const ROCM_SUPPORTED_GFX_TARGETS = new Set([
  'gfx900',
  'gfx906',
  'gfx908',
  'gfx90a',
  'gfx942',
  'gfx950',
  'gfx1030',
  'gfx1100',
  'gfx1101',
  'gfx1102',
  'gfx1151',
  'gfx1200',
  'gfx1201',
]);

/** Normalize a gfx target - `rocminfo` reports feature suffixes, e.g. `gfx90a:sramecc+:xnack-`. */
function normalizeGfxTarget(name: string): string {
  return name.trim().toLowerCase().split(':')[0] ?? '';
}

function isRocmSupportedGfxTarget(name: string): boolean {
  return ROCM_SUPPORTED_GFX_TARGETS.has(normalizeGfxTarget(name));
}

type KfdNode = { node: string; name: string; gpu_id: string; properties: string };

/** Whether a KFD topology node describes a GPU at all (as opposed to the CPU node every machine has). */
function isKfdGpuNode(node: KfdNode): boolean {
  const props = parseKfdProperties(node.properties);
  const name = node.name.trim();

  const nameLooksLikeGpu = /^gfx[0-9a-f]+$/i.test(name);

  const hasNonzeroGpuIdentity =
    numberValue(props.gpu_id ?? node.gpu_id) > 0 ||
    numberValue(props.vendor_id) > 0 ||
    numberValue(props.device_id) > 0 ||
    numberValue(props.location_id) > 0 ||
    numberValue(props.drm_render_minor) > 0;

  const hasComputeUnits =
    numberValue(props.simd_count) > 0 && numberValue(props.array_count) > 0 && numberValue(props.cu_per_simd_array) > 0;

  const hasGfxTarget = numberValue(props.gfx_target_version) > 0 || nameLooksLikeGpu;

  return hasNonzeroGpuIdentity && hasComputeUnits && hasGfxTarget;
}

async function probeKfdTopology(): Promise<{ exists: boolean; gfxTargets: string[] }> {
  const base = '/sys/class/kfd/kfd/topology/nodes';
  const nodeNames = await listDir(base);
  const nodes: KfdNode[] = await Promise.all(
    nodeNames.map(async (nodeName) => {
      const nodePath = path.join(base, nodeName);
      const [name, gpu_id, properties] = await Promise.all([
        readFile(path.join(nodePath, 'name')),
        readFile(path.join(nodePath, 'gpu_id')),
        readFile(path.join(nodePath, 'properties')),
      ]);
      return { node: nodeName, name, gpu_id, properties };
    })
  );

  return {
    exists: await fileExists(base),
    gfxTargets: nodes.filter(isKfdGpuNode).map((node) => node.name.trim()),
  };
}

async function probeAmdRenderDevices(): Promise<{ hasAmdRenderDevice: boolean }> {
  const drmPath = '/sys/class/drm';
  const entries = (await listDir(drmPath)).filter((name) => name.startsWith('renderD'));

  const vendors = await Promise.all(entries.map((entry) => readFile(path.join(drmPath, entry, 'device', 'vendor'))));

  return { hasAmdRenderDevice: vendors.some((vendor) => vendor.toLowerCase() === '0x1002') };
}

async function hasNvidiaGpu(): Promise<BackendProbe> {
  const nvidiaSmi = await runProbe('nvidia-smi', ['-L']);

  if (nvidiaSmi.ok && nvidiaSmi.stdout.includes('GPU')) {
    return { detected: true, confidence: 'high', reason: '`nvidia-smi -L` reported at least one GPU' };
  }

  // `/proc/driver/nvidia` exists whenever `nvidia.ko` is loaded, even with zero usable devices (all of them bound to
  // `vfio-pci` for passthrough, for instance), so require an actual GPU entry underneath it.
  const nvidiaProcGpus = await listDir('/proc/driver/nvidia/gpus');
  if (nvidiaProcGpus.length > 0 || (await fileExists('/dev/nvidia0'))) {
    return { detected: true, confidence: 'medium', reason: 'NVIDIA Linux device files exist' };
  }

  return { detected: false, confidence: 'none', reason: 'No NVIDIA evidence found' };
}

async function hasRocmGpu(): Promise<BackendProbe> {
  // Every probe below is Linux-only (ROCm tools, `/sys/class/kfd`, `/sys/class/drm`). Without this guard an `amd-smi`
  // that happens to be on a Windows PATH would route the user to `pins.torchIndexUrl.win32.rocm`, which does not
  // exist - the exact outcome the Windows AMD probe below exists to prevent.
  if (process.platform !== 'linux') {
    return { detected: false, confidence: 'none', reason: 'ROCm is only supported on Linux' };
  }

  // Each external probe has a 3s timeout; running them sequentially would cost up to ~9s of spinner time on a machine
  // without ROCm tools installed. They're independent, so run them concurrently and then evaluate in priority order.
  const [amdSmi, rocmSmi, rocminfo, kfdTopology] = await Promise.all([
    runProbe('amd-smi', ['list']),
    runProbe('rocm-smi', ['--showproductname']),
    runProbe('rocminfo', []),
    probeKfdTopology(),
  ]);

  // Prefer the probes that name a gfx target, because that is the only signal that says whether a ROCm torch build
  // exists for this hardware. `amd-smi`/`rocm-smi` only tell us that ROCm tooling is installed.
  const rocminfoGfxTargets = rocminfo.ok
    ? [...rocminfo.stdout.matchAll(/Name:\s+(gfx[0-9a-f]+(?::[\w+-]+)*)/gi)].map((match) => match[1] ?? '')
    : [];
  const gfxTargets = [...rocminfoGfxTargets, ...kfdTopology.gfxTargets].filter(Boolean);
  const supportedGfxTargets = gfxTargets.filter(isRocmSupportedGfxTarget);

  if (supportedGfxTargets.length > 0) {
    return {
      detected: true,
      confidence: 'high',
      reason: `Found an AMD GPU with a ROCm-supported target (${supportedGfxTargets.join(', ')})`,
    };
  }

  if (gfxTargets.length > 0) {
    return {
      detected: false,
      confidence: 'weak-signal',
      reason: `We detected AMD graphics (${gfxTargets.join(', ')}), but PyTorch has no ROCm build for it, so Invoke will use your CPU`,
    };
  }

  // No gfx target anywhere (e.g. a container where the KFD nodes are listable but their `properties` are not) - fall
  // back to "ROCm tooling reports a device".
  if (
    amdSmi.ok &&
    /GPU:\s*\d+|ASIC|DEVICE/i.test(amdSmi.stdout) &&
    !/no devices|not found|failed/i.test(amdSmi.stdout)
  ) {
    return { detected: true, confidence: 'medium', reason: '`amd-smi list` reported at least one AMD GPU' };
  }

  // `rocm-smi` prints its banner and footer even with no supported device attached, so require an actual device row
  // rather than just non-empty output.
  if (rocmSmi.ok && /^GPU\[\d+\]/m.test(rocmSmi.stdout) && !/no devices|not found|failed/i.test(rocmSmi.stdout)) {
    return { detected: true, confidence: 'medium', reason: '`rocm-smi --showproductname` reported a GPU' };
  }

  const renderDevices = await probeAmdRenderDevices();
  if ((await fileExists('/dev/kfd')) || renderDevices.hasAmdRenderDevice || kfdTopology.exists) {
    return {
      detected: false,
      confidence: 'weak-signal',
      reason:
        'We detected AMD graphics hardware, but could not confirm a ROCm-capable GPU, so Invoke will use your CPU',
    };
  }

  return { detected: false, confidence: 'none', reason: 'No ROCm evidence found' };
}

async function hasMacGpuCapabilities(): Promise<BackendProbe> {
  if (process.platform !== 'darwin') {
    return { detected: false, confidence: 'none', reason: 'Not macOS' };
  }

  if (os.arch() === 'arm64') {
    return { detected: true, confidence: 'high', reason: 'Apple Silicon Mac detected' };
  }

  const systemProfiler = await runProbe('system_profiler', ['SPDisplaysDataType']);
  const markers = ['Metal', 'AMD', 'Apple'];
  if (systemProfiler.ok && markers.some((marker) => systemProfiler.stdout.includes(marker))) {
    return {
      detected: true,
      confidence: 'medium',
      reason: '`system_profiler SPDisplaysDataType` showed Mac GPU capability markers',
    };
  }

  return { detected: false, confidence: 'none', reason: 'No macOS GPU capability evidence found' };
}

/**
 * Detect a discrete AMD GPU on Windows. There is no supported ROCm-on-Windows install path, so this never yields a
 * usable GPU backend - it exists purely so we can tell the user "we saw your AMD card, but Windows will use the CPU"
 * instead of the misleading "no dedicated GPU detected". These are exactly the users the custom-index field targets.
 */
async function hasWindowsAmdGpu(): Promise<BackendProbe> {
  if (process.platform !== 'win32') {
    return { detected: false, confidence: 'none', reason: 'Not Windows' };
  }

  const videoControllers = await runProbe('powershell', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    'Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name }',
  ]);

  if (videoControllers.ok && /\b(AMD|Radeon|ATI)\b/i.test(videoControllers.stdout)) {
    return { detected: true, confidence: 'medium', reason: 'Windows reported an AMD/Radeon display adapter' };
  }

  return { detected: false, confidence: 'none', reason: 'No AMD display adapter reported by Windows' };
}

async function detect(): Promise<GpuDetectionResult> {
  const [nvidia, rocm, mac, windowsAmd] = await Promise.all([
    hasNvidiaGpu(),
    hasRocmGpu(),
    hasMacGpuCapabilities(),
    hasWindowsAmdGpu(),
  ]);

  if (nvidia.detected) {
    return { backend: 'cuda', vendor: 'nvidia', confidence: nvidia.confidence, decision: nvidia.reason };
  }

  if (rocm.detected) {
    return { backend: 'rocm', vendor: 'amd', confidence: rocm.confidence, decision: rocm.reason };
  }

  if (mac.detected) {
    return { backend: 'metal', vendor: 'apple', confidence: mac.confidence, decision: mac.reason };
  }

  if (windowsAmd.detected) {
    // A real AMD GPU, but no ROCm on Windows - the usable backend is still CPU. We surface the vendor so the UI can
    // explain why, rather than claiming there's no GPU at all.
    return {
      backend: 'cpu',
      vendor: 'amd',
      confidence: windowsAmd.confidence,
      decision: 'We detected an AMD GPU, but ROCm is not supported on Windows, so Invoke will use your CPU',
    };
  }

  if (rocm.confidence === 'weak-signal') {
    // We saw AMD hardware but could not confirm a ROCm-capable GPU. The backend is still CPU, but "no dedicated GPU"
    // would be a lie to someone staring at a Radeon - carry the reason through so the UI can explain itself.
    return { backend: 'cpu', vendor: 'amd', confidence: 'weak-signal', decision: rocm.reason };
  }

  return CPU_FALLBACK;
}

/**
 * Detect the most likely compute backend for this machine. The result is advisory and always user-overridable.
 *
 * An individual probe failing degrades to "no evidence for that backend". Blowing the overall deadline instead
 * *rejects*: we genuinely don't know what this machine has, and reporting "no dedicated GPU" would be indistinguishable
 * from a confident answer. The caller falls back to the manual picker, which is the honest outcome.
 */
export const detectGpu = async (): Promise<GpuDetectionResult> => {
  let deadline: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    deadline = setTimeout(
      () => reject(new Error(`GPU detection timed out after ${DETECTION_TIMEOUT_MS}ms`)),
      DETECTION_TIMEOUT_MS
    );
  });

  try {
    return await Promise.race([detect(), timeout]);
  } finally {
    clearTimeout(deadline);
  }
};
