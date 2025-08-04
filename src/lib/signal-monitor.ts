import { writeFileSync } from 'fs';
import { join } from 'path';
import { app } from 'electron';
import type { SimpleLogger } from './simple-logger';
import type { MemoryTracker } from './memory-tracker';

export interface SignalEvent {
  signal: NodeJS.Signals;
  timestamp: number;
  pid: number;
  memorySnapshot?: any;
  stackTrace?: string;
}

export class SignalMonitor {
  private logger: SimpleLogger;
  private memoryTracker?: MemoryTracker;
  private signalHandlers: Map<NodeJS.Signals, (() => void)[]> = new Map();
  private signalEvents: SignalEvent[] = [];
  private isMonitoring = false;

  constructor(options: {
    logger: SimpleLogger;
    memoryTracker?: MemoryTracker;
  }) {
    this.logger = options.logger;
    this.memoryTracker = options.memoryTracker;
  }

  start(): void {
    if (this.isMonitoring) {
      this.logger.warn('Signal monitoring already started');
      return;
    }

    this.isMonitoring = true;
    this.logger.info('Starting signal monitoring');

    // Monitor common termination signals
    const signalsToMonitor: NodeJS.Signals[] = ['SIGTERM', 'SIGINT', 'SIGQUIT', 'SIGHUP'];
    
    // On Windows, only SIGINT and SIGTERM are supported
    const availableSignals = process.platform === 'win32' 
      ? ['SIGTERM', 'SIGINT'] as NodeJS.Signals[]
      : signalsToMonitor;

    for (const signal of availableSignals) {
      this.monitorSignal(signal);
    }

    // Monitor uncaught exceptions and unhandled rejections
    process.on('uncaughtException', this.handleUncaughtException);
    process.on('unhandledRejection', this.handleUnhandledRejection);

    // Windows-specific monitoring for process termination
    if (process.platform === 'win32') {
      this.setupWindowsProcessMonitoring();
    }
  }

  stop(): void {
    if (!this.isMonitoring) {
      return;
    }

    this.isMonitoring = false;
    this.logger.info('Stopping signal monitoring');

    // Remove all signal handlers
    for (const [signal, handlers] of this.signalHandlers) {
      for (const handler of handlers) {
        process.removeListener(signal, handler);
      }
    }
    this.signalHandlers.clear();

    // Remove exception handlers
    process.removeListener('uncaughtException', this.handleUncaughtException);
    process.removeListener('unhandledRejection', this.handleUnhandledRejection);
  }

  private monitorSignal(signal: NodeJS.Signals): void {
    const handler = () => {
      this.handleSignal(signal);
    };

    // Store handler reference for cleanup
    if (!this.signalHandlers.has(signal)) {
      this.signalHandlers.set(signal, []);
    }
    this.signalHandlers.get(signal)!.push(handler);

    process.on(signal, handler);
    this.logger.debug(`Monitoring signal: ${signal}`);
  }

  private async handleSignal(signal: NodeJS.Signals): Promise<void> {
    const timestamp = Date.now();
    const stackTrace = new Error().stack;

    this.logger.warn(`Received signal: ${signal} at ${new Date(timestamp).toISOString()}`);

    let memorySnapshot;
    if (this.memoryTracker) {
      try {
        memorySnapshot = await this.memoryTracker.takeSnapshot();
        this.logger.info('Captured memory snapshot on signal');
      } catch (err) {
        this.logger.error(`Failed to capture memory snapshot: ${err.message}`);
      }
    }

    const signalEvent: SignalEvent = {
      signal,
      timestamp,
      pid: process.pid,
      memorySnapshot,
      stackTrace,
    };

    this.signalEvents.push(signalEvent);
    
    // Log detailed signal information
    this.logSignalEvent(signalEvent);
    
    // Save emergency crash dump
    this.saveEmergencyDump(signalEvent);

    // If this is a termination signal, perform cleanup
    if (['SIGTERM', 'SIGINT', 'SIGQUIT'].includes(signal)) {
      this.logger.warn(`Performing emergency cleanup for signal: ${signal}`);
      this.performEmergencyCleanup();
    }
  }

  private handleUncaughtException = (error: Error): void => {
    this.logger.error(`Uncaught exception: ${error.message}`);
    this.logger.error(`Stack trace: ${error.stack}`);
    
    const signalEvent: SignalEvent = {
      signal: 'SIGTERM', // Treat as termination event
      timestamp: Date.now(),
      pid: process.pid,
      stackTrace: error.stack,
    };

    this.signalEvents.push(signalEvent);
    this.saveEmergencyDump(signalEvent);
    
    // Don't exit here - let the default handler manage it
  };

  private handleUnhandledRejection = (reason: any, promise: Promise<any>): void => {
    this.logger.error(`Unhandled promise rejection: ${reason}`);
    this.logger.error(`Promise: ${promise}`);
    
    const signalEvent: SignalEvent = {
      signal: 'SIGTERM', // Treat as termination event
      timestamp: Date.now(),
      pid: process.pid,
      stackTrace: reason instanceof Error ? reason.stack : String(reason),
    };

    this.signalEvents.push(signalEvent);
    this.saveEmergencyDump(signalEvent);
  };

  private setupWindowsProcessMonitoring(): void {
    // Monitor Windows-specific process events
    process.on('exit', (code) => {
      this.logger.warn(`Process exiting with code: ${code}`);
      
      const signalEvent: SignalEvent = {
        signal: 'SIGTERM',
        timestamp: Date.now(),
        pid: process.pid,
        stackTrace: `Process exit with code: ${code}`,
      };
      
      this.signalEvents.push(signalEvent);
      this.saveEmergencyDump(signalEvent);
    });

    // Monitor for Windows console close events
    if (process.platform === 'win32') {
      // This requires additional setup for Windows console handlers
      // For now, we rely on the SIGTERM/SIGINT handlers
      this.logger.debug('Windows process monitoring configured');
    }
  }

  private logSignalEvent(event: SignalEvent): void {
    const lines = [
      `=== SIGNAL EVENT: ${event.signal} ===`,
      `Timestamp: ${new Date(event.timestamp).toISOString()}`,
      `PID: ${event.pid}`,
    ];

    if (event.memorySnapshot) {
      const snapshot = event.memorySnapshot;
      const toMB = (bytes: number) => Math.round(bytes / 1024 / 1024 * 100) / 100;
      
      lines.push(
        `Memory at signal:`,
        `  RSS: ${toMB(snapshot.nodeMemory.rss)} MB`,
        `  Heap Used: ${toMB(snapshot.nodeMemory.heapUsed)} MB`,
        `  Heap Total: ${toMB(snapshot.nodeMemory.heapTotal)} MB`,
        `  External: ${toMB(snapshot.nodeMemory.external)} MB`
      );

      if (snapshot.processMemory) {
        lines.push(
          `  Working Set: ${toMB(snapshot.processMemory.workingSetSize)} MB`,
          `  Private Usage: ${toMB(snapshot.processMemory.privateUsage)} MB`
        );
      }
    }

    if (event.stackTrace) {
      lines.push(`Stack trace:`, event.stackTrace);
    }

    lines.push('=== END SIGNAL EVENT ===');
    
    for (const line of lines) {
      this.logger.error(line);
    }
  }

  private saveEmergencyDump(event: SignalEvent): void {
    try {
      const userDataPath = app.getPath('userData');
      const dumpFile = join(userDataPath, `crash-dump-${event.timestamp}.json`);
      
      const dumpData = {
        signal: event.signal,
        timestamp: event.timestamp,
        iso_timestamp: new Date(event.timestamp).toISOString(),
        pid: event.pid,
        platform: process.platform,
        arch: process.arch,
        node_version: process.version,
        electron_version: process.versions.electron,
        chrome_version: process.versions.chrome,
        memory_snapshot: event.memorySnapshot,
        stack_trace: event.stackTrace,
        environment: {
          NODE_ENV: process.env.NODE_ENV,
          ELECTRON_ENV: process.env.ELECTRON_ENV,
        },
        all_signal_events: this.signalEvents,
      };

      // Generate memory report if tracker is available
      if (this.memoryTracker) {
        try {
          dumpData.memory_report = this.memoryTracker.generateReport();
          const leakInfo = this.memoryTracker.detectMemoryLeaks();
          dumpData.memory_analysis = leakInfo;
        } catch (err) {
          this.logger.error(`Failed to generate memory report: ${err.message}`);
        }
      }

      writeFileSync(dumpFile, JSON.stringify(dumpData, null, 2));
      this.logger.error(`Emergency crash dump saved to: ${dumpFile}`);
    } catch (err) {
      this.logger.error(`Failed to save emergency dump: ${err.message}`);
    }
  }

  private performEmergencyCleanup(): void {
    try {
      // Stop memory tracking
      if (this.memoryTracker) {
        this.memoryTracker.stop();
      }

      // Generate final memory report
      if (this.memoryTracker) {
        const report = this.memoryTracker.generateReport();
        this.logger.error('=== FINAL MEMORY REPORT ===');
        for (const line of report.split('\n')) {
          this.logger.error(line);
        }
        this.logger.error('=== END FINAL MEMORY REPORT ===');
      }

      this.logger.error('Emergency cleanup completed');
    } catch (err) {
      this.logger.error(`Error during emergency cleanup: ${err.message}`);
    }
  }

  getSignalEvents(): SignalEvent[] {
    return [...this.signalEvents];
  }

  getLatestSignalEvent(): SignalEvent | undefined {
    return this.signalEvents[this.signalEvents.length - 1];
  }

  // Method to manually trigger a memory dump (useful for testing)
  async triggerMemoryDump(): Promise<void> {
    this.logger.info('Manually triggering memory dump');
    
    let memorySnapshot;
    if (this.memoryTracker) {
      try {
        memorySnapshot = await this.memoryTracker.takeSnapshot();
      } catch (err) {
        this.logger.error(`Failed to capture memory snapshot: ${err.message}`);
      }
    }

    const dumpEvent: SignalEvent = {
      signal: 'SIGUSR1', // Use SIGUSR1 to indicate manual dump
      timestamp: Date.now(),
      pid: process.pid,
      memorySnapshot,
      stackTrace: new Error('Manual memory dump').stack,
    };

    this.signalEvents.push(dumpEvent);
    this.saveEmergencyDump(dumpEvent);
    this.logSignalEvent(dumpEvent);
  }
}