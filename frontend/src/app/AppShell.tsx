import {
  Bell,
  CircleHelp,
  Headphones,
  Home,
  Library,
  LogOut,
  Menu,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  TicketCheck,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Logo } from "../components/Logo";
import { OfflineBanner } from "../components/OfflineBanner";
import { Player } from "../features/player/Player";
import { repository } from "../repositories/localRepository";
import { hydratePlayerQueue } from "../store/player";
import { useAuthReady, useDatabaseVersion, useSession } from "../store/session";

let unreadPath = "";

const NavItem = ({
  to,
  icon: Icon,
  label,
  badge,
  onNavigate,
}: {
  to: string;
  icon: typeof Home;
  label: string;
  badge?: number;
  onNavigate?: () => void;
}) => (
  <NavLink
    to={to}
    end={to === "/"}
    className={({ isActive }) => (isActive ? "active" : "")}
    onClick={onNavigate}
  >
    <Icon />
    <span>{label}</span>
    {Boolean(badge) && <b className="nav-badge">{badge}</b>}
  </NavLink>
);

export function AppShell() {
  const { t, i18n } = useTranslation();
  const user = useSession()!;
  const authReady = useAuthReady();
  useDatabaseVersion();
  const navigate = useNavigate();
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const hydratedUserId = useRef<string | null>(null);
  useEffect(() => {
    if (!authReady || !user.id) return;
    if (hydratedUserId.current === user.id) return;
    hydratedUserId.current = user.id;
    hydratePlayerQueue();
  }, [authReady, user.id]);
  useEffect(() => {
    setMoreOpen(false);
  }, [location.pathname]);
  useEffect(() => {
    if (unreadPath === location.pathname) return;
    unreadPath = location.pathname;
    if (location.pathname === "/notifications") return;
    void repository.refreshUnreadCount?.();
  }, [location.pathname]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      void repository.refreshUnreadCount?.();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (i18n.language !== user.locale) void i18n.changeLanguage(user.locale);
  }, [i18n, user.locale]);
  useEffect(() => {
    document.documentElement.dataset.theme = user.theme;
  }, [user.theme]);
  useEffect(() => {
    document.documentElement.classList.add("in-app-shell");
    return () => document.documentElement.classList.remove("in-app-shell");
  }, []);
  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMoreOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moreOpen]);
  const unread = user.unreadNotificationCount ?? 0;
  const isArtist = Boolean(user.artistProfile);
  const isStaff = user.kind === "support" || user.kind === "admin";
  const closeMore = () => setMoreOpen(false);
  const openLogout = () => {
    setMoreOpen(false);
    setLogoutOpen(true);
  };
  const confirmLogout = () => {
    sessionStorage.setItem("sonora:logout-toast", "loggedOutToast");
    repository.logout();
    navigate("/login", {
      replace: true,
      state: { toastKey: "loggedOutToast" },
    });
  };
  return (
    <div
      className={`app-shell${isStaff ? "" : " has-player"}${moreOpen ? " more-open" : ""}`}
    >
      <aside
        id="mobile-sidebar"
        className={`sidebar${moreOpen ? " is-mobile-open" : ""}`}
      >
        <div className="sidebar-head">
          <Logo />
          <button
            type="button"
            className="sidebar-close icon-button"
            onClick={closeMore}
            aria-label={t("close")}
          >
            <X />
          </button>
        </div>
        {!isStaff && (
          <nav aria-label={t("primaryNavigation")}>
            <NavItem
              to="/"
              icon={Home}
              label={t("home")}
              onNavigate={closeMore}
            />
            <NavItem
              to="/search"
              icon={Search}
              label={t("search")}
              onNavigate={closeMore}
            />
            <NavItem
              to="/library"
              icon={Library}
              label={t("library")}
              onNavigate={closeMore}
            />
            <NavItem
              to="/notifications"
              icon={Bell}
              label={t("notifications")}
              badge={unread}
              onNavigate={closeMore}
            />
            <NavItem
              to="/rooms"
              icon={Users}
              label={t("groupListening")}
              onNavigate={closeMore}
            />
          </nav>
        )}
        {(isArtist || isStaff) && (
          <>
            {isArtist && <span className="nav-label">{t("artist")}</span>}
            <nav aria-label={isStaff ? t("support") : t("artist")}>
              {isArtist && (
                <NavItem
                  to="/studio"
                  icon={Sparkles}
                  label={t("studio")}
                  onNavigate={closeMore}
                />
              )}
              {isStaff && (
                <NavItem
                  to="/support"
                  icon={Headphones}
                  label={t("support")}
                  onNavigate={closeMore}
                />
              )}
              {user.kind === "admin" && (
                <NavItem
                  to="/admin"
                  icon={ShieldCheck}
                  label={t("admin")}
                  onNavigate={closeMore}
                />
              )}
            </nav>
          </>
        )}
        <div className="sidebar-foot">
          {!isStaff && (
            <NavItem
              to="/tickets"
              icon={TicketCheck}
              label={t("tickets")}
              onNavigate={closeMore}
            />
          )}
          {isStaff && (
            <NavItem
              to="/notifications"
              icon={Bell}
              label={t("notifications")}
              badge={unread}
              onNavigate={closeMore}
            />
          )}
          <NavItem
            to="/settings"
            icon={Settings}
            label={t("settings")}
            onNavigate={closeMore}
          />
          <NavItem
            to="/shortcuts"
            icon={CircleHelp}
            label={t("shortcuts")}
            onNavigate={closeMore}
          />
          {!isStaff && (
            <NavLink to={`/profile/${user.username}`} onClick={closeMore}>
              <UserRound />
              <span>{t("profile")}</span>
            </NavLink>
          )}
          <button
            className="sidebar-logout"
            onClick={openLogout}
            aria-label={t("logoutDesktopLabel")}
          >
            <LogOut />
            <span>{t("logout")}</span>
          </button>
        </div>
      </aside>
      <header className="mobile-header">
        <Logo />
        <NavLink
          to="/notifications"
          className="icon-button"
          aria-label={t("notifications")}
        >
          <Bell />
          {Boolean(unread) && <b className="nav-badge">{unread}</b>}
        </NavLink>
      </header>
      <main className="main-content">
        <OfflineBanner />
        <Outlet />
      </main>
      <nav className="mobile-nav">
        {isStaff ? (
          <>
            <NavItem
              to={user.kind === "admin" ? "/admin" : "/support"}
              icon={user.kind === "admin" ? ShieldCheck : Headphones}
              label={t(user.kind === "admin" ? "admin" : "support")}
            />
            <NavItem
              to="/notifications"
              icon={Bell}
              label={t("notifications")}
              badge={unread}
            />
            <NavItem to="/settings" icon={Settings} label={t("settings")} />
          </>
        ) : (
          <>
            <NavItem to="/" icon={Home} label={t("home")} />
            <NavItem to="/search" icon={Search} label={t("search")} />
            <NavItem to="/library" icon={Library} label={t("library")} />
            <NavItem
              to="/notifications"
              icon={Bell}
              label={t("notifications")}
              badge={unread}
            />
          </>
        )}
        <button
          type="button"
          className={moreOpen ? "active" : ""}
          onClick={() => setMoreOpen((open) => !open)}
          aria-expanded={moreOpen}
          aria-controls="mobile-sidebar"
        >
          {moreOpen ? <X /> : <Menu />}
          <span>{t("more")}</span>
        </button>
      </nav>
      {logoutOpen && (
        <div className="modal-backdrop">
          <div
            className="modal confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="logout-title"
          >
            <div className="modal-head">
              <div>
                <span className="eyebrow">{t("account")}</span>
                <h2 id="logout-title">{t("logoutConfirmTitle")}</h2>
              </div>
              <button
                className="icon-button"
                onClick={() => setLogoutOpen(false)}
                aria-label={t("close")}
              >
                <X />
              </button>
            </div>
            <p className="muted">{t("logoutConfirmBody")}</p>
            <div className="modal-actions">
              <button
                className="button ghost"
                onClick={() => setLogoutOpen(false)}
              >
                {t("cancel")}
              </button>
              <button className="button danger" onClick={confirmLogout}>
                <LogOut />
                {t("logoutConfirmAction")}
              </button>
            </div>
          </div>
        </div>
      )}
      {!isStaff && <Player />}
    </div>
  );
}
