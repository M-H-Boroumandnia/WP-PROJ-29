import { Route, Routes } from "react-router-dom";
import { AppShell } from "./AppShell";
import {
  AdminOnly,
  ArtistOnly,
  ConsumerOnly,
  GuestOnly,
  RequireAuth,
  RoleHome,
  StaffOnly,
} from "./guards";
import {
  LoginPage,
  RegisterPage,
  ForgotPasswordPage,
  PrivacyPage,
} from "../features/auth/AuthPages";
import { HomePage } from "../features/home/HomePage";
import { SearchPage } from "../features/search/SearchPage";
import { LibraryPage } from "../features/library/LibraryPage";
import { PlaylistPage } from "../features/playlists/PlaylistPage";
import { ReleasePage } from "../features/catalog/ReleasePage";
import { ProfilePage } from "../features/profiles/ProfilePage";
import { NotificationsPage } from "../features/notifications/NotificationsPage";
import { SettingsPage } from "../features/settings/SettingsPage";
import { ShortcutsPage } from "../features/settings/ShortcutsPage";
import { StudioPage } from "../features/studio/StudioPage";
import { SupportPage } from "../features/support/SupportPage";
import { TicketsPage } from "../features/support/TicketsPage";
import { AdminPage } from "../features/admin/AdminPage";
import { ErrorPage } from "../features/shared/ErrorPage";
import { RoomsPage } from "../features/rooms/RoomsPage";

export default function App() {
  return (
    <Routes>
      <Route element={<GuestOnly />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage artist={false} />} />
        <Route path="/register/artist" element={<RegisterPage artist />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      </Route>
      <Route path="/privacy" element={<PrivacyPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route element={<RoleHome />}>
            <Route index element={<HomePage />} />
          </Route>
          <Route element={<ConsumerOnly />}>
            <Route path="search" element={<SearchPage />} />
            <Route path="library" element={<LibraryPage />} />
            <Route path="playlist/:playlistId" element={<PlaylistPage />} />
            <Route path="release/:releaseId" element={<ReleasePage />} />
            <Route path="profile/:username" element={<ProfilePage />} />
            <Route
              path="artist/:username"
              element={<ProfilePage artistRoute />}
            />
            <Route path="tickets" element={<TicketsPage />} />
            <Route path="rooms" element={<RoomsPage />} />
          </Route>
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="shortcuts" element={<ShortcutsPage />} />
          <Route element={<ArtistOnly />}>
            <Route path="studio" element={<StudioPage />} />
          </Route>
          <Route element={<StaffOnly />}>
            <Route path="support" element={<SupportPage />} />
          </Route>
          <Route element={<AdminOnly />}>
            <Route path="admin" element={<AdminPage />} />
          </Route>
          <Route path="forbidden" element={<ErrorPage forbidden />} />
          <Route path="*" element={<ErrorPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
