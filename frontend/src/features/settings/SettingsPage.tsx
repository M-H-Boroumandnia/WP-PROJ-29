import {
  Bell,
  Check,
  ChevronDown,
  CircleDollarSign,
  Crown,
  LockKeyhole,
  MonitorSmartphone,
  RotateCcw,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import type { SubscriptionPlan } from "../../domain/types";
import { locales } from "../../i18n";
import { repository } from "../../repositories/localRepository";
import { useDatabaseVersion, useSession } from "../../store/session";
import { uiError } from "../shared/errors";

type PlanTierTab = "silver" | "gold";

export function SettingsPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const user = useSession()!;
  useDatabaseVersion();
  const db = repository.database();
  const usesApi = Boolean(
    (repository as unknown as { usesApi?: boolean }).usesApi,
  );

  const [message, setMessage] = useState("");
  const [plansOpen, setPlansOpen] = useState(false);
  const [checkoutPlan, setCheckoutPlan] = useState<string | null>(null);
  const [checkoutMessage, setCheckoutMessage] = useState("");
  const [planTierOpen, setPlanTierOpen] = useState<PlanTierTab>("gold");
  const selectedPlan =
    db.plans.find((plan) => plan.id === checkoutPlan) ?? null;

  useEffect(() => {
    document.documentElement.dataset.theme = user.theme;
  }, [user.theme]);

  const setLanguage = (locale: typeof user.locale) => {
    repository.updateSettings({ locale });
    void i18n.changeLanguage(locale);
  };

  const formatToman = (rial: number) =>
    `${Math.round(rial / 10).toLocaleString(user.locale)} ${t("toman")}`;

  const isBlocked = (plan: SubscriptionPlan | null) => {
    if (!plan) return null;
    if (
      user.subscription.status === "active" &&
      user.subscription.tier === plan.tier
    )
      return "sameTierCheckoutBlocked";
    if (
      user.subscription.status === "active" &&
      user.subscription.tier === "gold" &&
      plan.tier === "silver" &&
      user.subscription.expiresAt &&
      new Date(user.subscription.expiresAt) > new Date()
    )
      return "downgradeCheckoutBlocked";
    return null;
  };

  const consequence = (plan: SubscriptionPlan | null) => {
    const block = isBlocked(plan);
    if (block) return t(block);
    if (!plan) return t("checkoutSelectPlan");
    if (user.subscription.tier === "silver" && plan.tier === "gold")
      return t("silverToGoldWarning");
    if (user.subscription.tier === "basic") return t("basicToPaidConsequence");
    return t("paidSwitchConsequence");
  };

  const purchase = () => {
    const block = isBlocked(selectedPlan);
    if (!selectedPlan) {
      setCheckoutMessage(t("checkoutSelectPlan"));
      return;
    }
    if (block) {
      setCheckoutMessage(t(block));
      return;
    }
    Promise.resolve(repository.purchase(selectedPlan.id))
      .then(() => {
        setCheckoutPlan(null);
        setPlansOpen(false);
        setCheckoutMessage("");
        setMessage(t("checkoutComplete"));
      })
      .catch((reason) => setCheckoutMessage(uiError(reason, t)));
  };

  const deleteAccount = () => {
    if (!confirm(t("deleteWarning"))) return;
    Promise.resolve(repository.deleteAccount())
      .then(() => navigate("/login"))
      .catch((reason) => setMessage(uiError(reason, t)));
  };

  return (
    <div className="page settings-page">
      <header className="page-heading">
        <h1>{t("settingsTitle")}</h1>
      </header>
      {message && (
        <div className="notice-line">
          <Check />
          {message}
        </div>
      )}

      <section className="settings-section">
        <div className="settings-title">
          <SlidersHorizontal />
          <div>
            <h2>{t("appearance")}</h2>
            <p>
              {t("language")} · {t("theme")}
            </p>
          </div>
        </div>
        <div className="settings-controls">
          <label htmlFor="settings-language">
            {t("language")}
            <select
              id="settings-language"
              name="locale"
              value={user.locale}
              onChange={(event) =>
                setLanguage(event.target.value as typeof user.locale)
              }
            >
              {locales.map((locale) => (
                <option value={locale.value} key={locale.value}>
                  {locale.label}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="settings-theme">
            {t("theme")}
            <select
              id="settings-theme"
              name="theme"
              value={user.theme}
              onChange={(event) =>
                repository.updateSettings({
                  theme: event.target.value as typeof user.theme,
                })
              }
            >
              <option value="dark">{t("dark")}</option>
              <option value="light">{t("light")}</option>
              <option value="system">{t("system")}</option>
            </select>
          </label>
          <label htmlFor="settings-timezone">
            {t("timezone")}
            <select
              id="settings-timezone"
              name="timezone"
              value={user.timezone}
              onChange={(event) =>
                repository.updateSettings({ timezone: event.target.value })
              }
            >
              {[
                user.timezone,
                "Asia/Tehran",
                "Europe/Berlin",
                "America/New_York",
                "Asia/Shanghai",
              ]
                .filter((value, index, list) => list.indexOf(value) === index)
                .map((zone) => (
                  <option key={zone}>{zone}</option>
                ))}
            </select>
          </label>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-title">
          <Bell />
          <div>
            <h2>{t("content")}</h2>
            <p>{t("notificationMode")}</p>
          </div>
        </div>
        <div className="settings-controls">
          <label className="switch-row" htmlFor="settings-explicit">
            <span>
              <strong>{t("explicitSetting")}</strong>
              <small>{t("explicitMinor")}</small>
            </span>
            <input
              id="settings-explicit"
              name="explicitContentEnabled"
              type="checkbox"
              checked={user.explicitContentEnabled}
              onChange={(event) =>
                repository.updateSettings({
                  explicitContentEnabled: event.target.checked,
                })
              }
            />
          </label>
          <label htmlFor="settings-notifications">
            {t("notificationMode")}
            <select
              id="settings-notifications"
              name="notificationPreference"
              value={user.notificationPreference}
              onChange={(event) =>
                repository.updateSettings({
                  notificationPreference: event.target
                    .value as typeof user.notificationPreference,
                })
              }
            >
              <option value="all">{t("all")}</option>
              <option value="important_only">{t("importantOnly")}</option>
              <option value="max_five_daily">{t("maxFiveDaily")}</option>
              <option value="muted">{t("muted")}</option>
            </select>
          </label>
        </div>
      </section>

      {user.kind === "consumer" && (
        <section className="settings-section">
          <div className="settings-title">
            <CircleDollarSign />
            <div>
              <h2>{t("currentPlan")}</h2>
              <p>{t("editSubscription")}</p>
            </div>
          </div>
          <div className="settings-controls">
            <div className="settings-plan-row">
              <div>
                <span className={`plan-pill ${user.subscription.tier}`}>
                  <Crown />
                  {t(user.subscription.tier)}
                </span>
                <small>
                  {user.subscription.expiresAt
                    ? new Intl.DateTimeFormat(user.locale, {
                        dateStyle: "medium",
                      }).format(new Date(user.subscription.expiresAt))
                    : t("basic")}
                </small>
              </div>
              <button
                className="button primary"
                onClick={() => {
                  setPlansOpen(true);
                  setCheckoutMessage("");
                  setPlanTierOpen(
                    user.subscription.tier === "silver" ? "silver" : "gold",
                  );
                }}
              >
                {t("editSubscription")}
              </button>
            </div>
          </div>
        </section>
      )}

      <section className="settings-section danger-zone">
        <div className="settings-title">
          <MonitorSmartphone />
          <div>
            <h2>{t("account")}</h2>
            <p>{user.email}</p>
          </div>
        </div>
        <div className="settings-controls">
          <div className="danger-actions">
            {!usesApi && (
              <button
                className="button ghost"
                onClick={() => {
                  if (confirm(t("resetDemoHelp"))) {
                    repository.reset();
                    navigate("/login");
                  }
                }}
              >
                <RotateCcw />
                {t("resetDemo")}
              </button>
            )}
            <button className="button danger" onClick={deleteAccount}>
              <Trash2 />
              {t("deleteAccount")}
            </button>
          </div>
        </div>
      </section>

      {plansOpen && (
        <div className="modal-backdrop">
          <div className="modal plan-modal checkout-modal">
            <div className="modal-head">
              <div>
                <h2>{t("checkoutTitle")}</h2>
              </div>
              <button
                className="icon-button"
                onClick={() => setPlansOpen(false)}
                aria-label={t("close")}
              >
                <X />
              </button>
            </div>
            <div className="checkout-layout">
              <section className="checkout-choose">
                <h3>{t("checkoutStepChoose")}</h3>
                <div className="plan-tier-accordions">
                  {(["silver", "gold"] as const).map((tier) => {
                    const tierPlans = db.plans.filter(
                      (plan) => plan.isAvailable && plan.tier === tier,
                    );
                    const open = planTierOpen === tier;
                    return (
                      <div
                        key={tier}
                        className={`profile-connection-item plan-tier-item ${open ? "is-open" : ""} ${tier}`}
                      >
                        <button
                          type="button"
                          className={`profile-connection-tab plan-tier-tab ${tier} ${open ? "is-open" : ""}`}
                          onClick={() => setPlanTierOpen(tier)}
                          aria-expanded={open}
                        >
                          {tier === "gold" ? <Crown /> : <CircleDollarSign />}
                          <span>
                            {t(tier)}
                            <strong>{tierPlans.length}</strong>
                          </span>
                          <ChevronDown />
                        </button>
                        {open && (
                          <div className="profile-connection-panel plan-tier-panel">
                            <div className="plan-tier-list">
                              {tierPlans.map((plan) => (
                                <button
                                  className={`plan-choice ${plan.tier} ${checkoutPlan === plan.id ? "selected" : ""}`}
                                  key={plan.id}
                                  onClick={() => {
                                    setCheckoutPlan(plan.id);
                                    setCheckoutMessage("");
                                  }}
                                >
                                  <span>
                                    {plan.durationMonths === 1
                                      ? "1 mon"
                                      : `${plan.durationMonths} ${t("monthShort")}`}
                                  </span>
                                  <strong>
                                    {formatToman(plan.finalPriceRial)}
                                  </strong>
                                  <small>
                                    {plan.discountPercent
                                      ? `${plan.discountPercent}% ${t("discount")}`
                                      : t("perMonth")}
                                  </small>
                                  {checkoutPlan === plan.id && <Check />}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
              <section className="checkout-review">
                <h3>{t("checkoutStepReview")}</h3>
                <dl>
                  <div>
                    <dt>{t("planDetails")}</dt>
                    <dd>
                      {selectedPlan
                        ? `${t(selectedPlan.tier)} · ${
                            selectedPlan.durationMonths === 1
                              ? "1 mon"
                              : `${selectedPlan.durationMonths} ${t("monthShort")}`
                          }`
                        : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>{t("monthlyPrice")}</dt>
                    <dd>
                      {selectedPlan
                        ? formatToman(selectedPlan.monthlyPriceRial)
                        : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>{t("discount")}</dt>
                    <dd>
                      {selectedPlan ? `${selectedPlan.discountPercent}%` : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>{t("finalAmount")}</dt>
                    <dd>
                      {selectedPlan
                        ? formatToman(selectedPlan.finalPriceRial)
                        : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>{t("currentSubscription")}</dt>
                    <dd>{t(user.subscription.tier)}</dd>
                  </div>
                </dl>
                <div
                  className={`checkout-consequence ${!selectedPlan ? "is-hint" : ""} ${isBlocked(selectedPlan) ? "blocked" : user.subscription.tier === "silver" && selectedPlan?.tier === "gold" ? "warning" : ""}`}
                >
                  <LockKeyhole />
                  <span>{consequence(selectedPlan)}</span>
                </div>
                <p
                  className={`form-error checkout-message ${checkoutMessage ? "" : "is-empty"}`}
                >
                  {checkoutMessage || "\u00a0"}
                </p>
                <button
                  className="button primary wide"
                  onClick={purchase}
                  disabled={!selectedPlan || Boolean(isBlocked(selectedPlan))}
                >
                  {t("confirmDemoCheckout")}
                </button>
              </section>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
