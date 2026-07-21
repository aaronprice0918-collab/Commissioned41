// VIN decoding via NHTSA vPIC — free, public, no API key, CORS-enabled.
// Used to auto-populate vehicle fields when a 17-character VIN is entered.

export type DecodedVin = {
  year: string;
  make: string;
  model: string;
  trim: string;
  body: string;
  cylinders: string;
  fuel: string;
  vehicle: string; // "YEAR MAKE MODEL TRIM"
};

// Standard VIN charset (no I, O, Q) and length.
export function isValidVin(vin: string) {
  return /^[A-HJ-NPR-Z0-9]{17}$/.test((vin || "").toUpperCase());
}

function titleCase(value: string) {
  return (value || "")
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

export async function decodeVin(vin: string): Promise<DecodedVin | null> {
  const clean = (vin || "").trim().toUpperCase();
  if (!isValidVin(clean)) return null;
  try {
    // Hard timeout: this runs inside EILA's awaited tool loop, so a slow/hung
    // NHTSA endpoint would otherwise freeze the whole streamed reply until the
    // function's maxDuration kills it (a visible ~60s hang on the floor).
    const res = await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${clean}?format=json`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const r = data?.Results?.[0];
    if (!r) return null;

    const year = r.ModelYear || "";
    const make = titleCase(r.Make || "");
    const model = r.Model || "";
    const trim = r.Trim || r.Series || "";
    // NHTSA returns an error code; 0 means decoded. Anything with no make/model
    // is not a usable decode.
    if (!make && !model && !year) return null;

    return {
      year,
      make,
      model,
      trim,
      body: r.BodyClass || "",
      cylinders: r.EngineCylinders || "",
      fuel: r.FuelTypePrimary || "",
      vehicle: [year, make, model, trim].filter(Boolean).join(" "),
    };
  } catch {
    return null;
  }
}
