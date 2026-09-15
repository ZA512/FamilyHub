import { useState } from 'react';

export type DeviceViewMode = 'list' | 'cards';

const VIEW_MODE_STORAGE_PREFIX = 'familyhub:view-mode:v1';

function viewModeStorageKey(memberId: string, moduleId: string) {
  return `${VIEW_MODE_STORAGE_PREFIX}:${memberId}:${moduleId}`;
}

function deviceStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readDeviceViewMode(
  storage: Pick<Storage, 'getItem'> | null,
  memberId: string,
  moduleId: string,
  defaultMode: DeviceViewMode,
): DeviceViewMode {
  try {
    const stored = storage?.getItem(viewModeStorageKey(memberId, moduleId));
    return stored === 'list' || stored === 'cards' ? stored : defaultMode;
  } catch {
    return defaultMode;
  }
}

export function writeDeviceViewMode(
  storage: Pick<Storage, 'setItem'> | null,
  memberId: string,
  moduleId: string,
  mode: DeviceViewMode,
) {
  try {
    storage?.setItem(viewModeStorageKey(memberId, moduleId), mode);
  } catch {
    // The view still changes for this session if local storage is unavailable.
  }
}

export function useDeviceViewMode(
  memberId: string,
  moduleId: string,
  defaultMode: DeviceViewMode,
): [DeviceViewMode, (mode: DeviceViewMode) => void] {
  const [mode, setMode] = useState<DeviceViewMode>(() =>
    readDeviceViewMode(deviceStorage(), memberId, moduleId, defaultMode),
  );

  function changeMode(nextMode: DeviceViewMode) {
    setMode(nextMode);
    writeDeviceViewMode(deviceStorage(), memberId, moduleId, nextMode);
  }

  return [mode, changeMode];
}
