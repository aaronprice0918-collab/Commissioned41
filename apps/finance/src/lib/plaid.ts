import { Configuration, CountryCode, PlaidApi, PlaidEnvironments, Products } from "plaid";

const env = (process.env.PLAID_ENV ?? "sandbox") as keyof typeof PlaidEnvironments;

const configuration = new Configuration({
  basePath: PlaidEnvironments[env] ?? PlaidEnvironments.sandbox,
  baseOptions: {
    headers: {
      "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID,
      "PLAID-SECRET": process.env.PLAID_SECRET,
    },
  },
});

export const plaid = new PlaidApi(configuration);

export const PLAID_PRODUCTS: Products[] = (process.env.PLAID_PRODUCTS ?? "transactions")
  .split(",")
  .map((p) => p.trim() as Products);

export const PLAID_COUNTRY_CODES: CountryCode[] = (process.env.PLAID_COUNTRY_CODES ?? "US")
  .split(",")
  .map((c) => c.trim() as CountryCode);

export function plaidConfigured(): boolean {
  return (
    !!process.env.PLAID_CLIENT_ID &&
    !!process.env.PLAID_SECRET &&
    !process.env.PLAID_CLIENT_ID.startsWith("PASTE") &&
    !process.env.PLAID_SECRET.startsWith("PASTE")
  );
}
