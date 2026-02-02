import { useCallback, useRef, useState } from "react";

interface UndoRedoState {
  past: string[];
  present: string;
  future: string[];
}

export function useUndoRedo(initialValue: string, maxHistory = 100) {
  const [state, setState] = useState<UndoRedoState>({
    past: [],
    present: initialValue,
    future: [],
  });

  const lastRecordAtRef = useRef(0);

  const set = useCallback(
    (newValue: string, forceRecord = false) => {
      setState((prev) => {
        if (newValue === prev.present) return prev;

        const now = Date.now();
        const shouldRecord = forceRecord || now - lastRecordAtRef.current > 1000;

        if (!shouldRecord) {
          return { ...prev, present: newValue, future: [] };
        }

        lastRecordAtRef.current = now;
        const nextPast = [...prev.past, prev.present].slice(-maxHistory);
        return {
          past: nextPast,
          present: newValue,
          future: [],
        };
      });
    },
    [maxHistory],
  );

  const undo = useCallback(() => {
    setState((prev) => {
      if (prev.past.length === 0) return prev;
      const newPast = prev.past.slice(0, -1);
      const newPresent = prev.past[prev.past.length - 1];
      return {
        past: newPast,
        present: newPresent,
        future: [prev.present, ...prev.future],
      };
    });
  }, []);

  const redo = useCallback(() => {
    setState((prev) => {
      if (prev.future.length === 0) return prev;
      const newFuture = prev.future.slice(1);
      const newPresent = prev.future[0];
      return {
        past: [...prev.past, prev.present],
        present: newPresent,
        future: newFuture,
      };
    });
  }, []);

  const reset = useCallback((value: string) => {
    setState({
      past: [],
      present: value,
      future: [],
    });
    lastRecordAtRef.current = 0;
  }, []);

  return {
    value: state.present,
    set,
    undo,
    redo,
    reset,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
  };
}
