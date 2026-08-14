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

type PlaybackGrant = {
  streamUrl: string;
  playbackSessionId: string;
};

type PlaybackReporter = {
  recordPlaybackProgress?: (
    trackId: string,
    positionSeconds: number,
    options: { finalize?: boolean; playbackSessionId: string },
  ) => void | Promise<unknown>;
  playbackSource?: (
    trackId: string,
    options?: { force?: boolean },
  ) => Promise<PlaybackGrant | string>;
};

function grantFromSource(source: PlaybackGrant | string): {
  streamUrl: string;
  playbackSessionId: string | null;
} {
  if (typeof source === "string") {
    return { streamUrl: source, playbackSessionId: null };
  }
  return {
    streamUrl: source.streamUrl,
    playbackSessionId: source.playbackSessionId,
  };
}

export function AudioEngine() {
  const audio = useRef<HTMLAudioElement>(null);
  const counted = useRef<string | null>(null);
  const latestPosition = useRef(0);
  const loadToken = useRef(0);
  const activeSource = useRef("");
  /** Session opened for the current listen — progress must target this id. */
  const activeSessionId = useRef<string | null>(null);
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
    const trackId = track?.id ?? null;
    const canReport = Boolean(
      track && track.isPlayableForViewer && !unavailableIds.includes(track.id),
    );
    counted.current = null;
    latestPosition.current = 0;
    activeSource.current = "";
    activeSessionId.current = null;
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
    const api = repository as unknown as PlaybackReporter;
    // Always open a fresh playback session per listen so replays can count
    // streams/minutes (reusing a counted session returns validStreamRecorded:false).
    const sourceTask =
      api.playbackSource?.(track.id, { force: true }) ??
      Promise.resolve(track.audioUrl);

    sourceTask
      .then((nextSource) => {
        if (cancelled || token !== loadToken.current) return;
        const grant = grantFromSource(nextSource);
        activeSource.current = grant.streamUrl;
        activeSessionId.current = grant.playbackSessionId;
        element.src = grant.streamUrl;
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
      // Finalize against the session that belonged to this listen.
      const sessionId = activeSessionId.current;
      if (
        canReport &&
        trackId &&
        sessionId &&
        latestPosition.current > 0 &&
        api.recordPlaybackProgress
      ) {
        void api.recordPlaybackProgress(trackId, latestPosition.current, {
          finalize: true,
          playbackSessionId: sessionId,
        });
      }
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
        latestPosition.current = element.currentTime;
        usePlayer
          .getState()
          .setProgress(
            element.currentTime,
            element.duration || track.durationSeconds,
          );

        const api = repository as unknown as PlaybackReporter;
        // Restarting the same track opens a new listen session so replays count.
        if (
          counted.current === track.id &&
          element.currentTime < 2.5 &&
          api.playbackSource
        ) {
          counted.current = null;
          const token = loadToken.current;
          void api.playbackSource(track.id, { force: true }).then((source) => {
            if (token !== loadToken.current) return;
            const grant = grantFromSource(source);
            activeSessionId.current = grant.playbackSessionId;
            if (grant.streamUrl) activeSource.current = grant.streamUrl;
          });
        }
      }}
      onEnded={(event) => {
        if (!track) return;
        const element = event.currentTarget;
        const position = Math.max(
          element.currentTime,
          element.duration || track.durationSeconds,
        );
        latestPosition.current = position;
        const api = repository as unknown as PlaybackReporter;
        const sessionId = activeSessionId.current;

        const finalizeListen = () => {
          if (
            !track.isPlayableForViewer ||
            !api.recordPlaybackProgress ||
            !sessionId
          ) {
            return Promise.resolve();
          }
          // Streams count when the track finishes — not mid-listen.
          counted.current = track.id;
          // Prevent the effect cleanup from sending a second finalize.
          latestPosition.current = 0;
          return Promise.resolve(
            api.recordPlaybackProgress(track.id, position, {
              finalize: true,
              playbackSessionId: sessionId,
            }),
          );
        };

        if (repeatMode === "one") {
          void finalizeListen().finally(() => {
            if (api.playbackSource) {
              const token = loadToken.current;
              void api
                .playbackSource(track.id, { force: true })
                .then((source) => {
                  if (token !== loadToken.current) return;
                  const grant = grantFromSource(source);
                  activeSessionId.current = grant.playbackSessionId;
                  if (grant.streamUrl) activeSource.current = grant.streamUrl;
                });
            }
            element.currentTime = 0;
            usePlayer.getState().setProgress(0);
            element.play().catch((error: unknown) => {
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
          });
          return;
        }

        void finalizeListen().finally(() => {
          usePlayer.getState().next("ended");
        });
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
