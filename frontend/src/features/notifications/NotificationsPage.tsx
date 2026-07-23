import {
  Bell,
  Check,
  CheckCheck,
  Disc3,
  ShieldAlert,
  Trash2,
  UserPlus,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "../../components/EmptyState";
import type { Notification } from "../../domain/types";
import { repository } from "../../repositories/localRepository";
import { useDatabaseVersion, useSession } from "../../store/session";

const kindIcon: Record<Notification["kind"], typeof Bell> = {
  release: Disc3,
  social: UserPlus,
  critical: ShieldAlert,
  important: Bell,
};

export function NotificationsPage() {
  const { t } = useTranslation();
  const user = useSession()!;
  useDatabaseVersion();
  const notices = repository.notifications();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const text = (
    key: string | undefined,
    fallback: string,
    values?: Record<string, string | number>,
  ) => (key ? t(key, values) : fallback);
  return (
    <div className="page notifications-page">
      <header className="page-heading with-action">
        <div>
          <span className="eyebrow">{t("notifications")}</span>
          <h1>{t("notificationTitle")}</h1>
        </div>
        {notices.some((notice) => !notice.readAt) && (
          <button
            className="button ghost"
            onClick={() => repository.readAllNotifications()}
          >
            <CheckCheck />
            {t("markAllRead")}
          </button>
        )}
      </header>
      {notices.length ? (
        <div className="notification-list">
          {notices.map((notice) => {
            const Icon = kindIcon[notice.kind] ?? Bell;
            const unread = !notice.readAt;
            const title = text(notice.titleKey, notice.title, notice.values);
            const body = text(notice.bodyKey, notice.body, notice.values);
            const expanded = expandedId === notice.id;
            return (
              <article
                key={notice.id}
                className={`notification-card ${unread ? "unread" : ""} ${expanded ? "expanded" : ""}`}
                onClick={() =>
                  setExpandedId((current) =>
                    current === notice.id ? null : notice.id,
                  )
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setExpandedId((current) =>
                      current === notice.id ? null : notice.id,
                    );
                  }
                }}
                role="button"
                tabIndex={0}
                aria-expanded={expanded}
              >
                <span className={`notice-dot ${notice.kind}`}>
                  <Icon />
                </span>
                <div
                  className="notification-body"
                  title={expanded ? undefined : `${title}\n${body}`}
                >
                  <div className="notification-meta">
                    {unread ? (
                      <span className="notification-status">{t("unread")}</span>
                    ) : (
                      <span>{t("read")}</span>
                    )}
                    <time>
                      {new Intl.DateTimeFormat(user.locale, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(new Date(notice.createdAt))}
                    </time>
                  </div>
                  <h2 title={expanded ? undefined : title}>{title}</h2>
                  <p title={expanded ? undefined : body}>{body}</p>
                </div>
                <div
                  className="notice-actions"
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                >
                  {unread && (
                    <button
                      className="icon-button"
                      onClick={() => repository.readNotification(notice.id)}
                      aria-label={t("read")}
                    >
                      <Check />
                    </button>
                  )}
                  <button
                    className="icon-button danger"
                    onClick={() => repository.deleteNotification(notice.id)}
                    aria-label={t("remove")}
                  >
                    <Trash2 />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={Bell}
          title={t("notificationEmpty")}
          body={t("notificationEmptyBody")}
        />
      )}
    </div>
  );
}
