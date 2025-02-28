import axios from "axios";
import { Env } from "../start/env";

export const WPP_API = axios.create({
  baseURL: "https://graph.facebook.com/v22.0",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${Env.WPP_API_TOKEN}`,
  },
});
