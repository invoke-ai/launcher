import type { BrowserWindow, IpcMainEvent, MouseInputEvent } from 'electron';
import { ipcMain, screen } from 'electron';

import type { SimpleLogger } from '@/lib/simple-logger';

type NativeAttachResult = {
  attached: boolean;
  contactActive: boolean;
  pressureMin: number;
  pressureMax: number;
  lastError: string;
};

type NativePenEvent = {
  kind: 'down' | 'move' | 'up';
  screenX: number;
  screenY: number;
  pressure: number;
  buttons: number;
};

type NativeAddon = {
  isSupported: () => boolean;
  attach: (hwndBuffer: Buffer) => NativeAttachResult;
  detach: () => void;
  drainEvents: () => NativePenEvent[];
  getStatus: () => NativeAttachResult;
};

type BridgedPenEvent = NativePenEvent & {
  clientX: number;
  clientY: number;
};

const IPC_STATUS_CHANNEL = 'invoke-window:wintab-status';
const IPC_EVENT_CHANNEL = 'invoke-window:wintab-pen-event';
const IPC_ACK_CHANNEL = 'invoke-window:wintab-pen-event-ack';
const SUPPRESS_PRIMARY_MOUSE_GRACE_MS = 200;
const EVENT_POLL_INTERVAL_MS = 8;

export class InvokeWindowWinTabBridge {
  private readonly window: BrowserWindow;
  private readonly log: SimpleLogger;
  private addon: NativeAddon | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private attached = false;
  private penContactActive = false;
  private suppressPrimaryMouseUntil = 0;
  private lastPenActivityAt = 0;
  private batchInFlight = false;
  private ackListenerInstalled = false;

  constructor(window: BrowserWindow, log: SimpleLogger) {
    this.window = window;
    this.log = log;
  }

  attach = (): void => {
    if (this.attached || this.pollTimer || this.ackListenerInstalled) {
      this.detach();
    }

    if (process.platform !== 'win32') {
      this.sendStatus(false, 'WinTab bridge is only available on Windows');
      return;
    }

    const addon = this.loadAddon();
    if (!addon) {
      this.sendStatus(false, 'Failed to load WinTab bridge native addon');
      return;
    }

    if (!addon.isSupported()) {
      const status = addon.getStatus();
      this.sendStatus(false, status.lastError || 'WinTab is not supported by the current driver');
      return;
    }

    const result = addon.attach(this.window.getNativeWindowHandle());
    if (!result.attached) {
      this.sendStatus(false, result.lastError || 'Failed to attach WinTab bridge');
      return;
    }

    this.addon = addon;
    this.attached = true;
    this.penContactActive = result.contactActive;
    this.lastPenActivityAt = Date.now();
    this.batchInFlight = false;
    ipcMain.on(IPC_ACK_CHANNEL, this.handleBatchAck);
    this.ackListenerInstalled = true;
    this.sendStatus(true, 'WinTab attached');

    this.pollTimer = setInterval(this.drainAndForwardEvents, EVENT_POLL_INTERVAL_MS);
  };

  detach = (): void => {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    if (this.addon && this.attached) {
      this.addon.detach();
    }

    if (this.ackListenerInstalled) {
      ipcMain.removeListener(IPC_ACK_CHANNEL, this.handleBatchAck);
      this.ackListenerInstalled = false;
    }

    this.attached = false;
    this.addon = null;
    this.penContactActive = false;
    this.suppressPrimaryMouseUntil = 0;
    this.lastPenActivityAt = 0;
    this.batchInFlight = false;
  };

  shouldSuppressPrimaryMouse = (mouse: MouseInputEvent): boolean => {
    if (!this.attached || !this.addon) {
      return false;
    }

    if (mouse.button && mouse.button !== 'left') {
      return false;
    }

    if (mouse.type === 'contextMenu' || mouse.type === 'mouseWheel') {
      return false;
    }

    const status = this.addon.getStatus();
    const now = Date.now();

    if (status.contactActive) {
      this.penContactActive = true;
      this.lastPenActivityAt = now;
    }

    if (!this.penContactActive && now > this.suppressPrimaryMouseUntil) {
      return false;
    }

    if (
      !status.contactActive &&
      now > this.suppressPrimaryMouseUntil &&
      now - this.lastPenActivityAt > SUPPRESS_PRIMARY_MOUSE_GRACE_MS
    ) {
      this.penContactActive = false;
      return false;
    }

    return true;
  };

  private loadAddon = (): NativeAddon | null => {
    if (this.addon) {
      return this.addon;
    }

    try {
      const addon = require('wintab-pen-bridge') as NativeAddon;
      this.addon = addon;
      return addon;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log.warn(`Failed to require wintab-pen-bridge: ${message}\r\n`);
      return null;
    }
  };

  private sendStatus = (enabled: boolean, message: string): void => {
    if (this.window.isDestroyed()) {
      return;
    }
    this.window.webContents.send(IPC_STATUS_CHANNEL, { enabled, message });
  };

  private handleBatchAck = (event: IpcMainEvent): void => {
    if (event.sender !== this.window.webContents) {
      return;
    }

    this.batchInFlight = false;
  };

  private drainAndForwardEvents = (): void => {
    if (!this.window || this.window.isDestroyed() || !this.addon || this.batchInFlight) {
      return;
    }

    const events = this.addon.drainEvents();
    if (events.length === 0) {
      return;
    }

    const now = Date.now();
    const contentBounds = this.window.getContentBounds();
    const bridgedEvents: BridgedPenEvent[] = [];
    for (const event of events) {
      this.lastPenActivityAt = now;
      if (event.kind === 'down') {
        this.penContactActive = true;
      } else if (event.kind === 'up') {
        this.penContactActive = false;
        this.suppressPrimaryMouseUntil = now + SUPPRESS_PRIMARY_MOUSE_GRACE_MS;
      }

      const dipPoint = screen.screenToDipPoint({ x: event.screenX, y: event.screenY });
      const clientX = dipPoint.x - contentBounds.x;
      const clientY = dipPoint.y - contentBounds.y;

      if (
        event.kind !== 'up' &&
        (clientX < 0 || clientY < 0 || clientX > contentBounds.width || clientY > contentBounds.height)
      ) {
        continue;
      }

      bridgedEvents.push({
        ...event,
        screenX: dipPoint.x,
        screenY: dipPoint.y,
        clientX,
        clientY,
      });
    }

    if (bridgedEvents.length > 0) {
      this.batchInFlight = true;
      this.window.webContents.send(IPC_EVENT_CHANNEL, bridgedEvents);
    }
  };
}
