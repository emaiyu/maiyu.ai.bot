import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().default(3333),

  WPP_API_TOKEN: z.string().trim(),
  GROQ_API_KEY: z.string().trim(),

  // DB_HOST: z.string().default('127.0.0.1'),
  // DB_PORT: z.coerce.number().default(27017),
  // DB_USERNAME: z.string(),
  // DB_PASSWORD: z.string(),
  // DB_DATABASE: z.string(),

  // DATABASE_URL: z.string().trim(),

  // APP_KEY: z.string().trim(),

  // EMAIL_PROVIDER_ADDRESS: z.string().trim(),
  // EMAIL_PROVIDER_PASSWORD: z.string().trim(),
  // EMAIL_PROVIDER_HOST: z.string().trim(),
  // EMAIL_PROVIDER_PORT: z.coerce.number(),
  // EMAIL_PROVIDER_USER: z.string().trim(),

  // CLIENT_BASE_URL: z.string().default("http://localhost:5173"),

  // STORAGE_ACCOUNT_ID: z.string().trim(),
  // STORAGE_SECRET_ID: z.string().trim(),
  // STORAGE_SECRET_KEY: z.string().trim(),
  // STORAGE_BUCKET_NAME: z.string().trim(),
  // STORAGE_PUBLIC_URL: z.string().trim(),
});
// console.log(process.env);

const validation = schema.safeParse(process.env);

if (!validation.success) {
  console.error("Invalid environment variables", validation.error.format());
  throw new Error("Invalid environment variables");
}

export const Env = validation.data;
