import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import type { GpuBackend, GpuDetectionResult } from '@/shared/types';

/**
 * Best-effort hardware probe for the compute backend (CUDA / ROCm / Metal / CPU). This is advisory only: the install
 * flow presents the result to the user for confirmation and always allows a manual override, so a wrong guess is never
 * fatal. Ported from a standalone prototype; probes are async so we never block the main process event loop.
 */

const execFileAsync = promisify(execFile);

type Confidence = 'high' | 'medium' | 'low' | 'weak-signal' | 'none';

type ProbeResult = {
  ok: boolean;
  command: string;
  stdout: string;
  stderr: string;
  reason: string;
};

type BackendProbe = {
  detected: boolean;
  confidence: Confidence;
  reason: string;
};

async function runProbe(command: string, args: string[] = []): Promise<ProbeResult> {
  const commandLine = [command, ...args].join(' ');
  try {
    const { stdout } = await execFileAsync(command, args, { encoding: 'utf8', timeout: 3000 });
    return { ok: true, command: commandLine, stdout: stdout.trim(), stderr: '', reason: 'command succeeded' };
  } catch (error) {
    const err = error as { stdout?: unknown; stderr?: unknown; message?: string };
    return {
      ok: false,
      command: commandLine,
      stdout: typeof err.stdout === 'string' ? err.stdout.trim() : '',
      stderr: typeof err.stderr === 'string' ? err.stderr.trim() : '',
      reason: err.message ?? 'command failed',
    };
  }
}

function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

function readFile(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf8').trim();
  } catch {
    return '';
  }
}

function listDir(dirPath: string): string[] {
  try {
    return fs.readdirSync(dirPath);
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

type KfdNode = { node: string; name: string; gpu_id: string; properties: string };

function isUsableKfdGpuNode(node: KfdNode): boolean {
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

function probeKfdTopology(): { exists: boolean; hasUsableGpuNode: boolean } {
  const base = '/sys/class/kfd/kfd/topology/nodes';
  const nodes: KfdNode[] = listDir(base).map((nodeName) => {
    const nodePath = path.join(base, nodeName);
    return {
      node: nodeName,
      name: readFile(path.join(nodePath, 'name')),
      gpu_id: readFile(path.join(nodePath, 'gpu_id')),
      properties: readFile(path.join(nodePath, 'properties')),
    };
  });

  return {
    exists: fs.existsSync(base),
    hasUsableGpuNode: nodes.some(isUsableKfdGpuNode),
  };
}

function probeAmdRenderDevices(): { hasAmdRenderDevice: boolean } {
  const drmPath = '/sys/class/drm';
  const entries = listDir(drmPath).filter((name) => name.startsWith('renderD'));

  const hasAmdRenderDevice = entries.some((entry) => {
    const vendor = readFile(path.join(drmPath, entry, 'device', 'vendor'));
    return vendor.toLowerCase() === '0x1002';
  });

  return { hasAmdRenderDevice };
}

async function hasNvidiaGpu(): Promise<BackendProbe> {
  const nvidiaSmi = await runProbe('nvidia-smi', ['-L']);

  if (nvidiaSmi.ok && nvidiaSmi.stdout.includes('GPU')) {
    return { detected: true, confidence: 'high', reason: '`nvidia-smi -L` reported at least one GPU' };
  }

  if (fileExists('/proc/driver/nvidia') || fileExists('/dev/nvidia0')) {
    return { detected: true, confidence: 'medium', reason: 'NVIDIA Linux device files exist' };
  }

  return { detected: false, confidence: 'none', reason: 'No NVIDIA evidence found' };
}

async function hasRocmGpu(): Promise<BackendProbe> {
  const amdSmi = await runProbe('amd-smi', ['list']);
  if (
    amdSmi.ok &&
    /GPU:\s*\d+|ASIC|DEVICE/i.test(amdSmi.stdout) &&
    !/no devices|not found|failed/i.test(amdSmi.stdout)
  ) {
    return { detected: true, confidence: 'high', reason: '`amd-smi list` reported at least one AMD GPU' };
  }

  const rocmSmi = await runProbe('rocm-smi', ['--showproductname']);
  if (rocmSmi.ok && rocmSmi.stdout.length > 0 && !/no devices|not found|failed/i.test(rocmSmi.stdout)) {
    return { detected: true, confidence: 'high', reason: '`rocm-smi --showproductname` returned GPU product output' };
  }

  const rocminfo = await runProbe('rocminfo', []);
  const rocminfoHasGpuAgent =
    rocminfo.ok && /Device Type:\s+GPU/i.test(rocminfo.stdout) && /Name:\s+gfx[0-9a-f]+/i.test(rocminfo.stdout);
  if (rocminfoHasGpuAgent) {
    return { detected: true, confidence: 'high', reason: '`rocminfo` reported a GPU agent with a gfx target' };
  }

  const kfdTopology = probeKfdTopology();
  if (kfdTopology.hasUsableGpuNode) {
    return { detected: true, confidence: 'medium', reason: 'KFD topology contains at least one usable GPU node' };
  }

  const renderDevices = probeAmdRenderDevices();
  if (fileExists('/dev/kfd') || renderDevices.hasAmdRenderDevice || kfdTopology.exists) {
    return {
      detected: false,
      confidence: 'weak-signal',
      reason: 'AMD/KFD evidence exists, but no ROCm tool or KFD topology node confirmed a usable ROCm GPU',
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
 * Detect the most likely compute backend for this machine. The result is advisory and always user-overridable.
 */
export const detectGpu = async (): Promise<GpuDetectionResult> => {
  const [nvidia, rocm, mac] = await Promise.all([hasNvidiaGpu(), hasRocmGpu(), hasMacGpuCapabilities()]);

  let backend: GpuBackend;
  let vendor: string;
  let confidence: Confidence;
  let decision: string;

  if (nvidia.detected) {
    backend = 'cuda';
    vendor = 'nvidia';
    confidence = nvidia.confidence;
    decision = nvidia.reason;
  } else if (rocm.detected) {
    backend = 'rocm';
    vendor = 'amd';
    confidence = rocm.confidence;
    decision = rocm.reason;
  } else if (mac.detected) {
    backend = 'metal';
    vendor = 'apple';
    confidence = mac.confidence;
    decision = mac.reason;
  } else {
    backend = 'cpu';
    vendor = 'cpu';
    confidence = 'high';
    decision = 'No supported GPU backend detected';
  }

  return { backend, vendor, confidence, decision };
};
