import {
  Check,
  ChevronDown,
  LockKeyhole,
  Plus,
  Send,
  TicketCheck,
  X,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "../../components/EmptyState";
import { canOpenTicket } from "../../domain/entitlements";
import type { Ticket } from "../../domain/types";
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
  const [reply, setReply] = useState<Record<string, string>>({});
  const [expandedClosedId, setExpandedClosedId] = useState<string | null>(null);
  const eligible = canOpenTicket(me);
  const activeTickets = tickets.filter((ticket) => ticket.status !== "closed");
  const closedTickets = tickets.filter((ticket) => ticket.status === "closed");

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

  const sendReply = (ticketId: string) => {
    const text = reply[ticketId]?.trim();
    if (!text) return;
    repository.replyTicket(ticketId, text);
    setReply({ ...reply, [ticketId]: "" });
  };

  const toggleClosed = (ticketId: string) => {
    setExpandedClosedId((current) => (current === ticketId ? null : ticketId));
  };

  const renderMessages = (ticket: Ticket) => (
    <div className="messages">
      {ticket.messages.map((message) => {
        const own = message.authorId === me.id;
        const author = db.users.find((user) => user.id === message.authorId);
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
  );

  return (
    <div className="page tickets-page">
      <header className="page-heading with-action">
        <div>
          <span className="eyebrow">{t("support")}</span>
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
      <div className="consumer-tickets">
        {tickets.length ? (
          <>
            {activeTickets.map((ticket) => (
              <article key={ticket.id}>
                <header>
                  <span className="ticket-icon" aria-hidden>
                    <TicketCheck />
                  </span>
                  <div>
                    <h2>{ticket.subject}</h2>
                    <span className="ticket-meta">
                      <span className={`ticket-status ${ticket.status}`}>
                        {t(ticket.status)}
                      </span>
                      <span>
                        {new Date(ticket.createdAt).toLocaleDateString()}
                      </span>
                    </span>
                  </div>
                  <button
                    className="button ghost"
                    onClick={() => repository.closeTicket(ticket.id)}
                  >
                    <Check />
                    {t("close")}
                  </button>
                </header>
                {renderMessages(ticket)}
                <form
                  className="message-compose"
                  onSubmit={(event) => {
                    event.preventDefault();
                    sendReply(ticket.id);
                  }}
                >
                  <input
                    id={`ticket-reply-${ticket.id}`}
                    name="reply"
                    value={reply[ticket.id] ?? ""}
                    onChange={(e) =>
                      setReply({ ...reply, [ticket.id]: e.target.value })
                    }
                    placeholder={t("writeReply")}
                    aria-label={t("writeReply")}
                    autoComplete="off"
                  />
                  <button
                    className="button primary send-btn"
                    type="submit"
                    aria-label={t("send")}
                    disabled={!reply[ticket.id]?.trim()}
                  >
                    <Send />
                  </button>
                </form>
              </article>
            ))}
            {closedTickets.map((ticket) => {
              const expanded = expandedClosedId === ticket.id;
              return (
                <article
                  key={ticket.id}
                  className={`is-closed ${expanded ? "is-expanded" : ""}`}
                >
                  <button
                    type="button"
                    className="closed-ticket-toggle"
                    aria-expanded={expanded}
                    onClick={() => toggleClosed(ticket.id)}
                  >
                    <div>
                      <h2>{ticket.subject}</h2>
                      <span>
                        {new Date(ticket.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    <ChevronDown className="closed-chevron" />
                  </button>
                  {expanded && renderMessages(ticket)}
                </article>
              );
            })}
          </>
        ) : (
          <EmptyState
            icon={TicketCheck}
            title={t("noTickets")}
            body={t("notificationEmptyBody")}
          />
        )}
      </div>
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
