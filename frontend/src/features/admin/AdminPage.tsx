import {
  Banknote,
  BarChart3,
  Landmark,
  Save,
  ShieldCheck,
  ToggleLeft,
  ToggleRight,
  Users,
  WalletCards,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { RewardFormula } from "../../components/RewardFormula";
import { repository } from "../../repositories/localRepository";
import { useDatabaseVersion, useSession } from "../../store/session";

const MIX_COLORS: Record<string, string> = {
  basic: "#8a8f7a",
  silver: "#c5c9ce",
  gold: "#e2b340",
};

export function AdminPage() {
  const { t } = useTranslation();
  const user = useSession()!;
  useDatabaseVersion();
  const db = repository.database();
  const reports = db.adminReports;
  const [tab, setTab] = useState<"overview" | "plans" | "accounting">(
    "overview",
  );
  const [drafts, setDrafts] = useState<
    Record<string, { monthlyPriceRial: number; discountPercent: number }>
  >({});
  const formatToman = (rial: number) =>
    `${Math.round(rial / 10).toLocaleString(user.locale)} ${t("toman")}`;
  const mixData = (reports?.subscriptionMix ?? []).map((item) => ({
    name: t(item.tier),
    value: item.count,
    tier: item.tier,
  }));
  const pieSlices = mixData.filter((item) => item.value > 0);
  const revenueData = (reports?.revenueByMonth ?? []).map((item) => ({
    period: item.period,
    toman: Math.round(item.revenueRial / 10),
  }));
  const hasRevenueChart = revenueData.some((item) => item.toman > 0);

  useEffect(() => {
    void repository.loadAdminData();
  }, []);

  return (
    <div className="page admin-page">
      <header className="staff-hero admin">
        <div>
          <span className="eyebrow">
            <ShieldCheck />
            {t("adminRole")}
          </span>
          <h1>{t("admin")}</h1>
        </div>
        <div className="staff-stat">
          <strong>{(reports?.subscriptions ?? 0).toLocaleString(user.locale)}</strong>
          <span>{t("subscriptions")}</span>
        </div>
        <div className="staff-stat gold">
          <strong>{formatToman(reports?.revenueRial ?? 0)}</strong>
          <span>{t("allTimeRevenue")}</span>
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
          className={tab === "accounting" ? "active" : ""}
          onClick={() => setTab("accounting")}
        >
          {t("accounting")}
        </button>
      </nav>
      {tab === "overview" && (
        <div className="admin-overview">
          <div className="admin-kpis">
            <div>
              <WalletCards />
              <span>{t("allTimeRevenue")}</span>
              <strong>{formatToman(reports?.revenueRial ?? 0)}</strong>
              <small>{t("revenue")}</small>
            </div>
            <div>
              <BarChart3 />
              <span>{t("monthRevenue")}</span>
              <strong>{formatToman(reports?.monthRevenueRial ?? 0)}</strong>
              <small>{reports?.period}</small>
            </div>
            <div>
              <Users />
              <span>{t("subscriptions")}</span>
              <strong>
                {(reports?.subscriptions ?? 0).toLocaleString(user.locale)}
              </strong>
              <small>{t("subscriptionMix")}</small>
            </div>
            <div>
              <Landmark />
              <span>{t("pendingPayouts")}</span>
              <strong>{formatToman(reports?.pendingPayoutsRial ?? 0)}</strong>
              <small>
                {(reports?.pendingPayoutsRial ?? 0) > 0
                  ? t("payoutPending")
                  : t("noPayoutDue")}
              </small>
            </div>
          </div>
          <div className="chart-grid">
            <section className="chart-card">
              <h2>{t("revenue")}</h2>
              {hasRevenueChart ? (
                <ResponsiveContainer width="100%" height={280}>
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
                    <XAxis dataKey="period" stroke="var(--faint)" />
                    <YAxis
                      stroke="var(--faint)"
                      tickFormatter={(value: number) =>
                        value.toLocaleString(user.locale)
                      }
                    />
                    <Tooltip
                      formatter={(value) => [
                        `${Number(value).toLocaleString(user.locale)} ${t("toman")}`,
                        t("revenue"),
                      ]}
                      contentStyle={{
                        background: "var(--panel)",
                        border: "1px solid var(--border)",
                        color: "var(--text)",
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="toman"
                      stroke="#7bbd19"
                      fill="url(#revenueFill)"
                      strokeWidth={3}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <p className="muted">
                  {reports ? t("noRevenueChart") : t("loading")}
                </p>
              )}
            </section>
            <section className="chart-card">
              <h2>{t("subscriptionMix")}</h2>
              {pieSlices.length ? (
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie
                      data={pieSlices}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={62}
                      outerRadius={96}
                      paddingAngle={2}
                    >
                      {pieSlices.map((item) => (
                        <Cell
                          key={item.tier}
                          fill={MIX_COLORS[item.tier] ?? MIX_COLORS.basic}
                        />
                      ))}
                    </Pie>
                    <Legend />
                    <Tooltip
                      contentStyle={{
                        background: "var(--panel)",
                        border: "1px solid var(--border)",
                        color: "var(--text)",
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <p className="muted">
                  {reports ? t("noSubscriptionMix") : t("loading")}
                </p>
              )}
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
                    className="icon-button plan-toggle"
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
      {tab === "accounting" && (
        <div className="accounting-panel">
          <RewardFormula />
          <div className="audit-table accounting-table">
            <div className="table-head">
              <span>{t("artist")}</span>
              <span>{t("uniqueListeners")}</span>
              <span>{t("validStreams")}</span>
              <span>{t("artistReward")}</span>
              <span>{t("payoutStatus")}</span>
              <span>{t("settle")}</span>
            </div>
            {db.payouts.length ? (
              db.payouts.map((payout) => (
                <div className="table-row" key={payout.id}>
                  <span>
                    <Banknote />
                    <span className="accounting-artist">
                      <strong>
                        {payout.artistName ??
                          db.users.find((item) => item.id === payout.artistUserId)
                            ?.artistProfile?.stageName}
                      </strong>
                      <small>@{payout.username ?? ""}</small>
                    </span>
                  </span>
                  <span>
                    {(payout.uniqueListeners ?? 0).toLocaleString(user.locale)}
                  </span>
                  <span>
                    {(payout.validStreams ?? 0).toLocaleString(user.locale)}
                  </span>
                  <strong>
                    {payout.amountRial > 0
                      ? formatToman(payout.amountRial)
                      : "—"}
                  </strong>
                  <span>
                    {t(
                      payout.status === "settled"
                        ? "settled"
                        : payout.amountRial > 0
                          ? "payoutPending"
                          : "noPayoutDue",
                    )}
                  </span>
                  {payout.status === "settled" ? (
                    <span className="muted">{t("settled")}</span>
                  ) : payout.amountRial > 0 ? (
                    <button
                      className="button ghost small"
                      onClick={() => repository.settlePayout(payout.id)}
                    >
                      <Landmark />
                      {t("settle")}
                    </button>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </div>
              ))
            ) : (
              <p className="muted accounting-empty">{t("noAccountingRows")}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
