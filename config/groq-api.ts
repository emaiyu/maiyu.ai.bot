import axios from "axios";
import { Env } from "../start/env";

export const GROQ_API = axios.create({
  baseURL: "https://api.groq.com/openai/v1",
  // baseURL: "https://api.groq.com/openai/v1/chat/completions",

  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${Env.GROQ_API_KEY}`,
  },
});
