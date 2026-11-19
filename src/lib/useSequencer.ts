import { useCallback, useEffect, useRef, useState } from 'react';
import type { Frame, CalloutSpec } from '../types';
import { sfx } from './audio';

export interface ActiveCallout extends CalloutSpec {
  step: number;
  total: number;
}

/**
 * Plays a list of machine-state frames with timing scaled by the speed factor.
 * Every machine shares this engine: the machine renders `state`, and CSS
 * transitions (driven by `transitionMs`) make movement between frames smooth.
 */
export function useSequencer<S>(initial: S, speed: number) {
  const [state, setState] = useState<S>(initial);
  const [transitionMs, setTransitionMs] = useState(180);
  const [callout, setCallout] = useState<ActiveCallout | null>(null);
  const [playing, setPlaying] = useState(false);
  const runRef = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const speedRef = useRef(speed);
  speedRef.current = speed;

  const stop = useCallback(() => {
    runRef.current++;
    window.clearTimeout(timer.current);
    setPlaying(false);
  }, []);

  useEffect(() => stop, [stop]);

  const play = useCallback(
    (frames: Frame<S>[], onStep: (i: number, total: number) => void, onDone: () => void) => {
      stop();
      const id = runRef.current;
      setPlaying(true);
      let i = 0;
      const total = frames.length;
      const next = () => {
        if (id !== runRef.current) return;
        if (i >= total) {
          setPlaying(false);
          setCallout(null);
          onDone();
          return;
        }
        const f = frames[i++];
        const sp = speedRef.current;
        const t = f.t ?? Math.min(f.dur * 0.8, 650);
        setTransitionMs(t * sp);
        setState(f.state);
        setCallout(f.callout ? { ...f.callout, step: i, total } : null);
        sfx.play(f.sound, sp);
        onStep(i, total);
        timer.current = window.setTimeout(next, f.dur * sp);
      };
      next();
    },
    [stop],
  );

  /** Immediate state change from direct manipulation by the user. */
  const setManual = useCallback((s: S | ((prev: S) => S), t = 160) => {
    setTransitionMs(t);
    setState(s);
  }, []);

  return { state, transitionMs, callout, setCallout, playing, play, stop, setManual };
}
