import {
  Check,
  ChevronRight,
  LockKeyhole,
  Plus,
  Send,
  TicketCheck,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "../../components/EmptyState";
import { canOpenTicket } from "../../domain/entitlements";
import { repository } from "../../repositories/localRepository";
import { useDatabaseVersion, useSession } from "../../store/session";

const formatMessageTime = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export function TicketsPage() {
  const { t } = useTranslation();
  const me = useSession()!;
  useDatabaseVersion();
  const tickets = repository.tickets();
  const db = repository.database();
  const [creating, setCreating] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [reply, setReply] = useState("");
  const [selectedTicket, setSelectedTicket] = useState<string | null>(
    tickets[0]?.id ?? null,
  );
  const eligible = canOpenTicket(me);
  const ticket =
    tickets.find((item) => item.id === selectedTicket) ?? tickets[0] ?? null;

  useEffect(() => {
    void repository.loadTicketsData();
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

  useEffect(() => {
    setReply("");
  }, [selectedTicket]);

  const closeCreateModal = () => {
    setCreating(false);
    setSubject("");
    setBody("");
  };

  const createTicket = () => {
    if (!subject.trim() || !body.trim()) return;
    repository.createTicket(subject.trim(), body.trim());
    closeCreateModal();
  };

  const sendReply = () => {
    if (!ticket || !reply.trim()) return;
    repository.replyTicket(ticket.id, reply.trim());
    setReply("");
  };

  return (
    <div className="page tickets-page">
      <header className="page-heading with-action">
        <div>
          <h1>{t("tickets")}</h1>
        </div>
        {eligible ? (
          <button
            className="button primary"
            onClick={() => setCreating(true)}
          >
            <Plus />
            {t("newTicket")}
          </button>
        ) : null}
      </header>
      {!eligible && (
        <div className="locked-card">
          <LockKeyhole />
          <div>
            <h2>{t("ticketGate")}</h2>
            <p>
              {t("currentPlan")}: {t(me.subscription.tier)}
            </p>
          </div>
        </div>
      )}
      {tickets.length ? (
        <div className="ticket-layout">
          <aside className="ticket-list" aria-label={t("tickets")}>
            {tickets.map((item) => (
              <button
                type="button"
                className={item.id === ticket?.id ? "active" : ""}
                key={item.id}
                onClick={() => setSelectedTicket(item.id)}
              >
                <span className={`status-dot ${item.status}`} />
                <div>
                  <strong>{item.subject}</strong>
                  <small>
                    {t(item.status)} ·{" "}
                    {new Date(item.createdAt).toLocaleDateString()}
                  </small>
                </div>
                <ChevronRight />
              </button>
            ))}
          </aside>
          {ticket ? (
            <section className="ticket-thread">
              <header>
                <div className="ticket-thread-meta">
                  <span className="eyebrow">#{ticket.id.slice(-6)}</span>
                  <h2>{ticket.subject}</h2>
                  <span>{t(ticket.status)}</span>
                </div>
                <div className="ticket-thread-actions">
                  {ticket.status !== "closed" ? (
                    <button
                      className="button ghost"
                      onClick={() => repository.closeTicket(ticket.id)}
                    >
                      <Check />
                      {t("close")}
                    </button>
                  ) : null}
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
                      <time dateTime={message.createdAt}>
                        {formatMessageTime(message.createdAt)}
                      </time>
                    </div>
                  );
                })}
              </div>
              {ticket.status !== "closed" ? (
                <form
                  className="message-compose"
                  onSubmit={(event) => {
                    event.preventDefault();
                    sendReply();
                  }}
                >
                  <textarea
                    id={`ticket-reply-${ticket.id}`}
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
              ) : (
                <div className="ticket-closed-note">
                  <TicketCheck />
                  <span>{t("closed")}</span>
                </div>
              )}
            </section>
          ) : null}
        </div>
      ) : (
        <EmptyState
          icon={TicketCheck}
          title={t("noTickets")}
          body={t("notificationEmptyBody")}
        />
      )}
      {creating && eligible && (
        <div
          className="modal-backdrop"
          onClick={closeCreateModal}
          role="presentation"
        >
          <div
            className="modal new-ticket-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-ticket-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
              <div>
                <span className="eyebrow">{t("support")}</span>
                <h2 id="new-ticket-title">{t("newTicket")}</h2>
              </div>
              <button
                className="icon-button"
                onClick={closeCreateModal}
                aria-label={t("close")}
              >
                <X />
              </button>
            </div>
            <form
              className="new-ticket-form"
              onSubmit={(event) => {
                event.preventDefault();
                createTicket();
              }}
            >
              <label htmlFor="ticket-subject">
                {t("ticketSubject")}
                <input
                  id="ticket-subject"
                  name="subject"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  autoFocus
                />
              </label>
              <label htmlFor="ticket-body">
                {t("note")}
                <textarea
                  id="ticket-body"
                  name="body"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                />
              </label>
              <div className="modal-actions">
                <button
                  type="button"
                  className="button ghost"
                  onClick={closeCreateModal}
                >
                  {t("cancel")}
                </button>
                <button
                  type="submit"
                  className="button primary"
                  disabled={!subject.trim() || !body.trim()}
                >
                  <Plus />
                  {t("newTicket")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
