import {
  BadgeCheck,
  CalendarDays,
  Check,
  ChevronRight,
  CircleUserRound,
  ExternalLink,
  Globe2,
  Link2,
  Mail,
  Music2,
  Send,
  ShieldCheck,
  UserCheck,
  UserRound,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { VerificationRequest } from "../../domain/types";
import { repository } from "../../repositories/localRepository";
import { useDatabaseVersion, useSession } from "../../store/session";

function genderLabel(
  gender: string | null | undefined,
  t: (key: string) => string,
) {
  if (!gender) return "—";
  if (gender === "non_binary") return t("nonBinary");
  if (gender === "prefer_not_to_say") return t("preferNot");
  return t(gender);
}

function applicantFromRequest(
  request: VerificationRequest,
  dbUser:
    | ReturnType<typeof repository.database>["users"][number]
    | undefined,
) {
  return {
    stageName:
      request.artistName ||
      dbUser?.artistProfile?.stageName ||
      dbUser?.displayName ||
      "Artist",
    displayName: request.displayName || dbUser?.displayName || "—",
    username: request.username || dbUser?.username || "—",
    email: request.email || dbUser?.email || "—",
    avatarUrl: request.avatarUrl ?? dbUser?.avatarUrl ?? null,
    bio: request.bio || dbUser?.artistProfile?.bio || "",
    genre: request.genre || dbUser?.artistProfile?.genre || "",
    birthDate: request.birthDate || dbUser?.birthDate || null,
    gender: request.gender || dbUser?.gender || null,
    locale: request.locale || dbUser?.locale || "—",
    timezone: request.timezone || dbUser?.timezone || "—",
    accountCreatedAt: request.accountCreatedAt || null,
  };
}

export function SupportPage() {
  const { t } = useTranslation();
  const me = useSession()!;
  useDatabaseVersion();
  const db = repository.database();
  const requests = db.verificationRequests.filter(
    (request) => request.status === "pending",
  );
  const tickets = repository.tickets();
  const [tab, setTab] = useState<"verification" | "tickets">("verification");
  const [decision, setDecision] = useState<{
    id: string;
    approved: boolean;
  } | null>(null);
  const [reason, setReason] = useState("");
  const [selectedTicket, setSelectedTicket] = useState<string | null>(
    tickets[0]?.id ?? null,
  );
  const [reply, setReply] = useState("");

  useEffect(() => {
    void repository.loadSupportData();
  }, []);

  useEffect(() => {
    if (!tickets.length) {
      setSelectedTicket(null);
      return;
    }
    if (!selectedTicket || !tickets.some((item) => item.id === selectedTicket)) {
      setSelectedTicket(tickets[0].id);
    }
  }, [tickets, selectedTicket]);

  const ticket = tickets.find((item) => item.id === selectedTicket);
  const decide = () => {
    if (decision && reason.trim()) {
      repository.decideVerification(decision.id, decision.approved, reason);
      setDecision(null);
      setReason("");
    }
  };
  return (
    <div className="page support-page">
      <header className="page-heading">
        <h1>{t("support")}</h1>
      </header>
      <nav className="tab-bar">
        <button
          className={tab === "verification" ? "active" : ""}
          onClick={() => setTab("verification")}
        >
          {t("verificationQueue")}
        </button>
        <button
          className={tab === "tickets" ? "active" : ""}
          onClick={() => setTab("tickets")}
        >
          {t("tickets")}
        </button>
      </nav>
      {tab === "verification" && (
        <div className="staff-list verification-queue">
          {requests.length ? (
            requests.map((request) => {
              const user = db.users.find((item) => item.id === request.userId);
              const artist = applicantFromRequest(request, user);
              return (
                <article className="verification-request" key={request.id}>
                  <header className="verification-request-head">
                    <div className="request-avatar">
                      {artist.avatarUrl ? (
                        <img src={artist.avatarUrl} alt="" />
                      ) : (
                        <CircleUserRound />
                      )}
                    </div>
                    <div className="verification-request-title">
                      <h2>{artist.stageName}</h2>
                      <p>
                        @{artist.username}
                        <span aria-hidden> · </span>
                        {t("verificationSubmittedAt")}{" "}
                        {new Date(request.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <div className="request-actions">
                      <button
                        className="button creator"
                        onClick={() =>
                          setDecision({ id: request.id, approved: true })
                        }
                      >
                        <BadgeCheck />
                        {t("approve")}
                      </button>
                      <button
                        className="button ghost"
                        onClick={() =>
                          setDecision({ id: request.id, approved: false })
                        }
                      >
                        <X />
                        {t("reject")}
                      </button>
                    </div>
                  </header>

                  <div className="verification-request-body">
                    <section>
                      <h3>{t("verificationApplicant")}</h3>
                      <dl className="verification-facts">
                        <div>
                          <dt>
                            <UserRound />
                            {t("displayName")}
                          </dt>
                          <dd>{artist.displayName}</dd>
                        </div>
                        <div>
                          <dt>
                            <Mail />
                            {t("email")}
                          </dt>
                          <dd>
                            <a href={`mailto:${artist.email}`}>{artist.email}</a>
                          </dd>
                        </div>
                        <div>
                          <dt>
                            <CalendarDays />
                            {t("birthDate")}
                          </dt>
                          <dd>
                            {artist.birthDate
                              ? new Date(artist.birthDate).toLocaleDateString()
                              : "—"}
                          </dd>
                        </div>
                        <div>
                          <dt>
                            <UserCheck />
                            {t("gender")}
                          </dt>
                          <dd>{genderLabel(artist.gender, t)}</dd>
                        </div>
                        <div>
                          <dt>
                            <Globe2 />
                            {t("language")}
                          </dt>
                          <dd>
                            {artist.locale} · {artist.timezone}
                          </dd>
                        </div>
                        <div>
                          <dt>
                            <Music2 />
                            {t("genre")}
                          </dt>
                          <dd>{artist.genre || t("noGenreProvided")}</dd>
                        </div>
                        {artist.accountCreatedAt ? (
                          <div>
                            <dt>
                              <CalendarDays />
                              {t("accountCreated")}
                            </dt>
                            <dd>
                              {new Date(
                                artist.accountCreatedAt,
                              ).toLocaleDateString()}
                            </dd>
                          </div>
                        ) : null}
                      </dl>
                      <div className="verification-bio">
                        <strong>{t("artistBio")}</strong>
                        <p>{artist.bio || t("noBioProvided")}</p>
                      </div>
                    </section>

                    <section>
                      <h3>{t("verificationMaterials")}</h3>
                      <div className="verification-note">
                        <strong>{t("note")}</strong>
                        <p>{request.note || "—"}</p>
                      </div>
                      <div className="portfolio-links">
                        {request.portfolioUrls.length ? (
                          request.portfolioUrls.map((url) => (
                            <a
                              href={url}
                              target="_blank"
                              rel="noreferrer"
                              key={url}
                            >
                              <Link2 />
                              <span>{url}</span>
                              <ExternalLink />
                            </a>
                          ))
                        ) : (
                          <p className="muted">{t("portfolioUrl")}</p>
                        )}
                      </div>
                    </section>
                  </div>
                </article>
              );
            })
          ) : (
            <div className="empty-state">
              <ShieldCheck />
              <h2>{t("notificationEmpty")}</h2>
              <p>{t("verificationQueue")}</p>
            </div>
          )}
        </div>
      )}
      {tab === "tickets" && (
        <div className="ticket-layout">
          <aside className="ticket-list">
            {tickets.length ? (
              tickets.map((item) => {
                const creator = db.users.find(
                  (user) => user.id === item.creatorId,
                )!;
                return (
                  <button
                    className={item.id === selectedTicket ? "active" : ""}
                    key={item.id}
                    onClick={() => setSelectedTicket(item.id)}
                  >
                    <span className={`status-dot ${item.status}`} />
                    <div>
                      <strong>{item.subject}</strong>
                      <small>
                        {creator.displayName} · {t(item.status)}
                      </small>
                    </div>
                    <ChevronRight />
                  </button>
                );
              })
            ) : (
              <p>{t("noTickets")}</p>
            )}
          </aside>
          {ticket && (
            <section className="ticket-thread">
              <header>
                <div className="ticket-thread-meta">
                  <span className="eyebrow">#{ticket.id.slice(-6)}</span>
                  <h2>{ticket.subject}</h2>
                  <span>{t(ticket.status)}</span>
                </div>
                <div className="ticket-thread-actions">
                  <button
                    className="button ghost"
                    onClick={() => repository.closeTicket(ticket.id)}
                    disabled={ticket.status === "closed"}
                  >
                    <Check />
                    {t("close")}
                  </button>
                </div>
              </header>
              <div className="messages">
                {ticket.messages.map((message) => {
                  const own = message.authorId === me.id;
                  const author = db.users.find(
                    (user) => user.id === message.authorId,
                  );
                  return (
                    <div
                      className={`message ${own ? "own" : ""}`}
                      key={message.id}
                    >
                      <span>{author?.displayName}</span>
                      <p>{message.body}</p>
                      <time>
                        {new Date(message.createdAt).toLocaleString()}
                      </time>
                    </div>
                  );
                })}
              </div>
              {ticket.status !== "closed" && (
                <form
                  className="message-compose"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (reply.trim()) {
                      repository.replyTicket(ticket.id, reply);
                      setReply("");
                    }
                  }}
                >
                  <textarea
                    id={`staff-ticket-reply-${ticket.id}`}
                    name="reply"
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    placeholder={t("writeReply")}
                    aria-label={t("writeReply")}
                  />
                  <button
                    className="button primary send-btn"
                    type="submit"
                    aria-label={t("send")}
                    disabled={!reply.trim()}
                  >
                    <Send />
                  </button>
                </form>
              )}
            </section>
          )}
        </div>
      )}
      {decision && (
        <div className="modal-backdrop">
          <div className="modal">
            <div className="modal-head">
              <h2>{t(decision.approved ? "approve" : "reject")}</h2>
              <button className="icon-button" onClick={() => setDecision(null)}>
                <X />
              </button>
            </div>
            <label htmlFor="verification-decision-reason">
              {t("decisionReason")}
              <textarea
                id="verification-decision-reason"
                name="reason"
                autoFocus
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <div className="modal-actions">
              <button
                className="button primary wide"
                onClick={decide}
                disabled={!reason.trim()}
              >
                {t("confirm")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
