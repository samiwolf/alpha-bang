import {
  Component,
  computed,
  effect,
  signal,
  WritableSignal,
} from '@angular/core';
import { MatToolbar } from '@angular/material/toolbar';
import { MatButtonToggleGroup, MatButtonToggle } from '@angular/material/button-toggle';
import { MatCard, MatCardContent } from '@angular/material/card';
import { MatIconButton } from '@angular/material/button';
import { MatMenu, MatMenuTrigger } from '@angular/material/menu';
import { MatSlider, MatSliderThumb } from '@angular/material/slider';
import { MatSlideToggle } from '@angular/material/slide-toggle';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatDivider } from '@angular/material/divider';

type Category = 'english' | 'swaraborno' | 'benjonborno' | 'banglaDigits' | 'digits';

interface Tile {
  char: string;
  color: string;
  combining: boolean;
  src: string;
}

interface TileView extends Tile {
  /** True while the tile's audio is still preloading. */
  loading: boolean;
}

const LETTERS: Record<Category, string[]> = {
  english: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''),
  swaraborno: ['অ', 'আ', 'ই', 'ঈ', 'উ', 'ঊ', 'ঋ', 'এ', 'ঐ', 'ও', 'ঔ'],
  benjonborno: [
    'ক', 'খ', 'গ', 'ঘ', 'ঙ',
    'চ', 'ছ', 'জ', 'ঝ', 'ঞ',
    'ট', 'ঠ', 'ড', 'ঢ', 'ণ',
    'ত', 'থ', 'দ', 'ধ', 'ন',
    'প', 'ফ', 'ব', 'ভ', 'ম',
    'য', 'র', 'ল', 'শ', 'ষ',
    'স', 'হ', 'ড়', 'ঢ়', 'য়',
    'ৎ', 'ং', 'ঃ', 'ঁ',
  ],
  banglaDigits: ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'],
  digits: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'],
};

const COMBINING = new Set(['ং', 'ঃ', 'ঁ']);

const TILE_COLORS = ['#c62828', '#1565c0', '#2e7d32', '#6a1b9a', '#ef6c00', '#00838f'];

const STORAGE_PREFIX = 'alphabang.';

/** Returns the OS dark-mode preference, defaulting to light when unavailable. */
function prefersDarkColorScheme(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

/**
 * Creates a signal whose value is initialized from `localStorage` (if present)
 * and persisted back to `localStorage` whenever it changes. Falls back to the
 * provided default when storage is unavailable or empty.
 */
function persistedSignal<T>(
  key: string,
  fallback: T,
  parse: (value: unknown) => T,
): WritableSignal<T> {
  let initial = fallback;
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    if (raw !== null) initial = parse(JSON.parse(raw));
  } catch {
    // localStorage unavailable or corrupted; use fallback.
  }
  const sig = signal<T>(initial);
  effect(() => {
    try {
      localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(sig()));
    } catch {
      // Ignore write failures (e.g. private mode quota).
    }
  });
  return sig;
}

@Component({
  imports: [
    MatToolbar,
    MatButtonToggleGroup,
    MatButtonToggle,
    MatCard,
    MatCardContent,
    MatIconButton,
    MatMenu,
    MatMenuTrigger,
    MatSlider,
    MatSliderThumb,
    MatSlideToggle,
    MatProgressSpinner,
    MatDivider,
  ],
  selector: 'app-root',
  styleUrl: './app.css',
  templateUrl: './app.html',
  host: {
    '(document:gesturestart)': 'onGesture($event)',
    '(document:gesturechange)': 'onGesture($event)',
    '(document:gestureend)': 'onGesture($event)',
    '(document:keydown)': 'onKeydown($event)',
    '(document:visibilitychange)': 'onVisibilityChange()',
  },
})
export class App {
  protected readonly selected = persistedSignal<Category>(
    'selected',
    'english',
    (v) => (typeof v === 'string' && v in LETTERS ? (v as Category) : 'english'),
  );
  protected readonly tiles = computed<Tile[]>(() => {
    const cat = this.selected();
    return LETTERS[cat].map((char, i) => ({
      char,
      color: TILE_COLORS[i % TILE_COLORS.length],
      combining: COMBINING.has(char),
      src: `audio/${cat}-${i}.m4a`,
    }));
  });

  /** Tiles plus per-tile loading state for the template. */
  protected readonly tileViews = computed<TileView[]>(() => {
    const loaded = this.loaded();
    return this.tiles().map((tile) => ({
      ...tile,
      loading: !loaded.has(tile.src),
    }));
  });

  protected readonly squareSize = persistedSignal('squareSize', 150, Number);
  protected readonly darkMode = persistedSignal(
    'darkMode',
    prefersDarkColorScheme(),
    Boolean,
  );

  protected readonly squareSizePx = computed(() => `${this.squareSize()}px`);
  protected readonly fontSizePx = computed(() => `${this.squareSize() * 0.8}px`);
  protected readonly gridTemplate = computed(
    () => `repeat(auto-fill, ${this.squareSize()}px)`,
  );


  protected readonly tapSlopPx = computed(() => (this.squareSize() * 4) / 5);

  protected readonly popping = signal<string | null>(null);
  private popTimer: ReturnType<typeof setTimeout> | null = null;


  private tapStart: { x: number; y: number } | null = null;
  
  private ignoreClick = false;

  protected readonly playingChar = signal<string | null>(null);

  /** Audio sources that have finished preloading for the current page. */
  protected readonly loaded = signal<ReadonlySet<string>>(new Set());
  protected readonly total = computed(() => this.tiles().length);
  protected readonly loadedCount = computed(() => {
    const set = this.loaded();
    return this.tiles().filter((t) => set.has(t.src)).length;
  });
  protected readonly loading = computed(() => this.loadedCount() < this.total());
  protected readonly progressPercent = computed(() =>
    this.total() === 0 ? 0 : (this.loadedCount() / this.total()) * 100,
  );

  private audioCache = new Map<string, HTMLAudioElement>();
  private currentAudio: HTMLAudioElement | null = null;
  private playbackId = 0;

  constructor() {
    effect(() => {
      document.body.style.colorScheme = this.darkMode() ? 'dark' : 'light';
    });
    // Preload the active category's audio so the first tap plays instantly.
    effect(() => {
      for (const tile of this.tiles()) this.audioFor(tile.src);
    });
    // Stop playback when the category changes so the new grid isn't stuck
    // blurred waiting for a sound from the previous one.
    effect(() => {
      this.selected();
      this.stopPlayback();
    });
    // Block ctrl+scroll / trackpad-pinch zoom. Registered manually because
    // Chrome treats document-level wheel listeners as passive by default,
    // which would make preventDefault() a no-op.
    document.addEventListener(
      'wheel',
      (event) => {
        if (event.ctrlKey) event.preventDefault();
      },
      { passive: false },
    );
  }

  /** Blocks pinch-zoom gestures (iOS Safari ignores user-scalable=no). */
  protected onGesture(event: Event): void {
    event.preventDefault();
  }

  /** Blocks ctrl +/-/0 browser zoom shortcuts. */
  protected onKeydown(event: KeyboardEvent): void {
    if (event.ctrlKey && ['+', '-', '=', '0'].includes(event.key)) {
      event.preventDefault();
    }
  }

  protected onVisibilityChange(): void {
    if (document.hidden) this.stopPlayback();
  }

  protected onTileTouchStart(event: TouchEvent): void {
    // Only a single-finger touch can be a tap; anything else is a zoom gesture.
    this.tapStart =
      event.touches.length === 1
        ? { x: event.touches[0].clientX, y: event.touches[0].clientY }
        : null;
  }

  protected onTileTouchEnd(event: TouchEvent, src: string, char: string): void {
    const start = this.tapStart;
    this.tapStart = null;
    // Wait for every finger to lift so a pinch never plays a tile.
    if (!start || event.touches.length > 0) return;
    const touch = event.changedTouches[0];
    const moved = Math.hypot(touch.clientX - start.x, touch.clientY - start.y);
    // A light swipe drifts a few pixels and should still register; travel
    // beyond the slop is a deliberate scroll, so let the browser handle it.
    if (moved > this.tapSlopPx()) return;
    // Suppress the click the browser would otherwise synthesize for this tap.
    if (event.cancelable) event.preventDefault();
    this.ignoreClick = true;
    setTimeout(() => (this.ignoreClick = false), 500);
    this.play(src, char);
  }

  protected onTileTouchCancel(): void {
    this.tapStart = null;
  }

  protected onTileClick(src: string, char: string): void {
    if (this.ignoreClick) return;
    this.play(src, char);
  }

  private stopPlayback(): void {
    const audio = this.currentAudio;
    this.currentAudio = null;
    this.playbackId++;
    this.playingChar.set(null);
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
  }

  private finishPlayback(audio: HTMLAudioElement): void {
    if (this.currentAudio !== audio) return;
    this.currentAudio = null;
    this.playbackId++;
    this.playingChar.set(null);
  }

  private audioFor(src: string): HTMLAudioElement {
    let audio = this.audioCache.get(src);
    if (!audio) {
      const createdAudio = new Audio();
      audio = createdAudio;
      createdAudio.preload = 'auto';
      createdAudio.src = src;
      createdAudio.load();
      this.audioCache.set(src, createdAudio);
      const markLoaded = () => {
        this.loaded.update((s) => (s.has(src) ? s : new Set(s).add(src)));
      };
      if (createdAudio.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA) {
        markLoaded();
      } else {
        createdAudio.addEventListener('canplaythrough', markLoaded, { once: true });
        createdAudio.addEventListener('error', markLoaded, { once: true });
      }
      createdAudio.addEventListener('ended', () => {
        if (createdAudio.ended) this.finishPlayback(createdAudio);
      });
      createdAudio.addEventListener('pause', () => {
        if (createdAudio.paused) this.finishPlayback(createdAudio);
      });
      createdAudio.addEventListener('error', () => this.finishPlayback(createdAudio));
    }
    return audio;
  }

  protected play(src: string, char: string): void {
    // While a sound is playing, all taps are ignored until it finishes.
    if (this.playingChar() !== null) return;
    // Taps on tiles whose audio hasn't finished preloading do nothing;
    // playing now would leave the grid locked with no sound.
    if (!this.loaded().has(src)) return;

    // Stop the previous audio immediately: pause and rewind so it can't
    // keep emitting sound while the new one starts.
    if (this.currentAudio && this.currentAudio.src !== src) {
      this.currentAudio.pause();
      this.currentAudio.currentTime = 0;
    }
    const audio = this.audioFor(src);
    audio.currentTime = 0;
    const playbackId = ++this.playbackId;
    this.currentAudio = audio;
    this.playingChar.set(char);
    audio.play().catch(() => {
      if (this.playbackId !== playbackId || this.currentAudio !== audio) return;
      this.currentAudio = null;
      this.playingChar.set(null);
    });

    // Trigger the pop-out animation, restarting it on rapid re-clicks.
    if (this.popTimer) clearTimeout(this.popTimer);
    this.popping.set(null);
    requestAnimationFrame(() => this.popping.set(char));
    this.popTimer = setTimeout(() => this.popping.set(null), 500);
  }
}
