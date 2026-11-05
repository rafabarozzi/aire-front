import { Activity, Clock3 } from "lucide-react";
import { observationText } from "@/lib/aire/customer-report";
import type { EntryMonitoring } from "@/lib/aire/observability";
import styles from "./customer-review.module.css";

const windowTime = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});
const number = new Intl.NumberFormat("pt-BR");
const statusColors: Record<string, string> = {
  "1": "#90bbff",
  "2": "#6ad9cb",
  "3": "#a9b6ff",
  "4": "#eed28a",
  "5": "#ffad8b",
};

export function EntryOverview({ entry }: { entry: EntryMonitoring }) {
  const counts = Object.entries(entry.counts || {});
  const total = counts.reduce((sum, [, n]) => sum + n, 0);
  const errors = counts.reduce(
    (sum, [code, n]) => sum + (code.startsWith("5") ? n : 0),
    0,
  );
  if (entry.status !== "measured" || !total)
    return (
      <section className={styles.empty}>
        <Activity size={22} aria-hidden />
        <div>
          <h3>Medição da entrada</h3>
          <p>
            {entry.status === "measured"
              ? "A medição aguarda respostas HTTP classificadas."
              : observationText(entry)[0]}
          </p>
        </div>
      </section>
    );
  return (
    <section className={styles.overview} aria-label="Respostas HTTP na entrada">
      <div className={styles.heroMain}>
        <div className={styles.kicker}>
          <Activity size={16} aria-hidden /> Entrada da jornada
        </div>
        <h3>{errors ? "Falhas na entrada" : "Tráfego observado"}</h3>
        <div className={styles.route}>
          <b>{entry.method}</b>
          <code>{entry.route}</code>
        </div>
        {errors > 0 && (
          <p>
            Cabe à equipe da jornada verificar o impacto dessas falhas no
            resultado final.
          </p>
        )}
      </div>
      <div className={styles.distribution}>
        <div className={styles.totals}>
          <div>
            <strong>{number.format(total)}</strong>
            <span>Respostas HTTP</span>
          </div>
          <div>
            <strong className={errors ? styles.errorNumber : undefined}>
              {number.format(errors)}
            </strong>
            <span>Erros de servidor (5xx)</span>
          </div>
        </div>
        <div className={styles.bar} aria-hidden>
          {counts.map(([code, n]) => (
            <i
              key={code}
              style={{ flexGrow: n, background: statusColors[code[0]] }}
            />
          ))}
        </div>
        <ul className={styles.legend}>
          {counts.map(([code, n]) => (
            <li key={code}>
              <i style={{ background: statusColors[code[0]] }} aria-hidden />
              HTTP {code} <b>{number.format(n)}</b>
            </li>
          ))}
        </ul>
      </div>
      <div className={styles.window}>
        {entry.from != null && entry.to != null && (
          <span>
            <Clock3 size={15} aria-hidden />
            {windowTime.format(entry.from * 1000)} –{" "}
            {windowTime.format(entry.to * 1000)} UTC
          </span>
        )}
        {entry.buckets_with_traffic != null &&
          entry.buckets_without_traffic_witness != null && (
            <p>
              Tráfego observado em{" "}
              <b>
                {entry.buckets_with_traffic} de{" "}
                {entry.buckets_with_traffic +
                  entry.buckets_without_traffic_witness}
              </b>{" "}
              intervalos de 5 minutos
              {entry.buckets_with_5xx != null
                ? ` · ${entry.buckets_with_5xx} com erro`
                : ""}
              .
              {entry.buckets_without_traffic_witness > 0 && (
                <>
                  {" "}
                  Nos outros {entry.buckets_without_traffic_witness}, o tráfego
                  é desconhecido.
                </>
              )}
            </p>
          )}
      </div>
    </section>
  );
}
