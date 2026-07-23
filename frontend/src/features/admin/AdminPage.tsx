import {
  Archive,
  Banknote,
  BarChart3,
  Check,
  FileClock,
  Landmark,
  Save,
  ShieldCheck,
  ToggleLeft,
  ToggleRight,
  WalletCards,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CoverArt } from "../../components/CoverArt";
import { repository } from "../../repositories/localRepository";
import { useDatabaseVersion, useSession } from "../../store/session";

const revenue = [
  { monthKey: "monthFeb", rial: 182 },
  { monthKey: "monthMar", rial: 214 },
  { monthKey: "monthApr", rial: 238 },
  { monthKey: "monthMay", rial: 267 },
  { monthKey: "monthJun", rial: 301 },
  { monthKey: "monthJul", rial: 329 },
];
const subscriberMix = [
  { tierKey: "basic", count: 6480 },
  { tierKey: "silver", count: 2710 },
  { tierKey: "gold", count: 1380 },
];

export function AdminPage() {
  const { t } = useTranslation();
  const user = useSession()!;
  useDatabaseVersion();
  const db = repository.database();
  const [tab, setTab] = useState<
    "overview" | "plans" | "audit" | "payouts" | "moderation"
  >("overview");
  const [drafts, setDrafts] = useState<
    Record<string, { monthlyPriceRial: number; discountPercent: number }>
  >({});
  const formatToman = (rial: number) =>
    `${Math.round(rial / 10).toLocaleString(user.locale)} ${t("toman")}`;
  const revenueData = revenue.map((item) => ({
    month: t(item.monthKey),
    rial: item.rial,
  }));
  const subscriberData = subscriberMix.map((item) => ({
    tier: t(item.tierKey),
    count: item.count,
  }));
  return (
    <div className="page admin-page">
      <header className="staff-hero admin">
        <div>
          <span className="eyebrow">
            <ShieldCheck />
            {t("adminRole")}
          </span>
          <h1>{t("admin")}</h1>
          <p>{t("tehranReporting")}</p>
        </div>
        <div className="staff-stat">
          <strong>10,570</strong>
          <span>{t("subscriptions")}</span>
        </div>
        <div className="staff-stat gold">
          <strong>32.9M</strong>
          <span>{t("revenue")}</span>
        </div>
      </header>
      <nav className="tab-bar admin-tabs">
        <button
          className={tab === "overview" ? "active" : ""}
          onClick={() => setTab("overview")}
        >
          {t("reports")}
        </button>
        <button
          className={tab === "plans" ? "active" : ""}
          onClick={() => setTab("plans")}
        >
          {t("plans")}
        </button>
        <button
          className={tab === "audit" ? "active" : ""}
          onClick={() => setTab("audit")}
        >
          {t("audit")}
        </button>
        <button
          className={tab === "payouts" ? "active" : ""}
          onClick={() => setTab("payouts")}
        >
          {t("payouts")}
        </button>
        <button
          className={tab === "moderation" ? "active" : ""}
          onClick={() => setTab("moderation")}
        >
          {t("moderation")}
        </button>
      </nav>
      {tab === "overview" && (
        <div className="admin-overview">
          <div className="admin-kpis">
            <div>
              <WalletCards />
              <span>{t("revenue")}</span>
              <strong>{formatToman(329_000_000)}</strong>
              <small>+12.4%</small>
            </div>
            <div>
              <BarChart3 />
              <span>{t("subscriptions")}</span>
              <strong>10,570</strong>
              <small>+8.1%</small>
            </div>
            <div>
              <Landmark />
              <span>{t("payouts")}</span>
              <strong>
                {formatToman(
                  db.payouts.reduce((sum, item) => sum + item.amountRial, 0),
                )}
              </strong>
              <small>{t("pending")}</small>
            </div>
          </div>
          <div className="chart-grid">
            <section className="chart-card">
              <h2>{t("revenue")}</h2>
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={revenueData}>
                  <defs>
                    <linearGradient
                      id="revenueFill"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="0%"
                        stopColor="#b6f13c"
                        stopOpacity={0.45}
                      />
                      <stop offset="100%" stopColor="#b6f13c" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                  <XAxis dataKey="month" stroke="var(--faint)" />
                  <YAxis stroke="var(--faint)" />
                  <Tooltip
                    contentStyle={{
                      background: "var(--panel)",
                      border: "1px solid var(--border)",
                      color: "var(--text)",
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="rial"
                    stroke="#7bbd19"
                    fill="url(#revenueFill)"
                    strokeWidth={3}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </section>
            <section className="chart-card">
              <h2>{t("subscriptions")}</h2>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={subscriberData}>
                  <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                  <XAxis dataKey="tier" stroke="var(--faint)" />
                  <YAxis stroke="var(--faint)" />
                  <Tooltip
                    contentStyle={{
                      background: "var(--panel)",
                      border: "1px solid var(--border)",
                      color: "var(--text)",
                    }}
                  />
                  <Bar dataKey="count" fill="#7c5cff" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </section>
          </div>
        </div>
      )}
      {tab === "plans" && (
        <div className="plan-admin-grid">
          {db.plans.map((plan) => {
            const draft = drafts[plan.id] ?? {
              monthlyPriceRial: plan.monthlyPriceRial,
              discountPercent: plan.discountPercent,
            };
            return (
              <article className={`plan-admin-card ${plan.tier}`} key={plan.id}>
                <header>
                  <span>
                    {t(plan.tier)} · {plan.durationMonths} {t("monthShort")}
                  </span>
                  <button
                    className="icon-button"
                    onClick={() =>
                      repository.updatePlan(plan.id, {
                        isAvailable: !plan.isAvailable,
                      })
                    }
                    aria-label={t("available")}
                  >
                    {plan.isAvailable ? <ToggleRight /> : <ToggleLeft />}
                  </button>
                </header>
                <strong>{formatToman(plan.finalPriceRial)}</strong>
                <label htmlFor={`plan-price-${plan.id}`}>
                  {t("perMonth")}
                  <input
                    id={`plan-price-${plan.id}`}
                    name="monthlyPriceRial"
                    type="number"
                    value={draft.monthlyPriceRial}
                    onChange={(e) =>
                      setDrafts({
                        ...drafts,
                        [plan.id]: {
                          ...draft,
                          monthlyPriceRial: Number(e.target.value),
                        },
                      })
                    }
                  />
                </label>
                <label htmlFor={`plan-discount-${plan.id}`}>
                  {t("discount")}
                  <input
                    id={`plan-discount-${plan.id}`}
                    name="discountPercent"
                    type="number"
                    min="0"
                    max="100"
                    value={draft.discountPercent}
                    onChange={(e) =>
                      setDrafts({
                        ...drafts,
                        [plan.id]: {
                          ...draft,
                          discountPercent: Number(e.target.value),
                        },
                      })
                    }
                  />
                </label>
                <button
                  className="button small"
                  onClick={() => repository.updatePlan(plan.id, draft)}
                >
                  <Save />
                  {t("savePlan")}
                </button>
                <span
                  className={
                    plan.isAvailable ? "status available" : "status disabled"
                  }
                >
                  {t(plan.isAvailable ? "available" : "disabled")}
                </span>
              </article>
            );
          })}
        </div>
      )}
      {tab === "audit" && (
        <div className="audit-table">
          <div className="table-head">
            <span>{t("action")}</span>
            <span>{t("target")}</span>
            <span>{t("actor")}</span>
            <span>{t("date")}</span>
            <span>{t("requestId")}</span>
          </div>
          {[...db.auditEvents].reverse().map((event) => (
            <div className="table-row" key={event.id}>
              <span>
                <FileClock />
                {event.action}
              </span>
              <code>{event.target}</code>
              <span>
                {
                  db.users.find((item) => item.id === event.actorId)
                    ?.displayName
                }
              </span>
              <time>{new Date(event.createdAt).toLocaleString()}</time>
              <code>{event.requestId}</code>
            </div>
          ))}
        </div>
      )}
      {tab === "payouts" && (
        <div className="payout-list">
          {db.payouts.map((payout) => {
            const artist = db.users.find(
              (item) => item.id === payout.artistUserId,
            );
            return (
              <article key={payout.id}>
                <span className="payout-icon">
                  <Banknote />
                </span>
                <div>
                  <h2>{artist?.artistProfile?.stageName}</h2>
                  <span>
                    {payout.period} · {t(payout.status)}
                  </span>
                </div>
                <strong>{formatToman(payout.amountRial)}</strong>
                <button
                  className="button ghost"
                  disabled={payout.status === "settled"}
                  onClick={() => repository.settlePayout(payout.id)}
                >
                  {payout.status === "settled" ? <Check /> : <Landmark />}
                  {t(payout.status === "settled" ? "settled" : "settle")}
                </button>
              </article>
            );
          })}
        </div>
      )}
      {tab === "moderation" && (
        <div className="moderation-list">
          {db.releases
            .filter((release) => release.status !== "archived")
            .map((release) => (
              <article key={release.id}>
                <CoverArt src={release.coverUrl} alt="" />
                <div>
                  <h2>{release.title}</h2>
                  <span>
                    {release.primaryArtist.stageName} · {release.status}
                  </span>
                </div>
                <button
                  className="button danger"
                  onClick={() => {
                    const reason = prompt(t("moderationReason"));
                    if (reason) repository.moderateRelease(release.id, reason);
                  }}
                >
                  <Archive />
                  {t("archive")}
                </button>
              </article>
            ))}
        </div>
      )}
    </div>
  );
}
