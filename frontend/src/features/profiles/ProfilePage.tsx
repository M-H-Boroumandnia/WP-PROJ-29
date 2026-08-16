import {
  BadgeCheck,
  BarChart3,
  Camera,
  Check,
  ChevronDown,
  Crown,
  Flame,
  Headphones,
  LockKeyhole,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";
import { EmptyState } from "../../components/EmptyState";
import { MediaCard } from "../../components/MediaCard";
import { Section } from "../../components/Section";
import { canEditAvatar } from "../../domain/entitlements";
import type { User } from "../../domain/types";
import { repository } from "../../repositories/localRepository";
import { useDatabaseVersion, useSession } from "../../store/session";
import { uiError } from "../shared/errors";

const PROFILE_IMAGE_MAX_BYTES = 50 * 1024 * 1024;
const PROFILE_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
type ConnectionsTab = "followers" | "following";

function normalizeUsername(value: string) {
  return value.trim().toLowerCase().replace(/^@/, "");
}

function resolvePeople(ids: string[], users: User[]) {
  return ids
    .map((id) =>
      users.find((candidate) => candidate.id === id && !candidate.deletedAt),
    )
    .filter((candidate): candidate is User => Boolean(candidate));
}

function PersonRow({
  person,
  onUnfollow,
  unfollowLabel,
}: {
  person: User;
  onUnfollow?: () => void;
  unfollowLabel?: string;
}) {
  const name = person.artistProfile?.stageName ?? person.displayName;
  return (
    <div className="profile-person-card">
      <Link
        className="profile-person-link"
        to={
          person.artistProfile
            ? `/artist/${person.username}`
            : `/profile/${person.username}`
        }
      >
        {person.avatarUrl ? (
          <img src={person.avatarUrl} alt="" />
        ) : (
          <div className="profile-person-fallback">{name.slice(0, 1)}</div>
        )}
        <span>
          <strong>{name}</strong>
          <small>@{person.username}</small>
        </span>
      </Link>
      {onUnfollow && (
        <button
          type="button"
          className="button ghost small profile-unfollow-button"
          onClick={onUnfollow}
        >
          {unfollowLabel}
        </button>
      )}
    </div>
  );
}

export function ProfilePage({
  artistRoute = false,
}: {
  artistRoute?: boolean;
}) {
  const { username = "" } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const me = useSession()!;
  useDatabaseVersion();
  const result = repository.profile(username);
  const db = repository.database();
  const avatarInput = useRef<HTMLInputElement>(null);
  const [displayNameDraft, setDisplayNameDraft] = useState("");
  const [usernameDraft, setUsernameDraft] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [connectionsOpen, setConnectionsOpen] =
    useState<ConnectionsTab>("following");
  const personalInfoRef = useRef<HTMLDivElement>(null);
  const connectionsRef = useRef<HTMLElement | null>(null);
  const usesApi = Boolean(
    (repository as unknown as { usesApi?: boolean }).usesApi,
  );

  useEffect(() => {
    if (!message && !error) return;
    const timer = window.setTimeout(() => {
      setMessage("");
      setError("");
    }, 4200);
    return () => window.clearTimeout(timer);
  }, [message, error]);

  useEffect(() => {
    if (!username) return;
    void repository.loadProfileData?.(username);
  }, [username]);

  useEffect(() => {
    if (!result) return;
    setDisplayNameDraft(result.user.displayName);
    setUsernameDraft(result.user.username);
  }, [result?.user.id, result?.user.displayName, result?.user.username]);

  const isOwnProfile = Boolean(result && result.user.id === me.id);

  useEffect(() => {
    const personal = personalInfoRef.current;
    const connections = connectionsRef.current;
    if (!isOwnProfile || !personal || !connections) {
      if (connections) {
        connections.style.height = "";
        connections.style.maxHeight = "";
      }
      return;
    }

    const syncHeight = () => {
      const height = Math.round(personal.getBoundingClientRect().height);
      connections.style.height = `${height}px`;
      connections.style.maxHeight = `${height}px`;
    };

    syncHeight();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", syncHeight);
      return () => window.removeEventListener("resize", syncHeight);
    }

    const observer = new ResizeObserver(syncHeight);
    observer.observe(personal);
    return () => observer.disconnect();
  }, [isOwnProfile, result?.user.id, displayNameDraft, usernameDraft, connectionsOpen]);

  if (!result || (artistRoute && !result.user.artistProfile))
    return (
      <div className="page">
        <EmptyState
          icon={LockKeyhole}
          title={t("notFound")}
          body={t("forbidden")}
        />
      </div>
    );

  const { user: profileUser, profile, playlists, releases, artistStats } = result;
  const user =
    profileUser.id === me.id
      ? {
          ...profileUser,
          email: profileUser.email || me.email,
          subscription: profileUser.subscription ?? me.subscription,
          explicitContentEnabled:
            profileUser.explicitContentEnabled ?? me.explicitContentEnabled,
          notificationPreference: me.notificationPreference,
          locale: profileUser.locale || me.locale,
          timezone: profileUser.timezone || me.timezone,
          theme: profileUser.theme || me.theme,
          birthDate: profileUser.birthDate || me.birthDate,
          streamDates: me.streamDates,
          listeningStats: profileUser.listeningStats ?? me.listeningStats,
          likedTrackIds: me.likedTrackIds,
          savedPlaylistIds: me.savedPlaylistIds,
          recentlyPlayedIds: me.recentlyPlayedIds,
          recentlyPlayedPlaylistIds: me.recentlyPlayedPlaylistIds,
        }
      : profileUser;
  const artist = user.artistProfile;
  const followers = resolvePeople(user.followerIds, db.users);
  const followingPeople = resolvePeople(user.followingIds, db.users);
  const own = user.id === me.id;
  const stats = own
    ? (user.listeningStats ?? {
        minutesListened: 0,
        dailyStreams: 0,
        listeningStreak: 0,
        weekBars: [0, 0, 0, 0, 0, 0, 0],
      })
    : null;
  const minutesListened = stats?.minutesListened ?? 0;
  const dailyStreams = stats?.dailyStreams ?? 0;
  const streak = stats?.listeningStreak ?? 0;
  const weekBars = stats?.weekBars ?? [0, 0, 0, 0, 0, 0, 0];
  const weekMax = Math.max(...weekBars, 1);
  const canChangeAvatar = own && canEditAvatar(me.subscription.tier);
  const personalDirty =
    displayNameDraft.trim() !== user.displayName ||
    normalizeUsername(usernameDraft) !== user.username;

  const cancelPersonalInfo = () => {
    setDisplayNameDraft(user.displayName);
    setUsernameDraft(user.username);
    setError("");
    setMessage("");
  };

  const savePersonalInfo = () => {
    setError("");
    setMessage("");
    const nextName = displayNameDraft.trim();
    if (!nextName) {
      setError(t("displayNameRequired"));
      return;
    }
    const nextUsername = normalizeUsername(usernameDraft);
    try {
      if (nextName !== user.displayName) {
        repository.updateSettings({ displayName: nextName });
      }
      if (nextUsername !== user.username) {
        repository.updateUsername(nextUsername);
        setMessage(t("profileUpdated"));
        navigate(`/profile/${nextUsername}`, { replace: true });
        return;
      }
      setMessage(t("profileUpdated"));
    } catch (reason) {
      setError(uiError(reason, t));
    }
  };

  const chooseAvatar = () => {
    setError("");
    setMessage("");
    if (!canChangeAvatar) {
      setError(t("profileImageGate"));
      return;
    }
    avatarInput.current?.click();
  };

  const onAvatarFile = (file: File | undefined) => {
    if (!file) return;
    if (!PROFILE_IMAGE_TYPES.includes(file.type)) {
      setError(t("profileImageInvalid"));
      return;
    }
    if (file.size > PROFILE_IMAGE_MAX_BYTES) {
      setError(t("profileImageTooLarge"));
      return;
    }
    if (usesApi) {
      Promise.resolve(repository.updateAvatar(file))
        .then(() => setMessage(t("avatarUpdated")))
        .catch((reason) => setError(uiError(reason, t)));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => setError(t("profileImageReadError"));
    reader.onload = () => {
      if (typeof reader.result !== "string") return;
      Promise.resolve(repository.updateAvatar(reader.result))
        .then(() => setMessage(t("avatarUpdated")))
        .catch((reason) => setError(uiError(reason, t)));
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="page profile-page">
      <header className={`profile-hero ${artist ? "artist" : ""}`}>
        <div className="profile-backdrop" />
        <div className="profile-copy">
          <span className="eyebrow">{t(artist ? "artist" : "profile")}</span>
          <h1>
            {profile.displayName}
            {artist?.verifiedAt && <BadgeCheck aria-label={t("verified")} />}
          </h1>
          <span>@{profile.username}</span>
          {artist?.bio && <p>{artist.bio}</p>}
          <div className="profile-stats">
            <span className={`plan-pill ${user.subscription.tier}`}>
              <Crown />
              {t(user.subscription.tier)}
            </span>
            {own ? (
              <>
                <button
                  type="button"
                  className="profile-stat-link"
                  onClick={() => setConnectionsOpen("followers")}
                >
                  <strong>{profile.followerCount}</strong> {t("followers")}
                </button>
                <button
                  type="button"
                  className="profile-stat-link"
                  onClick={() => setConnectionsOpen("following")}
                >
                  <strong>{profile.followingCount}</strong> {t("following")}
                </button>
              </>
            ) : (
              <>
                <span>
                  <strong>{profile.followerCount}</strong> {t("followers")}
                </span>
                <span>
                  <strong>{profile.followingCount}</strong> {t("following")}
                </span>
              </>
            )}
          </div>
        </div>
        <div className="profile-avatar-wrap">
          {user.avatarUrl ? (
            <img className="profile-avatar" src={user.avatarUrl} alt="" />
          ) : (
            <div className="profile-avatar fallback">
              {profile.displayName.slice(0, 1)}
            </div>
          )}
          {own && (
            <>
              <button
                type="button"
                className={`profile-avatar-edit ${canChangeAvatar ? "" : "is-locked"}`}
                onClick={chooseAvatar}
                aria-label={t("changeAvatar")}
                title={
                  canChangeAvatar ? t("changeAvatar") : t("profileImageGate")
                }
              >
                {canChangeAvatar ? <Camera /> : <LockKeyhole />}
              </button>
              <input
                ref={avatarInput}
                className="visually-hidden"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(event) => {
                  onAvatarFile(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
            </>
          )}
          {!own && (
            <button
              type="button"
              className={`button small profile-follow-button ${profile.isFollowing ? "ghost" : "primary"}`}
              onClick={() => repository.follow(user.id)}
            >
              <UserPlus />
              {t(profile.isFollowing ? "unfollow" : "follow")}
            </button>
          )}
        </div>
      </header>

      {own && (
        <div className="insight-grid">
          <div className="insight primary">
            <div>
              <span>{t("weeklySound")}</span>
              <strong>{minutesListened}</strong>
              <small>{t("minutesListened")}</small>
            </div>
            <div className="mini-bars">
              {weekBars.map((count, index) => (
                <i
                  key={index}
                  style={{
                    height: `${
                      count <= 0
                        ? 8
                        : Math.max(18, Math.round((count / weekMax) * 100))
                    }%`,
                  }}
                />
              ))}
            </div>
          </div>
          <div className="insight">
            <span className="insight-icon">
              <Headphones />
            </span>
            <div>
              <strong>{dailyStreams}</strong>
              <small>{t("dailyStreams")}</small>
            </div>
          </div>
          <div className="insight">
            <span className="insight-icon violet">
              <Flame />
            </span>
            <div>
              <strong>{streak}</strong>
              <small>{t("listeningStreak")}</small>
            </div>
          </div>
        </div>
      )}

      {(message || error) && (
        <div
          className={`app-toast ${error ? "is-error" : "is-success"}`}
          role={error ? "alert" : "status"}
          aria-live="polite"
        >
          <span className="app-toast-icon">
            {error ? <X /> : <Check />}
          </span>
          <p>{error || message}</p>
          <button
            type="button"
            className="app-toast-close"
            aria-label={t("close")}
            onClick={() => {
              setMessage("");
              setError("");
            }}
          >
            <X />
          </button>
        </div>
      )}

      {own && (
        <div className="profile-dashboard is-own">
          <div className="profile-dashboard-main" ref={personalInfoRef}>
            <section className="profile-edit-panel">
              <div className="profile-edit-heading">
                <h2>{t("personalInfo")}</h2>
              </div>

              <div className="profile-edit-grid">
                <label>
                  {t("displayName")}
                  <input
                    value={displayNameDraft}
                    onChange={(event) => setDisplayNameDraft(event.target.value)}
                  />
                </label>

                <label>
                  {t("username")}
                  <input
                    value={usernameDraft}
                    onChange={(event) => setUsernameDraft(event.target.value)}
                  />
                </label>

                <label>
                  {t("email")}
                  <input value={user.email} disabled />
                </label>

                <div className="profile-edit-actions">
                  <button
                    className="button ghost"
                    onClick={cancelPersonalInfo}
                    disabled={!personalDirty}
                  >
                    {t("cancel")}
                  </button>
                  <button
                    className="button primary"
                    onClick={savePersonalInfo}
                    disabled={!personalDirty}
                  >
                    {t("save")}
                  </button>
                </div>
              </div>
            </section>
          </div>

          <section
            className="profile-connections"
            id="profile-connections"
            ref={connectionsRef}
          >
            <div
              className={`profile-connection-item ${connectionsOpen === "followers" ? "is-open" : ""}`}
              id="profile-followers"
            >
              <button
                type="button"
                className={`profile-connection-tab ${connectionsOpen === "followers" ? "is-open" : ""}`}
                onClick={() => setConnectionsOpen("followers")}
                aria-expanded={connectionsOpen === "followers"}
              >
                <Users />
                <span>
                  {t("followers")}
                  <strong>{followers.length}</strong>
                </span>
                <ChevronDown />
              </button>
              {connectionsOpen === "followers" && (
                <div className="profile-connection-panel">
                  {followers.length ? (
                    <div className="profile-people-list">
                      {followers.map((person) => (
                        <PersonRow key={person.id} person={person} />
                      ))}
                    </div>
                  ) : (
                    <p className="muted profile-connection-empty">
                      {t("noFollowers")}
                    </p>
                  )}
                </div>
              )}
            </div>

            <div
              className={`profile-connection-item ${connectionsOpen === "following" ? "is-open" : ""}`}
              id="profile-following"
            >
              <button
                type="button"
                className={`profile-connection-tab ${connectionsOpen === "following" ? "is-open" : ""}`}
                onClick={() => setConnectionsOpen("following")}
                aria-expanded={connectionsOpen === "following"}
              >
                <UserPlus />
                <span>
                  {t("following")}
                  <strong>{followingPeople.length}</strong>
                </span>
                <ChevronDown />
              </button>
              {connectionsOpen === "following" && (
                <div className="profile-connection-panel">
                  {followingPeople.length ? (
                    <div className="profile-people-list">
                      {followingPeople.map((person) => (
                        <PersonRow
                          key={person.id}
                          person={person}
                          unfollowLabel={t("unfollowAction")}
                          onUnfollow={() => {
                            try {
                              repository.follow(person.id);
                            } catch (reason) {
                              setError(uiError(reason, t));
                            }
                          }}
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="muted profile-connection-empty">
                      {t("noFollowing")}
                    </p>
                  )}
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      {artist && me.subscription.tier === "gold" && artistStats && (
        <div className="metrics-grid">
          <div>
            <Users />
            <strong>{artistStats.uniqueListeners.toLocaleString(me.locale)}</strong>
            <span>{t("listeners")}</span>
          </div>
          <div>
            <Headphones />
            <strong>{artistStats.streams.toLocaleString(me.locale)}</strong>
            <span>{t("streams")}</span>
          </div>
          <div>
            <BarChart3 />
            <strong>{artistStats.releases.toLocaleString(me.locale)}</strong>
            <span>{t("releases")}</span>
          </div>
        </div>
      )}

      {artist && (
        <Section title={t("discography")}>
          {releases.length ? (
            <div className="media-grid">
              {releases.map((release) => (
                <MediaCard
                  key={release.id}
                  title={release.title}
                  subtitle={`${t(release.type)} · ${release.primaryArtist.stageName}`}
                  coverUrl={release.coverUrl}
                  href={`/release/${release.id}`}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              icon={Headphones}
              title={t("noReleases")}
              body=""
            />
          )}
        </Section>
      )}

      <Section title={t("publicPlaylists")}>
        {!artist && (
          <p className="privacy-note">
            <LockKeyhole />
            {t("privateBoundary")}
          </p>
        )}
        {playlists.length ? (
          <div className="media-grid">
            {playlists.map((playlist) => (
              <MediaCard
                key={playlist.id}
                title={playlist.title}
                subtitle={t("tracksCount", { count: playlist.trackIds.length })}
                collageUrls={playlist.trackIds.map(
                  (id) =>
                    db.tracks.find((track) => track.id === id)?.coverUrl ?? null,
                )}
                href={`/playlist/${playlist.id}`}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={Headphones}
            title={t("noPublicPlaylists")}
            body=""
          />
        )}
      </Section>

    </div>
  );
}
