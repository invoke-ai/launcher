import { performance } from 'perf_hooks';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { app } from 'electron';
import { freemem, totalmem } from 'os';
import type { SimpleLogger } from './simple-logger';

const execFileAsync = promisify(execFile);

export interface MemorySnapshot {
  timestamp: number;
  nodeMemory: NodeJS.MemoryUsage;
  processMemory?: WindowsProcessMemory;
  heapStats?: V8HeapStatistics;
  electronMemory?: ElectronMemoryInfo;
  systemMemory?: SystemMemoryInfo;
}

export interface ElectronMemoryInfo {
  workingSetSize?: number;
  peakWorkingSetSize?: number;
  sharedWorkingSetSize?: number;
  privateWorkingSetSize?: number;
}

export interface SystemMemoryInfo {
  totalMemory: number;
  freeMemory: number;
  usedMemory: number;
  memoryUsagePercent: number;
}

export interface WindowsProcessMemory {
  workingSetSize: number;
  peakWorkingSetSize: number;
  pagefileUsage: number;
  peakPagefileUsage: number;
  privateUsage: number;
}

export interface V8HeapStatistics {
  totalHeapSize: number;
  totalHeapSizeExecutable: number;
  totalPhysicalSize: number;
  totalAvailableSize: number;
  usedHeapSize: number;
  heapSizeLimit: number;
  mallocedMemory: number;
  peakMallocedMemory: number;
  doesZapGarbage: number;
  numberOfNativeContexts: number;
  numberOfDetachedContexts: number;
}

export class MemoryTracker {
  private isTracking = false;
  private intervalId: NodeJS.Timeout | null = null;
  private snapshots: MemorySnapshot[] = [];
  private readonly maxSnapshots: number;
  private readonly intervalMs: number;
  private readonly logger: SimpleLogger;

  constructor(options: {
    logger: SimpleLogger;
    intervalMs?: number;
    maxSnapshots?: number;
  }) {
    this.logger = options.logger;
    this.intervalMs = options.intervalMs ?? 30000; // 30 seconds
    this.maxSnapshots = options.maxSnapshots ?? 100;
  }

  start(): void {
    if (this.isTracking) {
      this.logger.warn('Memory tracking already started');
      return;
    }

    this.isTracking = true;
    this.logger.info('Starting memory tracking');
    
    // Take initial snapshot
    this.takeSnapshot().catch(err => {
      this.logger.error(`Failed to take initial memory snapshot: ${err.message}`);
    });

    // Schedule periodic snapshots
    this.intervalId = setInterval(() => {
      this.takeSnapshot().catch(err => {
        this.logger.error(`Failed to take memory snapshot: ${err.message}`);
      });
    }, this.intervalMs);
  }

  stop(): void {
    if (!this.isTracking) {
      return;
    }

    this.isTracking = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    
    this.logger.info('Stopped memory tracking');
  }

  async takeSnapshot(): Promise<MemorySnapshot> {
    const timestamp = Date.now();
    const nodeMemory = process.memoryUsage();
    
    const snapshot: MemorySnapshot = {
      timestamp,
      nodeMemory,
    };

    // Get V8 heap statistics
    try {
      const v8 = require('v8');
      snapshot.heapStats = v8.getHeapStatistics();
    } catch (err) {
      this.logger.debug(`Could not get V8 heap stats: ${err.message}`);
    }

    // Get system memory information
    try {
      const totalMem = totalmem();
      const freeMem = freemem();
      const usedMem = totalMem - freeMem;
      
      snapshot.systemMemory = {
        totalMemory: totalMem,
        freeMemory: freeMem,
        usedMemory: usedMem,
        memoryUsagePercent: (usedMem / totalMem) * 100,
      };
    } catch (err) {
      this.logger.debug(`Could not get system memory info: ${err.message}`);
    }

    // Get Electron app memory information
    try {
      if (app && app.getAppMetrics) {
        const metrics = app.getAppMetrics();
        const mainProcess = metrics.find(metric => metric.type === 'Browser');
        
        if (mainProcess && mainProcess.memory) {
          snapshot.electronMemory = {
            workingSetSize: mainProcess.memory.workingSetSize,
            peakWorkingSetSize: mainProcess.memory.peakWorkingSetSize,
            sharedWorkingSetSize: mainProcess.memory.sharedWorkingSetSize,
            privateWorkingSetSize: mainProcess.memory.privateWorkingSetSize,
          };
        }
      }
    } catch (err) {
      this.logger.debug(`Could not get Electron memory info: ${err.message}`);
    }

    // Get Windows-specific process memory info
    if (process.platform === 'win32') {
      try {
        snapshot.processMemory = await this.getWindowsProcessMemory();
      } catch (err) {
        this.logger.debug(`Could not get Windows process memory: ${err.message}`);
      }
    }

    // Store snapshot (with rotation)
    this.snapshots.push(snapshot);
    if (this.snapshots.length > this.maxSnapshots) {
      this.snapshots.shift();
    }

    // Log memory info
    this.logMemorySnapshot(snapshot);

    return snapshot;
  }

  private async getWindowsProcessMemory(): Promise<WindowsProcessMemory | undefined> {
    try {
      const pid = process.pid;
      const { stdout } = await execFileAsync('wmic', [
        'process',
        'where',
        `processid=${pid}`,
        'get',
        'WorkingSetSize,PeakWorkingSetSize,PageFileUsage,PeakPageFileUsage,PrivatePageCount',
        '/format:csv'
      ]);

      const lines = stdout.trim().split('\n');
      if (lines.length < 2) {
        return undefined;
      }

      const dataLine = lines[1];
      const parts = dataLine.split(',');
      
      if (parts.length >= 6) {
        return {
          workingSetSize: parseInt(parts[5]) || 0,
          peakWorkingSetSize: parseInt(parts[3]) || 0,
          pagefileUsage: parseInt(parts[1]) || 0,
          peakPagefileUsage: parseInt(parts[2]) || 0,
          privateUsage: parseInt(parts[4]) || 0,
        };
      }
    } catch (err) {
      // Fallback method using tasklist
      try {
        const { stdout } = await execFileAsync('tasklist', [
          '/fi', `pid eq ${process.pid}`,
          '/fo', 'csv'
        ]);
        
        const lines = stdout.trim().split('\n');
        if (lines.length >= 2) {
          const dataLine = lines[1];
          const match = dataLine.match(/"([^"]+)","([^"]+)","([^"]+)","([^"]+)","([^"]+)"/);
          if (match && match[5]) {
            const memUsage = match[5].replace(/[^\d]/g, '');
            return {
              workingSetSize: parseInt(memUsage) * 1024, // Convert KB to bytes
              peakWorkingSetSize: 0,
              pagefileUsage: 0,
              peakPagefileUsage: 0,
              privateUsage: 0,
            };
          }
        }
      } catch (fallbackErr) {
        // Both methods failed
      }
    }
    
    return undefined;
  }

  private logMemorySnapshot(snapshot: MemorySnapshot): void {
    const { nodeMemory, processMemory, heapStats, electronMemory, systemMemory } = snapshot;
    
    // Convert bytes to MB for readability
    const toMB = (bytes: number) => Math.round(bytes / 1024 / 1024 * 100) / 100;
    
    let memInfo = `Memory: RSS=${toMB(nodeMemory.rss)}MB, Heap=${toMB(nodeMemory.heapUsed)}/${toMB(nodeMemory.heapTotal)}MB, External=${toMB(nodeMemory.external)}MB`;
    
    if (systemMemory) {
      memInfo += `, System=${toMB(systemMemory.usedMemory)}/${toMB(systemMemory.totalMemory)}MB (${systemMemory.memoryUsagePercent.toFixed(1)}%)`;
    }
    
    if (electronMemory) {
      memInfo += `, Electron=${toMB(electronMemory.workingSetSize || 0)}MB`;
      if (electronMemory.peakWorkingSetSize) {
        memInfo += `/${toMB(electronMemory.peakWorkingSetSize)}MB(peak)`;
      }
    }
    
    if (processMemory) {
      memInfo += `, WS=${toMB(processMemory.workingSetSize)}MB, Private=${toMB(processMemory.privateUsage)}MB`;
    }
    
    if (heapStats) {
      memInfo += `, V8Heap=${toMB(heapStats.usedHeapSize)}/${toMB(heapStats.totalHeapSize)}MB`;
      memInfo += `, Contexts=${heapStats.numberOfNativeContexts}/${heapStats.numberOfDetachedContexts}(detached)`;
    }
    
    this.logger.info(memInfo);
    
    // Log warning if memory usage is high
    if (systemMemory && systemMemory.memoryUsagePercent > 85) {
      this.logger.warn(`High system memory usage: ${systemMemory.memoryUsagePercent.toFixed(1)}%`);
    }
    
    if (electronMemory && electronMemory.workingSetSize && electronMemory.workingSetSize > 1024 * 1024 * 1024) { // > 1GB
      this.logger.warn(`High Electron memory usage: ${toMB(electronMemory.workingSetSize)}MB`);
    }
  }

  getSnapshots(): MemorySnapshot[] {
    return [...this.snapshots];
  }

  getLatestSnapshot(): MemorySnapshot | undefined {
    return this.snapshots[this.snapshots.length - 1];
  }

  detectMemoryLeaks(): { hasLeak: boolean; trend: number; message: string } {
    if (this.snapshots.length < 10) {
      return { hasLeak: false, trend: 0, message: 'Not enough data points' };
    }

    // Calculate RSS memory trend over recent snapshots
    const recentSnapshots = this.snapshots.slice(-10);
    const rssValues = recentSnapshots.map(s => s.nodeMemory.rss);
    
    // Simple linear regression to detect trend
    const n = rssValues.length;
    const sumX = n * (n - 1) / 2; // 0 + 1 + 2 + ... + (n-1)
    const sumY = rssValues.reduce((a, b) => a + b, 0);
    const sumXY = rssValues.reduce((sum, y, x) => sum + x * y, 0);
    const sumXX = n * (n - 1) * (2 * n - 1) / 6; // 0² + 1² + 2² + ... + (n-1)²
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const avgMemory = sumY / n;
    
    // Normalized slope (MB per snapshot)
    const trendMBPerSnapshot = slope / (1024 * 1024);
    
    const hasLeak = trendMBPerSnapshot > 0.5; // More than 0.5MB growth per snapshot
    
    return {
      hasLeak,
      trend: trendMBPerSnapshot,
      message: hasLeak 
        ? `Potential memory leak detected: ${trendMBPerSnapshot.toFixed(2)}MB growth per measurement`
        : `Memory usage stable: ${trendMBPerSnapshot.toFixed(2)}MB trend per measurement`
    };
  }

  async forceGarbageCollection(): Promise<void> {
    if (global.gc) {
      this.logger.info('Forcing garbage collection');
      global.gc();
      
      // Wait a bit then take a snapshot to see the effect
      setTimeout(() => {
        this.takeSnapshot().catch(err => {
          this.logger.error(`Failed to take post-GC snapshot: ${err.message}`);
        });
      }, 1000);
    } else {
      this.logger.warn('Garbage collection not available (run with --expose-gc)');
    }
  }

  generateReport(): string {
    if (this.snapshots.length === 0) {
      return 'No memory snapshots available';
    }

    const latest = this.getLatestSnapshot()!;
    const first = this.snapshots[0];
    const leakInfo = this.detectMemoryLeaks();
    
    const toMB = (bytes: number) => Math.round(bytes / 1024 / 1024 * 100) / 100;
    
    const report = [
      '=== Memory Tracking Report ===',
      `Tracking Period: ${new Date(first.timestamp).toISOString()} to ${new Date(latest.timestamp).toISOString()}`,
      `Total Snapshots: ${this.snapshots.length}`,
      '',
      '=== Current Memory Usage ===',
      `RSS: ${toMB(latest.nodeMemory.rss)} MB`,
      `Heap Used: ${toMB(latest.nodeMemory.heapUsed)} MB`,
      `Heap Total: ${toMB(latest.nodeMemory.heapTotal)} MB`,
      `External: ${toMB(latest.nodeMemory.external)} MB`,
      `Array Buffers: ${toMB(latest.nodeMemory.arrayBuffers)} MB`,
    ];

    if (latest.systemMemory) {
      report.push(
        '',
        '=== System Memory ===',
        `Total System Memory: ${toMB(latest.systemMemory.totalMemory)} MB`,
        `Free System Memory: ${toMB(latest.systemMemory.freeMemory)} MB`,
        `Used System Memory: ${toMB(latest.systemMemory.usedMemory)} MB`,
        `Memory Usage: ${latest.systemMemory.memoryUsagePercent.toFixed(2)}%`
      );
    }

    if (latest.electronMemory) {
      report.push(
        '',
        '=== Electron Process Memory ===',
        `Working Set: ${toMB(latest.electronMemory.workingSetSize || 0)} MB`,
        `Peak Working Set: ${toMB(latest.electronMemory.peakWorkingSetSize || 0)} MB`,
        `Shared Working Set: ${toMB(latest.electronMemory.sharedWorkingSetSize || 0)} MB`,
        `Private Working Set: ${toMB(latest.electronMemory.privateWorkingSetSize || 0)} MB`
      );
    }

    if (latest.processMemory) {
      report.push(
        '',
        '=== Windows Process Memory ===',
        `Working Set: ${toMB(latest.processMemory.workingSetSize)} MB`,
        `Peak Working Set: ${toMB(latest.processMemory.peakWorkingSetSize)} MB`,
        `Private Usage: ${toMB(latest.processMemory.privateUsage)} MB`,
        `Pagefile Usage: ${toMB(latest.processMemory.pagefileUsage)} MB`
      );
    }

    if (latest.heapStats) {
      report.push(
        '',
        '=== V8 Heap Statistics ===',
        `Used Heap: ${toMB(latest.heapStats.usedHeapSize)} MB`,
        `Total Heap: ${toMB(latest.heapStats.totalHeapSize)} MB`,
        `Heap Limit: ${toMB(latest.heapStats.heapSizeLimit)} MB`,
        `Malloced Memory: ${toMB(latest.heapStats.mallocedMemory)} MB`,
        `Peak Malloced: ${toMB(latest.heapStats.peakMallocedMemory)} MB`,
        `Native Contexts: ${latest.heapStats.numberOfNativeContexts}`,
        `Detached Contexts: ${latest.heapStats.numberOfDetachedContexts}`
      );
    }

    report.push(
      '',
      '=== Memory Growth Analysis ===',
      leakInfo.message,
      '',
      '=== Memory Growth Over Time ===',
      `Initial RSS: ${toMB(first.nodeMemory.rss)} MB`,
      `Current RSS: ${toMB(latest.nodeMemory.rss)} MB`,
      `Net Change: ${toMB(latest.nodeMemory.rss - first.nodeMemory.rss)} MB`,
      `Growth Rate: ${((latest.nodeMemory.rss / first.nodeMemory.rss - 1) * 100).toFixed(2)}%`
    );

    return report.join('\n');
  }
}