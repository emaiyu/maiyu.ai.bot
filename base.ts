import axios from "axios";
import fastify from "fastify";
const kernel = fastify();
kernel.post("/webhook", async (request, reply) => {
  console.log("payload: ", request.body);
  const event = request.body.event;
  const session = request.body.session;
  const chatId = request.body.payload.from;
  const text = request.body.payload?.body;

  if (!(event === "message")) return;

  console.log("payload: ", { session, chatId, text });

  const response_gsk = await axios.post(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      model: "llama-3.3-70b-versatile",
      // model: "deepseek-r1-distill-llama-70b",
      messages: [{ role: "user", content: text }],
    },
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer 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`,
      },
    }
  );

  const content = response_gsk.data.choices[0].message.content;

  console.log("content: ", content);

  await axios.post("http://localhost:3001/api/sendText", {
    session,
    chatId,
    text: content,
  });

  return reply.status(200).send();
});

kernel.listen({ port: 3000, host: "0.0.0.0" }).then(() => {
  console.info("HTTP Server running on http://localhost:3000");
});
