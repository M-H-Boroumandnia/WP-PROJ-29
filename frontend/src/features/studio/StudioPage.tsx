import {
  Activity,
  Archive,
  BadgeCheck,
  BarChart3,
  Check,
  CircleDashed,
  Clock3,
  Eye,
  FileAudio,
  Image,
  Link2,
  Music,
  Pencil,
  Save,
  ShieldCheck,
  Sparkles,
  Upload,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CoverArt } from "../../components/CoverArt";
import { repository } from "../../repositories/localRepository";
import { useDatabaseVersion, useSession } from "../../store/session";
import { uiError } from "../shared/errors";

const AUDIO_TYPES = ["audio/mpeg", "audio/wav", "audio/x-wav", "audio/flac"];
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const DRAFT_GENRES = [
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
type DraftFormState = {
  title: string;
  type: "single" | "album";
  genre: string;
  year: number;
  releaseDate: string;
  lyrics: string;
  collaborators: string;
  earlyAccess: boolean;
};

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
    (release) => release.ownerUserId === user.id,
  );
  const [tab, setTab] = useState<"overview" | "verification" | "draft">(
    "overview",
  );
  const [preview, setPreview] = useState<"artist" | "listener">("artist");
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
          className={tab === "overview" ? "active" : ""}
          onClick={() => setTab("overview")}
        >
          {t("catalog")}
        </button>
        <button
          className={tab === "verification" ? "active" : ""}
          onClick={() => setTab("verification")}
        >
          {t("verification")}
        </button>
        <button
          className={tab === "draft" ? "active" : ""}
          onClick={() => setTab("draft")}
        >
          {t("draftUpload")}
        </button>
      </nav>
      {tab === "overview" && (
        <StudioOverview
          verified={verified}
          releases={releases}
          preview={preview}
          setPreview={setPreview}
        />
      )}
      {tab === "verification" && (
        <VerificationPanel verified={verified} request={request} />
      )}
      {tab === "draft" && <DraftPanel verified={verified} />}
    </div>
  );
}

function StudioOverview({
  verified,
  releases,
  preview,
  setPreview,
}: {
  verified: boolean;
  releases: ReturnType<typeof repository.database>["releases"];
  preview: "artist" | "listener";
  setPreview: (value: "artist" | "listener") => void;
}) {
  const { t } = useTranslation();
  const db = repository.database();
  const user = useSession()!;
  const [editing, setEditing] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  if (!verified)
    return (
      <div className="studio-locked">
        <ShieldCheck />
        <h2>{t("verifiedOnly")}</h2>
        <p>{t("noPublishedCatalog")}</p>
      </div>
    );
  const totalStreams = releases.reduce(
    (sum, release) =>
      sum +
      release.trackIds.reduce(
        (n, id) =>
          n + (db.tracks.find((track) => track.id === id)?.streamCount ?? 0),
        0,
      ),
    0,
  );
  return (
    <>
      <div className="studio-metrics">
        <div>
          <Music />
          <span>{t("releases")}</span>
          <strong>{releases.length}</strong>
        </div>
        <div>
          <BarChart3 />
          <span>{t("streams")}</span>
          <strong>{totalStreams.toLocaleString()}</strong>
        </div>
        <div>
          <Activity />
          <span>{t("releaseHealth")}</span>
          <strong>{t("healthy")}</strong>
        </div>
      </div>
      <div className="preview-toggle">
        <span>{t("listenerView")}</span>
        <button
          className={preview === "listener" ? "active" : ""}
          onClick={() =>
            setPreview(preview === "artist" ? "listener" : "artist")
          }
        >
          <Eye />
          {t(preview === "artist" ? "artistView" : "listenerView")}
        </button>
      </div>
      <div className={`studio-catalog ${preview}`}>
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
                {editing === release.id ? (
                  <input
                    id={`release-title-${release.id}`}
                    name="releaseTitle"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    aria-label={t("release")}
                  />
                ) : (
                  <h3>{release.title}</h3>
                )}
                <span>
                  {t(release.type)} · {release.trackIds.length} {t("tracks")}
                </span>
                <div className="health-track">
                  <i
                    style={{
                      width: `${Math.min(100, 72 + release.trackIds.length * 5)}%`,
                    }}
                  />
                </div>
                <small>
                  <Check />
                  {t("healthy")}
                </small>
              </div>
              {preview === "artist" && (
                <div className="release-manage">
                  {editing === release.id ? (
                    <button
                      className="icon-button"
                      onClick={() => {
                        repository.updateRelease(release.id, { title });
                        setEditing(null);
                      }}
                    >
                      <Save />
                    </button>
                  ) : (
                    <button
                      className="icon-button"
                      onClick={() => {
                        setEditing(release.id);
                        setTitle(release.title);
                      }}
                    >
                      <Pencil />
                    </button>
                  )}
                  <button
                    className="icon-button danger"
                    onClick={() =>
                      repository.updateRelease(release.id, {
                        status: "archived",
                      })
                    }
                  >
                    <Archive />
                  </button>
                  <strong>{streams.toLocaleString()}</strong>
                  <span>{t("streams")}</span>
                </div>
              )}
            </article>
          );
        })}
      </div>
      <div className="analytics-chart">
        <div className="section-heading">
          <h2>{t("artistMetrics")}</h2>
          <span>{t("mockData")}</span>
        </div>
        <div className="bar-chart">
          {[41, 56, 48, 74, 69, 86, 78, 95, 82, 89, 96, 91].map(
            (value, index) => (
              <i
                key={index}
                style={{ height: `${value}%` }}
                title={`${value * 41}`}
              />
            ),
          )}
        </div>
        <span>{user.artistProfile?.stageName}</span>
      </div>
    </>
  );
}

function VerificationPanel({
  verified,
  request,
}: {
  verified: boolean;
  request:
    | ReturnType<typeof repository.database>["verificationRequests"][number]
    | undefined;
}) {
  const { t } = useTranslation();
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const submit = () => {
    try {
      repository.submitVerification([url], note);
      setMessage(t("submitted"));
    } catch (reason) {
      setMessage(uiError(reason, t));
    }
  };
  return (
    <div className="verification-layout">
      <div className="timeline-card">
        <h2>{t("verificationJourney")}</h2>
        <div className="timeline-step done">
          <span>
            <Check />
          </span>
          <div>
            <strong>{t("profileCreated")}</strong>
            <small>{t("done")}</small>
          </div>
        </div>
        <div className={`timeline-step ${request ? "done" : ""}`}>
          <span>{request ? <Check /> : <CircleDashed />}</span>
          <div>
            <strong>{t("submitted")}</strong>
            <small>
              {request
                ? new Date(request.createdAt).toLocaleDateString()
                : t("pending")}
            </small>
          </div>
        </div>
        <div
          className={`timeline-step ${verified ? "done" : request?.status === "rejected" ? "rejected" : ""}`}
        >
          <span>{verified ? <BadgeCheck /> : <CircleDashed />}</span>
          <div>
            <strong>
              {t(
                verified
                  ? "approved"
                  : request?.status === "rejected"
                    ? "rejected"
                    : "pending",
              )}
            </strong>
            <small>{request?.reason ?? t("verification")}</small>
          </div>
        </div>
      </div>
      {!verified && !request?.status?.includes("pending") && (
        <div className="verification-form">
          <h2>{t("submitRequest")}</h2>
          <label htmlFor="verification-portfolio">
            {t("portfolioUrl")}
            <span className="input-icon">
              <Link2 />
              <input
                id="verification-portfolio"
                name="portfolioUrl"
                type="url"
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
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <button className="button creator" onClick={submit} disabled={!url}>
            {t("submitRequest")}
          </button>
          {message && <p>{message}</p>}
        </div>
      )}
    </div>
  );
}

function DraftPanel({ verified }: { verified: boolean }) {
  const { t } = useTranslation();
  const [audio, setAudio] = useState<File | null>(null);
  const [cover, setCover] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<DraftFormState>({
    title: "",
    type: "single",
    genre: "",
    year: new Date().getFullYear(),
    releaseDate: "",
    lyrics: "",
    collaborators: "",
    earlyAccess: false,
  });
  const validateFile = (file: File, kind: "audio" | "image") => {
    const types = kind === "audio" ? AUDIO_TYPES : IMAGE_TYPES;
    const max = kind === "audio" ? 250 * 1024 * 1024 : 50 * 1024 * 1024;
    if (!types.includes(file.type)) {
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
  const save = () => {
    setSaving(true);
    setSaved(false);
    const publish = (
      repository as unknown as {
        publishReleaseDraft?: (
          form: DraftFormState,
          audio: File | null,
          cover: File | null,
        ) => Promise<void>;
      }
    ).publishReleaseDraft;
    const task = publish
      ? publish(form, audio, cover)
      : Promise.resolve(
          repository.saveDraft({
            ...form,
            audioFileInfo: audio
              ? `${audio.name} · ${audio.type} · ${audio.size} bytes`
              : null,
            coverFileInfo: cover
              ? `${cover.name} · ${cover.type} · ${cover.size} bytes`
              : null,
          }),
        );
    task
      .then(() => {
        setSaved(true);
        setError("");
      })
      .catch((reason) => setError(uiError(reason, t)))
      .finally(() => setSaving(false));
  };
  if (!verified)
    return (
      <div className="studio-locked">
        <ShieldCheck />
        <h2>{t("verifiedOnly")}</h2>
        <p>{t("uploadHonesty")}</p>
      </div>
    );
  return (
    <div className="draft-layout">
      <div className="honesty-banner">
        <ShieldCheck />
        <div>
          <strong>{t("draftUpload")}</strong>
          <p>{t("uploadHonesty")}</p>
        </div>
      </div>
      <div className="upload-grid">
        <label className="file-drop" htmlFor="studio-cover-file">
          {coverPreview ? <img src={coverPreview} alt="" /> : <Image />}
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
                if (coverPreview) URL.revokeObjectURL(coverPreview);
                setCover(file);
                setCoverPreview(URL.createObjectURL(file));
              }
            }}
          />
        </label>
        <label className="file-drop" htmlFor="studio-audio-file">
          <FileAudio />
          <strong>{t("audioFile")}</strong>
          <span>{audio?.name ?? t("audioSpecs")}</span>
          <input
            id="studio-audio-file"
            name="audio"
            type="file"
            accept="audio/mpeg,audio/wav,audio/flac"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file && validateFile(file, "audio")) setAudio(file);
            }}
          />
        </label>
      </div>
      <div className="draft-form">
        <label htmlFor="studio-release-title">
          {t("release")}
          <input
            id="studio-release-title"
            name="title"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
        </label>
        <label htmlFor="studio-release-type">
          {t("releaseType")}
          <select
            id="studio-release-type"
            name="type"
            value={form.type}
            onChange={(e) =>
              setForm({ ...form, type: e.target.value as typeof form.type })
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
            onChange={(e) => setForm({ ...form, genre: e.target.value })}
          >
            <option value="">—</option>
            {DRAFT_GENRES.map((genre) => (
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
            onChange={(e) => setForm({ ...form, year: Number(e.target.value) })}
          />
        </label>
        <label htmlFor="studio-release-date">
          {t("releaseDate")}
          <input
            id="studio-release-date"
            name="releaseDate"
            type="date"
            value={form.releaseDate}
            onChange={(e) => setForm({ ...form, releaseDate: e.target.value })}
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
        <label className="wide" htmlFor="studio-lyrics">
          {t("lyrics")}
          <textarea
            id="studio-lyrics"
            name="lyrics"
            value={form.lyrics}
            onChange={(e) => setForm({ ...form, lyrics: e.target.value })}
          />
        </label>
        <label className="check-row wide" htmlFor="studio-early-access">
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
      {error && <p className="form-error">{error}</p>}
      {saved && (
        <p className="notice-line">
          <Check />
          {t("draftSaved")}
        </p>
      )}
      <button
        className="button creator"
        onClick={save}
        disabled={!form.title || saving}
      >
        <Upload />
        {saving ? t("uploading") : t("saveDraft")}
      </button>
    </div>
  );
}
