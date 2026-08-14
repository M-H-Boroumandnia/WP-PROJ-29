import {
  BadgeCheck,
  Check,
  CircleDashed,
  Clock3,
  FileAudio,
  Image,
  Link2,
  Pencil,
  Plus,
  Send,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  UserRound,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CoverArt } from "../../components/CoverArt";
import type { Release, VerificationRequest } from "../../domain/types";
import { repository } from "../../repositories/localRepository";
import { useDatabaseVersion, useSession } from "../../store/session";
import { uiError } from "../shared/errors";
import { StudioStatistics } from "./StudioStatistics";

const AUDIO_TYPES = [
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/flac",
  "audio/x-flac",
];
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const RELEASE_GENRES = [
  "Ambient",
  "Downtempo",
  "Electronic",
  "Indie",
  "Synthwave",
  "Pop",
  "Hip-Hop",
  "Jazz",
  "Rock",
  "R&B",
] as const;

type ReleaseFormState = {
  title: string;
  type: "single" | "album";
  genre: string;
  year: number;
  releaseDate: string;
  collaborators: string;
  earlyAccess: boolean;
};

type TrackDraft = {
  key: string;
  id: string | null;
  title: string;
  lyrics: string;
  audio: File | null;
  audioLabel: string | null;
};

const emptyForm = (): ReleaseFormState => ({
  title: "",
  type: "single",
  genre: "",
  year: new Date().getFullYear(),
  releaseDate: "",
  collaborators: "",
  earlyAccess: false,
});

const emptyTrack = (partial?: Partial<TrackDraft>): TrackDraft => ({
  key: partial?.key ?? `new-${Math.random().toString(36).slice(2, 9)}`,
  id: partial?.id ?? null,
  title: partial?.title ?? "",
  lyrics: partial?.lyrics ?? "",
  audio: partial?.audio ?? null,
  audioLabel: partial?.audioLabel ?? null,
});

function formFromRelease(release: Release): ReleaseFormState {
  const db = repository.database();
  const tracks = release.trackIds
    .map((id) => db.tracks.find((track) => track.id === id))
    .filter(Boolean);
  const collaborators = [
    ...new Set(
      tracks.flatMap(
        (track) =>
          track?.artists
            .filter((artist) => artist.role !== "primary")
            .map((artist) => artist.stageName) ?? [],
      ),
    ),
  ].join(", ");
  const date = release.publicReleaseAt.slice(0, 10);
  return {
    title: release.title,
    type: release.type,
    genre: release.genre,
    year: Number(date.slice(0, 4)) || new Date().getFullYear(),
    releaseDate: date,
    collaborators,
    earlyAccess: release.isEarlyAccess,
  };
}

function tracksFromRelease(release: Release | null): TrackDraft[] {
  if (!release) return [emptyTrack()];
  const db = repository.database();
  if (!release.trackIds.length) return [emptyTrack()];
  return release.trackIds.map((id) => {
    const track = db.tracks.find((item) => item.id === id);
    if (!track)
      return emptyTrack({
        key: id,
        id,
        title: "",
        lyrics: "",
        audioLabel: null,
      });
    return emptyTrack({
      key: track.id,
      id: track.id,
      title: track.title,
      lyrics: track.lyrics ?? "",
      audioLabel: track.hasAudio || Boolean(track.audioUrl) ? "uploaded" : null,
    });
  });
}

export function StudioPage() {
  const { t } = useTranslation();
  const user = useSession()!;
  useDatabaseVersion();
  const db = repository.database();
  const verified = Boolean(user.artistProfile?.verifiedAt);
  const request = db.verificationRequests
    .filter((item) => item.userId === user.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const releases = db.releases.filter(
    (release) =>
      release.ownerUserId === user.id && release.status !== "archived",
  );
  const [tab, setTab] = useState<"releases" | "statistics" | "verification">(
    "releases",
  );

  useEffect(() => {
    void repository.loadStudioData();
  }, []);

  return (
    <div className="page studio-page">
      <header className="studio-hero">
        <div>
          <span className="eyebrow">
            <Sparkles />
            {t("artist")}
          </span>
          <h1>{t("studio")}</h1>
          <p>{user.artistProfile?.stageName}</p>
        </div>
        <span
          className={`verification-chip ${verified ? "verified" : "pending"}`}
        >
          {verified ? <BadgeCheck /> : <Clock3 />}
          {t(verified ? "verified" : (request?.status ?? "verification"))}
        </span>
      </header>
      <nav className="tab-bar">
        <button
          className={tab === "releases" ? "active" : ""}
          onClick={() => setTab("releases")}
        >
          {t("releases")}
        </button>
        <button
          className={tab === "statistics" ? "active" : ""}
          onClick={() => setTab("statistics")}
        >
          {t("statistics")}
        </button>
        <button
          className={tab === "verification" ? "active" : ""}
          onClick={() => setTab("verification")}
        >
          {t("verification")}
        </button>
      </nav>
      {tab === "releases" && (
        <StudioReleases verified={verified} releases={releases} />
      )}
      {tab === "statistics" && <StudioStatistics verified={verified} />}
      {tab === "verification" && (
        <VerificationPanel verified={verified} request={request} />
      )}
    </div>
  );
}

function StudioReleases({
  verified,
  releases,
}: {
  verified: boolean;
  releases: Release[];
}) {
  const { t } = useTranslation();
  const db = repository.database();
  const [editor, setEditor] = useState<Release | null | "new">(null);
  const [pendingDelete, setPendingDelete] = useState<Release | null>(null);

  const openEditor = async (target: Release | "new") => {
    if (target !== "new" && target.trackIds.length) {
      await repository.loadTracksByIds?.(target.trackIds);
    }
    setEditor(target);
  };

  if (!verified)
    return (
      <div className="studio-locked">
        <ShieldCheck />
        <h2>{t("verifiedOnly")}</h2>
      </div>
    );

  return (
    <>
      <div className="studio-releases-toolbar">
        <button className="button creator" onClick={() => void openEditor("new")}>
          <Plus />
          {t("newRelease")}
        </button>
      </div>
      <div className="studio-releases">
        {releases.map((release) => {
          const streams = release.trackIds.reduce(
            (sum, id) =>
              sum +
              (db.tracks.find((track) => track.id === id)?.streamCount ?? 0),
            0,
          );
          return (
            <article className="release-health-card" key={release.id}>
              <CoverArt src={release.coverUrl} alt={release.title} />
              <div className="release-health-main">
                <h3>{release.title}</h3>
                <span>
                  {t(release.type)} · {release.trackIds.length} {t("tracks")}
                </span>
              </div>
              <div className="release-manage">
                <div className="release-manage-actions">
                  <button
                    className="icon-button"
                    onClick={() => void openEditor(release)}
                    aria-label={t("editRelease")}
                  >
                    <Pencil />
                  </button>
                  <button
                    className="icon-button danger"
                    onClick={() => setPendingDelete(release)}
                    aria-label={t("deleteRelease")}
                  >
                    <Trash2 />
                  </button>
                </div>
                <strong>{streams.toLocaleString()}</strong>
                <span>{t("streams")}</span>
              </div>
            </article>
          );
        })}
      </div>
      {editor !== null && (
        <ReleaseEditorModal
          release={editor === "new" ? null : editor}
          onClose={() => setEditor(null)}
        />
      )}
      {pendingDelete && (
        <div className="modal-backdrop" onClick={() => setPendingDelete(null)}>
          <div
            className="modal confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-release-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
              <div>
                <span className="eyebrow">{t("releases")}</span>
                <h2 id="delete-release-title">
                  {t("deleteReleaseConfirmTitle")}
                </h2>
              </div>
              <button
                className="icon-button"
                onClick={() => setPendingDelete(null)}
                aria-label={t("close")}
              >
                <X />
              </button>
            </div>
            <p className="muted">
              {t("deleteReleaseConfirmBody", { title: pendingDelete.title })}
            </p>
            <div className="modal-actions">
              <button
                className="button ghost"
                onClick={() => setPendingDelete(null)}
              >
                {t("cancel")}
              </button>
              <button
                className="button danger"
                onClick={() => {
                  const target = pendingDelete;
                  setPendingDelete(null);
                  void Promise.resolve(
                    repository.updateRelease(target.id, {
                      status: "archived",
                    }),
                  ).catch(() => undefined);
                }}
              >
                <Trash2 />
                {t("deleteRelease")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ReleaseEditorModal({
  release,
  onClose,
}: {
  release: Release | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const editing = Boolean(release);
  const initialForm = useMemo(
    () => (release ? formFromRelease(release) : emptyForm()),
    [release],
  );
  const initialTracks = useMemo(() => tracksFromRelease(release), [release]);
  const [step, setStep] = useState<"details" | "tracks">("details");
  const [form, setForm] = useState<ReleaseFormState>(initialForm);
  const [tracks, setTracks] = useState<TrackDraft[]>(initialTracks);
  const [cover, setCover] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(
    release?.coverUrl ?? null,
  );
  const [removedTrackIds, setRemovedTrackIds] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setStep("details");
    setForm(initialForm);
    setTracks(initialTracks);
    setCover(null);
    setCoverPreview(release?.coverUrl ?? null);
    setRemovedTrackIds([]);
    setError("");
  }, [initialForm, initialTracks, release]);

  useEffect(() => {
    return () => {
      if (coverPreview?.startsWith("blob:")) URL.revokeObjectURL(coverPreview);
    };
  }, [coverPreview]);

  const setTrack = (key: string, patch: Partial<TrackDraft>) => {
    setTracks((rows) =>
      rows.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );
  };

  const setType = (type: "single" | "album") => {
    setForm((current) => ({ ...current, type }));
    setTracks((rows) => {
      if (type === "single") return [rows[0] ?? emptyTrack()];
      return rows.length ? rows : [emptyTrack()];
    });
  };

  const validateFile = (file: File, kind: "audio" | "image") => {
    const types = kind === "audio" ? AUDIO_TYPES : IMAGE_TYPES;
    const max = kind === "audio" ? 250 * 1024 * 1024 : 50 * 1024 * 1024;
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    const extOk =
      kind === "audio"
        ? ["mp3", "wav", "flac"].includes(ext)
        : ["jpg", "jpeg", "png", "webp"].includes(ext);
    if (file.type && !types.includes(file.type) && !extOk) {
      setError(t("fileTypeInvalid"));
      return false;
    }
    if (!file.type && !extOk) {
      setError(t("fileTypeInvalid"));
      return false;
    }
    if (file.size > max) {
      setError(t("fileTooLarge"));
      return false;
    }
    setError("");
    return true;
  };

  const canContinueDetails =
    Boolean(form.title.trim()) && Boolean(editing ? coverPreview : cover);

  const canSave =
    canContinueDetails &&
    tracks.length > 0 &&
    tracks.every((track) => track.title.trim()) &&
    tracks.every((track) => Boolean(track.id || track.audio));

  const goToTracks = () => {
    if (!canContinueDetails) {
      setError(t("releaseDetailsRequired"));
      return;
    }
    setError("");
    if (release?.trackIds.length) {
      void repository.loadTracksByIds?.(release.trackIds).then(() => {
        setTracks((current) => {
          const fresh = tracksFromRelease(release);
          return current.map((row) => {
            if (!row.id || row.audio) return row;
            const loaded = fresh.find((item) => item.id === row.id);
            if (!loaded) return row;
            return {
              ...row,
              title: row.title.trim() ? row.title : loaded.title,
              lyrics: row.lyrics.trim() ? row.lyrics : loaded.lyrics,
              audioLabel: row.audioLabel ?? loaded.audioLabel,
            };
          });
        });
      });
    }
    setStep("tracks");
  };

  const save = () => {
    if (!canSave) {
      setError(t("releaseTracksRequired"));
      return;
    }
    setSaving(true);
    const api = repository as typeof repository & {
      saveRelease?: (
        releaseId: string | null,
        form: ReleaseFormState,
        tracks: TrackDraft[],
        cover: File | null,
        removedTrackIds?: string[],
      ) => Promise<void>;
    };
    if (!api.saveRelease) {
      setError(t("verifiedOnly"));
      setSaving(false);
      return;
    }
    api
      .saveRelease(release?.id ?? null, form, tracks, cover, removedTrackIds)
      .then(() => {
        setError("");
        onClose();
      })
      .catch((reason) => setError(uiError(reason, t)))
      .finally(() => setSaving(false));
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal release-editor-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="release-editor-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <span className="eyebrow">
              {step === "details" ? t("studio") : t("tracksSection")}
            </span>
            <h2 id="release-editor-title">
              {step === "details"
                ? t(editing ? "editRelease" : "newRelease")
                : t("tracksPopupTitle")}
            </h2>
          </div>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label={t("close")}
          >
            <X />
          </button>
        </div>
        <div className="release-editor-body">
          {step === "details" ? (
            <>
              <p className="muted release-editor-hint">{t("uploadHonesty")}</p>
              <section className="release-editor-section">
                <h3>{t("releaseDetails")}</h3>
                <label
                  className={`file-drop file-drop-cover${coverPreview ? " has-preview" : ""}`}
                  htmlFor="studio-cover-file"
                >
                  {coverPreview ? (
                    <img
                      className="file-drop-preview"
                      src={coverPreview}
                      alt=""
                    />
                  ) : (
                    <Image />
                  )}
                  <strong>{t("coverFile")}</strong>
                  <span>{cover?.name ?? t("imageSpecs")}</span>
                  <input
                    id="studio-cover-file"
                    name="cover"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file && validateFile(file, "image")) {
                        if (coverPreview?.startsWith("blob:"))
                          URL.revokeObjectURL(coverPreview);
                        setCover(file);
                        setCoverPreview(URL.createObjectURL(file));
                      }
                    }}
                  />
                </label>
                <div className="draft-form release-editor-fields">
                  <label htmlFor="studio-release-title">
                    {t("release")}
                    <input
                      id="studio-release-title"
                      name="title"
                      value={form.title}
                      onChange={(e) =>
                        setForm({ ...form, title: e.target.value })
                      }
                    />
                  </label>
                  <label htmlFor="studio-release-type">
                    {t("releaseType")}
                    <select
                      id="studio-release-type"
                      name="type"
                      value={form.type}
                      onChange={(e) =>
                        setType(e.target.value as ReleaseFormState["type"])
                      }
                    >
                      <option value="single">{t("single")}</option>
                      <option value="album">{t("album")}</option>
                    </select>
                  </label>
                  <label htmlFor="studio-genre">
                    {t("genre")}
                    <select
                      id="studio-genre"
                      name="genre"
                      value={form.genre}
                      onChange={(e) =>
                        setForm({ ...form, genre: e.target.value })
                      }
                    >
                      <option value="">—</option>
                      {RELEASE_GENRES.map((genre) => (
                        <option key={genre} value={genre}>
                          {genre}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label htmlFor="studio-year">
                    {t("year")}
                    <input
                      id="studio-year"
                      name="year"
                      type="number"
                      value={form.year}
                      onChange={(e) =>
                        setForm({ ...form, year: Number(e.target.value) })
                      }
                    />
                  </label>
                  <label htmlFor="studio-release-date">
                    {t("releaseDate")}
                    <input
                      id="studio-release-date"
                      name="releaseDate"
                      type="date"
                      value={form.releaseDate}
                      onChange={(e) =>
                        setForm({ ...form, releaseDate: e.target.value })
                      }
                    />
                  </label>
                  <label htmlFor="studio-collaborators">
                    {t("collaborators")}
                    <input
                      id="studio-collaborators"
                      name="collaborators"
                      value={form.collaborators}
                      onChange={(e) =>
                        setForm({ ...form, collaborators: e.target.value })
                      }
                    />
                  </label>
                  <label
                    className="check-row wide"
                    htmlFor="studio-early-access"
                  >
                    <input
                      id="studio-early-access"
                      name="earlyAccess"
                      type="checkbox"
                      checked={form.earlyAccess}
                      onChange={(e) =>
                        setForm({ ...form, earlyAccess: e.target.checked })
                      }
                    />
                    {t("earlyAccessOption")}
                  </label>
                </div>
              </section>
            </>
          ) : (
            <section className="release-editor-section">
              <p className="muted release-editor-hint">
                {form.type === "album"
                  ? t("tracksPopupAlbumHint")
                  : t("tracksPopupSingleHint")}
              </p>
              <div className="release-tracks-head">
                <h3>{form.title || t("tracksSection")}</h3>
                {form.type === "album" && (
                  <button
                    type="button"
                    className="button ghost small"
                    onClick={() => setTracks((rows) => [...rows, emptyTrack()])}
                  >
                    <Plus />
                    {t("addTrack")}
                  </button>
                )}
              </div>
              <div className="release-track-list">
                {tracks.map((track, index) => (
                  <article className="release-track-card" key={track.key}>
                    <div className="release-track-card-head">
                      <strong>
                        {t("trackNumber", { number: index + 1 })}
                      </strong>
                      {form.type === "album" && tracks.length > 1 && (
                        <button
                          type="button"
                          className="icon-button danger"
                          aria-label={t("removeTrack")}
                          onClick={() => {
                            if (track.id)
                              setRemovedTrackIds((ids) => [...ids, track.id!]);
                            setTracks((rows) =>
                              rows.filter((row) => row.key !== track.key),
                            );
                          }}
                        >
                          <Trash2 />
                        </button>
                      )}
                    </div>
                    <div className="release-track-grid">
                      <label htmlFor={`track-title-${track.key}`}>
                        {t("trackTitle")}
                        <input
                          id={`track-title-${track.key}`}
                          value={track.title}
                          onChange={(e) =>
                            setTrack(track.key, { title: e.target.value })
                          }
                        />
                      </label>
                      <label
                        className={`file-drop file-drop-audio${
                          track.audio || track.audioLabel ? " has-file" : ""
                        }`}
                        htmlFor={`track-audio-${track.key}`}
                      >
                        <FileAudio />
                        <strong>{t("audioFile")}</strong>
                        <span>
                          {track.audio?.name ??
                            (track.audioLabel
                              ? t("audioKeepExisting")
                              : t("audioSpecs"))}
                        </span>
                        <input
                          id={`track-audio-${track.key}`}
                          type="file"
                          accept="audio/mpeg,audio/wav,audio/flac"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file && validateFile(file, "audio"))
                              setTrack(track.key, {
                                audio: file,
                                audioLabel: file.name,
                              });
                          }}
                        />
                      </label>
                      <label
                        className="wide"
                        htmlFor={`track-lyrics-${track.key}`}
                      >
                        {t("lyrics")}
                        <textarea
                          id={`track-lyrics-${track.key}`}
                          value={track.lyrics}
                          onChange={(e) =>
                            setTrack(track.key, { lyrics: e.target.value })
                          }
                        />
                      </label>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}

          {error && <p className="form-error">{error}</p>}
        </div>
        <div className="modal-actions">
          {step === "details" ? (
            <>
              <button
                className="button ghost"
                onClick={onClose}
                disabled={saving}
              >
                {t("cancel")}
              </button>
              <button
                className="button creator"
                onClick={goToTracks}
                disabled={!canContinueDetails || saving}
              >
                {t("continueToTracks")}
              </button>
            </>
          ) : (
            <>
              <button
                className="button ghost"
                onClick={() => {
                  setError("");
                  setStep("details");
                }}
                disabled={saving}
              >
                {t("back")}
              </button>
              <button
                className="button creator"
                onClick={save}
                disabled={!canSave || saving}
              >
                <Upload />
                {saving
                  ? t("uploading")
                  : t(editing ? "saveRelease" : "newRelease")}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

type StepState = "done" | "current" | "upcoming" | "rejected";

function VerificationPanel({
  verified,
  request,
}: {
  verified: boolean;
  request: VerificationRequest | undefined;
}) {
  const { t } = useTranslation();
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const rejected = request?.status === "rejected";
  const pending = request?.status === "pending";
  const canSubmit = !verified && !pending;

  const status = verified
    ? "verified"
    : rejected
      ? "rejected"
      : pending
        ? "pending"
        : "ready";

  const steps: {
    key: string;
    title: string;
    detail: string;
    state: StepState;
    icon: typeof Check;
  }[] = [
    {
      key: "profile",
      title: t("verificationStepProfile"),
      detail: t("verificationStepProfileHint"),
      state: "done",
      icon: UserRound,
    },
    {
      key: "submit",
      title: t("verificationStepSubmit"),
      detail: request
        ? new Date(request.createdAt).toLocaleDateString()
        : t("verificationStepSubmitHint"),
      state: request || verified ? "done" : "current",
      icon: Send,
    },
    {
      key: "review",
      title: t("verificationStepReview"),
      detail: pending
        ? t("verificationStepReviewHint")
        : verified || rejected
          ? t("done")
          : t("pending"),
      state: verified || rejected ? "done" : pending ? "current" : "upcoming",
      icon: Clock3,
    },
    {
      key: "decision",
      title: t(
        verified ? "approved" : rejected ? "rejected" : "verificationStepDecision",
      ),
      detail: verified
        ? t("verificationStepDecisionApproved")
        : rejected
          ? (request?.reason || t("verificationStepDecisionRejected"))
          : t("verificationStepDecisionHint"),
      state: verified ? "done" : rejected ? "rejected" : "upcoming",
      icon: verified ? BadgeCheck : rejected ? ShieldAlert : CircleDashed,
    },
  ];

  const submit = () => {
    try {
      repository.submitVerification([url], note);
      setMessage(t("submitted"));
      setUrl("");
      setNote("");
    } catch (reason) {
      setMessage(uiError(reason, t));
    }
  };

  return (
    <div className="verification-flow">
      <header className={`verification-status verification-status-${status}`}>
        <span className="verification-status-icon" aria-hidden>
          {verified ? (
            <BadgeCheck />
          ) : rejected ? (
            <ShieldAlert />
          ) : pending ? (
            <Clock3 />
          ) : (
            <ShieldCheck />
          )}
        </span>
        <div>
          <p className="eyebrow">{t("verificationJourney")}</p>
          <h2>{t(`verificationStatus_${status}`)}</h2>
          <p>{t(`verificationStatusHint_${status}`)}</p>
        </div>
      </header>

      <ol className="verification-steps" aria-label={t("verificationJourney")}>
        {steps.map((step, index) => {
          const Icon = step.state === "done" ? Check : step.icon;
          return (
            <li
              key={step.key}
              className={`verification-step verification-step-${step.state}`}
            >
              {index > 0 && (
                <span
                  className="verification-step-rail"
                  aria-hidden
                  data-filled={
                    steps[index - 1].state === "done" ? "true" : "false"
                  }
                />
              )}
              <span className="verification-step-marker">
                <Icon />
              </span>
              <div className="verification-step-copy">
                <strong>{step.title}</strong>
                <small>{step.detail}</small>
              </div>
            </li>
          );
        })}
      </ol>

      {pending && (
        <div className="verification-wait">
          <Clock3 />
          <div>
            <strong>{t("verificationWaitingTitle")}</strong>
            <p>{t("verificationWaitingBody")}</p>
          </div>
        </div>
      )}

      {verified && (
        <div className="verification-wait verification-wait-success">
          <BadgeCheck />
          <div>
            <strong>{t("verificationUnlockedTitle")}</strong>
            <p>{t("verificationUnlockedBody")}</p>
          </div>
        </div>
      )}

      {canSubmit && (
        <div className="verification-form">
          <div>
            <h2>
              {rejected ? t("verificationResubmit") : t("submitRequest")}
            </h2>
            <p>{t("verificationFormHint")}</p>
          </div>
          <label htmlFor="verification-portfolio">
            {t("portfolioUrl")}
            <span className="input-icon">
              <Link2 />
              <input
                id="verification-portfolio"
                name="portfolioUrl"
                type="url"
                placeholder="https://"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </span>
          </label>
          <label htmlFor="verification-note">
            {t("note")}
            <textarea
              id="verification-note"
              name="note"
              rows={4}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <button className="button creator" onClick={submit} disabled={!url}>
            <Send />
            {rejected ? t("verificationResubmit") : t("submitRequest")}
          </button>
          {message && <p className="verification-form-message">{message}</p>}
        </div>
      )}
    </div>
  );
}
