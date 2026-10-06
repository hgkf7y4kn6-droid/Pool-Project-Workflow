import type { CurrentConditions, DailyForecast } from "@pool/core";

export interface WeatherReport {
  latitude: number;
  longitude: number;
  timezone: string;
  current: CurrentConditions | null;
  daily: DailyForecast[];
  fetchedAt: string;
  provider: string;
}

/** Any weather API can be plugged in by producing a WeatherReport. */
export interface WeatherProvider {
  readonly id: string;
  getForecast(latitude: number, longitude: number, days: number): Promise<WeatherReport>;
}
