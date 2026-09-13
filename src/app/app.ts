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
      src: `audio/${cat}-${i}.wav`,
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

  /** Character currently playing its pop animation, or null. */
  protected readonly popping = signal<string | null>(null);
  private popTimer: ReturnType<typeof setTimeout> | null = null;

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

  constructor() {
    effect(() => {
      document.body.style.colorScheme = this.darkMode() ? 'dark' : 'light';
    });
    // Preload the active category's audio so the first tap plays instantly.
    effect(() => {
      for (const tile of this.tiles()) this.audioFor(tile.src);
    });
  }

  private audioFor(src: string): HTMLAudioElement {
    let audio = this.audioCache.get(src);
    if (!audio) {
      audio = new Audio();
      audio.preload = 'auto';
      audio.src = src;
      audio.load();
      this.audioCache.set(src, audio);
      const markLoaded = () => {
        this.loaded.update((s) => (s.has(src) ? s : new Set(s).add(src)));
      };
      if (audio.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA) {
        markLoaded();
      } else {
        audio.addEventListener('canplaythrough', markLoaded, { once: true });
        audio.addEventListener('error', markLoaded, { once: true });
      }
    }
    return audio;
  }

  protected play(src: string, char: string): void {
    // Stop the previous audio immediately: pause and rewind so it can't
    // keep emitting sound while the new one starts.
    if (this.currentAudio && this.currentAudio.src !== src) {
      this.currentAudio.pause();
      this.currentAudio.currentTime = 0;
    }
    const audio = this.audioFor(src);
    audio.currentTime = 0;
    audio.play().catch(() => {
      // Playback can fail (autoplay policy, missing file); ignore.
    });
    this.currentAudio = audio;

    // Trigger the pop-out animation, restarting it on rapid re-clicks.
    if (this.popTimer) clearTimeout(this.popTimer);
    this.popping.set(null);
    requestAnimationFrame(() => this.popping.set(char));
    this.popTimer = setTimeout(() => this.popping.set(null), 500);
  }
}
