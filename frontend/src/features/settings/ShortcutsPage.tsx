import { useTranslation } from "react-i18next";

export function ShortcutsPage() {
  const { t } = useTranslation();
  const shortcuts = [
    ["Space", "shortcutSpace"],
    ["N", "shortcutNext"],
    ["P", "shortcutPrevious"],
    ["L", "shortcutLike"],
    ["Q", "shortcutQueue"],
    ["M", "shortcutMute"],
    ["?", "shortcutHelp"],
  ];
  return (
    <div className="page settings-page shortcuts-page">
      <header className="page-heading">
        <h1>{t("shortcuts")}</h1>
      </header>
      <div className="shortcut-card">
        <div className="shortcut-head">
          <span>{t("key")}</span>
          <span>{t("action")}</span>
        </div>
        {shortcuts.map(([key, label]) => (
          <div className="shortcut-row" key={key}>
            <kbd>{key}</kbd>
            <span>{t(label)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
