/**
 * Weather rules for construction scheduling. Pure functions: providers
 * (Open-Meteo, Tomorrow.io, …) live behind an adapter in the API and only
 * have to produce `DailyForecast` values.
 */

export interface DailyForecast {
  date: string;
  tempMinC: number;
  tempMaxC: number;
  precipitationProbabilityPct: number;
  precipitationMm: number;
  windSpeedMaxKph: number;
  windGustMaxKph?: number;
  /** WMO weather code (0 clear … 95+ thunderstorm). */
  weatherCode: number;
  summary: string;
}

export interface CurrentConditions {
  observedAt: string;
  temperatureC: number;
  windSpeedKph: number;
  precipitationMm: number;
  weatherCode: number;
  summary: string;
}

export interface WeatherThresholds {
  rainProbabilityPct: number;
  windSpeedKph: number;
  minTempC: number;
  maxTempC: number;
}

export const DEFAULT_WEATHER_THRESHOLDS: WeatherThresholds = {
  rainProbabilityPct: 60,
  windSpeedKph: 40,
  minTempC: 4,
  maxTempC: 41,
};

/** Stages whose work is especially sensitive to specific conditions. */
const STAGE_SENSITIVITY: Record<string, { rain?: boolean; wind?: boolean; cold?: boolean; heat?: boolean }> = {
  excavation: { rain: true },
  plumbing: { rain: true },
  electrical: { rain: true },
  steel: { rain: true },
  gunite: { rain: true, cold: true, heat: true },
  tile: { rain: true, cold: true },
  coping: { rain: true, cold: true },
  decking: { rain: true, cold: true, heat: true },
  interior_finish: { rain: true, wind: true, cold: true, heat: true },
};

export interface WeatherSensitiveWork {
  id: string;
  title: string;
  stageKey?: string | null;
  plannedStartDate: string;
  plannedEndDate: string;
}

export interface WeatherWarning {
  taskId: string;
  taskTitle: string;
  date: string;
  severity: "advisory" | "warning" | "severe";
  reasons: string[];
  message: string;
}

const SEVERE_CODES = new Set([65, 67, 75, 82, 86, 95, 96, 99]);

export function describeWeatherCode(code: number): string {
  if (code === 0) return "Clear";
  if (code <= 3) return "Partly cloudy";
  if (code <= 48) return "Fog";
  if (code <= 57) return "Drizzle";
  if (code <= 67) return "Rain";
  if (code <= 77) return "Snow";
  if (code <= 82) return "Rain showers";
  if (code <= 86) return "Snow showers";
  return "Thunderstorm";
}

/**
 * Compare weather-sensitive work against the forecast. Produces warnings
 * only — never reschedules. The UI offers "Review schedule" which runs the
 * schedule-impact preview and requires user confirmation.
 */
export function evaluateWeatherRisks(
  work: WeatherSensitiveWork[],
  forecast: DailyForecast[],
  thresholds: WeatherThresholds = DEFAULT_WEATHER_THRESHOLDS,
): WeatherWarning[] {
  const byDate = new Map(forecast.map((f) => [f.date, f]));
  const warnings: WeatherWarning[] = [];
  for (const item of work) {
    const sensitivity = STAGE_SENSITIVITY[item.stageKey ?? ""] ?? { rain: true, wind: true };
    for (const day of forecast) {
      if (day.date < item.plannedStartDate || day.date > item.plannedEndDate) continue;
      const f = byDate.get(day.date)!;
      const reasons: string[] = [];
      let severity: WeatherWarning["severity"] = "advisory";
      if (SEVERE_CODES.has(f.weatherCode)) {
        reasons.push(`severe weather (${describeWeatherCode(f.weatherCode).toLowerCase()})`);
        severity = "severe";
      }
      if (sensitivity.rain !== false && f.precipitationProbabilityPct >= thresholds.rainProbabilityPct) {
        reasons.push(`${f.precipitationProbabilityPct}% chance of rain`);
        if (f.precipitationMm >= 10 && severity === "advisory") severity = "warning";
      }
      if (f.windSpeedMaxKph >= thresholds.windSpeedKph) {
        reasons.push(`winds up to ${Math.round(f.windSpeedMaxKph)} km/h`);
        if (severity === "advisory") severity = "warning";
      }
      if (sensitivity.cold && f.tempMinC <= thresholds.minTempC) {
        reasons.push(`low of ${Math.round(f.tempMinC)}°C`);
        if (severity === "advisory") severity = "warning";
      }
      if (sensitivity.heat && f.tempMaxC >= thresholds.maxTempC) {
        reasons.push(`high of ${Math.round(f.tempMaxC)}°C`);
      }
      if (reasons.length === 0) continue;
      const heavyRain = f.precipitationMm >= 10 || f.precipitationProbabilityPct >= 80;
      const lead = heavyRain ? "Heavy rain expected" : `${describeWeatherCode(f.weatherCode)} expected`;
      warnings.push({
        taskId: item.id,
        taskTitle: item.title,
        date: f.date,
        severity,
        reasons,
        message: `${lead} on ${f.date}. ${item.title} may require rescheduling (${reasons.join(", ")}).`,
      });
    }
  }
  const rank = { severe: 0, warning: 1, advisory: 2 } as const;
  return warnings.sort((a, b) => a.date.localeCompare(b.date) || rank[a.severity] - rank[b.severity]);
}
