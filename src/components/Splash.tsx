import { useCallback, useEffect, useRef, useState } from 'react';

/*
 * Opening splash: the Azim Archive logo animation (4 s) plays full-screen over the app, then fades away.
 * - Large high-resolution screens get the 4K file; everything else gets the light 1080p copy.
 * - Tries to play with sound; browsers that block that play it muted.
 * - Esc / Enter / Space end it early.
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
  return physicalWidth > 2400 ? '/splash-logo-4k.mp4' : '/splash-logo.mp4';
}

const POSTER = window.__SPLASH_POSTER__ ?? '/splash-poster.jpg';
const STILL = window.__SPLASH_STILL__ ?? '/splash-end.jpg';
const FADE_MS = 600;

export default function Splash({ onDone }: { onDone: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const finished = useRef(false);
  const [src] = useState(pickSource);
  const [leaving, setLeaving] = useState(false);
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
        return el.play();
      })
      .catch(() => finish());
    // if playback never really starts, don't hold the app hostage
    timers.push(
      window.setTimeout(() => {
        if (!el.currentTime) finish();
      }, 3500),
    );
    // hard cap a little past the video's own 4 s length
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

    </div>
  );
}
