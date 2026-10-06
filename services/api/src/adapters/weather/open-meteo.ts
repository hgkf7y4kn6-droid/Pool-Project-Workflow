import { describeWeatherCode } from "@pool/core";
import type { WeatherProvider, WeatherReport } from "./types";

interface OpenMeteoResponse {
  latitude: number;
  longitude: number;
  timezone: string;
  current?: { time: string; temperature_2m: number; wind_speed_10m: number; precipitation: number; weather_code: number };
  daily: {
    time: string[];
    temperature_2m_min: number[];
    temperature_2m_max: number[];
    precipitation_probability_max: (number | null)[];
    precipitation_sum: number[];
    wind_speed_10m_max: number[];
    wind_gusts_10m_max: number[];
    weather_code: number[];
  };
}

/** Open-Meteo (no API key required). Responses are cached for 30 minutes. */
export class OpenMeteoProvider implements WeatherProvider {
  readonly id = "open-meteo";
  private cache = new Map<string, { expires: number; report: WeatherReport }>();

  constructor(
    private readonly baseUrl = "https://api.open-meteo.com/v1/forecast",
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly ttlMs = 30 * 60_000,
  ) {}

  async getForecast(latitude: number, longitude: number, days: number): Promise<WeatherReport> {
    // ~1 km grid is plenty for site forecasts and makes the cache effective.
    const lat = Math.round(latitude * 100) / 100;
    const lng = Math.round(longitude * 100) / 100;
    const cacheKey = `${lat},${lng},${days}`;
    const hit = this.cache.get(cacheKey);
    if (hit && hit.expires > Date.now()) return hit.report;

    const params = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lng),
      timezone: "auto",
      forecast_days: String(Math.min(Math.max(days, 1), 16)),
      current: "temperature_2m,wind_speed_10m,precipitation,weather_code",
      daily:
        "temperature_2m_min,temperature_2m_max,precipitation_probability_max,precipitation_sum,wind_speed_10m_max,wind_gusts_10m_max,weather_code",
    });
    const res = await this.fetchImpl(`${this.baseUrl}?${params}`, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) throw new Error(`Open-Meteo request failed with ${res.status}`);
    const body = (await res.json()) as OpenMeteoResponse;
    const d = body.daily;
    const report: WeatherReport = {
      latitude: body.latitude,
      longitude: body.longitude,
      timezone: body.timezone,
      provider: this.id,
      fetchedAt: new Date().toISOString(),
      current: body.current
        ? {
            observedAt: body.current.time,
            temperatureC: body.current.temperature_2m,
            windSpeedKph: body.current.wind_speed_10m,
            precipitationMm: body.current.precipitation,
            weatherCode: body.current.weather_code,
            summary: describeWeatherCode(body.current.weather_code),
          }
        : null,
      daily: d.time.map((date, i) => ({
        date,
        tempMinC: d.temperature_2m_min[i] ?? 0,
        tempMaxC: d.temperature_2m_max[i] ?? 0,
        precipitationProbabilityPct: d.precipitation_probability_max[i] ?? 0,
        precipitationMm: d.precipitation_sum[i] ?? 0,
        windSpeedMaxKph: d.wind_speed_10m_max[i] ?? 0,
        windGustMaxKph: d.wind_gusts_10m_max[i] ?? undefined,
        weatherCode: d.weather_code[i] ?? 0,
        summary: describeWeatherCode(d.weather_code[i] ?? 0),
      })),
    };
    this.cache.set(cacheKey, { expires: Date.now() + this.ttlMs, report });
    return report;
  }
}

/** Used when weather is disabled; callers treat it as "no data". */
export class NoWeatherProvider implements WeatherProvider {
  readonly id = "none";
  async getForecast(latitude: number, longitude: number): Promise<WeatherReport> {
    return { latitude, longitude, timezone: "UTC", current: null, daily: [], fetchedAt: new Date().toISOString(), provider: this.id };
  }
}
