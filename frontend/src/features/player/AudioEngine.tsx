import { useEffect, useRef } from "react";
import { repository } from "../../repositories/localRepository";
import { currentTrack, usePlayer } from "../../store/player";
import { useDatabaseVersion } from "../../store/session";

function isBenignPlayError(error: unknown) {
  return (
    error instanceof DOMException &&
    (error.name === "AbortError" || error.name === "NotAllowedError")
  );
}

export function AudioEngine() {
  const audio = useRef<HTMLAudioElement>(null);
  const counted = useRef<string | null>(null);
  const loadToken = useRef(0);
  const activeSource = useRef("");
  useDatabaseVersion();
  const tracks = repository.sessionUser() ? repository.tracks() : [];
  const state = usePlayer();
  const track = currentTrack(tracks, state.trackIds, state.currentIndex);
  const isPlaying = usePlayer((s) => s.isPlaying);
  const volume = usePlayer((s) => s.volume);
  const unavailableIds = usePlayer((s) => s.unavailableIds);
  const repeatMode = usePlayer((s) => s.repeatMode);
  const playbackNonce = usePlayer((s) => s.playbackNonce);

  function handleFailure(trackId: string, token: number) {
    if (token !== loadToken.current) return;
    usePlayer.getState().markFailure(trackId);
    window.setTimeout(() => {
      if (token !== loadToken.current) return;
      const latest = usePlayer.getState();
      if (latest.failureCount >= 3) latest.setPlaying(false);
      else latest.next("failure");
    }, 550);
  }

  useEffect(() => {
    const element = audio.current;
    if (!element) return;
    element.volume = volume;
  }, [volume]);

  useEffect(() => {
    const element = audio.current;
    if (!element) return;

    const token = ++loadToken.current;
    counted.current = null;
    activeSource.current = "";
    element.pause();
    element.removeAttribute("src");
    element.load();

    if (!track) {
      usePlayer.getState().setProgress(0, 0);
      return;
    }

    usePlayer.getState().setProgress(0, track.durationSeconds);
    if (!track.isPlayableForViewer || unavailableIds.includes(track.id)) {
      usePlayer.getState().setPlaying(false);
      return;
    }

    let cancelled = false;
    const sourceTask =
      (
        repository as unknown as {
          playbackSource?: (trackId: string) => Promise<string>;
        }
      ).playbackSource?.(track.id) ?? Promise.resolve(track.audioUrl);

    sourceTask
      .then((nextSource) => {
        if (cancelled || token !== loadToken.current) return;
        activeSource.current = nextSource;
        element.src = nextSource;
        if (usePlayer.getState().isPlaying) {
          element.play().catch((error: unknown) => {
            if (cancelled || token !== loadToken.current) return;
            if (
              error instanceof DOMException &&
              error.name === "NotAllowedError"
            ) {
              usePlayer.getState().setGestureRequired(true);
              return;
            }
            if (isBenignPlayError(error)) return;
            handleFailure(track.id, token);
          });
        }
      })
      .catch(() => {
        if (!cancelled) handleFailure(track.id, token);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track?.id, playbackNonce]);

  useEffect(() => {
    const element = audio.current;
    if (!element || !track || !activeSource.current) return;
    const token = loadToken.current;
    if (isPlaying) {
      element.play().catch((error: unknown) => {
        if (token !== loadToken.current) return;
        if (error instanceof DOMException && error.name === "NotAllowedError") {
          usePlayer.getState().setGestureRequired(true);
          return;
        }
        if (isBenignPlayError(error)) return;
        handleFailure(track.id, token);
      });
    } else {
      element.pause();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying]);

  return (
    <audio
      ref={audio}
      preload="metadata"
      onLoadedMetadata={(event) => {
        if (!track) return;
        usePlayer
          .getState()
          .setProgress(
            event.currentTarget.currentTime,
            event.currentTarget.duration || track.durationSeconds,
          );
      }}
      onTimeUpdate={(event) => {
        if (!track) return;
        const element = event.currentTarget;
        usePlayer
          .getState()
          .setProgress(
            element.currentTime,
            element.duration || track.durationSeconds,
          );
        const threshold = Math.min(
          30,
          (element.duration || track.durationSeconds) * 0.8,
        );
        if (
          element.currentTime >= threshold &&
          counted.current !== track.id &&
          track.isPlayableForViewer
        ) {
          counted.current = track.id;
          const progress = (
            repository as unknown as {
              recordPlaybackProgress?: (
                trackId: string,
                positionSeconds: number,
              ) => void;
            }
          ).recordPlaybackProgress;
          if (progress) progress(track.id, element.currentTime);
          else repository.recordValidStream(track.id);
        }
      }}
      onEnded={(event) => {
        if (!track) return;
        if (repeatMode === "one") {
          event.currentTarget.currentTime = 0;
          usePlayer.getState().setProgress(0);
          event.currentTarget.play().catch((error: unknown) => {
            if (
              error instanceof DOMException &&
              error.name === "NotAllowedError"
            ) {
              usePlayer.getState().setGestureRequired(true);
              return;
            }
            if (isBenignPlayError(error)) return;
            handleFailure(track.id, loadToken.current);
          });
        } else {
          usePlayer.getState().next("ended");
        }
      }}
      onError={() => {
        if (!track || !activeSource.current) return;
        if (
          audio.current?.src &&
          !audio.current.src.includes(activeSource.current)
        )
          return;
        handleFailure(track.id, loadToken.current);
      }}
      onPlaying={() => {
        usePlayer.getState().resetFailures();
      }}
    />
  );
}
