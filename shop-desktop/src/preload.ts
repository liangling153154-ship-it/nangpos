import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopConfig } from './config-store';
import type { ActivityLogEntry, ConnectionState } from './agent-client';

export interface AlarmEvent {
  kind: 'new_order' | 'transfer_alert';
  orderCode: string;
  title: string;
  body: string;
  durationSec: number;
}

contextBridge.exposeInMainWorld('nangDesktop', {
  getInitialState: () =>
    ipcRenderer.invoke('desktop:get-initial') as Promise<{
      config: DesktopConfig;
      connectionState: ConnectionState;
      logs: ActivityLogEntry[];
      printers: { name: string; displayName: string; isDefault: boolean }[];
      audioUrls: { newOrder10s: string; transfer10s: string };
    }>,
  listPrinters: () =>
    ipcRenderer.invoke('desktop:list-printers') as Promise<
      { name: string; displayName: string; isDefault: boolean }[]
    >,
  saveConfig: (patch: Partial<DesktopConfig>) =>
    ipcRenderer.invoke('desktop:save-config', patch) as Promise<DesktopConfig>,
  testPrint: () =>
    ipcRenderer.invoke('desktop:test-print') as Promise<{ ok: boolean; error?: string; outputPath?: string }>,
  testAlarm: () => ipcRenderer.invoke('desktop:test-alarm') as Promise<void>,
  openMockFolder: () => ipcRenderer.invoke('desktop:open-mock-folder') as Promise<void>,
  onConnectionState: (cb: (state: ConnectionState) => void) => {
    const handler = (_ev: unknown, state: ConnectionState) => cb(state);
    ipcRenderer.on('desktop:state', handler);
    return () => ipcRenderer.removeListener('desktop:state', handler);
  },
  onLog: (cb: (entry: ActivityLogEntry) => void) => {
    const handler = (_ev: unknown, entry: ActivityLogEntry) => cb(entry);
    ipcRenderer.on('desktop:log', handler);
    return () => ipcRenderer.removeListener('desktop:log', handler);
  },
  onAlarm: (cb: (alarm: AlarmEvent) => void) => {
    const handler = (_ev: unknown, alarm: AlarmEvent) => cb(alarm);
    ipcRenderer.on('desktop:alarm', handler);
    return () => ipcRenderer.removeListener('desktop:alarm', handler);
  },
  onStopAlarm: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on('desktop:stop-alarm', handler);
    return () => ipcRenderer.removeListener('desktop:stop-alarm', handler);
  },
  onOpenSettings: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on('desktop:open-settings', handler);
    return () => ipcRenderer.removeListener('desktop:open-settings', handler);
  },
});
