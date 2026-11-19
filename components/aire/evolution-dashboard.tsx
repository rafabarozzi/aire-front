"use client";

import { useState } from "react";
import {
  Activity,
  ArrowUpRight,
  GitBranch,
  History,
  Layers3,
} from "lucide-react";
import type { evolution } from "@/lib/server/store";
import styles from "./evolution-dashboard.module.css";

export type EvolutionData = Awaited<ReturnType<typeof evolution>>;
const number = new Intl.NumberFormat("pt-BR");
const monthName = new Intl.DateTimeFormat("pt-BR", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const shortDate = new Intl.DateTimeFormat("pt-BR", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const tiers = ["Gold", "Silver", "Bronze"] as const;

function ActivityChart({ data }: { data: EvolutionData }) {
  const [selection, setSelection] = useState("");
  const month =
    data.months.find((row) => row.month === selection) || data.months.at(-1);
  if (!month) return null;
  const monthStart = new Date(month.month + "-01T00:00:00Z");
  const today = new Date();
  const dayCount = today.toISOString().startsWith(month.month)
    ? today.getUTCDate()
    : new Date(
        Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0),
      ).getUTCDate();
  const days = Array.from({ length: dayCount }, (_, index) => {
    const day = index + 1;
    return {
      day,
      count:
        data.dailyAnalyses[month.month + "-" + String(day).padStart(2, "0")] ||
        0,
    };
  });
  const peak = Math.max(1, ...days.map((day) => day.count));
  const step = Math.max(1, Math.ceil(peak / 4));
  const ceiling = step * Math.ceil(peak / step);
  const scale = Array.from(
    { length: ceiling / step + 1 },
    (_, i) => ceiling - step * i,
  );

  return (
    <section className={styles.panel} aria-labelledby="evolution-activity">
      <header className={styles.panelHeading}>
        <h2 id="evolution-activity">Atividade de mapeamento</h2>
        <select
          className={styles.select}
          aria-label="Mês da atividade"
          value={month.month}
          onChange={(e) => setSelection(e.target.value)}
        >
          {[...data.months].reverse().map((row) => (
            <option key={row.month} value={row.month}>
              {monthName.format(new Date(row.month + "-01T00:00:00Z"))}
            </option>
          ))}
        </select>
      </header>
      <div className={styles.monthTotal}>
        <strong>{number.format(month.analyses)}</strong> análises no mês
      </div>
      <div
        className={styles.plot}
        role="img"
        aria-label={
          `Análises por dia em ${monthName.format(monthStart)}. ` +
          days
            .filter((d) => d.count)
            .map((d) => `Dia ${d.day}, ${d.count}`)
            .join(". ")
        }
      >
        <div className={styles.lines} aria-hidden="true">
          {scale.map((value) => (
            <div key={value}>
              <span>{number.format(value)}</span>
            </div>
          ))}
        </div>
        <div className={styles.columns} aria-hidden="true">
          {days.map(({ day, count }) => (
            <div
              className={styles.column}
              key={day}
              title={`Dia ${day} · ${number.format(count)} análises`}
            >
              {count > 0 && (
                <span
                  className={styles.bar}
                  style={{ height: `${(count / ceiling) * 100}%` }}
                />
              )}
              {(dayCount <= 9 ||
                day === 1 ||
                (day % 5 === 0 && dayCount - day > 2) ||
                day === dayCount) && <small>{day}</small>}
            </div>
          ))}
        </div>
      </div>
      <div className={styles.chartFooter}>
        <span>
          <i className={styles.completeDot} />
          Concluídas <b>{number.format(month.completed)}</b>
        </span>
        <span>
          <i className={styles.failedDot} />
          Falhas <b>{number.format(month.failed)}</b>
        </span>
        <span>
          <i className={styles.otherDot} />
          Outros estados{" "}
          <b>
            {number.format(month.analyses - month.completed - month.failed)}
          </b>
        </span>
      </div>
    </section>
  );
}

export function EvolutionDashboard({ data }: { data: EvolutionData }) {
  if (!data.uniqueJourneys)
    return (
      <section className={styles.empty}>
        <Layers3 aria-hidden size={30} />
        <h2>Comece pela primeira jornada</h2>
        <p>
          O primeiro mapeamento inicia o histórico de evolução deste workspace.
        </p>
        <a className="button primary" href="/#jornadas">
          Abrir Jornadas <ArrowUpRight size={16} aria-hidden />
        </a>
      </section>
    );
  const percent = Math.round(
    (100 * data.completedJourneys) / data.uniqueJourneys,
  );
  const unclassified =
    data.uniqueJourneys -
    tiers.reduce((sum, tier) => sum + data.tiers[tier], 0);
  return (
    <div className={styles.dashboard}>
      <section className={styles.overview} aria-labelledby="evolution-overview">
        <div>
          <h2 id="evolution-overview">Jornadas no inventário</h2>
          <strong className={styles.heroNumber}>
            {number.format(data.uniqueJourneys)}
          </strong>
          {data.firstAnalysisAt && (
            <p>
              Primeira análise em{" "}
              {shortDate.format(new Date(data.firstAnalysisAt))}
            </p>
          )}
        </div>
        <div className={styles.completion}>
          <div
            className={styles.ring}
            aria-hidden="true"
            style={{
              background: `conic-gradient(#76dfcf ${percent}%, #3e5572 0)`,
            }}
          >
            <strong>{percent}%</strong>
          </div>
          <div>
            <h3>Mapeamentos concluídos</h3>
            <p>
              {number.format(data.completedJourneys)} de{" "}
              {number.format(data.uniqueJourneys)} jornadas na versão atual
            </p>
          </div>
        </div>
      </section>
      <div className={styles.metrics}>
        {[
          { label: "Versões de análise", value: data.analyses, icon: Layers3 },
          {
            label: "Reanálises preservadas",
            value: data.reanalyses,
            icon: History,
          },
          {
            label: "Repositórios mapeados",
            value: data.repositories,
            icon: GitBranch,
          },
        ].map(({ label, value, icon: Icon }) => (
          <div className={styles.metric} key={label}>
            <span className={styles.icon}>
              <Icon size={20} aria-hidden />
            </span>
            <div>
              <span>{label}</span>
              <strong>{number.format(value)}</strong>
            </div>
          </div>
        ))}
      </div>
      <div className={styles.panels}>
        <ActivityChart data={data} />
        <section className={styles.panel} aria-labelledby="evolution-tiers">
          <h2 id="evolution-tiers">Criticidade das jornadas</h2>
          <p className={styles.description}>Distribuição das versões atuais</p>
          <div className={styles.tierBar} aria-hidden="true">
            {tiers.map(
              (tier) =>
                data.tiers[tier] > 0 && (
                  <span
                    key={tier}
                    className={styles[tier]}
                    style={{
                      width: `${(100 * data.tiers[tier]) / data.uniqueJourneys}%`,
                    }}
                  />
                ),
            )}
          </div>
          <dl className={styles.tierList}>
            {tiers.map((tier) => (
              <div key={tier}>
                <dt>
                  <i className={styles[tier]} />
                  {tier}
                </dt>
                <dd>{number.format(data.tiers[tier])}</dd>
              </div>
            ))}
            {unclassified > 0 && (
              <div>
                <dt>Sem classificação</dt>
                <dd>{number.format(unclassified)}</dd>
              </div>
            )}
          </dl>
        </section>
      </div>
      <details className={styles.history}>
        <summary>Histórico mensal</summary>
        <div className={styles.tableScroll}>
          <table>
            <caption className="sr-only">
              Análises por mês de criação e estado atual
            </caption>
            <thead>
              <tr>
                <th scope="col">Mês de criação</th>
                <th scope="col">Análises</th>
                <th scope="col">Concluídas</th>
                <th scope="col">Falhas</th>
              </tr>
            </thead>
            <tbody>
              {[...data.months].reverse().map((m) => (
                <tr key={m.month}>
                  <th scope="row">
                    {monthName.format(new Date(m.month + "-01T00:00:00Z"))}
                  </th>
                  <td>{number.format(m.analyses)}</td>
                  <td>{number.format(m.completed)}</td>
                  <td>{number.format(m.failed)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <aside className={styles.outcomes}>
        <Activity aria-hidden size={20} />
        <div>
          <h3>Resultados operacionais</h3>
          <p>
            A medição de alertas criados ou ajustados, horas poupadas e retorno
            financeiro depende da comprovação das ações executadas na Etapa 2.
          </p>
        </div>
      </aside>
    </div>
  );
}
