import { create } from "zustand";
import type { RepeatMode, TrackView } from "../domain/types";
import { repository } from "../repositories/localRepository";

interface PlayerState {
  trackIds: string[];
  currentIndex: number;
  isPlaying: boolean;
  position: number;
  duration: number;
  volume: number;
  repeatMode: RepeatMode;
  shuffleEnabled: boolean;
  queueOpen: boolean;
  mobileExpanded: boolean;
  lyricsOpen: boolean;
  gestureRequired: boolean;
  toast: string | null;
  failureCount: number;
  unavailableIds: string[];
  playbackNonce: number;
  replaceContext: (tracks: TrackView[], selectedId: string) => void;
  addNext: (trackId: string) => void;
  addToQueue: (trackId: string) => void;
  remove: (index: number) => void;
  reorder: (from: number, to: number) => void;
  next: (reason?: string) => void;
  previous: () => void;
  togglePlay: () => void;
  setPlaying: (playing: boolean) => void;
  setProgress: (position: number, duration?: number) => void;
  setVolume: (volume: number) => void;
  cycleRepeat: () => void;
  toggleShuffle: () => void;
  setQueueOpen: (open: boolean) => void;
  setMobileExpanded: (open: boolean) => void;
  setLyricsOpen: (open: boolean) => void;
  setGestureRequired: (required: boolean) => void;
  markFailure: (trackId: string) => void;
  resetFailures: () => void;
  clearToast: () => void;
}

const persisted = repository.queue();
const persist = (
  state: Pick<
    PlayerState,
    "trackIds" | "currentIndex" | "repeatMode" | "shuffleEnabled" | "volume"
  >,
) =>
  repository.saveQueue({
    trackIds: state.trackIds,
    currentIndex: state.currentIndex,
    repeatMode: state.repeatMode,
    shuffleEnabled: state.shuffleEnabled,
    volume: state.volume,
  });

export const usePlayer = create<PlayerState>((set, get) => ({
  ...persisted,
  isPlaying: false,
  position: 0,
  duration: 0,
  queueOpen: false,
  mobileExpanded: false,
  lyricsOpen: false,
  gestureRequired: false,
  toast: null,
  failureCount: 0,
  unavailableIds: [],
  playbackNonce: 0,
  replaceContext: (tracks, selectedId) =>
    set(() => {
      const playableIds = tracks.map((track) => track.id);
      const selected = tracks.find((track) => track.id === selectedId);
      if (!selected?.isPlayableForViewer)
        return {
          isPlaying: false,
          toast:
            selected?.lockReason === "gold_required"
              ? "goldRequired"
              : selected?.lockReason === "explicit_restricted"
                ? "explicitRestricted"
                : selected?.lockReason === "daily_stream_limit"
                  ? "dailyLimit"
                  : "cannotQueueLocked",
        };
      const next = {
        trackIds: playableIds,
        currentIndex: Math.max(0, playableIds.indexOf(selectedId)),
        repeatMode: get().repeatMode,
        shuffleEnabled: get().shuffleEnabled,
        volume: get().volume,
      };
      persist(next);
      repository.recordRecentlyPlayed(selectedId);
      return {
        ...next,
        isPlaying: true,
        position: 0,
        gestureRequired: false,
        failureCount: 0,
        unavailableIds: [],
        playbackNonce: get().playbackNonce + 1,
        toast: "queueReplaced",
      };
    }),
  addNext: (trackId) =>
    set((state) => {
      const candidate = repository
        .tracks()
        .find((track) => track.id === trackId);
      if (candidate && !candidate.isPlayableForViewer)
        return { toast: "cannotQueueLocked" };
      const trackIds = [...state.trackIds];
      trackIds.splice(Math.max(0, state.currentIndex + 1), 0, trackId);
      persist({ ...state, trackIds });
      return { trackIds, toast: "playingNext" };
    }),
  addToQueue: (trackId) =>
    set((state) => {
      const candidate = repository
        .tracks()
        .find((track) => track.id === trackId);
      if (candidate && !candidate.isPlayableForViewer)
        return { toast: "cannotQueueLocked" };
      const trackIds = [...state.trackIds, trackId];
      persist({ ...state, trackIds });
      return { trackIds, toast: "addedQueue" };
    }),
  remove: (index) =>
    set((state) => {
      if (index === state.currentIndex) return state;
      const trackIds = state.trackIds.filter((_, i) => i !== index);
      const currentIndex =
        index < state.currentIndex
          ? state.currentIndex - 1
          : state.currentIndex;
      persist({ ...state, trackIds, currentIndex });
      return { trackIds, currentIndex };
    }),
  reorder: (from, to) =>
    set((state) => {
      if (from === state.currentIndex || to === state.currentIndex)
        return state;
      const trackIds = [...state.trackIds];
      const [moved] = trackIds.splice(from, 1);
      trackIds.splice(to, 0, moved);
      let currentIndex = state.currentIndex;
      if (from < currentIndex && to >= currentIndex) currentIndex--;
      else if (from > currentIndex && to <= currentIndex) currentIndex++;
      persist({ ...state, trackIds, currentIndex });
      return { trackIds, currentIndex };
    }),
  next: (reason) =>
    set((state) => {
      if (!state.trackIds.length) return state;
      let currentIndex = state.currentIndex;
      if (state.repeatMode === "one" && reason === "ended")
        currentIndex = state.currentIndex;
      else if (state.shuffleEnabled && state.trackIds.length > 1) {
        do {
          currentIndex = Math.floor(Math.random() * state.trackIds.length);
        } while (currentIndex === state.currentIndex);
      } else if (state.currentIndex + 1 < state.trackIds.length) currentIndex++;
      else if (reason !== "ended" || state.repeatMode === "all")
        currentIndex = 0;
      else return { isPlaying: false, position: 0 };
      const selected = state.trackIds[currentIndex];
      repository.recordRecentlyPlayed(selected);
      persist({ ...state, currentIndex });
      return {
        currentIndex,
        position: 0,
        isPlaying: true,
        toast: reason === "failure" ? "unavailableSkipped" : "queueAdvanced",
      };
    }),
  previous: () =>
    set((state) => {
      if (state.position > 3) return { position: 0 };
      const currentIndex = Math.max(0, state.currentIndex - 1);
      persist({ ...state, currentIndex });
      return { currentIndex, position: 0, isPlaying: true };
    }),
  togglePlay: () =>
    set((state) => ({ isPlaying: !state.isPlaying, gestureRequired: false })),
  setPlaying: (isPlaying) => set({ isPlaying }),
  setProgress: (position, duration) =>
    set((state) => ({ position, duration: duration ?? state.duration })),
  setVolume: (volume) =>
    set((state) => {
      persist({ ...state, volume });
      return { volume };
    }),
  cycleRepeat: () =>
    set((state) => {
      const repeatMode: RepeatMode =
        state.repeatMode === "off"
          ? "all"
          : state.repeatMode === "all"
            ? "one"
            : "off";
      persist({ ...state, repeatMode });
      return { repeatMode };
    }),
  toggleShuffle: () =>
    set((state) => {
      const shuffleEnabled = !state.shuffleEnabled;
      persist({ ...state, shuffleEnabled });
      return { shuffleEnabled };
    }),
  setQueueOpen: (queueOpen) =>
    set(queueOpen ? { queueOpen: true, lyricsOpen: false } : { queueOpen: false }),
  setMobileExpanded: (mobileExpanded) => set({ mobileExpanded }),
  setLyricsOpen: (lyricsOpen) =>
    set(lyricsOpen ? { lyricsOpen: true, queueOpen: false } : { lyricsOpen: false }),
  setGestureRequired: (gestureRequired) =>
    set({ gestureRequired, isPlaying: false }),
  markFailure: (trackId) =>
    set((state) => ({
      failureCount: state.failureCount + 1,
      unavailableIds: [...new Set([...state.unavailableIds, trackId])],
    })),
  resetFailures: () => set({ failureCount: 0 }),
  clearToast: () => set({ toast: null }),
}));

export const currentTrack = (
  tracks: TrackView[],
  trackIds: string[],
  currentIndex: number,
): TrackView | null =>
  tracks.find((track) => track.id === trackIds[currentIndex]) ?? null;
