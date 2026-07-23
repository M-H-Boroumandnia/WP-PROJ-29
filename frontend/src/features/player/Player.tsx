import {
  ChevronDown,
  ChevronRight,
  Disc3,
  Heart,
  ListMusic,
  Mic2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { FastAverageColor } from "fast-average-color";
import { CoverArt } from "../../components/CoverArt";
import { repository } from "../../repositories/localRepository";
import { currentTrack, usePlayer } from "../../store/player";
import { useDatabaseVersion, useSession } from "../../store/session";
import { AudioEngine } from "./AudioEngine";

const formatTime = (value: number) =>
  `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, "0")}`;

const formatCount = (value: number) =>
  new Intl.NumberFormat(undefined, { notation: "compact" }).format(value);

export function Player() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const user = useSession();
  useDatabaseVersion();
  const player = usePlayer();
  const seekRef = useRef<HTMLInputElement>(null);
  const tracks = repository.tracks();
  const track = currentTrack(tracks, player.trackIds, player.currentIndex);
  const showGoldStats = user?.subscription.tier === "gold" && !!track;
  const [lastVolume, setLastVolume] = useState(0.75);
  const [coverAccent, setCoverAccent] = useState("#b6f13c");
  const accent = track?.coverUrl ? coverAccent : "#b6f13c";
  const [hoverProgress, setHoverProgress] = useState<number | null>(null);
  const [hoverVolume, setHoverVolume] = useState<number | null>(null);
  const [queueVisible, setQueueVisible] = useState(false);
  const [queueClosing, setQueueClosing] = useState(false);
  const queueTracks = useMemo(
    () =>
      player.trackIds
        .map((id) => tracks.find((item) => item.id === id))
        .filter(Boolean),
    [player.trackIds, tracks],
  );

  useEffect(() => {
    if (!track?.coverUrl) return;
    const fac = new FastAverageColor();
    fac
      .getColorAsync(track.coverUrl, { algorithm: "dominant" })
      .then((color) => setCoverAccent(color.hex))
      .catch(() => setCoverAccent("#b6f13c"));
    return () => fac.destroy();
  }, [track?.coverUrl]);
  useEffect(() => {
    if (!player.toast) return;
    const timer = setTimeout(player.clearToast, 2400);
    return () => clearTimeout(timer);
  }, [player.toast, player.clearToast]);
  useEffect(() => {
    if (player.queueOpen) {
      setQueueVisible(true);
      setQueueClosing(false);
      return;
    }
    if (!queueVisible) return;
    setQueueClosing(true);
    const timer = window.setTimeout(() => {
      setQueueVisible(false);
      setQueueClosing(false);
    }, 280);
    return () => clearTimeout(timer);
  }, [player.queueOpen, queueVisible]);

  const seek = (value: number) => {
    const audio = document.querySelector("audio");
    if (audio) audio.currentTime = value;
    player.setProgress(value);
  };
  const previous = () => {
    if (player.position > 3) seek(0);
    else player.previous();
  };
  const toggleMute = () => {
    if (player.volume > 0) {
      setLastVolume(player.volume);
      player.setVolume(0);
    } else player.setVolume(lastVolume || 0.75);
  };
  const hoverRatio = (event: React.MouseEvent<HTMLInputElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return null;
    return Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
  };
  const updateHoverProgress = (event: React.MouseEvent<HTMLInputElement>) => {
    const ratio = hoverRatio(event);
    if (ratio !== null) setHoverProgress(ratio * 100);
  };
  const clearHoverProgress = () => setHoverProgress(null);
  const updateHoverVolume = (event: React.MouseEvent<HTMLInputElement>) => {
    const ratio = hoverRatio(event);
    if (ratio !== null) setHoverVolume(ratio * 100);
  };
  const clearHoverVolume = () => setHoverVolume(null);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement).tagName;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(tag)) return;
      if (event.code === "Space") {
        event.preventDefault();
        player.togglePlay();
      } else if (event.key.toLowerCase() === "n") player.next();
      else if (event.key.toLowerCase() === "p") previous();
      else if (event.key.toLowerCase() === "q")
        player.setQueueOpen(!player.queueOpen);
      else if (event.key.toLowerCase() === "m") toggleMute();
      else if (event.key.toLowerCase() === "l" && track)
        repository.like(track.id);
      else if (event.key === "?") navigate("/shortcuts");
    };
    addEventListener("keydown", handler);
    return () => removeEventListener("keydown", handler);
  });

  const progressPercent = player.duration
    ? Math.min(100, (player.position / player.duration) * 100)
    : 0;
  const volumePercent = player.volume * 100;
  const progressStyle = {
    "--progress": `${progressPercent}%`,
    ...(hoverProgress !== null ? { "--hover": `${hoverProgress}%` } : {}),
  } as React.CSSProperties;
  const volumeStyle = {
    "--volume": `${volumePercent}%`,
    ...(hoverVolume !== null ? { "--hover": `${hoverVolume}%` } : {}),
  } as React.CSSProperties;
  const seekHoverProps = {
    className: hoverProgress !== null ? "is-hovering" : undefined,
    style: progressStyle,
    onMouseMove: updateHoverProgress,
    onMouseEnter: updateHoverProgress,
    onMouseLeave: clearHoverProgress,
  };
  const volumeHoverProps = {
    className: `volume-slider${hoverVolume !== null ? " is-hovering" : ""}`,
    style: volumeStyle,
    onMouseMove: updateHoverVolume,
    onMouseEnter: updateHoverVolume,
    onMouseLeave: clearHoverVolume,
  };

  return (
    <>
      <AudioEngine />
      {track && (
        <div
          className="mobile-mini-player"
          style={{ "--player-accent": accent } as React.CSSProperties}
          onClick={() => player.setMobileExpanded(true)}
        >
          <CoverArt src={track.coverUrl} alt="" />
          <div>
            <strong>{track.title}</strong>
            <span>{track.artists[0].stageName}</span>
          </div>
          <button
            className="icon-button"
            onClick={(event) => {
              event.stopPropagation();
              player.togglePlay();
            }}
            aria-label={t(player.isPlaying ? "pause" : "play")}
          >
            {player.isPlaying ? (
              <Pause fill="currentColor" />
            ) : (
              <Play fill="currentColor" />
            )}
          </button>
          <div
            className="mini-progress"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      )}
      <footer
        className={`desktop-player ${track ? "has-track" : ""}`}
        style={{ "--player-accent": accent } as React.CSSProperties}
      >
        <div className="player-track">
          {track ? (
            <>
              <CoverArt src={track.coverUrl} alt="" />
              <div>
                <strong>{track.title}</strong>
                <Link to={`/artist/${track.artists[0].username}`}>
                  {track.artists[0].stageName}
                </Link>
                {showGoldStats && (
                  <span className="player-gold-stats">
                    {formatCount(track.uniqueListenerCount)} {t("listeners")}
                    {" · "}
                    {formatCount(track.streamCount)} {t("streams")}
                  </span>
                )}
              </div>
              <button
                className={`icon-button ${track.isLiked ? "active" : ""}`}
                onClick={() => repository.like(track.id)}
                aria-label={t(track.isLiked ? "unlike" : "like")}
              >
                <Heart fill={track.isLiked ? "currentColor" : "none"} />
              </button>
            </>
          ) : (
            <>
              <span className="empty-cover">
                <Disc3 />
              </span>
              <div>
                <strong>{t("queueEmpty")}</strong>
                <span>{t("queueEmptyBody")}</span>
              </div>
            </>
          )}
        </div>
        <div className="player-center">
          <div className="player-buttons">
            <button
              className={`icon-button ${player.shuffleEnabled ? "active" : ""}`}
              onClick={player.toggleShuffle}
              aria-label={t("shuffle")}
            >
              <Shuffle />
            </button>
            <button
              className="icon-button"
              onClick={previous}
              aria-label={t("previous")}
            >
              <SkipBack fill="currentColor" />
            </button>
            <button
              className="main-play"
              onClick={player.togglePlay}
              disabled={!track}
              aria-label={t(player.isPlaying ? "pause" : "play")}
            >
              {player.isPlaying ? (
                <Pause fill="currentColor" />
              ) : (
                <Play fill="currentColor" />
              )}
            </button>
            <button
              className="icon-button"
              onClick={() => player.next()}
              aria-label={t("next")}
            >
              <SkipForward fill="currentColor" />
            </button>
            <button
              className={`icon-button ${player.repeatMode !== "off" ? "active" : ""}`}
              onClick={player.cycleRepeat}
              aria-label={t(
                player.repeatMode === "off"
                  ? "repeatOff"
                  : player.repeatMode === "all"
                    ? "repeatAll"
                    : "repeatOne",
              )}
            >
              {player.repeatMode === "one" ? <Repeat1 /> : <Repeat />}
            </button>
          </div>
          <div className="progress-row">
            <span>{formatTime(player.position)}</span>
            <input
              ref={seekRef}
              id="player-seek"
              name="seek"
              type="range"
              min="0"
              max={player.duration || 1}
              step=".1"
              value={Math.min(player.position, player.duration || 1)}
              onChange={(e) => seek(Number(e.target.value))}
              aria-label={t("seek")}
              {...seekHoverProps}
            />
            <span>{formatTime(player.duration)}</span>
          </div>
        </div>
        <div className="player-actions">
          <button
            className={`icon-button ${player.lyricsOpen ? "active" : ""}`}
            onClick={() => player.setLyricsOpen(!player.lyricsOpen)}
            disabled={!track}
            aria-label={t("lyrics")}
            aria-pressed={player.lyricsOpen}
          >
            <Mic2 />
          </button>
          <button
            className={`icon-button ${player.queueOpen ? "active" : ""}`}
            onClick={() => player.setQueueOpen(!player.queueOpen)}
            aria-label={t("queue")}
          >
            <ListMusic />
          </button>
          <button
            className="icon-button"
            onClick={toggleMute}
            aria-label={t("volume")}
          >
            {player.volume === 0 ? (
              <VolumeX />
            ) : player.volume < 0.5 ? (
              <Volume1 />
            ) : (
              <Volume2 />
            )}
          </button>
          <input
            id="player-volume"
            name="volume"
            type="range"
            min="0"
            max="1"
            step=".01"
            value={player.volume}
            onChange={(e) => player.setVolume(Number(e.target.value))}
            aria-label={t("volume")}
            {...volumeHoverProps}
          />
        </div>
      </footer>
      {queueVisible && (
        <aside
          className={`queue-drawer ${queueClosing ? "is-closing" : ""}`}
          aria-label={t("queue")}
        >
          <div className="drawer-heading">
            <div>
              <span className="eyebrow">{t("nowPlaying")}</span>
              <h2>{t("queue")}</h2>
            </div>
            <button
              className="icon-button"
              onClick={() => player.setQueueOpen(false)}
              aria-label={t("close")}
            >
              <ChevronRight />
            </button>
          </div>
          {queueTracks.length ? (
            <div className="queue-list">
              {queueTracks.map(
                (item, index) =>
                  item && (
                    <div
                      className={`queue-item ${index === player.currentIndex ? "current" : ""}`}
                      key={`${item.id}-${index}`}
                      draggable={index !== player.currentIndex}
                      onDragStart={(e) =>
                        e.dataTransfer.setData("text/plain", String(index))
                      }
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) =>
                        player.reorder(
                          Number(e.dataTransfer.getData("text/plain")),
                          index,
                        )
                      }
                    >
                      <span className="drag-grip">⠿</span>
                      <CoverArt src={item.coverUrl} alt="" />
                      <button
                        onClick={() =>
                          player.replaceContext(
                            queueTracks as typeof tracks,
                            item.id,
                          )
                        }
                      >
                        <strong>{item.title}</strong>
                        <span>{item.artists[0].stageName}</span>
                      </button>
                      {index !== player.currentIndex && (
                        <button
                          className="icon-button"
                          onClick={() => player.remove(index)}
                          aria-label={t("removeQueue")}
                        >
                          <X />
                        </button>
                      )}
                    </div>
                  ),
              )}
            </div>
          ) : (
            <p className="muted">{t("queueEmptyBody")}</p>
          )}
        </aside>
      )}
      {player.mobileExpanded && track && (
        <div
          className="mobile-full-player"
          style={{ "--player-accent": accent } as React.CSSProperties}
        >
          <button
            className="icon-button collapse-player"
            onClick={() => player.setMobileExpanded(false)}
            aria-label={t("close")}
          >
            <ChevronDown />
          </button>
          <span className="eyebrow">{t("nowPlaying")}</span>
          <CoverArt
            src={track.coverUrl}
            alt={track.title}
            className="full-cover"
          />
          <div className="full-track-copy">
            <div>
              <h2>{track.title}</h2>
              <Link to={`/artist/${track.artists[0].username}`}>
                {track.artists[0].stageName}
              </Link>
              {showGoldStats && (
                <span className="player-gold-stats">
                  {formatCount(track.uniqueListenerCount)} {t("listeners")}
                  {" · "}
                  {formatCount(track.streamCount)} {t("streams")}
                </span>
              )}
            </div>
            <button
              className={`icon-button ${track.isLiked ? "active" : ""}`}
              onClick={() => repository.like(track.id)}
            >
              <Heart fill={track.isLiked ? "currentColor" : "none"} />
            </button>
          </div>
          <div className="progress-row">
            <span>{formatTime(player.position)}</span>
            <input
              id="mobile-player-seek"
              name="mobileSeek"
              type="range"
              min="0"
              max={player.duration || 1}
              step=".1"
              value={Math.min(player.position, player.duration || 1)}
              onChange={(e) => seek(Number(e.target.value))}
              aria-label={t("seek")}
              {...seekHoverProps}
            />
            <span>{formatTime(player.duration)}</span>
          </div>
          <div className="full-controls">
            <button
              className={`icon-button ${player.shuffleEnabled ? "active" : ""}`}
              onClick={player.toggleShuffle}
            >
              <Shuffle />
            </button>
            <button className="icon-button" onClick={previous}>
              <SkipBack fill="currentColor" />
            </button>
            <button className="main-play" onClick={player.togglePlay}>
              {player.isPlaying ? (
                <Pause fill="currentColor" />
              ) : (
                <Play fill="currentColor" />
              )}
            </button>
            <button className="icon-button" onClick={() => player.next()}>
              <SkipForward fill="currentColor" />
            </button>
            <button
              className={`icon-button ${player.repeatMode !== "off" ? "active" : ""}`}
              onClick={player.cycleRepeat}
            >
              {player.repeatMode === "one" ? <Repeat1 /> : <Repeat />}
            </button>
          </div>
          <div className="full-secondary">
            <button
              className={player.lyricsOpen ? "active" : ""}
              onClick={() => player.setLyricsOpen(!player.lyricsOpen)}
              aria-pressed={player.lyricsOpen}
            >
              <Mic2 />
              {t("lyrics")}
            </button>
            <button
              className={player.queueOpen ? "active" : ""}
              onClick={() => {
                player.setQueueOpen(true);
              }}
              aria-pressed={player.queueOpen}
            >
              <ListMusic />
              {t("queue")}
            </button>
          </div>
        </div>
      )}
      {player.lyricsOpen && track && (
        <div className="lyrics-overlay">
          <div className="lyrics-top">
            <div>
              <span className="eyebrow">{t("focusMode")}</span>
              <h2>{track.title}</h2>
              <span>{track.artists[0].stageName}</span>
            </div>
            <button
              className="icon-button"
              onClick={() => player.setLyricsOpen(false)}
              aria-label={t("close")}
            >
              <X />
            </button>
          </div>
          <div className="lyrics-body">
            {track.lyrics ? (
              track.lyrics.split("\n").map((line) => <p key={line}>{line}</p>)
            ) : (
              <p className="muted">{t("lyricsUnavailable")}</p>
            )}
          </div>
        </div>
      )}
      {player.gestureRequired && (
        <button className="gesture-toast" onClick={player.togglePlay}>
          {t("gestureRequired")} <Play />
        </button>
      )}
      {player.failureCount >= 3 && (
        <div className="toast error" role="alert">
          {t("playerError")}
        </div>
      )}
      {player.toast && (
        <div className="toast" role="status">
          {t(player.toast)}
        </div>
      )}
    </>
  );
}
