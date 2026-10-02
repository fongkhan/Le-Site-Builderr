import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createAutosave,
  INITIAL_AUTOSAVE_STATE,
  type AutosaveController,
  type AutosaveErrorInfo,
  type AutosaveState,
} from './autosaveController';

export interface UseAutosaveOptions {
  /** Appelé à chaque échec (toast…) ; info.permanent indique l'arrêt des essais */
  onError?: (err: unknown, info: AutosaveErrorInfo) => void;
  debounceMs?: number;
}

export interface Autosave<T> {
  state: AutosaveState;
  schedule: (data: T) => void;
  saveNow: (data: T) => void;
  retry: () => void;
}

// Sauvegarde automatique liée au cycle de vie du composant : la machine d'état
// (autosaveController) est créée au montage et vidée au démontage (dernier envoi de ce
// qui attend). Les callbacks renvoyés sont stables.
export function useAutosave<T>(save: (data: T) => Promise<unknown>, options: UseAutosaveOptions = {}): Autosave<T> {
  const { onError, debounceMs } = options;
  const [state, setState] = useState<AutosaveState>(INITIAL_AUTOSAVE_STATE);
  const controllerRef = useRef<AutosaveController<T> | null>(null);
  // Dernières versions des callbacks, lues au moment de l'appel (jamais de fermeture périmée)
  const saveRef = useRef(save);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    saveRef.current = save;
    onErrorRef.current = onError;
  });

  useEffect(() => {
    const controller = createAutosave<T>({
      save: (data) => saveRef.current(data),
      debounceMs,
      onStateChange: setState,
      onError: (err, info) => onErrorRef.current?.(err, info),
    });
    controllerRef.current = controller;
    return () => {
      controller.dispose();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [debounceMs]);

  const schedule = useCallback((data: T) => controllerRef.current?.schedule(data), []);
  const saveNow = useCallback((data: T) => controllerRef.current?.saveNow(data), []);
  const retry = useCallback(() => controllerRef.current?.retry(), []);

  return { state, schedule, saveNow, retry };
}
