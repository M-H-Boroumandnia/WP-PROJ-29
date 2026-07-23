import { Ellipsis, LockKeyhole, Play, Sparkles } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { CoverArt, PlaylistCollage } from "./CoverArt";
import { PlaylistManageModal } from "./PlaylistManageModal";

interface MediaCardProps {
  title: string;
  subtitle?: string;
  artistName?: string;
  artistHref?: string;
  coverUrl?: string | null;
  collageUrls?: (string | null)[];
  href: string;
  onPlay?: () => void;
  locked?: boolean;
  badge?: "new" | "gold";
  /** When set, shows a menu to add/remove these tracks from playlists. */
  manageTrackIds?: string[];
}

export function MediaCard({
  title,
  subtitle,
  artistName,
  artistHref,
  coverUrl = null,
  collageUrls,
  href,
  onPlay,
  locked,
  badge,
  manageTrackIds,
}: MediaCardProps) {
  const { t } = useTranslation();
  const [managing, setManaging] = useState(false);
  const canManage = !!manageTrackIds?.length;

  return (
    <article className={`media-card ${managing ? "is-menu-open" : ""}`}>
      <Link to={href} className="media-art">
        {collageUrls ? (
          <PlaylistCollage urls={collageUrls} title={title} />
        ) : (
          <CoverArt src={coverUrl} alt={title} />
        )}
        {badge && (
          <span className={`media-badge ${badge}`}>
            <Sparkles size={12} />
            {badge === "gold" ? t("gold") : t("newBadge")}
          </span>
        )}
      </Link>
      <div className="media-copy">
        <Link to={href} className="media-title">
          {title}
        </Link>
        {(subtitle || artistName) && (
          <div className="media-subtitle">
            {subtitle && <span>{subtitle}</span>}
            {subtitle && artistName && <span className="media-dot">·</span>}
            {artistName && artistHref ? (
              <Link to={artistHref} className="media-artist">
                {artistName}
              </Link>
            ) : artistName ? (
              <span>{artistName}</span>
            ) : null}
          </div>
        )}
      </div>
      {onPlay && (
        <button
          type="button"
          className="floating-play"
          onClick={onPlay}
          aria-label={`${t("play")} ${title}`}
          disabled={locked}
        >
          {locked ? <LockKeyhole /> : <Play fill="currentColor" />}
        </button>
      )}
      {canManage && (
        <button
          type="button"
          className="icon-button media-card-menu-btn"
          aria-label={t("addToPlaylist")}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setManaging(true);
          }}
        >
          <Ellipsis />
        </button>
      )}
      {managing && manageTrackIds && (
        <PlaylistManageModal
          trackIds={manageTrackIds}
          onClose={() => setManaging(false)}
        />
      )}
    </article>
  );
}
