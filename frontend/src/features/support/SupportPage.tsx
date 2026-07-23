import {
  BadgeCheck,
  Check,
  ChevronRight,
  CircleUserRound,
  Headphones,
  Send,
  ShieldCheck,
  UserCheck,
  X,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { repository } from "../../repositories/localRepository";
import { useDatabaseVersion, useSession } from "../../store/session";

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
  const [selectedTicket, setSelectedTicket] = useState(tickets[0]?.id ?? null);
  const [reply, setReply] = useState("");
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
      <header className="staff-hero">
        <div>
          <span className="eyebrow">
            <Headphones />
            {t("supportRole")}
          </span>
          <h1>{t("support")}</h1>
          <p>{me.displayName}</p>
        </div>
        <div className="staff-stat">
          <strong>{requests.length}</strong>
          <span>{t("pending")}</span>
        </div>
        <div className="staff-stat">
          <strong>
            {tickets.filter((item) => item.status !== "closed").length}
          </strong>
          <span>{t("open")}</span>
        </div>
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
        <div className="staff-list">
          {requests.length ? (
            requests.map((request) => {
              const user = db.users.find((item) => item.id === request.userId)!;
              return (
                <article className="verification-request" key={request.id}>
                  <div className="request-avatar">
                    <CircleUserRound />
                  </div>
                  <div>
                    <h2>{user.artistProfile?.stageName}</h2>
                    <span>
                      @{user.username} ·{" "}
                      {new Date(request.createdAt).toLocaleDateString()}
                    </span>
                    <p>{request.note}</p>
                    <div className="portfolio-links">
                      {request.portfolioUrls.map((url) => (
                        <a
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          key={url}
                        >
                          {url}
                        </a>
                      ))}
                    </div>
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
                <div>
                  <span className="eyebrow">#{ticket.id.slice(-6)}</span>
                  <h2>{ticket.subject}</h2>
                  <span>{t(ticket.status)}</span>
                </div>
                <div>
                  {ticket.status !== "closed" && (
                    <button
                      className="button ghost"
                      onClick={() => repository.claimTicket(ticket.id)}
                    >
                      <UserCheck />
                      {t(ticket.claimedById === me.id ? "unclaim" : "claim")}
                    </button>
                  )}
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
            <button
              className="button primary wide"
              onClick={decide}
              disabled={!reason.trim()}
            >
              {t("confirm")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
