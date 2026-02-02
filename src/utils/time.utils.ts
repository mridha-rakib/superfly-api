const TIME_PATTERN = /^\s*(\d{1,2})(?::(\d{1,2}))?\s*(am|pm)?\s*$/i;

const pad = (value: number) => value.toString().padStart(2, "0");

export const parseTimeTo24Hour = (value?: string): string | null => {
  if (!value) {
    return null;
  }
  const match = value.match(TIME_PATTERN);
  if (!match) {
    return null;
  }
  let [, hourPart, minutePart = "00", period] = match;
  let hour = Number(hourPart);
  let minute = Number(minutePart) || 0;

  if (period) {
    if (period.toLowerCase() === "pm" && hour < 12) {
      hour += 12;
    }
    if (period.toLowerCase() === "am" && hour === 12) {
      hour = 0;
    }
  }

  hour = Math.max(0, Math.min(23, hour));
  minute = Math.max(0, Math.min(59, minute));

  return `${pad(hour)}:${pad(minute)}`;
};

export const normalizeTimeTo24Hour = (value?: string): string => {
  const raw = (value || "").trim();
  if (!raw) return "";
  return parseTimeTo24Hour(raw) || raw;
};

export const formatTimeTo12Hour = (value?: string): string => {
  if (!value) return "";
  const normalized = parseTimeTo24Hour(value) || value.trim();
  const [hourPart = "0", minutePart = "00"] = normalized.split(":");
  const hour = Number(hourPart);
  const minute = Number(minutePart) || 0;

  if (Number.isNaN(hour) || Number.isNaN(minute)) {
    return value;
  }

  const period = hour >= 12 ? "PM" : "AM";
  const displayHour = ((hour + 11) % 12) + 1;

  return `${displayHour}:${pad(minute)} ${period}`;
};
