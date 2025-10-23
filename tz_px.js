import axios from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";
import dotenv from "dotenv";
import fs from "fs";

// Load configuration from config.json
const config = JSON.parse(fs.readFileSync("./c.json", "utf-8"));

const DEFAULT_TIMEZONES = {
  us: "America/New_York",
  uk: "Europe/London",
  fr: "Europe/Paris",
};

export const checkTz = async (username) => {
  dotenv.config();
  const proxyHost = config.proxyHost;
  const proxyPort = config.proxyPort;
  const proxyUsername = username;
  const proxyPassword = process.env.JEDI;

  // Extract country code from username (assuming format contains country code)
  // if not found in username, default to 'us'
  const countryCode = username.split("-")[2]?.toLowerCase();
  const timezone = DEFAULT_TIMEZONES[countryCode] || DEFAULT_TIMEZONES["us"];
  return timezone;
};
