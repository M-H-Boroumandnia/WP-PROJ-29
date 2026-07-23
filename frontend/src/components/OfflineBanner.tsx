import { WifiOff, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export function OfflineBanner() {
  const { t } = useTranslation();
  const [online, setOnline] = useState(navigator.onLine);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const on = () => {
      setOnline(true);
      setHidden(false);
    };
    const off = () => {
      setOnline(false);
      setHidden(false);
    };
    addEventListener("online", on);
    addEventListener("offline", off);
    return () => {
      removeEventListener("online", on);
      removeEventListener("offline", off);
    };
  }, []);
  if (online || hidden) return null;
  return (
    <div className="offline-banner" role="status">
      <WifiOff />
      <div>
        <strong>{t("offline")}</strong>
        <span>{t("offlineBody")}</span>
      </div>
      <button
        className="icon-button"
        onClick={() => setHidden(true)}
        aria-label={t("close")}
      >
        <X />
      </button>
    </div>
  );
}
