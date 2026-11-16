import { config } from "dotenv";

// Integration tests read DATABASE_URL from .env.local; they skip themselves if it's absent.
config({ path: ".env.local", quiet: true });
