import {
  Download,
  Ellipsis,
  Heart,
  ListEnd,
  ListMusic,
  ListPlus,
  LockKeyhole,
  Play,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import type { TrackView } from "../domain/types";
import { canDownload } from "../domain/entitlements";
import { repository } from "../repositories/localRepository";
import { usePlayer } from "../store/player";
import { useSession } from "../store/session";
import { CoverArt } from "./CoverArt";
import { PlaylistManageModal } from "./PlaylistManageModal";

export function TrackRow({
  track,
  context,
  index,
  compact = false,
}: {
  track: TrackView;
  context: TrackView[];
  index?: number;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const [menu, setMenu] = useState(false);
  const [managing, setManaging] = useState(false);
  const [opensUp, setOpensUp] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const user = useSession();
  const replace = usePlayer((s) => s.replaceContext);
  const addNext = usePlayer((s) => s.addNext);
  const addToQueue = usePlayer((s) => s.addToQueue);
  const canShowDownload =
    !!user &&
    canDownload(user.subscription.tier) &&
    track.isPlayableForViewer;

  useLayoutEffect(() => {
    if (!menu) {
      setOpensUp(false);
      return;
    }
    const wrap = menuRef.current;
    const popover = wrap?.querySelector(".popover-menu");
    if (!wrap || !(popover instanceof HTMLElement)) return;

    const place = () => {
      const wrapRect = wrap.getBoundingClientRect();
      const menuHeight = popover.offsetHeight;
      const gap = 6;
      const main = wrap.closest(".main-content");
      const boundaryBottom = main
        ? main.getBoundingClientRect().bottom
        : window.innerHeight;
      const spaceBelow = boundaryBottom - wrapRect.bottom - gap;
      setOpensUp(spaceBelow < menuHeight);
    };

    place();
    window.addEventListener("resize", place);
    const main = wrap.closest(".main-content");
    main?.addEventListener("scroll", place);
    return () => {
      window.removeEventListener("resize", place);
      main?.removeEventListener("scroll", place);
    };
  }, [menu, canShowDownload, downloading, track.isPlayableForViewer]);

  useEffect(() => {
    if (!menu) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenu(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menu]);
  const lockText =
    track.lockReason === "gold_required"
      ? t("goldRequired")
      : track.lockReason === "explicit_restricted"
        ? t("explicitRestricted")
        : t("dailyLimit");
  const download = async () => {
    if (
      !user ||
      !canDownload(user.subscription.tier) ||
      !track.isPlayableForViewer ||
      downloading
    )
      return;
    setDownloading(true);
    try {
      const ticketSource = (
        repository as unknown as {
          downloadSource?: (trackId: string) => Promise<string>;
        }
      ).downloadSource;
      const source = ticketSource
        ? await ticketSource(track.id)
        : track.audioUrl;
      if (source) {
        const link = document.createElement("a");
        link.href = source;
        link.download = `${track.title}.wav`;
        document.body.append(link);
        link.click();
        link.remove();
      }
      setMenu(false);
    } finally {
      setDownloading(false);
    }
  };
  return (
    <div
      className={`track-row ${compact ? "compact" : ""} ${!track.isPlayableForViewer ? "is-locked" : ""} ${menu ? "is-menu-open" : ""}`}
    >
      <button
        className="track-play"
        onClick={() => replace(context, track.id)}
        disabled={!track.isPlayableForViewer}
        aria-label={
          track.isPlayableForViewer ? `${t("play")} ${track.title}` : lockText
        }
      >
        {track.isPlayableForViewer ? (
          <>
            {index !== undefined && (
              <span className="track-index">{index + 1}</span>
            )}
            <Play className="track-play-icon" fill="currentColor" />
          </>
        ) : (
          <LockKeyhole />
        )}
      </button>
      <CoverArt src={track.coverUrl} alt="" />
      <div className="track-main">
        <strong>
          {track.title}{" "}
          {track.isExplicit && (
            <span className="explicit-mark" title={t("explicit")}>
              E
            </span>
          )}
        </strong>
        <Link to={`/artist/${track.artists[0].username}`}>
          {track.artists.map((a) => a.stageName).join(", ")}
        </Link>
      </div>
      {!compact && (
        <Link className="track-release" to={`/release/${track.releaseId}`}>
          {track.releaseTitle}
        </Link>
      )}
      {!track.isPlayableForViewer && (
        <span className="lock-label">{lockText}</span>
      )}
      <span className="track-duration">
        {Math.floor(track.durationSeconds / 60)}:
        {String(track.durationSeconds % 60).padStart(2, "0")}
      </span>
      <button
        className={`icon-button ${track.isLiked ? "active" : ""}`}
        onClick={() => repository.like(track.id)}
        aria-label={t(track.isLiked ? "unlike" : "like")}
      >
        <Heart fill={track.isLiked ? "currentColor" : "none"} />
      </button>
      <div className="menu-wrap" ref={menuRef}>
        <button
          className="icon-button"
          aria-label={t("more")}
          onClick={() => setMenu(!menu)}
        >
          <Ellipsis />
        </button>
        {menu && (
          <div
            className={`popover-menu ${opensUp ? "opens-up" : ""}`}
            role="menu"
          >
            <button
              disabled={!track.isPlayableForViewer}
              onClick={() => {
                addNext(track.id);
                setMenu(false);
              }}
            >
              <ListEnd />
              {t("addNext")}
            </button>
            <button
              disabled={!track.isPlayableForViewer}
              onClick={() => {
                addToQueue(track.id);
                setMenu(false);
              }}
            >
              <ListPlus />
              {t("addQueue")}
            </button>
            <button
              onClick={() => {
                setMenu(false);
                setManaging(true);
              }}
            >
              <ListMusic />
              {t("addToPlaylist")}
            </button>
            {canShowDownload && (
              <button disabled={downloading} onClick={download}>
                <Download />
                {t("download")}
              </button>
            )}
            {!track.isPlayableForViewer && (
              <span className="popover-note">{lockText}</span>
            )}
          </div>
        )}
      </div>
      {managing && (
        <PlaylistManageModal
          trackIds={[track.id]}
          onClose={() => setManaging(false)}
        />
      )}
    </div>
  );
}
