import { useCallback, useEffect, useRef, useState } from 'react';

/*
 * Opening splash: the Azim Archive glow animation (3 s) plays full-screen over the app, then fades away.
 * - Large high-resolution screens get the 4K file; everything else gets the light 1080p copy.
 * - Tries to play with sound; browsers that block that get a muted video and a "Sound on" button.
 * - Skip button, Esc / Enter / Space to skip.
 * - If the video can't load or play (offline, power saving, blocked), it gets out of the way quickly.
 * - With reduced motion turned on, it shows the logo as a still instead.
 */

declare global {
  interface Window {
    __SPLASH_SRC__?: string;
    __SPLASH_POSTER__?: string;
    __SPLASH_STILL__?: string;
  }
}

function pickSource(): string {
  if (window.__SPLASH_SRC__) return window.__SPLASH_SRC__;
  const physicalWidth = Math.max(window.screen.width, window.screen.height) * (window.devicePixelRatio || 1);
  return physicalWidth > 2400 ? '/splash-4k.mp4' : '/splash.mp4';
}

const POSTER = window.__SPLASH_POSTER__ ?? '/splash-poster.jpg';
const STILL = window.__SPLASH_STILL__ ?? '/splash-end.jpg';
const FADE_MS = 600;

export default function Splash({ onDone }: { onDone: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const finished = useRef(false);
  const [src] = useState(pickSource);
  const [leaving, setLeaving] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const [mutedFallback, setMutedFallback] = useState(false);
  const [reduced] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);

  const finish = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    setLeaving(true);
    window.setTimeout(onDone, FADE_MS);
  }, [onDone]);

  // lock page scroll while the splash is up
  useEffect(() => {
    const html = document.documentElement;
    const prev = html.style.overflow;
    html.style.overflow = 'hidden';
    return () => {
      html.style.overflow = prev;
    };
  }, []);

  // keyboard: skip keys, and keep keystrokes from reaching the calculator underneath
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        finish();
      }
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [finish]);

  useEffect(() => {
    const timers: number[] = [];
    timers.push(window.setTimeout(() => setShowControls(true), 500));
    if (reduced) {
      timers.push(window.setTimeout(finish, 1500));
      return () => timers.forEach(clearTimeout);
    }
    const el = video.current;
    if (!el) return;
    el.muted = false;
    el.play()
      .catch(() => {
        // autoplay with sound was blocked: play muted instead
        el.muted = true;
        setMutedFallback(true);
        return el.play();
      })
      .catch(() => finish());
    // if playback never really starts, don't hold the app hostage
    timers.push(
      window.setTimeout(() => {
        if (!el.currentTime) finish();
      }, 3500),
    );
    // hard cap a little past the video's own 3 s length
    timers.push(window.setTimeout(finish, 8000));
    return () => {
      timers.forEach(clearTimeout);
      el.pause();
    };
  }, [finish, reduced]);

  return (
    <div className={`splash ${leaving ? 'is-leaving' : ''}`} style={{ transitionDuration: `${FADE_MS}ms` }} role="dialog" aria-label="Opening animation">
      {reduced ? (
        <img className="splash-media" src={STILL} alt="Azim Archive" />
      ) : (
        <video
          ref={video}
          className="splash-media"
          src={src}
          poster={POSTER}
          playsInline
          preload="auto"
          onEnded={finish}
          onError={finish}
          aria-label="Azim Archive opening animation"
        />
      )}

      <div className={`splash-controls ${showControls && !leaving ? 'is-visible' : ''}`}>
        {mutedFallback && !reduced && (
          <button
            type="button"
            className="splash-btn"
            onClick={() => {
              const el = video.current;
              if (!el) return;
              // the clip is short: replay it from the start with sound
              el.muted = false;
              el.currentTime = 0;
              void el.play();
              setMutedFallback(false);
            }}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" fill="currentColor" stroke="none" />
              <path d="M16 9a4.2 4.2 0 0 1 0 6M18.6 6.6a7.6 7.6 0 0 1 0 10.8" />
            </svg>
            Sound on
          </button>
        )}
        <button type="button" className="splash-btn" onClick={finish}>
          Skip
          <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 6l7 6-7 6M15 6v12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
